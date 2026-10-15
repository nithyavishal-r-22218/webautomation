import { test, expect } from '../../src/fixtures';
import { FilterPanel } from '../../src/pages/FilterPanel';
import { applyCase, assertSavedViewUnchanged, findSection, readTruth, runCases, type FilterCase, type Truth } from '../../src/filterChecks';

/**
 * FLT-WL — Toolbar › Filter › Workload group: Allocation Type (every condition × Hours / Percentage) and Role
 * (Is / Is Not × every role). User/Resource is in filter-user-resource.spec.ts.
 * Oracles come from the unfiltered API: overall_allocation / total_work / total_availability per owner, and each
 * user's role from /users. Each case checks request, UI = API, work rule, chips, unsaved marker and reopened panel.
 */
test.describe.configure({ mode: 'default', timeout: 1800_000 });
let truth: Truth;
test.beforeAll(async ({ browser }, info) => { test.setTimeout(300_000); truth = await readTruth(browser, info.project.use.storageState as string | undefined); });
test.afterAll(async ({ browser }, info) => { if (truth) await assertSavedViewUnchanged(browser, info.project.use.storageState as string | undefined, truth); });

const hours = (w: number) => w / 60;
const percent = (w: number, a: number) => (a ? (w / a) * 100 : 0);
/** Allocation Type values as the panel lists them: 0 Unallocated · 1 Under-allocated · 2 Optimally allocated · 3 Over-Allocated. */
const allocationClass = (o: { totalWork: number; allocation: string }) =>
  /under/.test(o.allocation) ? '1' : /optimal/.test(o.allocation) ? '2' : /over/.test(o.allocation) ? '3'
    : o.totalWork === 0 || /^(unalloc|none|no)/.test(o.allocation) ? '0' : '?';

test('FLT-WL-01 Allocation Type › Is: each value and all values (oracle: overall_allocation)', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const section = findSection(await fp.sections(), 'allocation');
  test.skip(!section, 'portal has no Allocation Type filter');
  await fp.expand(section!.field);
  const options = await fp.valueOptions(section!.field);
  expect(options.map(o => o.id), 'four allocation classes offered').toEqual(expect.arrayContaining(['0', '1', '2', '3']));
  const cases: FilterCase[] = options.map(o => ({
    name: `WL-01 Allocation Is ${o.label}`, section: section!, code: 'is', ids: [o.id], level: 'user',
    expectOwners: t => [...t.owners.values()].filter(x => allocationClass(x) === o.id).map(x => x.id),
  }));
  cases.push({ name: 'WL-01 Allocation Is all four', section: section!, code: 'is', ids: options.map(o => o.id), level: 'user', expectOwners: t => [...t.owners.keys()] });
  await runCases(wl, fp, truth, cases);
});

test('FLT-WL-02 Allocation Type › Hours: Equal, Less/Greater Than (or Equal), Between (oracle: total_work / 60)', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const found = findSection(await fp.sections(), 'allocation');
  test.skip(!found, 'portal has no Allocation Type filter');
  const section = found!;
  const worked = [...truth.owners.values()].filter(o => o.totalWork > 0).map(o => hours(o.totalWork)).sort((a, b) => a - b);
  test.skip(!worked.length, 'no owner has work in the view');
  const mid = Math.round(worked[Math.floor(worked.length / 2)]!);           // a whole number of hours near the middle
  const exact = worked.find(h => Number.isInteger(h));                         // an owner with a whole-hour total, if any
  const tie = (v: number) => (h: number) => Math.abs(h - v) < 1e-6;
  const sel = (pred: (h: number) => boolean) => (t: Truth) => [...t.owners.values()].filter(o => pred(hours(o.totalWork))).map(o => o.id);
  const cases: FilterCase[] = [
    { name: `WL-02 Hours Equal ${exact ?? mid}`, section, code: 'equal', tab: 'hours', typed: [String(exact ?? mid)], level: 'user', expectOwners: exact !== undefined ? sel(tie(exact)) : undefined, note: exact === undefined ? 'no whole-hour owner: consistency only' : '' },
    { name: `WL-02 Hours Less Than ${mid}`, section, code: 'less_than', tab: 'hours', typed: [String(mid)], level: 'user', expectOwners: sel(h => h < mid) },
    { name: `WL-02 Hours Greater Than ${mid}`, section, code: 'greater_than', tab: 'hours', typed: [String(mid)], level: 'user', expectOwners: sel(h => h > mid) },
    { name: `WL-02 Hours Less Than Or Equal ${mid}`, section, code: 'less_than_or_equal', tab: 'hours', typed: [String(mid)], level: 'user', expectOwners: sel(h => h <= mid) },
    { name: `WL-02 Hours Greater Than Or Equal ${mid}`, section, code: 'greater_than_or_equal', tab: 'hours', typed: [String(mid)], level: 'user', expectOwners: sel(h => h >= mid) },
    { name: `WL-02 Hours Between 1 and ${mid}`, section, code: 'between', tab: 'hours', typed: ['1', String(mid)], level: 'user', expectOwners: sel(h => h >= 1 && h <= mid), note: 'Between taken as inclusive: check spec if the boundary owner differs' },
  ];
  await runCases(wl, fp, truth, cases);
});

test('FLT-WL-03 Allocation Type › Percentage: Equal, Less/Greater Than (or Equal), Between (oracle: work / availability)', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const found = findSection(await fp.sections(), 'allocation');
  test.skip(!found, 'portal has no Allocation Type filter');
  const section = found!;
  const pcts = [...truth.owners.values()].filter(o => o.availability > 0).map(o => percent(o.totalWork, o.availability)).sort((a, b) => a - b);
  test.skip(!pcts.length, 'no owner has availability in the view');
  const mid = Math.max(1, Math.round(pcts[Math.floor(pcts.length / 2)]!));
  const sel = (pred: (p: number) => boolean) => (t: Truth) => [...t.owners.values()].filter(o => o.availability > 0 && pred(percent(o.totalWork, o.availability))).map(o => o.id);
  const cases: FilterCase[] = [
    { name: `WL-03 Percent Equal ${mid}`, section, code: 'equal', tab: 'percent', typed: [String(mid)], level: 'user', note: 'equality on a rounded percentage: consistency only' },
    { name: `WL-03 Percent Less Than ${mid}`, section, code: 'less_than', tab: 'percent', typed: [String(mid)], level: 'user', expectOwners: sel(p => p < mid) },
    { name: `WL-03 Percent Greater Than ${mid}`, section, code: 'greater_than', tab: 'percent', typed: [String(mid)], level: 'user', expectOwners: sel(p => p > mid) },
    { name: `WL-03 Percent Less Than Or Equal ${mid}`, section, code: 'less_than_or_equal', tab: 'percent', typed: [String(mid)], level: 'user', expectOwners: sel(p => p <= mid) },
    { name: `WL-03 Percent Greater Than Or Equal ${mid}`, section, code: 'greater_than_or_equal', tab: 'percent', typed: [String(mid)], level: 'user', expectOwners: sel(p => p >= mid) },
    { name: `WL-03 Percent Between 1 and ${mid}`, section, code: 'between', tab: 'percent', typed: ['1', String(mid)], level: 'user', expectOwners: sel(p => p >= 1 && p <= mid), note: 'Between taken as inclusive' },
  ];
  await runCases(wl, fp, truth, cases);
});

test('FLT-WL-04 Role › Is / Is Not × every role (oracle: /users role per owner)', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const section = findSection(await fp.sections(), 'userrole');
  test.skip(!section, 'portal has no Role filter');
  await fp.expand(section!.field);
  const roles = await fp.valueOptions(section!.field);
  expect(roles.length, 'roles offered').toBeGreaterThan(0);
  const ownersWithRole = (t: Truth, roleId: string) => [...t.owners.values()].filter(o => !o.isResource && t.users.get(o.id)?.roleId === roleId).map(o => o.id);
  const cases: FilterCase[] = [];
  for (const r of roles) {
    cases.push({ name: `WL-04 Role Is ${r.label}`, section: section!, code: 'is', ids: [r.id], level: 'user', expectOwners: t => ownersWithRole(t, r.id) });
    cases.push({ name: `WL-04 Role Is Not ${r.label}`, section: section!, code: 'is_not', ids: [r.id], level: 'user',
      expectOwners: t => [...t.owners.values()].filter(o => !o.isResource && t.users.has(o.id) && t.users.get(o.id)!.roleId !== r.id).map(o => o.id),
      note: 'resources (no role) expected absent from Is Not: check spec if they appear' });
  }
  cases.push({ name: 'WL-04 Role Is all roles', section: section!, code: 'is', ids: roles.map(r => r.id), level: 'user',
    expectOwners: t => [...t.owners.values()].filter(o => !o.isResource && t.users.has(o.id)).map(o => o.id) });
  const results = await runCases(wl, fp, truth, cases);
  // Is ∪ Is Not covers every user owner, for each role
  for (const r of roles) {
    const a = results.get(`WL-04 Role Is ${r.label}`), b = results.get(`WL-04 Role Is Not ${r.label}`);
    if (!a || !b) continue;
    const union = new Set([...a.owners.keys(), ...b.owners.keys()]);
    for (const o of truth.owners.values()) if (!o.isResource) expect.soft(union.has(o.id), `Role ${r.label}: ${o.name} is in Is or Is Not`).toBe(true);
  }
});

test('FLT-WL-05 Allocation Type › Is with no value ticked, and a typed value cleared by the section × (check spec)', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const section = findSection(await fp.sections(), 'allocation');
  test.skip(!section, 'portal has no Allocation Type filter');
  await fp.expand(section!.field);
  await fp.setConditionOf(section!.field, 'is'); await fp.tickIds(section!.field, []);
  const cap = fp.capture();
  await fp.findNoWait();
  cap.stop();
  test.info().annotations.push({ type: 'check spec', description: `Allocation Is + no value + Find: ${cap.data.filters.length} data request(s); panel ${await fp.isOpen() ? 'stays open' : 'closes'}` });
  expect.soft(cap.data.filters.every(f => !/allocation/.test(f)), 'no allocation criterion without a value').toBe(true);
  if (!(await fp.isOpen())) await fp.open();
  await fp.setConditionOf(section!.field, 'greater_than'); await fp.selectTab(section!.field, 'hours'); await fp.typeValue(section!.field, '1');
  expect(await fp.selectionCount(section!.field), 'badge shows the typed value').toBe(1);
  await fp.clearSection(section!.field);
  expect(await fp.selectionCount(section!.field), 'section × clears the badge').toBe(0);
  expect(await fp.typedValue(section!.field).catch(() => ''), 'section × empties the value').toBe('');
  await fp.cancel();
  await expect(wl.page.locator(`[data-zpqa="cview_save_as"]`), 'nothing applied').toBeHidden();
});
