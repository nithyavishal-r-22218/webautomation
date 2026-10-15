import fs from 'fs';
import { expect, test, type Page, type Response } from '@playwright/test';
import { ZpApi } from './api';
import { env } from './env';
import { K, qa } from './locators';
import { knownDefect } from './fixtures';
import { CreateViewPage } from './pages/CreateViewPage';
import type { WorkloadPage } from './pages/WorkloadPage';
import type { ViewType, ViewStyle } from './pages/WorkloadEditPage';
import { addDays, expectedRange, headerText, NoRuleError, shown, startOfWeek, type Range, type Unit } from './dates';
import { uiRows } from './pdfExport';

/**
 * Shared layers for the Create Workload Report specs (tests/workload/create-view*.spec.ts).
 *
 * A case is created through the UI, then checked in five layers:
 *   1. request   the PUT /reports/custom-workload body carries every choice (codes read from the form while filling)
 *   2. stored    GET /views/{id} returns the same definition
 *   3. listed    the view is in the creator's list (My Custom Views)
 *   4. opened    the app opens it: dropdown name, URL custom-view/<id>, period header, view type, data label, grouping
 *   5. data      UI rows = the view's own API owners; per-owner work against All Users for the same period, with a
 *                rule per criterion (user-level fields keep work; task-level fields never add work; partitions sum up)
 * The view is deleted (DELETE /views/{id}) in a finally block, whatever happens.
 */
export interface Crit { field: string; condition: string; values?: string[]; kind?: ValueKind; text?: string[]; allocTab?: 'Hours' | 'Percentage'; dateTab?: 'Range' | 'Date' }
export type ValueKind = 'list' | 'select' | 'text' | 'number' | 'date' | 'daterange' | 'dates' | 'allocation' | 'none';
export interface CaseSpec {
  name: string; description?: string;
  viewType?: ViewType; unit?: Unit; option?: string; custom?: [Date, Date];
  style?: ViewStyle; dataLabel?: string; reportsFor?: 'users' | 'teams';
  grouping?: string; order?: 'Asc' | 'Desc';
  match?: 'AND' | 'OR'; criteria?: Crit[];
  share?: { mode: 'none' | 'all' | 'users'; users?: string[] };
  projects?: { mode: 'none' | 'all' | 'projects'; projects?: string[] };
}
export interface Built { spec: CaseSpec; id: string; body: Record<string, any>; def: Record<string, any>; codes: { field: string; condition: string }[]; status: number; meta?: { status: number; text: string }; cap?: ViewCapture }
export interface OwnerWork { id: string; name: string; work: number; alloc: string; resource: boolean; unassigned: boolean }

/** JSON with sorted keys, so stored and sent objects compare regardless of key order. */
export const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const ymd = iso;

/** Which value control a condition shows — read live from the row. */
export async function valueKind(cv: CreateViewPage, i: number): Promise<ValueKind> {
  const row = cv.rows().nth(i);
  // the value control is re-rendered after a condition change: give it a moment to appear
  await row.locator('.condition-select-class, custom-allocation-range, daterange-picker, ruc-date-range, ruc-date, ruc-decimal, ruc-input, ruc-textarea').first().waitFor({ timeout: 5_000 }).catch(() => {});
  if (await row.locator('custom-allocation-range').count()) return 'allocation';
  if (await row.locator('daterange-picker').count()) return 'daterange';
  if (await row.locator('ruc-date-range').count()) return 'dates';
  if (await row.locator('ruc-date').count()) return 'date';
  if (await row.locator('.condition-select-class .ztokenfield').count()) return 'list';
  // a plain dropdown (e.g. the Checkbox field: Yes / No) has a select box but no token field
  if (await row.locator('.condition-select-class .zselectbox__selected, ruc-select.condition-select-class .zselectbox__selected').count()) return 'select';
  if (await row.locator('ruc-decimal').count()) return 'number';
  const inp = row.locator('.condition-select-class input, ruc-textarea textarea, textarea').first();
  if (await inp.count()) return (await inp.isDisabled().catch(() => false)) ? 'none' : 'text';
  return 'none';
}

/** Fill row i: field, condition, then a value suited to the control. Returns the field and condition codes. */
export async function fillCriterion(cv: CreateViewPage, i: number, c: Crit): Promise<{ field: string; condition: string; kind: ValueKind }> {
  const page = cv.page;
  await cv.openTab('determiner');
  while ((await cv.rows().count()) <= i) await cv.addRow();
  await cv.choose(cv.fieldSel(i), c.field);
  await cv.choose(cv.condSel(i), c.condition);
  const field = await cv.value(cv.fieldSel(i)), condition = await cv.value(cv.condSel(i));
  const kind = c.kind ?? await valueKind(cv, i);
  const row = cv.rows().nth(i);
  const done = async () => { await page.getByText('Done', { exact: true }).filter({ visible: true }).last().click(); await page.waitForTimeout(400); };
  switch (kind) {
    case 'list': {
      const box = cv.valueBox(i);
      const want = c.values?.length ? c.values : [];
      await box.locator('.ztokenfield__textbox').click();
      if (!want.length) { await page.locator('li.zdropdownlist__item').filter({ visible: true }).first().click(); }
      // list items can carry a prefix (projects: "ZO-3" + name), so they are matched with whitespace ignored
      const norm = (t: string) => t.replace(/\s+/g, '');
      const pickItem = async (v: string) => {
        const items = page.locator('li.zdropdownlist__item').filter({ visible: true });
        await items.first().waitFor({ timeout: 10_000 }).catch(() => {});
        const texts = (await items.allInnerTexts()).map(norm);
        // user lists show avatar initials before the name ("CL Current Login User"): try the value with and without them
        const wants = [norm(v), norm(v.replace(/^[A-Z]{1,3}\s+/, ''))];
        let i = texts.findIndex(t => wants.includes(t));
        if (i < 0) i = texts.findIndex(t => !!t && wants.some(w => t.endsWith(w) || w.endsWith(t)));
        if (i >= 0) { await items.nth(i).click(); return true; }
        return false;
      };
      for (const v of want) {
        await box.locator('.ztokenfield__textbox').click();
        if (await pickItem(v)) continue;
        // not in the first page of the list: type a search term (the longest word of the value) and pick again
        const term = (v.replace(/^[A-Z]{1,3}\s+/, '').split(/[\s-]+/).sort((a, b) => b.length - a.length)[0] ?? v).slice(0, 12);
        await box.locator('.ztokenfield__textbox').pressSequentially(term);
        expect(await pickItem(v), `value "${v}" offered in the list`).toBe(true);
      }
      await page.keyboard.press('Escape');
      break;
    }
    case 'select': {
      // plain dropdown: pick the wanted label, else the first option
      const sel = row.locator('ruc-select.condition-select-class, .condition-select-class ruc-select').first();
      await sel.locator('.zselectbox__selected').click();
      const items = page.locator('li.zdropdownlist__item').filter({ visible: true }); await items.first().waitFor({ timeout: 10_000 });
      const want = c.values?.[0]; const named = want ? items.filter({ hasText: want }).first() : null;
      if (named && await named.count()) await named.click(); else await items.first().click();
      break;
    }
    case 'text': case 'number': {
      const inp = row.locator('.condition-select-class input, ruc-textarea textarea, textarea').filter({ visible: true }).first();
      await inp.click(); await inp.pressSequentially(c.text?.[0] ?? (kind === 'number' ? '50' : 'CV'));
      await page.keyboard.press('Tab');
      break;
    }
    case 'allocation': {
      await row.locator('[data-zpqa="custom-allocation-trigger"]').click();
      await qa(page, c.allocTab === 'Hours' ? 'customalloc_tab_hours' : 'customalloc_tab_percent').filter({ visible: true }).first().click();
      const vals = c.text ?? (/between/.test(condition) ? ['20', '80'] : ['50']);
      for (let k = 0; k < vals.length; k++) { const inp = qa(page, `input_allocation_input_${k}`).filter({ visible: true }).first(); await inp.click(); await inp.pressSequentially(vals[k]!); }
      await done();
      break;
    }
    case 'daterange': {
      await row.locator('daterange-picker .select-style').click();
      await qa(page, c.dateTab === 'Date' ? 'daterange_tab_date' : 'daterange_tab_range').filter({ visible: true }).first().click();
      const vals = c.text ?? (/between/.test(condition) ? ['30', '30'] : ['15']);
      for (let k = 0; k < vals.length; k++) { const inp = qa(page, `input_rangevalue_${k}`).filter({ visible: true }).first(); await inp.click(); await inp.fill(''); await inp.pressSequentially(vals[k]!); }
      await done();
      break;
    }
    case 'date': {
      await row.locator('ruc-date input').first().click();
      await page.getByText('Today', { exact: true }).filter({ visible: true }).last().click();
      break;
    }
    case 'dates': {
      const ins = row.locator('ruc-date input');
      for (let k = 0; k < 2; k++) {
        await ins.nth(k).click();
        if (k === 0) await page.getByText('Today', { exact: true }).filter({ visible: true }).last().click();
        else { // a day near the end of the month shown, after today
          const t = new Date(); const d = new Date(t.getFullYear(), t.getMonth(), Math.min(28, t.getDate() + 10));
          const cell = page.locator(`[data-date="${shown(d)}"]`).filter({ visible: true }).first();
          if (await cell.count()) await cell.click(); else await page.getByText('Today', { exact: true }).filter({ visible: true }).last().click();
        }
      }
      break;
    }
    case 'none': break;
  }
  return { field, condition, kind };
}

/**
 * The data the app itself loads for a view (pages of GET /reports/workload?view_id=… and the Unassigned row), so a check
 * does not fetch the same rows again. Complete once the last page (page_info.has_next false) and the Unassigned call
 * were seen; grouped views load through other endpoints and fall back to the API.
 */
export interface ViewCapture { ownersFor(viewId: string, from: string, to: string): Map<string, OwnerWork> | undefined; stop(): void }
export function captureView(page: Page): ViewCapture {
  const seen = new Map<string, { owners: Map<string, OwnerWork>; last: boolean; un: boolean }>();
  const on = async (r: Response) => {
    const u = new URL(r.url());
    if (!/\/reports\/workload$/.test(u.pathname) || !r.ok()) return;
    const key = `${u.searchParams.get('view_id')}|${(u.searchParams.get('from_date') ?? '').slice(0, 10)}|${(u.searchParams.get('to_date') ?? '').slice(0, 10)}`;
    const j = await r.json().catch(() => null); if (!j) return;
    const e = seen.get(key) ?? { owners: new Map(), last: false, un: false }; seen.set(key, e);
    const un = u.searchParams.get('fetch_unassignee') === 'true';
    for (const o of (j.owners ?? []) as any[]) e.owners.set(String(o.id), { id: String(o.id), name: String(o.name ?? ''), work: Number(o.work?.total_work ?? 0), alloc: String(o.work?.overall_allocation ?? ''), resource: !!o.is_resource, unassigned: un });
    if (un) e.un = true; else if (j.page_info?.has_next === false || !(j.owners ?? []).length) e.last = true;
  };
  page.on('response', on);
  return {
    ownersFor: (viewId, from, to) => { const e = seen.get(`${viewId}|${from}|${to}`); return e && e.last && e.un ? e.owners : undefined; },
    stop: () => page.off('response', on),
  };
}

/**
 * All Users for a period, read once per run and portal: every case compares with it, and the seeded data does not
 * change during a create run. Kept in memory and in <reports>/cache/ (keyed by the run id), so the next test process
 * of the same run reuses it.
 */
const baselines = new Map<string, Map<string, OwnerWork>>();
export async function baselineOf(api: ZpApi, allUsersId: string, from: string, to: string, unit: Unit): Promise<Map<string, OwnerWork>> {
  const key = `${allUsersId}|${from}|${to}|${unit}`;
  const mem = baselines.get(key); if (mem) return mem;
  const file = `${env.reportsDir}/cache/baseline-${env.runId}.json`;
  let disk: Record<string, OwnerWork[]> = {};
  try { disk = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
  if (disk[key]) { const m = new Map(disk[key]!.map(o => [o.id, o])); baselines.set(key, m); return m; }
  const m = await ownersOf(api, allUsersId, from, to, unit);
  baselines.set(key, m);
  try { fs.mkdirSync(`${env.reportsDir}/cache`, { recursive: true }); disk[key] = [...m.values()]; fs.writeFileSync(file, JSON.stringify(disk)); } catch { /* cache is best effort */ }
  return m;
}

/** Reload the report only when the page cannot open the create form (no toolbar, or a "Permission Denied" page). */
export async function ensureReport(wl: WorkloadPage) {
  const ok = await qa(wl.page, K.viewDropdown).isVisible().catch(() => false);
  const denied = await wl.page.getByText('Permission Denied').filter({ visible: true }).count().catch(() => 0);
  if (!ok || denied) await wl.goto();
}

/** Open the form, fill the case, save. The form state is recorded just before Save (to tell UI and request apart). */
export async function createCase(wl: WorkloadPage, spec: CaseSpec): Promise<Built> {
  const cv = new CreateViewPage(wl.page);
  await ensureReport(wl);
  await cv.open(wl);
  await cv.setName(spec.name);
  if (spec.description !== undefined) await qa(wl.page, K.description).pressSequentially(spec.description);
  if (spec.viewType) await cv.setViewType(spec.viewType);
  const codes: Built['codes'] = [];
  if (spec.criteria?.length) {
    for (let i = 0; i < spec.criteria.length; i++) { const r = await fillCriterion(cv, i, spec.criteria[i]!); codes.push({ field: r.field, condition: r.condition }); }
    if (spec.match) await cv.match(spec.match);
  }
  if (spec.unit) await cv.setUnit(spec.unit);
  if (spec.option) await cv.setRelative(spec.option);
  // the default option depends on the unit (Months has no "This Month": it opens on Next 6 Months): read what the form chose
  if (!spec.option && !spec.custom) { const st = await cv.formState(); if (st.mode === 'Relative' && st.option) spec.option = st.option; }
  if (spec.custom) await cv.setCustom(spec.unit ?? 'days', spec.custom[0], spec.custom[1]);
  if (spec.grouping) {
    const offered = await cv.grouping(spec.grouping, spec.order ?? 'Asc');
    if (offered) {
      // a form rule, not a failure: e.g. the Timeline view type offers only "None"
      test.info().annotations.push({ type: 'constraint', description: `${spec.name}: grouping "${spec.grouping}" is not offered for ${spec.viewType ?? 'heatmap'} / ${spec.reportsFor ?? 'users'} (offered: ${offered.join(', ')})` });
      spec.grouping = undefined; spec.order = undefined;
    }
    test.info().annotations.push({ type: 'form', description: `${spec.name}: grouping on screen after choosing: ${(await cv.groupSelects().allInnerTexts().catch(() => [])).map(t => t.trim()).join(' / ')}` });
  }
  // Reports For and the expanded-view style are not offered for every view type (Timeline shows neither): a form rule
  const offered = async (value: string) => { await cv.openTab('report_preference'); return wl.page.locator('ruc-radio-button', { has: wl.page.locator(`input[value="${value}"]`) }).filter({ visible: true }).count(); };
  if (spec.reportsFor) {
    if (await offered(spec.reportsFor)) await cv.reportsFor(spec.reportsFor);
    else { test.info().annotations.push({ type: 'constraint', description: `${spec.name}: Reports For is not offered for ${spec.viewType ?? 'heatmap'}` }); spec.reportsFor = undefined; }
  }
  if (spec.style) {
    if ((await offered('gantt')) && (await offered(spec.style))) await cv.setViewStyle(spec.style);
    else { test.info().annotations.push({ type: 'constraint', description: `${spec.name}: the expanded-view style is not offered for ${spec.viewType ?? 'heatmap'}` }); spec.style = undefined; }
  }
  if (spec.dataLabel) {
    const labels = await cv.dataLabelOptions();
    if (labels.includes(spec.dataLabel)) await cv.setDataLabel(spec.dataLabel);
    else {
      // a form rule: e.g. the Timeline view type offers fewer data labels
      test.info().annotations.push({ type: 'constraint', description: `${spec.name}: data label "${spec.dataLabel}" is not offered for ${spec.viewType ?? 'heatmap'} / ${spec.unit ?? 'days'} (offered: ${labels.join(', ')})` });
      spec.dataLabel = undefined;
    }
  }
  if (spec.share) await cv.share(spec.share.mode, spec.share.users);
  if (spec.projects) await cv.otherProjects(spec.projects.mode, spec.projects.projects);
  if (spec.grouping) { await cv.openTab('grouping'); test.info().annotations.push({ type: 'form', description: `${spec.name}: grouping on screen just before Save: ${(await cv.groupSelects().allInnerTexts().catch(() => [])).map(t => t.trim()).join(' / ')}` }); }
  // the rows the app loads for the new view are read from its own responses (captureView)
  const cap = captureView(wl.page);
  // the new view's meta request tells whether it can load at all (WL-D-36: some criteria give 400 here)
  const metaResp = wl.page.waitForResponse(x => /\/reports\/workload\/meta\?/.test(x.url()), { timeout: 150_000 }).catch(() => null);
  const r = await cv.create();
  const m = await metaResp;
  const meta = m ? { status: m.status(), text: (await m.text().catch(() => '')).slice(0, 300) } : undefined;
  const api = new ZpApi(wl.page, wl.d);
  const id = r.id || await idOf(api, spec.name);
  const def = id ? await api.view(id) : {};
  return { spec, id, body: r.body, def, codes, status: r.put.status(), meta, cap };
}
/**
 * Switch the tab to All Users before a created view is deleted: a tab still on a view that is deleted elsewhere
 * reopens it from its own state and lands on "Permission Denied" (seen 14-10-2026; CVE-19 records it).
 */
let allUsersViewId = '';
export async function leaveToAllUsers(wl: WorkloadPage) {
  const page = wl.page;
  try {
    if (!(await qa(page, K.viewDropdown).isVisible().catch(() => false))) {
      // a view that cannot render (no toolbar, e.g. WL-D-36) is left by opening All Users by its own URL
      if (!allUsersViewId) {
        const v = (await new ZpApi(page, wl.d).views('predefined_views')).find(x => x.name === 'zp.workload.customview.allusers');
        allUsersViewId = v ? String(v.custom_view_id || v.id) : '';
      }
      if (allUsersViewId) await page.goto(`${env.baseUrl}/portal/${env.portal}#zp/reports/workload/custom-view/${allUsersViewId}/details`);
      await expect(qa(page, K.viewDropdown)).toContainText('All Users', { timeout: 150_000 });
      return;
    }
    if (/^\s*All Users\s*$/.test(await qa(page, K.viewDropdown).innerText().catch(() => ''))) return;
    await wl.openViews();
    await page.locator('.customview-name').filter({ hasText: /^\s*All Users\s*$/ }).filter({ visible: true }).first().click();
    await expect(qa(page, K.viewDropdown)).toContainText('All Users', { timeout: 90_000 });
  } catch { /* best effort: the deletion still runs */ }
}
export async function idOf(api: ZpApi, name: string) { const v = [...(await api.allViews()).values()].find(x => x.name === name); return v ? String(v.custom_view_id || v.id) : ''; }
/** Every listed custom view with that name (the name-keyed allViews map would hide duplicates). */
export async function viewsNamed(api: ZpApi, name: string, projectId?: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const t of ['created_views', 'shared_views'] as const) {
    for (const v of await api.views(t).catch(() => [])) if (v.name === name || (name.endsWith('*') && v.name.startsWith(name.slice(0, -1)))) ids.add(String(v.custom_view_id || v.id));
    if (projectId) {
      const f = encodeURIComponent(JSON.stringify({ view_type: t }));
      const j = await api.getJson<{ user_views?: any[] }>(`/user-views?module=workload&project_id=${projectId}&page=1&per_page=200&filter=${f}`).catch(() => ({ user_views: [] }));
      for (const v of j.user_views ?? []) if (v.name === name || (name.endsWith('*') && String(v.name).startsWith(name.slice(0, -1)))) ids.add(String(v.custom_view_id || v.id));
    }
  }
  return [...ids];
}
/**
 * Delete a created view (and any duplicate of its name). A view created from a project-level report needs the
 * project id: without it DELETE /views/{id} answers 500 (WL-D-34 candidate), so the delete is retried with it.
 */
export async function removeView(api: ZpApi, id: string, name: string, projectId = process.env.ZP_PERM_PROJECT_ID || '') {
  const ids = new Set([id, ...(name ? await viewsNamed(api, name, projectId) : [])].filter(Boolean));
  for (const vid of ids) {
    let st = (await api.deleteView(vid)).status();
    if (st >= 500 && projectId) {
      test.info().annotations.push({ type: 'issue', description: `WL-D-34: DELETE /views/${vid} without project_id → ${st}; retried with the project id` });
      st = (await api.call('DELETE', `/views/${vid}?module=workload&project_id=${projectId}`)).status();
    }
    expect.soft([200, 204, 404], `view ${name || vid} deleted`).toContain(st);
  }
}

/** Layers 1–3: the request, the stored definition and the list. */
export async function checkDefinition(api: ZpApi, b: Built) {
  const s = b.spec, body = b.body, def = b.def;
  expect(b.status, `${s.name}: create → 201`).toBe(201);
  expect(b.id, `${s.name}: has an id`).not.toBe('');
  const soft = (v: unknown, want: unknown, what: string) => expect.soft(v, `${s.name}: ${what}`).toEqual(want);
  soft(body.name, s.name, 'request name');
  soft(body.description ?? '', s.description ?? '', 'request description');
  soft(body.report_preference?.view_type, s.viewType ?? 'heatmap', 'request view type');
  soft(body.view_period?.time_period, s.unit ?? 'days', 'request unit');
  soft(body.view_period?.time_period_type, s.custom ? 'absolute' : 'relative', 'request period type');
  soft(body.report_preference?.report_based_on, s.reportsFor ?? 'users', 'request reports-for');
  if (s.style && (s.viewType ?? 'heatmap') !== 'timeline') soft(body.report_preference?.bar_type, s.style, 'request view style');
  // share and accessibility
  const access = { none: ['only_to_me', 'private'], all: ['public'], users: ['shared'] }[s.share?.mode ?? 'none'];
  expect.soft(access, `${s.name}: request view_access_type ${body.view_access_type}`).toContain(body.view_access_type);
  if (s.share?.mode === 'users') soft((body.shared_users ?? []).length, s.share.users?.length ?? 0, 'request shared users');
  const proj = { none: ['specific_project', 'only_this_project', 'current_project'], all: ['all_projects'], projects: ['selected_projects'] }[s.projects?.mode ?? 'none'];
  expect.soft(proj, `${s.name}: request project_access_type ${body.project_access_type}`).toContain(body.project_access_type);
  if (s.projects?.mode === 'projects') soft((body.shared_projects ?? []).length, s.projects.projects?.length ?? 0, 'request shared projects');
  // criteria
  const crit = (body.determiner?.criteria ?? []) as { field_name: string; condition: string; value?: unknown[] }[];
  soft(crit.length, s.criteria?.length ?? 0, 'request criteria count');
  b.codes.forEach((c, i) => {
    // the form's code can carry the module ("projects.status", "tasklist.id"); the request keeps the field part
    const sent = String(crit[i]?.field_name ?? '');
    expect.soft(sent === c.field || c.field.endsWith(`.${sent}`), `${s.name}: criterion ${i + 1} field ${sent} for ${c.field}`).toBe(true);
    soft(crit[i]?.condition, c.condition, `criterion ${i + 1} condition`);
  });
  if ((s.criteria?.length ?? 0) > 1) {
    const join = s.match === 'OR' ? 'OR' : 'AND';
    soft(body.determiner?.pattern, s.criteria!.map((_, i) => String(i + 1)).join(` ${join} `), 'request pattern');
  }
  // grouping (WL-D-31 candidate: the chosen grouping is replaced by the reports-for field, ascending)
  const g = (body.group_by ?? [])[0] ?? {};
  const base = s.reportsFor ?? 'users';
  if (!s.grouping || s.grouping === 'None') soft(g.field_name, base, 'request grouping None = reports-for field');
  else {
    if (g.field_name === base) knownDefect('WL-D-31', 'Create Workload Report: the Grouping tab choice (field and order) is not saved — group_by is always the reports-for field, ascending');
    expect.soft(g.field_name, `${s.name}: request grouping field for "${s.grouping}"`).not.toBe(base);
    soft(String(g.sort_by ?? '').toLowerCase(), (s.order ?? 'Asc').toLowerCase(), 'request grouping order');
  }
  // stored = request
  for (const k of ['name', 'view_access_type', 'project_access_type'] as const) soft(def[k], body[k], `stored ${k}`);
  soft(def.description ?? '', body.description ?? '', 'stored description');
  soft(def.report_preference, body.report_preference, 'stored report preference');
  soft(def.view_period, body.view_period, 'stored period');
  soft(canon(def.determiner ?? {}), canon(body.determiner ?? {}), 'stored criteria');
  soft(JSON.stringify((def.group_by ?? []).map((x: any) => [x.field_name, x.sort_by])), JSON.stringify((body.group_by ?? []).map((x: any) => [x.field_name, x.sort_by])), 'stored grouping');
  // listed
  const listed = [...(await api.allViews()).values()].find(v => String(v.custom_view_id || v.id) === b.id || v.name === s.name);
  expect.soft(listed, `${s.name}: listed for its creator`).toBeTruthy();
  test.info().annotations.push({ type: 'created', description: `${s.name} → ${b.id} (${(listed as any)?.group ?? '?'}) ${JSON.stringify({ period: body.view_period, pref: body.report_preference, group: body.group_by, det: body.determiner, access: [body.view_access_type, body.project_access_type] }).slice(0, 500)}` });
}

/** The period the view must show (null when the spec defines no rule for the option). */
export function expectedPeriod(s: CaseSpec, today = new Date()): Range | null {
  if (s.custom) {
    // Weeks and Months snap a custom range to whole weeks / months (seen 14-10-2026)
    const [a, z] = s.custom;
    if (s.unit === 'weeks') { const sa = startOfWeek(a, env.weekStart), sz = startOfWeek(z, env.weekStart); return [sa, addDays(sz, 6)]; }
    if (s.unit === 'months') return [new Date(a.getFullYear(), a.getMonth(), 1), new Date(z.getFullYear(), z.getMonth() + 1, 0)];
    return s.custom;
  }
  try { return expectedRange(s.unit ?? 'days', s.option ?? 'This Month', today, env.weekStart); }
  catch (e) { if (e instanceof NoRuleError) return null; throw e; }
}

/** Layer 4: what the app shows after Save. Returns the period the view loaded with (from the header). */
export async function checkOpened(wl: WorkloadPage, b: Built): Promise<{ from: string; to: string }> {
  const s = b.spec, page = wl.page;
  // the name as stored (characters the portal replaces, e.g. emoji → "?", are compared in checkDefinition / CVE-06)
  const shownName = String(b.def.name || s.name).trim();
  await expect(qa(page, K.viewDropdown), `${s.name}: the new view opens`).toContainText(shownName, { timeout: 150_000 });
  expect.soft(page.url(), `${s.name}: URL is the new view`).toContain(`/custom-view/${b.id}`);
  await expect(qa(page, K.calendar)).toBeVisible({ timeout: 150_000 });
  expect.soft(await qa(page, K.saveAs).filter({ visible: true }).count(), `${s.name}: no unsaved marker`).toBe(0);
  const header = (await qa(page, K.calendar).innerText()).trim();
  const exp = expectedPeriod(s);
  if (exp) {
    // Days › Last/Next N Days windows are one day long (known WL-D-02): recorded as that defect
    if (header !== headerText(exp) && (s.unit ?? 'days') === 'days' && /^(Last|Next) \d+ Days$/.test(s.option ?? '')) {
      const longer = /^Last/.test(s.option!) ? headerText([addDays(exp[0], -1), exp[1]]) : headerText([exp[0], addDays(exp[1], 1)]);
      if (header === longer) knownDefect('WL-D-02', 'Days-unit relative windows are one day long (Last/Next N Days show N + 1 days)');
    }
    expect.soft(header, `${s.name}: period header`).toBe(headerText(exp));
  } else test.info().annotations.push({ type: 'check spec', description: `${s.name}: ${s.unit}/${s.option} shows ${header}` });
  const vt = (await qa(page, K.chartType).innerText().catch(() => '')).trim().toLowerCase();
  expect.soft(vt, `${s.name}: toolbar view type`).toContain(s.viewType ?? 'heatmap');
  if (s.dataLabel && s.dataLabel !== 'No Legend') {
    const dl = (await qa(page, K.dataLabel).innerText().catch(() => '')).trim();
    expect.soft(dl, `${s.name}: toolbar data label`).toContain(s.dataLabel);
  }
  if (s.grouping && s.grouping !== 'None') {
    const gb = (await qa(page, K.groupBy).innerText().catch(() => '')).trim();
    test.info().annotations.push({ type: 'opened', description: `${s.name}: toolbar "${gb}"` });
  }
  const [a, z] = header.split(' to ');
  const toIso = (t: string) => { const p = t.split('-').map(Number); return env.dateOrder === 'mdy' ? `${p[2]}-${String(p[0]).padStart(2, '0')}-${String(p[1]).padStart(2, '0')}` : `${p[2]}-${String(p[1]).padStart(2, '0')}-${String(p[0]).padStart(2, '0')}`; };
  return { from: toIso(a!), to: toIso(z!) };
}

/** Owners of a view for a period (all pages + the Unassigned row). */
export async function ownersOf(api: ZpApi, viewId: string, from: string, to: string, unit: Unit, basedOn: 'users' | 'teams' = 'users'): Promise<Map<string, OwnerWork>> {
  const m = new Map<string, OwnerWork>();
  const add = (o: any, un = false) => m.set(String(o.id), { id: String(o.id), name: String(o.name ?? ''), work: Number(o.work?.total_work ?? 0), alloc: String(o.work?.overall_allocation ?? ''), resource: !!o.is_resource, unassigned: un });
  for (const o of await api.workload({ from, to, timePeriod: unit, viewId, basedOn })) add(o);
  if (basedOn === 'users') for (const o of await api.workload({ from, to, timePeriod: unit, viewId, unassigned: true })) add(o, true);
  return m;
}

/** Scroll the grid until the row count is stable, then return the UI row ids. */
/** Wait until the open report has rows or says "No data found" (a page still loading ignores clicks). */
export async function waitLoaded(wl: WorkloadPage, timeout = 150_000) {
  await expect.poll(async () => (await wl.rows().count()) > 0 || (await wl.page.getByText('No data found').filter({ visible: true }).count()) > 0,
    { timeout, intervals: [1000], message: 'report loaded' }).toBe(true);
}
export async function uiIds(wl: WorkloadPage): Promise<string[]> {
  let last = -1, same = 0;
  for (let i = 0; i < 30 && same < 3; i++) {
    await wl.scroller().evaluate(el => { el.scrollTop = el.scrollHeight; }).catch(() => {});
    await wl.page.waitForTimeout(700);
    const n = await wl.rows().count(); same = n === last ? same + 1 : 0; last = n;
  }
  return (await uiRows(wl)).map(r => r.id).filter(Boolean);
}

/** Field level: a user-level criterion keeps each owner's whole work; a task-level one can only remove work. */
export const USER_LEVEL = new Set(['resource_type', 'allocation', 'role']);

/**
 * Layer 5. UI rows = API owners; every owner is an All Users owner (or Unassigned); work never exceeds All Users
 * work; with no criteria (Task Owner) the owners and work equal All Users; user-level criteria keep the whole work.
 * Returns the view's owners for partition checks by the caller.
 */
export async function checkData(wl: WorkloadPage, b: Built, period: { from: string; to: string }, allUsersId: string): Promise<{ owners: Map<string, OwnerWork>; base: Map<string, OwnerWork> }> {
  const s = b.spec, api = new ZpApi(wl.page, wl.d), unit = s.unit ?? 'days';
  const ui = [...new Set(await uiIds(wl))];   // scrolls to the end, so the app has loaded every page
  const fromApp = (s.reportsFor ?? 'users') === 'users' && (!s.grouping || s.grouping === 'None') ? b.cap?.ownersFor(b.id, period.from, period.to) : undefined;
  const owners = fromApp ?? await ownersOf(api, b.id, period.from, period.to, unit, s.reportsFor ?? 'users');
  b.cap?.stop();
  const base = await baselineOf(api, allUsersId, period.from, period.to, unit);
  if ((s.reportsFor ?? 'users') === 'users' && (!s.grouping || s.grouping === 'None')) {
    // the Unassigned row is listed whenever the API returns it, also with 0 work (seen 14-10-2026)
    const want = [...owners.values()].map(o => o.id).sort();
    expect.soft(ui.sort(), `${s.name}: UI rows = the view's API owners`).toEqual(want);
  } else expect.soft(ui.every(id => owners.has(id)), `${s.name}: every UI row is an API owner`).toBe(true);
  if ((s.reportsFor ?? 'users') === 'teams') {
    test.info().annotations.push({ type: 'data', description: `${s.name}: ${owners.size} team rows (${[...owners.values()].map(o => o.name).join(', ').slice(0, 200)})` });
    return { owners, base };
  }
  const crit = (b.body.determiner?.criteria ?? []) as { field_name: string }[];
  for (const o of owners.values()) {
    const ref = base.get(o.id);
    expect.soft(!!ref, `${s.name}: ${o.name} is an All Users owner`).toBe(true);
    if (ref) expect.soft(o.work, `${s.name}: ${o.name} work ≤ All Users work`).toBeLessThanOrEqual(ref.work);
    if (ref && crit.length && crit.every(c => USER_LEVEL.has(c.field_name)))
      expect.soft(o.work, `${s.name}: user-level criteria keep ${o.name}'s whole work`).toBe(ref.work);
  }
  if (!crit.length) {
    expect.soft([...owners.keys()].sort(), `${s.name}: no criteria → the same owners as All Users`).toEqual([...base.keys()].sort());
    for (const o of owners.values()) if (base.get(o.id)) expect.soft(o.work, `${s.name}: ${o.name} work = All Users`).toBe(base.get(o.id)!.work);
  }
  const total = [...owners.values()].reduce((a, o) => a + o.work, 0);
  test.info().annotations.push({ type: 'data', description: `${s.name}: ${owners.size} owners, ${Math.round(total / 60)} h in ${period.from}…${period.to} (All Users ${base.size} owners, ${Math.round([...base.values()].reduce((a, o) => a + o.work, 0) / 60)} h)` });
  return { owners, base };
}

/** Is + Is Not (and the like) must split All Users work exactly, owner by owner. */
export function checkPartition(label: string, a: Map<string, OwnerWork>, b: Map<string, OwnerWork>, base: Map<string, OwnerWork>, strict = true, only?: (o: OwnerWork) => boolean) {
  const diffs: string[] = [];
  const left = [...base.values()].filter(o => only && !only(o) && ((a.get(o.id)?.work ?? 0) + (b.get(o.id)?.work ?? 0)) !== o.work);
  if (left.length) test.info().annotations.push({ type: 'check spec', description: `${label}: in neither half (outside the field's scope): ${left.map(o => `${o.name} ${o.work} min`).join(', ')}` });
  for (const o of base.values()) {
    if (only && !only(o)) continue;
    const sum = (a.get(o.id)?.work ?? 0) + (b.get(o.id)?.work ?? 0);
    if (sum !== o.work) diffs.push(`${o.name}: ${a.get(o.id)?.work ?? 0} + ${b.get(o.id)?.work ?? 0} ≠ ${o.work}`);
  }
  if (strict) expect.soft(diffs, `${label}: the two views split every owner's work exactly`).toEqual([]);
  else if (diffs.length) test.info().annotations.push({ type: 'check spec', description: `${label}: not an exact split (tasks without a value?) — ${diffs.slice(0, 4).join('; ')}` });
}

/** Reopen ••• › Edit on the open view and compare the form with the case. */
export async function checkReopened(wl: WorkloadPage, b: Built) {
  const s = b.spec, cv = new CreateViewPage(wl.page);
  await cv.openEdit();
  const st = await cv.formState();
  expect.soft(st.viewType, `${s.name}: reopened view type`).toBe(s.viewType ?? 'heatmap');
  expect.soft(st.unit, `${s.name}: reopened unit`).toBe(s.unit ?? 'days');
  if (s.option) expect.soft(st.option, `${s.name}: reopened option`).toBe(s.option);
  if (s.dataLabel) expect.soft(st.dataLabel, `${s.name}: reopened data label`).toBe(s.dataLabel);
  expect.soft(await qa(wl.page, K.name).inputValue(), `${s.name}: reopened name`).toBe(s.name);
  if (s.criteria?.length) { await cv.openTab('determiner'); expect.soft(await cv.rows().count(), `${s.name}: reopened criteria rows`).toBe(s.criteria.length); }
  await cv.cancel();
}

/** Seeded pairwise generator: every pair of values of any two factors appears in at least one case. */
export function pairwise<T extends Record<string, readonly unknown[]>>(factors: T, valid: (c: Record<string, unknown>) => boolean = () => true): { [K in keyof T]: T[K][number] }[] {
  const F = factors as unknown as Record<string, readonly unknown[]>;
  const keys = Object.keys(F);
  const pk = (a: string, va: number, b: string, vb: number) => (keys.indexOf(a) < keys.indexOf(b) ? `${a}=${va}|${b}=${vb}` : `${b}=${vb}|${a}=${va}`);
  const uncovered = new Set<string>();
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++)
    for (let a = 0; a < F[keys[i]!]!.length; a++) for (let c = 0; c < F[keys[j]!]!.length; c++)
      if (valid({ [keys[i]!]: F[keys[i]!]![a], [keys[j]!]: F[keys[j]!]![c] })) uncovered.add(pk(keys[i]!, a, keys[j]!, c));
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out: Record<string, unknown>[] = [];
  while (uncovered.size && out.length < 500) {
    let best: { idx: Record<string, number>; gain: number } | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const order = [...keys].sort(() => rnd() - 0.5);
      const idx: Record<string, number> = {}; const val: Record<string, unknown> = {};
      for (const k of order) {
        let bi = -1, bg = -1;
        for (let v = 0; v < F[k]!.length; v++) {
          if (!valid({ ...val, [k]: F[k]![v] })) continue;
          let g = 0;
          for (const k2 of Object.keys(idx)) if (uncovered.has(pk(k, v, k2, idx[k2]!))) g++;
          if (g > bg || (g === bg && rnd() < 0.3)) { bg = g; bi = v; }
        }
        if (bi < 0) bi = 0;
        idx[k] = bi; val[k] = F[k]![bi];
      }
      let gain = 0;
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (uncovered.has(pk(keys[i]!, idx[keys[i]!]!, keys[j]!, idx[keys[j]!]!))) gain++;
      if (!best || gain > best.gain) best = { idx, gain };
    }
    if (!best || best.gain === 0) break;
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) uncovered.delete(pk(keys[i]!, best.idx[keys[i]!]!, keys[j]!, best.idx[keys[j]!]!));
    out.push(Object.fromEntries(keys.map(k => [k, F[k]![best!.idx[k]!]])));
  }
  return out as { [K in keyof T]: T[K][number] }[];
}
