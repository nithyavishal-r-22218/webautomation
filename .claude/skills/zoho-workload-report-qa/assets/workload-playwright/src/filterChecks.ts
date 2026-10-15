import { expect, test, type Browser } from '@playwright/test';
import { ZpApi } from './api';
import { K, qa } from './locators';
import { trackContext, waitForApiBudget } from './rate';
import { env } from './env';
import { WorkloadPage } from './pages/WorkloadPage';
import {
  FilterPanel, criteriaOf, toOwnerRow, NO_VALUE_CONDITIONS, DATE_RANGE_CONDITIONS, DATE_PICK_CONDITIONS,
  type Criterion, type FilterSection, type OwnerRow,
} from './pages/FilterPanel';

/**
 * Shared layers for the Filter specs. Ground truth is the unfiltered report read from the API at the start of a
 * suite (owners, work, availability, allocation, Unassigned, saved-view determiner); nothing is hardcoded.
 *
 * Request format seen live 12-10-2026 (customworkload), `filter` query parameter of GET /reports/workload:
 *   {"criteria":[{"criteria_condition":"<code>","value":["<id or text>",…],"field_name":"<name>"[,"module_name":"projects|tasklist"]}],"pattern":"1","isclearfilter":true}
 *   is_empty → criteria_condition "custom_condition", value ["${IS_EMPTY}"]; all_open/all_closed/today… → value ["${ALL_OPEN}"] / ["${TODAY}"]
 *   Allocation Percentage tab appends "#" to the value ("50#"); Date Range tab sends relative_columns [{offset,unit,prior,cfid}] and no value
 *   Field names: resource_type, allocation, role, status, priority, owner, created_by, tags, name (Task Name),
 *   completion_percentage, id + module_name projects / tasklist; custom fields use their label in snake_case.
 */
export interface Truth {
  viewId: string; owners: Map<string, OwnerRow>; unassignedId: string; determiner: string;
  from: string; to: string; range: string;
  /** users by id with role id/name (from /users), for the Role oracle */
  users: Map<string, { id: string; name: string; roleId: string; roleName: string; email: string }>;
}

const iso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

export async function readTruth(browser: Browser, storageState: string | undefined): Promise<Truth> {
  const ctx = await browser.newContext({ storageState });
  await trackContext(ctx); await waitForApiBudget(60); // a page load held by the budget would outlive Discovery.ready's 60 s
  const page = await ctx.newPage();
  const wl = new WorkloadPage(page); await wl.goto();
  const api = new ZpApi(page, wl.d);
  const viewId = wl.d.meta!.custom_view_id;
  const ch = wl.d.meta!.chart_details;
  const from = iso(ch.start_date!), to = iso(ch.end_date!), range = ch.range || 'days';
  const q = (index: number, unassigned: boolean) => `/reports/workload?project_id=0&from_date=${encodeURIComponent(from + 'T00:00:00.000Z')}`
    + `&to_date=${encodeURIComponent(to + 'T23:59:59.999Z')}&time_period=${range}&report_based_on=users`
    + `&index=${index}&range=50&filter=${encodeURIComponent('{}')}&view_id=${viewId}&sort_order=asc&fetch_unassignee=${unassigned}`;
  const owners = new Map<string, OwnerRow>();
  for (let index = 1; index < 2000; index += 50) {
    const j = await api.getJson<{ owners?: any[]; page_info?: { has_next?: boolean } }>(q(index, false));
    for (const o of j.owners ?? []) owners.set(String(o.id), toOwnerRow(o));
    if (!j.page_info?.has_next || !(j.owners ?? []).length) break;
  }
  const un = await api.getJson<{ owners?: { id: string }[] }>(q(1, true));
  const view = await api.getJson<{ determiner?: unknown }>(`/views/${viewId}?module=workload`);
  const users = new Map<string, Truth['users'] extends Map<string, infer V> ? V : never>();
  for (const u of await api.users().catch(() => [] as any[]))
    users.set(String(u.id), { id: String(u.id), name: u.full_name ?? u.display_name ?? '', roleId: String(u.role?.id ?? ''), roleName: u.role?.name ?? '', email: u.email ?? '' });
  await ctx.close();
  return { viewId, owners, unassignedId: String(un.owners?.[0]?.id ?? ''), determiner: JSON.stringify(view.determiner ?? {}), from, to, range, users };
}

/** Save-view determiner after a suite must equal the one before: toolbar filters never change the saved view. */
export async function assertSavedViewUnchanged(browser: Browser, storageState: string | undefined, truth: Truth) {
  const ctx = await browser.newContext({ storageState });
  await trackContext(ctx); await waitForApiBudget(60);
  const page = await ctx.newPage();
  const wl = new WorkloadPage(page); await wl.goto();
  const saved = await new ZpApi(page, wl.d).getJson<{ determiner?: unknown }>(`/views/${truth.viewId}?module=workload`);
  await ctx.close();
  expect(JSON.stringify(saved.determiner ?? {}), 'toolbar filters never change the saved view').toBe(truth.determiner);
}

/** One filter to apply and verify. */
export interface FilterCase {
  name: string;
  section: FilterSection;
  code: string;
  /** subgroup tab to select first (allocation: hours|percent; owner/created_by: users|teams; date: range|date) */
  tab?: string;
  /** list values to tick (ids as the request sends them) */
  ids?: string[];
  /** typed values (value0, value1) */
  typed?: string[];
  /** Date-tab calendar picks (value0, value1) */
  dates?: Date[];
  /** user-level filters keep each owner's work; task-level filters can only remove work */
  level: 'user' | 'task';
  /** semantic oracle: the owner ids expected (undefined = no rule → consistency layers only) */
  expectOwners?: (truth: Truth) => string[] | undefined;
  /** extra note for the report */
  note?: string;
  /** open defect id: with ZP_EXPECT_KNOWN_DEFECTS=1 a failure of this case is recorded as an issue, not an error */
  knownDefect?: string;
}

export interface CaseResult {
  criterion?: Criterion; criteria: Criterion[]; owners: Map<string, OwnerRow>; unassigned: Set<string>;
  rows: string[]; chips: string; valueLabels: string[]; failures: string[];
}

/** Title-case of a condition code: what the chip shows ("is_not" → "Is Not", "equal" → "Equal"). */
export const chipCondition = (code: string) => code.split('_').map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** field_name observed per section: must stay the same across every condition of the section. */
const fieldNames = new Map<string, string>();

/**
 * Apply one case on the open panel (section already expanded) and check the layers:
 *  1 request criterion  2 UI rows = API owners (+ Unassigned)  3 owners ⊆ unfiltered; work rule by level
 *  4 chips  5 unsaved marker  6 reopened panel keeps the choice  (+ the oracle when the case has one)
 * Soft expectations throughout: a failing layer is recorded, the other layers still run.
 */
export async function applyCase(wl: WorkloadPage, fp: FilterPanel, truth: Truth, c: FilterCase): Promise<CaseResult> {
  const field = c.section.field, label = c.section.label;
  const failures: string[] = [];
  // a case under an open defect (ZP_EXPECT_KNOWN_DEFECTS=1) collects its failures for the report without failing the test
  const quiet = !!c.knownDefect && env.expectKnownDefects;
  const soft = (ok: boolean, msg: string) => { if (!ok) failures.push(msg); if (!quiet) expect.soft(ok, msg).toBe(true); };

  if (!(await fp.isOpen())) await fp.open();
  await fp.expand(field);
  await fp.setConditionOf(field, c.code);
  if (c.tab) await fp.selectTab(field, c.tab);
  let valueLabels: string[] = [];
  if (c.ids?.length) {
    await fp.tickIds(field, c.ids);
    const opts = await fp.valueOptions(field);
    valueLabels = c.ids.map(id => opts.find(o => o.id === id)?.label ?? id);
  }
  if (c.typed) for (const [i, t] of c.typed.entries()) await fp.typeValue(field, t, i);
  if (c.typed) valueLabels = [...c.typed];
  if (c.dates) for (const [i, d] of c.dates.entries()) await fp.pickDate(field, i, d);
  if (c.dates) valueLabels = await Promise.all(c.dates.map((_, i) => fp.dateValue(field, i)));
  const noValue = NO_VALUE_CONDITIONS.has(c.code);
  if (noValue) soft(await fp.valueDisabled(field), `${c.name}: no-value condition shows a disabled value box`);

  // Find
  const cap = fp.capture(); wl.d.resetOwners();
  const first = await fp.find();
  await wl.loadAllRows();
  cap.stop();

  // 1 request
  const criteria = criteriaOf(new URL(first.url()).searchParams.get('filter') ?? '');
  const criterion = criteria.length === 1 ? criteria[0] : criteria.find(x => (fieldNames.get(field) && x.field_name === fieldNames.get(field)));
  soft(criteria.length === 1, `${c.name}: exactly one criterion sent (got ${criteria.length}: ${JSON.stringify(criteria)})`);
  if (criterion) {
    if (!fieldNames.has(field)) fieldNames.set(field, criterion.field_name);
    soft(criterion.field_name === fieldNames.get(field), `${c.name}: field_name "${criterion.field_name}" is the section's (${fieldNames.get(field)})`);
    const expectedCode = c.code === 'is_empty' ? 'custom_condition' : c.code;
    soft(criterion.criteria_condition === expectedCode, `${c.name}: criteria_condition ${criterion.criteria_condition} = ${expectedCode}`);
    if (c.ids?.length) soft(JSON.stringify([...criterion.value].sort()) === JSON.stringify([...c.ids].sort()), `${c.name}: value ${JSON.stringify(criterion.value)} = ticked ids ${JSON.stringify(c.ids)}`);
    if (c.typed && c.section.ftype !== 'Date') {
      const want = c.typed.map(t => (field === 'allocation' && c.tab === 'percent') ? `${t}#` : t);
      soft(JSON.stringify(criterion.value) === JSON.stringify(want), `${c.name}: value ${JSON.stringify(criterion.value)} = typed ${JSON.stringify(want)}`);
    }
    if (c.section.ftype === 'Date' && DATE_RANGE_CONDITIONS.has(c.code)) {
      const rel = (criterion as any).relative_columns as { offset: string; unit: string; prior: string }[] | undefined;
      soft(Array.isArray(rel) && rel.length === (c.typed?.length ?? 0), `${c.name}: relative_columns sent for the Range tab (${JSON.stringify(rel)})`);
      if (rel) c.typed?.forEach((t, i) => soft(rel[i]?.offset === t, `${c.name}: relative offset ${i} = ${t} (got ${rel[i]?.offset})`));
    }
    if (c.section.ftype === 'Date' && DATE_PICK_CONDITIONS.has(c.code)) soft(criterion.value.length === (c.dates?.length ?? 0) && criterion.value.every(v => /\d{4}|\d{2}-\d{2}/.test(v)), `${c.name}: date values sent (${JSON.stringify(criterion.value)})`);
    if (noValue) soft(criterion.value.length === 1 && /^\$\{[A-Z0-9_]+\}$/.test(criterion.value[0]!), `${c.name}: placeholder value for a no-value condition (${JSON.stringify(criterion.value)})`);
  }
  // 2 UI rows = API owners + Unassigned
  const rows = (await wl.rows().evaluateAll(es => es.map(e => (e.getAttribute('data-zpqa') ?? '').replace('username-', '')))).sort();
  const apiIds = [...cap.data.owners.keys(), ...cap.data.unassignedIds].sort();
  soft(JSON.stringify(rows) === JSON.stringify(apiIds), `${c.name}: UI rows (${rows.length}) = API owners + Unassigned (${apiIds.length})`);
  // 3 owners ⊆ unfiltered, work rule
  for (const o of cap.data.owners.values()) {
    const base = truth.owners.get(o.id);
    soft(!!base, `${c.name}: ${o.name} is an owner of the unfiltered view`);
    if (!base) continue;
    if (c.level === 'user') soft(o.totalWork === base.totalWork, `${c.name}: ${o.name} work unchanged by a user-level filter (${o.totalWork} vs ${base.totalWork})`);
    else soft(o.totalWork <= base.totalWork, `${c.name}: ${o.name} work ${o.totalWork} ≤ unfiltered ${base.totalWork} (a task filter only removes work)`);
  }
  // oracle
  const expected = c.expectOwners?.(truth);
  if (expected) soft(JSON.stringify([...cap.data.owners.keys()].sort()) === JSON.stringify([...expected].sort()), `${c.name}: owners ${JSON.stringify([...cap.data.owners.values()].map(o => o.name))} = expected ${JSON.stringify(expected.map(id => truth.owners.get(id)?.name ?? id))}`);
  // 4 chips (values beyond the row fold into "+N": then the chip DOM is checked by id instead of by text)
  const chips = await fp.chips();
  soft(norm(chips).includes(norm(`${label}:`)), `${c.name}: chip names the section (${chips})`);
  const condOpt = c.section.conditions.find(x => x.code === c.code)?.text ?? '';
  const condForms = [chipCondition(c.code), condOpt, ...(c.code === 'not_contains' ? ["Doesn't Contain"] : [])].map(norm);
  soft(condForms.some(f => norm(chips).includes(f)), `${c.name}: chip shows the condition (${chips})`);
  const overflow = await fp.chipOverflow();
  if (c.ids?.length) {
    const chipIds = (await fp.chipValues(field)).sort();
    const anyChips = await fp.chipBar().locator('.filter-category-items').count();
    if (chipIds.length) soft(JSON.stringify(chipIds) === JSON.stringify([...c.ids].sort()), `${c.name}: one chip per ticked value (${chipIds.length} chips, +${overflow} folded)`);
    else soft(anyChips === c.ids.length, `${c.name}: ${anyChips} value chip(s) for ${c.ids.length} ticked value(s) (chips not named by field here)`);
    if (!overflow) for (const v of valueLabels) soft(norm(chips).includes(norm(v)), `${c.name}: chip lists value "${v}" (${chips})`);
  } else for (const v of valueLabels) soft(norm(chips).includes(norm(v)), `${c.name}: chip lists value "${v}" (${chips})`);
  // Expected behaviour (confirmed by the user 12-10-2026): with many chips the bar collapses and "Clear filter" sits
  // behind the "Show More" (⌄ / +N) control. Either the link or the control must be offered (expanded in PN-08).
  if (!(await fp.clearFilterVisible())) soft(await fp.showMore().isVisible(), `${c.name}: "Show More" offered while Clear filter is collapsed (+${overflow} chips folded)`);
  // 5 unsaved marker
  soft((await qa(wl.page, K.viewDropdown).innerText()).includes('*'), `${c.name}: view marked unsaved (*)`);
  soft(await qa(wl.page, K.saveAs).isVisible(), `${c.name}: Save as offered`);
  // 6 the panel keeps the choice
  await fp.open(); await fp.expand(field);
  soft((await fp.conditionOf(field)) === c.code, `${c.name}: condition kept on reopen`);
  if (c.ids?.length) soft(JSON.stringify(await fp.tickedIds(field)) === JSON.stringify([...c.ids].sort()), `${c.name}: ticks kept on reopen`);
  if (c.typed && c.section.ftype !== 'Date') for (const [i, t] of c.typed.entries()) soft((await fp.typedValue(field, i)) === t, `${c.name}: typed value ${i} kept on reopen`);
  const count = await fp.selectionCount(field);
  const wantCount = c.ids?.length ? c.ids.length : 1;
  soft(count === wantCount, `${c.name}: section badge ${count} = ${wantCount}`);

  test.info().annotations.push({ type: 'case', description: `${c.name}: ${criterion ? JSON.stringify(criterion) : 'no criterion'} → ${cap.data.owners.size} owners, ${rows.length} rows, Unassigned ${cap.data.unassignedIds.size ? 'shown' : 'hidden'}; chips "${chips}"${c.note ? '; ' + c.note : ''}` });
  return { criterion, criteria, owners: cap.data.owners, unassigned: cap.data.unassignedIds, rows, chips, valueLabels, failures };
}

/** Clear filter (chip bar) and discard: every row back, no criterion, panel sections reset. */
export async function clearAndDiscard(wl: WorkloadPage, fp: FilterPanel, truth: Truth, name: string) {
  if (await fp.isOpen()) {
    // After a Date-tab case the panel can refuse to close and its backdrop blocks the toolbar (seen 12-10-2026).
    // A toolbar filter never changes the saved view, so reloading the page is a complete reset.
    const closed = await fp.cancel().then(() => true, () => false);
    if (!closed) {
      test.info().annotations.push({ type: 'recovery', description: `${name}: panel would not close — page reloaded` });
      await wl.goto();
      return;
    }
  }
  if (!(await qa(wl.page, K.filterClear).isVisible()) && (await fp.chips()) !== '') {
    // "Clear filter" collapsed behind Show More (many chips): expand the bar; failing that, Reset + Find drops the filter
    await fp.expandChips();
    if (!(await qa(wl.page, K.filterClear).isVisible())) { await fp.open(); await fp.reset(); wl.d.resetOwners(); await fp.find(); await wl.loadAllRows(); }
  }
  if (await qa(wl.page, K.filterClear).isVisible()) {
    wl.d.resetOwners();
    // Clear filter normally re-queries; after some toolbar changes (period arrows) it only clears the chips: wait a bounded time
    const cleared = await Promise.race([fp.clear(), new Promise<null>(r => setTimeout(() => r(null), 30_000))]);
    if (cleared) {
      await wl.loadAllRows();
      expect.soft(criteriaOf(new URL(cleared.url()).searchParams.get('filter') ?? ''), `${name}: no criterion after Clear filter`).toEqual([]);
      await expect.soft(wl.rows(), `${name}: every row back after Clear filter`).toHaveCount(truth.owners.size + (truth.unassignedId ? 1 : 0));
    } else test.info().annotations.push({ type: 'evidence', description: `${name}: Clear filter sent no data request within 30 s (chips "${await fp.chips()}")` });
    expect.soft(await fp.chips(), `${name}: chips gone`).toBe('');
  }
  if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard();
}

/**
 * Run cases one after another on the same page: each case replaces the previous criterion (same section) or follows
 * a section × (different section), so one Find per case. A thrown error (timeout, missing control) is recorded and
 * the run continues with the next case; the test fails at the end if any case failed.
 */
export async function runCases(wl: WorkloadPage, fp: FilterPanel, truth: Truth, cases: FilterCase[]): Promise<Map<string, CaseResult>> {
  const results = new Map<string, CaseResult>();
  const errors: string[] = [];
  let prevField = '';
  for (const c of cases) {
    await test.step(c.name, async () => {
      try {
        if (!(await fp.isOpen())) await fp.open();
        if (prevField && prevField !== c.section.field) { await fp.clearSection(prevField); await fp.collapse(prevField).catch(() => {}); }
        // same section again: drop the previous values first — a tab switch (Users → Team Members) keeps the other tab's ticks
        else if (prevField) await fp.clearSection(c.section.field);
        const r = await applyCase(wl, fp, truth, c);
        results.set(c.name, r);
        if (r.failures.length && c.knownDefect && env.expectKnownDefects) test.info().annotations.push({ type: 'issue', description: `${c.knownDefect}: ${r.failures.join('; ')}` });
        else if (r.failures.length) errors.push(...r.failures);
      } catch (e) {
        const msg = `${c.name}: ${String(e).split('\n')[0]}`;
        if (c.knownDefect && env.expectKnownDefects) test.info().annotations.push({ type: 'issue', description: `${c.knownDefect}: ${msg}` });
        else { errors.push(msg); test.info().annotations.push({ type: 'error', description: msg }); }
        await wl.page.screenshot({ path: `${env.reportsDir}/filter-${c.name.replace(/[^\w-]+/g, '_')}.png` }).catch(() => {});
        // recover: close any calendar / dropdown, the panel, drop the filter, reload the saved view. A timeout means the
        // report may no longer respond (WL-D-22: spinner after a relative-date Less Than): then the page is reloaded.
        await wl.page.keyboard.press('Escape').catch(() => {});
        const timedOut = /Timeout/i.test(String(e));
        const recovered = timedOut ? false : await Promise.race([
          clearAndDiscard(wl, fp, truth, c.name).then(() => true, () => false),
          new Promise<boolean>(r => setTimeout(() => r(false), 90_000)),
        ]);
        if (!recovered || await qa(wl.page, K.saveAs).isVisible().catch(() => false)) {
          test.info().annotations.push({ type: 'recovery', description: `${c.name}: page reloaded${timedOut ? ' after a timeout (report unresponsive?)' : ''}` });
          await wl.goto();
        }
      }
      prevField = c.section.field;
    });
  }
  await clearAndDiscard(wl, fp, truth, 'end');
  expect(errors, `failed layers:\n${errors.join('\n')}`).toEqual([]);
  return results;
}

/** Owner ids whose per-owner work partitions: work(is) + work(is_not) = unfiltered work. */
export function checkPartition(name: string, truth: Truth, a: CaseResult | undefined, b: CaseResult | undefined) {
  if (!a || !b) return;
  for (const [id, base] of truth.owners) {
    const wa = a.owners.get(id)?.totalWork ?? 0, wb = b.owners.get(id)?.totalWork ?? 0;
    expect.soft(wa + wb, `${name}: ${base.name} work(Is) ${wa} + work(Is Not) ${wb} = unfiltered ${base.totalWork}`).toBe(base.totalWork);
  }
}

/** Standard sections by field key (system column ids seen on customworkload 12-10-2026), with the label as a fallback. */
export const STANDARD_FIELDS: Record<string, string> = {
  resourcetype: 'User/Resource', allocation: 'Allocation Type', userrole: 'Role',
  '1': 'Project', '2': 'Project Group', '3': 'Project Status',
  '32': 'Task Name', '4': 'Status', '48': 'Completion Percentage', '5': 'Owner', '26': 'Associated Team', '6': 'Priority',
  '11': 'Created By', '47': 'Task List', '14': 'Tags', '25': 'Billing Type',
};
export function findSection(sections: FilterSection[], key: string): FilterSection | undefined {
  return sections.find(s => s.field === key) ?? sections.find(s => s.label === STANDARD_FIELDS[key]);
}
export const isCustomSection = (s: FilterSection) => !(s.field in STANDARD_FIELDS) && !Object.values(STANDARD_FIELDS).includes(s.label);

/** Is / Is Not × {first} {first two} {all} for a checkbox-list section, plus the partition check on the first value. */
export function listCases(prefix: string, section: FilterSection, options: { id: string; label: string }[], level: 'user' | 'task'): FilterCase[] {
  const first = options[0]!, two = options.slice(0, 2), all = options;
  const cases: FilterCase[] = [
    { name: `${prefix} Is ${first.label}`, section, code: 'is', ids: [first.id], level },
    { name: `${prefix} Is Not ${first.label}`, section, code: 'is_not', ids: [first.id], level },
  ];
  if (two.length > 1) cases.push({ name: `${prefix} Is two values`, section, code: 'is', ids: two.map(o => o.id), level });
  if (all.length > 2) cases.push({ name: `${prefix} Is all values`, section, code: 'is', ids: all.map(o => o.id), level });
  if (all.length > 1) cases.push({ name: `${prefix} Is Not all values`, section, code: 'is_not', ids: all.map(o => o.id), level, note: 'Is Not every value: expected to leave no work (check spec)' });
  return cases;
}

/** What one Find did, for inputs the spec does not define (edge values): recorded rather than judged. */
export interface ProbeResult {
  criteria: Criterion[]; requested: boolean; chips: string; rows: number; panelOpen: boolean; validation: string;
  responsive: boolean; typedBack: string[]; jsErrors: string[];
}

/**
 * Set a condition, key values in, Find, and record what happened: request criteria (or none), chips, rows, whether
 * the panel stayed open, any validation text shown in the section, whether the page still responds, and what the
 * value boxes hold afterwards. Then drop the filter again (Reset + Find, or Clear filter). Never throws on app
 * behaviour: a locator failure is reported as `responsive: false`.
 */
export async function probeFind(wl: WorkloadPage, fp: FilterPanel, field: string, code: string, o: { typed?: string[]; tab?: string; ids?: string[]; dates?: Date[]; settle?: number } = {}): Promise<ProbeResult> {
  const r: ProbeResult = { criteria: [], requested: false, chips: '', rows: 0, panelOpen: false, validation: '', responsive: true, typedBack: [], jsErrors: [] };
  const onErr = (e: Error) => r.jsErrors.push(`pageerror: ${String(e.message || e).slice(0, 200)}`);
  const onCon = (m: { type(): string; text(): string }) => { if (m.type() === 'error' && !/favicon|404|net::ERR/.test(m.text())) r.jsErrors.push(`console: ${m.text().slice(0, 200)}`); };
  wl.page.on('pageerror', onErr); wl.page.on('console', onCon);
  try {
    if (!(await fp.isOpen())) await fp.open();
    await fp.expand(field);
    await fp.clearSection(field);
    await fp.setConditionOf(field, code);
    if (o.tab) await fp.selectTab(field, o.tab);
    if (o.ids) await fp.tickIds(field, o.ids);
    if (o.typed) for (const [i, t] of o.typed.entries()) {
      const el = fp.valueInput(field, i);
      const target = (await el.evaluate(e => e.tagName)) === 'INPUT' || (await el.evaluate(e => e.tagName)) === 'TEXTAREA' ? el : el.locator('input, textarea').first();
      await target.click({ timeout: 10_000 }); await target.press('ControlOrMeta+a'); await target.press('Backspace');
      if (t) await target.pressSequentially(t, { delay: 15 });
      await target.press('Tab');
    }
    if (o.dates) for (const [i, d] of o.dates.entries()) await fp.pickDate(field, i, d);
    const cap = fp.capture(); wl.d.resetOwners();
    const first = fp.find().then(x => x, () => null);
    await qa(wl.page, K.filterFind).isVisible().catch(() => {});
    const resp = await Promise.race([first, new Promise<null>(res => setTimeout(() => res(null), o.settle ?? 8_000))]);
    if (resp) { r.requested = true; r.criteria = criteriaOf(new URL(resp.url()).searchParams.get('filter') ?? ''); await wl.loadAllRows(60_000).catch(() => {}); }
    cap.stop();
    r.panelOpen = await fp.isOpen();
    r.validation = await wl.page.locator(`#filterdiv_${field} [class*="error" i], #filterdiv_${field} [class*="invalid" i], #filterdiv_${field} [class*="warn" i], .zps-filter-popup [class*="toast" i], [class*="toast" i]`).filter({ visible: true }).allInnerTexts().then(a => a.join(' | ').trim(), () => '');
    r.chips = await fp.chips();
    r.rows = await wl.rows().count();
    if (!(await fp.isOpen())) await fp.open();
    await fp.expand(field);
    for (let i = 0; i < (o.typed?.length ?? 0); i++) r.typedBack.push(await fp.typedValue(field, i).catch(() => '(n/a)'));
    r.responsive = await qa(wl.page, K.viewDropdown).isVisible({ timeout: 5_000 }).catch(() => false);
  } catch (e) {
    r.responsive = false;
    r.validation = `${r.validation} [${String(e).split('\n')[0].slice(0, 160)}]`.trim();
  }
  wl.page.off('pageerror', onErr); wl.page.off('console', onCon);
  test.info().annotations.push({ type: 'probe', description: `${field} ${code} ${JSON.stringify(o.typed ?? o.ids ?? (o.dates ?? []).map(d => d.toDateString()))}: requested=${r.requested} criteria=${JSON.stringify(r.criteria)} chips="${r.chips}" rows=${r.rows} panelOpen=${r.panelOpen} validation="${r.validation}" typedBack=${JSON.stringify(r.typedBack)} responsive=${r.responsive}${r.jsErrors.length ? ` jsErrors=${JSON.stringify(r.jsErrors.slice(0, 3))}` : ''}` });
  if (!r.responsive) await wl.page.screenshot({ path: `${env.reportsDir}/filter-freeze-${field}-${code}-${Date.now()}.png` }).catch(() => {});
  // drop the filter
  try {
    if (!r.responsive) { await wl.goto(); return r; }
    if (!(await fp.isOpen())) await fp.open();
    await fp.reset(); await fp.findNoWait();
    if (await qa(wl.page, K.filterClear).isVisible()) await fp.clear().catch(() => {});
    if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard().catch(() => {});
  } catch { await wl.goto(); }
  return r;
}
