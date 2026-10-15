import { test, expect, knownDefect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { env } from '../../src/env';
import { K, qa } from '../../src/locators';
import { CreateViewPage } from '../../src/pages/CreateViewPage';
import type { WorkloadPage } from '../../src/pages/WorkloadPage';
import {
  fillCriterion, leaveToAllUsers, checkData, checkDefinition, checkOpened, checkPartition, checkReopened, createCase, ownersOf, removeView, valueKind,
  type Built, type CaseSpec, type Crit, type OwnerWork, type ValueKind,
} from '../../src/createChecks';

/**
 * CVC — Create Workload Report › Criteria: every field × every condition the form offers (read live), one created
 * view per condition, each checked in the five layers of src/createChecks.ts and deleted. Field rules:
 *   User/Resource Is / Is Not   owners = the users (or resources) of All Users, each with its whole work
 *   Role Is / Is Not            owners = All Users owners whose role is (not) the value, whole work
 *   Allocation Type Is <class>  owners = the matching predefined view (Over-, Under-, Optimally-Allocated, Unallocated)
 *   every task-level field      an owner never gains work; paired conditions split All Users work exactly
 *                               (Is / Is Not, Contains / Doesn't Contain, Less Than / Greater Than or Equal,
 *                               Greater Than / Less Than or Equal) — exact for single-valued fields, recorded for
 *                               multi-valued and custom fields (a task with no value is in neither half)
 * Plus CVC-M: two and three criteria with All of these / Any of these, removing a row and Clear All before saving.
 */
// one retry: a case that hits a report still loading after 150 s is created again from scratch (each attempt cleans up)
// every test is independent (its own views, deleted after): mode parallel lets a run be sharded across portals
test.describe.configure({ mode: 'parallel', retries: 1, timeout: 3 * 3600_000 });

const STANDARD = ['User/Resource', 'Allocation Type', 'Role', 'Project', 'Project Group', 'Project Status', 'Task Name', 'Status',
  'Completion Percentage', 'Owner', 'Associated Team', 'Priority', 'Created By', 'Task List', 'Tags', 'Billing Type'] as const;
const SINGLE_VALUED = new Set(['User/Resource', 'Role', 'Project', 'Project Group', 'Project Status', 'Status', 'Priority', 'Task List', 'Billing Type', 'Completion Percentage', 'Task Name']);
const PAIRS: [string, string][] = [['is', 'is_not'], ['contains', 'not_contains'], ['less_than', 'greater_than_or_equal'], ['greater_than', 'less_than_or_equal']];
const PREDEFINED_FOR_ALLOCATION: Record<string, string> = {
  'Unallocated': 'zp.workload.customview.unallocatedusers', 'Under-allocated': 'zp.workload.customview.underallocatedusers',
  'Optimally allocated': 'zp.workload.customview.optimalallocatedusers', 'Over-Allocated': 'zp.workload.customview.overallocatedusers',
};

interface Cond { label: string; code: string; kind: ValueKind; options: string[] }
/** Conditions of a field with their value control and list options, read from the form. */
async function conditionsOf(wl: WorkloadPage, field: string): Promise<Cond[]> {
  const cv = new CreateViewPage(wl.page);
  await cv.open(wl); await cv.openTab('determiner');
  const fields = await cv.selectOptions(cv.fieldSel(0));
  if (!fields.includes(field)) { await qa(wl.page, K.cancel).click(); return []; }
  await cv.choose(cv.fieldSel(0), field);
  const out: Cond[] = [];
  for (const c of await cv.selectOptions(cv.condSel(0))) {
    await cv.choose(cv.condSel(0), c);
    const kind = await valueKind(cv, 0);
    const options = kind === 'list' ? (await cv.describeValue(0)).options : [];
    out.push({ label: c, code: await cv.value(cv.condSel(0)), kind, options });
  }
  await qa(wl.page, K.cancel).click();
  return out;
}
/** Custom fields (anything not standard), read from the form. */
async function customFields(wl: WorkloadPage): Promise<string[]> {
  const cv = new CreateViewPage(wl.page);
  await cv.open(wl); await cv.openTab('determiner');
  const all = await cv.selectOptions(cv.fieldSel(0));
  await qa(wl.page, K.cancel).click();
  return all.filter(f => !(STANDARD as readonly string[]).includes(f));
}

let sample: { taskName: string } | undefined;
async function sampleTask(wl: WorkloadPage) {
  if (sample) return sample;
  const api = new ZpApi(wl.page, wl.d);
  const pid = process.env.ZP_PERM_PROJECT_ID || String((await api.getJson<any[]>('/projects?page=1&per_page=100'))[0]?.id ?? '');
  const t = (await api.tasks(pid).catch(() => [] as any[])).find((x: any) => /^CV /.test(x.name)) ?? (await api.tasks(pid).catch(() => [] as any[]))[0];
  sample = { taskName: String(t?.name ?? 'CV') };
  return sample;
}
/** The value a condition is created with (same value for both halves of a pair). */
function critFor(field: string, c: Cond, s: { taskName: string }): Crit | null {
  const base: Crit = { field, condition: c.label, kind: c.kind };
  switch (c.kind) {
    case 'list': return c.options.length ? { ...base, values: [c.options[0]!] } : null;
    case 'text': {
      if (field !== 'Task Name') return { ...base, text: ['QA'] };
      const t = s.taskName;
      const text = /^(is|is_not)$/.test(c.code) ? t : c.code === 'ends_with' ? t.slice(-6) : t.slice(0, 2);
      return { ...base, text: [text] };
    }
    case 'number': return { ...base, text: [field === 'Completion Percentage' ? '50' : '5'] };
    case 'allocation': return { ...base, allocTab: 'Percentage', text: /between/.test(c.code) ? ['20', '80'] : ['100'] };
    case 'daterange': return { ...base, dateTab: 'Range', text: /between/.test(c.code) ? ['30', '30'] : ['15'] };
    default: return base;
  }
}

let allUsersId = '';
async function allUsers(wl: WorkloadPage) {
  if (allUsersId) return allUsersId;
  const v = (await new ZpApi(wl.page, wl.d).views('predefined_views')).find(x => x.name === 'zp.workload.customview.allusers')!;
  return (allUsersId = String(v.custom_view_id || v.id));
}

/** Create one view per condition of the field and apply the field's rules. */
async function runField(wl: WorkloadPage, field: string) {
  const conds = await conditionsOf(wl, field);
  test.skip(!conds.length, `portal has no "${field}" criteria field`);
  test.info().annotations.push({ type: 'conditions', description: `${field}: ${conds.map(c => `${c.label} (${c.code}, ${c.kind}${c.options.length ? `, ${c.options.length} values` : ''})`).join(' · ')}` });
  const s = await sampleTask(wl);
  const au = await allUsers(wl);
  const api = new ZpApi(wl.page, wl.d);
  const results = new Map<string, { owners: Map<string, OwnerWork>; base: Map<string, OwnerWork>; b: Built }>();
  for (const [k, c] of conds.entries()) {
    const crit = critFor(field, c, s);
    if (!crit) { test.info().annotations.push({ type: 'skipped', description: `${field} ${c.label}: no value to pick (empty list on this portal)` }); continue; }
    await test.step(`${field} ${c.label}`, async () => {
     // one retry per condition when the step throws (a report still loading after 150 s); soft checks never throw
     for (let attempt = 1; attempt <= 2; attempt++) {
      const spec: CaseSpec = { name: `${env.runId}-CVC-${field.replace(/\W+/g, '')}-${c.code}${attempt > 1 ? '-r' : ''}`, criteria: [crit], viewType: 'bar', dataLabel: 'Allocated Hours' };
      let b: Built | undefined;
      try {
        await wl.goto();
        b = await createCase(wl, spec);
        await checkDefinition(api, b);
        const crit0 = (b.body.determiner?.criteria ?? [])[0];
        if (!['none'].includes(c.kind)) expect.soft((crit0?.value ?? []).length, `${spec.name}: the criterion carries a value`).toBeGreaterThan(0);
        if ((b.meta?.status ?? 200) >= 400) {
          // saved, but the report cannot load it: recorded (WL-D-36) and the next condition goes on
          // 400 = WL-D-36 (e.g. Multi Select › Is Empty); 500 = the server error family of WL-D-22 (e.g. Date › Less Than)
          if (b.meta!.status >= 500) knownDefect('WL-D-22', `${field} ${c.label}: a view saved with this criterion gets HTTP ${b.meta!.status} from GET /reports/workload/meta and never renders (the toolbar filter has the same server error)`);
          else knownDefect('WL-D-36', `${field} ${c.label}: saved (201) but GET /reports/workload/meta → ${b.meta!.status}; the view never renders`);
          test.info().annotations.push({ type: 'evidence', description: `${field} ${c.label}: meta ${b.meta!.status} ${b.meta!.text.slice(0, 160)}` });
          expect.soft(b.meta!.status, `${spec.name}: the new view loads (meta ${b.meta!.status})`).toBeLessThan(400);
          break;
        }
        const period = await checkOpened(wl, b);
        const r = await checkData(wl, b, period, au);
        results.set(c.code, { ...r, b });
        if (k === 0) await checkReopened(wl, b);
        await fieldRules(api, field, c, crit, r, period);
        break;
      } catch (e) {
        if (attempt === 2 || /expect\(/.test(String(e)) && !/not found|Timeout/i.test(String(e))) throw e;
        test.info().annotations.push({ type: 'retry', description: `${field} ${c.label}: ${String(e).split('\n')[0].slice(0, 160)} — trying once more` });
      } finally { await leaveToAllUsers(wl); await removeView(api, b?.id ?? '', spec.name); }
     }
    });
  }
  for (const [a, z] of PAIRS) {
    const A = results.get(a), Z = results.get(z);
    // Role applies to users only: resources and the Unassigned row have no role and are in neither half
    const scope = field === 'Role' ? (o: OwnerWork) => !o.resource && !o.unassigned : undefined;
    if (A && Z) checkPartition(`${field} ${a} / ${z}`, A.owners, Z.owners, A.base, SINGLE_VALUED.has(field), scope);
  }
}

/** Field-specific oracles on top of the generic layers. */
async function fieldRules(api: ZpApi, field: string, c: Cond, crit: Crit, r: { owners: Map<string, OwnerWork>; base: Map<string, OwnerWork> }, period: { from: string; to: string }) {
  const ids = (m: Map<string, OwnerWork>, pred: (o: OwnerWork) => boolean) => [...m.values()].filter(pred).map(o => o.id).sort();
  const shown = ids(r.owners, o => !o.unassigned);
  if (field === 'User/Resource') {
    const wantRes = /resource/i.test(crit.values?.[0] ?? '');
    const isNot = c.code === 'is_not';
    expect.soft(shown, `User/Resource ${c.label} ${crit.values?.[0]}`).toEqual(ids(r.base, o => !o.unassigned && (o.resource === wantRes) !== isNot));
  }
  if (field === 'Role') {
    const users = await api.users();
    const roleOf = new Map(users.map((u: any) => [String(u.id), String(u.role?.name ?? '')]));
    const v = crit.values?.[0] ?? '';
    expect.soft(shown, `Role ${c.label} ${v}: owners whose role is${c.code === 'is_not' ? ' not' : ''} ${v}`)
      .toEqual(ids(r.base, o => !o.unassigned && roleOf.has(o.id) && ((roleOf.get(o.id) === v) !== (c.code === 'is_not'))));
  }
  if (field === 'Allocation Type' && c.code === 'is' && crit.values?.[0] && PREDEFINED_FOR_ALLOCATION[crit.values[0]]) {
    const pv = (await api.views('predefined_views')).find(x => x.name === PREDEFINED_FOR_ALLOCATION[crit.values![0]!]);
    if (pv) {
      const ref = await ownersOf(api, String(pv.custom_view_id || pv.id), period.from, period.to, 'days');
      expect.soft(ids(r.owners, o => true), `Allocation Is ${crit.values[0]} = the predefined view's owners`).toEqual(ids(ref, o => true));
    }
  }
  if (field === 'Owner' && c.code === 'is') {
    const names = crit.values ?? [];
    for (const o of r.owners.values()) if (!o.unassigned && o.work > 0) test.info().annotations.push({ type: 'owner', description: `Owner Is ${names.join(', ')}: shows ${o.name} with ${o.work} min` });
  }
}

for (const field of STANDARD) {
  test(`CVC ${field}: every condition creates a view whose data follows the rule`, async ({ wl }) => {
    await runField(wl, field);
  });
}

/**
 * Custom fields differ per portal, so they are read from the live form; one test per position in that list lets a run
 * spread them across portals (a position past the end of the list is skipped).
 */
const MAX_CUSTOM_FIELDS = Number(process.env.ZP_MAX_CUSTOM_FIELDS ?? 30);
for (let i = 0; i < MAX_CUSTOM_FIELDS; i++) {
  test(`CVC custom field #${String(i + 1).padStart(2, '0')}: every condition creates a view whose data follows the rule`, async ({ wl }) => {
    const fields = await customFields(wl);
    test.skip(i >= fields.length, `portal has ${fields.length} custom task fields`);
    test.info().annotations.push({ type: 'custom field', description: fields[i]! });
    await runField(wl, fields[i]!);
  });
}

test('CVC-M All of these / Any of these with two and three criteria; a removed row and Clear All are not saved', async ({ wl }) => {
  const api = new ZpApi(wl.page, wl.d), au = await allUsers(wl);
  const role = (await conditionsOf(wl, 'Role')).find(c => c.code === 'is');
  const status = (await conditionsOf(wl, 'Status')).find(c => c.code === 'is');
  test.skip(!role?.options.length || !status?.options.length, 'needs Role and Status values');
  const A: Crit = { field: 'Role', condition: 'Is', kind: 'list', values: [role!.options[0]!] };
  const B: Crit = { field: 'Status', condition: 'Is', kind: 'list', values: [status!.options[0]!] };
  const run = async (tag: string, spec: Omit<CaseSpec, 'name'>) => {
    const name = `${env.runId}-CVC-M-${tag}`; let b: Built | undefined;
    try {
      await wl.goto(); b = await createCase(wl, { name, viewType: 'bar', dataLabel: 'Allocated Hours', ...spec });
      await checkDefinition(api, b); const period = await checkOpened(wl, b);
      return { ...(await checkData(wl, b, period, au)), b };
    } finally { await leaveToAllUsers(wl); await removeView(api, b?.id ?? '', name); }
  };
  const a = await run('A', { criteria: [A] }), bb = await run('B', { criteria: [B] });
  const and = await run('AND', { criteria: [A, B], match: 'AND' });
  const or = await run('OR', { criteria: [A, B], match: 'OR' });
  for (const o of and.owners.values()) {
    expect.soft(a.owners.has(o.id) && bb.owners.has(o.id), `AND: ${o.name} is in both single-criterion views`).toBe(true);
    expect.soft(o.work, `AND: ${o.name} work ≤ each single criterion`).toBeLessThanOrEqual(Math.min(a.owners.get(o.id)?.work ?? 0, bb.owners.get(o.id)?.work ?? 0));
  }
  // "Any of these" must never show less work than either criterion alone (WL-D-35 candidate: it returns the AND result)
  const sameAsAnd = [...or.owners.values()].every(o => (and.owners.get(o.id)?.work ?? 0) === o.work);
  const below = [...new Set([...a.owners.keys(), ...bb.owners.keys()])].filter(id => (or.owners.get(id)?.work ?? 0) < Math.max(a.owners.get(id)?.work ?? 0, bb.owners.get(id)?.work ?? 0));
  test.info().annotations.push({ type: 'evidence', description: `OR pattern ${or.b.body.determiner?.pattern}; OR = AND for every owner: ${sameAsAnd}; owners below a single criterion: ${below.length}` });
  if (below.length) knownDefect('WL-D-35', 'Create Workload Report: criteria saved with "Any of these" (pattern 1 OR 2) show the "All of these" result — less work than either criterion alone');
  for (const id of new Set([...a.owners.keys(), ...bb.owners.keys()])) {
    const want = Math.max(a.owners.get(id)?.work ?? 0, bb.owners.get(id)?.work ?? 0);
    if (want > 0) expect.soft(or.owners.get(id)?.work ?? 0, `OR: ${a.owners.get(id)?.name ?? bb.owners.get(id)?.name} keeps at least the larger single-criterion work`).toBeGreaterThanOrEqual(want);
  }
  // three criteria, Any of these
  const prio = (await conditionsOf(wl, 'Priority')).find(c => c.code === 'is');
  if (prio?.options.length) {
    const three = await run('ANY3', { criteria: [A, B, { field: 'Priority', condition: 'Is', kind: 'list', values: [prio.options[0]!] }], match: 'OR' });
    expect.soft(three.b.body.determiner?.pattern, 'three criteria, Any of these').toBe('1 OR 2 OR 3');
  }
  // a row removed and Clear All before saving leave no criteria in the request
  await test.step('removed row and Clear All', async () => {
    const name = `${env.runId}-CVC-M-clear`; let id = '';
    try {
      await wl.goto();
      const cv = new CreateViewPage(wl.page); await cv.open(wl); await cv.setName(name);
      await fillCriterion(cv, 0, A); await fillCriterion(cv, 1, B);
      await cv.removeRow(1);
      expect.soft(await cv.rows().count(), 'one row left after removing the second').toBe(1);
      await cv.clearAll();
      const r = await cv.create(); id = r.id;
      expect.soft(r.put.status(), 'saved').toBe(201);
      expect.soft(((r.body.determiner?.criteria ?? []) as unknown[]).length, 'Clear All → no criteria saved').toBe(0);
    } finally { await leaveToAllUsers(wl); await removeView(api, id, name); }
  });
});
