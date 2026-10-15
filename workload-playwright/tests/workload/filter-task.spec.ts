import { test, expect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { FilterPanel } from '../../src/pages/FilterPanel';
import { assertSavedViewUnchanged, checkPartition, findSection, listCases, readTruth, runCases, type FilterCase, type Truth } from '../../src/filterChecks';

/**
 * FLT-TK — Toolbar › Filter › Task group: Task Name (6 text conditions), Status (Is / Is Not / All Open / All Closed),
 * Completion Percentage (6 numeric conditions), Owner (users, Unassigned, team, Direct Reports Of, Subordinates Of),
 * Associated Team, Priority, Created By, Task List, Tags, Billing Type.
 * Task-level filters: each owner keeps at most the unfiltered work; complementary conditions partition the work
 * (Is + Is Not, All Open + All Closed, Less Than + Greater Than Or Equal). Sample text comes from a live task.
 */
test.describe.configure({ mode: 'default', timeout: 1800_000 });
let truth: Truth;
test.beforeAll(async ({ browser }, info) => { test.setTimeout(300_000); truth = await readTruth(browser, info.project.use.storageState as string | undefined); });
test.afterAll(async ({ browser }, info) => { if (truth) await assertSavedViewUnchanged(browser, info.project.use.storageState as string | undefined, truth); });

test('FLT-TK-01 Task Name: Contains, Is, Is Not, Doesn\'t Contain, Starts With, Ends With (sample from a live task)', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const sections = await fp.sections();
  const section = findSection(sections, '32');
  test.skip(!section, 'portal has no Task Name filter');
  // a real task name: first project offered by the Project filter → its first task
  const project = findSection(sections, '1');
  let name = 'a';
  if (project) {
    await fp.expand(project.field);
    const ids = (await fp.valueOptions(project.field)).map(o => o.id);
    const api = new ZpApi(wl.page, wl.d);
    for (const pid of ids) { const t = (await api.tasks(pid).catch(() => []))[0]; if (t?.name) { name = String(t.name); break; } }
    await fp.collapse(project.field);
  }
  test.info().annotations.push({ type: 'sample', description: `task name "${name}"` });
  const word = name.split(/\s+/)[0]!;
  const head = name.slice(0, 3).trim() || word, tail = name.slice(-3).trim() || word; // the app trims typed values
  const cases: FilterCase[] = [
    { name: `TK-01 Task Name Contains ${word}`, section: section!, code: 'contains', typed: [word], level: 'task' },
    { name: `TK-01 Task Name Is ${name}`, section: section!, code: 'is', typed: [name], level: 'task' },
    { name: `TK-01 Task Name Is Not ${name}`, section: section!, code: 'is_not', typed: [name], level: 'task' },
    { name: `TK-01 Task Name Doesn't Contain ${word}`, section: section!, code: 'not_contains', typed: [word], level: 'task' },
    { name: `TK-01 Task Name Starts With ${head}`, section: section!, code: 'starts_with', typed: [head], level: 'task' },
    { name: `TK-01 Task Name Ends With ${tail}`, section: section!, code: 'ends_with', typed: [tail], level: 'task' },
  ];
  const r = await runCases(wl, fp, truth, cases);
  checkPartition('Task Name Is/Is Not', truth, r.get(`TK-01 Task Name Is ${name}`), r.get(`TK-01 Task Name Is Not ${name}`));
  checkPartition('Task Name Contains/Doesn\'t Contain', truth, r.get(`TK-01 Task Name Contains ${word}`), r.get(`TK-01 Task Name Doesn't Contain ${word}`));
});

test('FLT-TK-02 Status: Is / Is Not × first, two, all · All Open · All Closed (partition Open + Closed)', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const section = findSection(await fp.sections(), '4');
  test.skip(!section, 'portal has no Status filter');
  expect(section!.conditions.map(c => c.code), 'Status conditions').toEqual(['is', 'is_not', 'all_open', 'all_closed']);
  await fp.expand(section!.field);
  const options = await fp.valueOptions(section!.field);
  test.info().annotations.push({ type: 'values', description: `statuses: ${options.map(o => o.label).join(', ')}` });
  const cases = listCases('TK-02 Status', section!, options, 'task');
  cases.push({ name: 'TK-02 Status All Open', section: section!, code: 'all_open', level: 'task' });
  cases.push({ name: 'TK-02 Status All Closed', section: section!, code: 'all_closed', level: 'task' });
  const r = await runCases(wl, fp, truth, cases);
  checkPartition(`Status ${options[0]!.label}`, truth, r.get(`TK-02 Status Is ${options[0]!.label}`), r.get(`TK-02 Status Is Not ${options[0]!.label}`));
  checkPartition('Status All Open + All Closed', truth, r.get('TK-02 Status All Open'), r.get('TK-02 Status All Closed'));
});

test('FLT-TK-03 Completion Percentage: Is, Is Not, Less/Greater Than (or Equal) at 50 (partitions)', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const section = findSection(await fp.sections(), '48');
  test.skip(!section, 'portal has no Completion Percentage filter');
  const v = '50';
  const cases: FilterCase[] = section!.conditions.map(c => ({ name: `TK-03 Completion ${c.text} ${v}`, section: section!, code: c.code, typed: [v], level: 'task' as const }));
  const r = await runCases(wl, fp, truth, cases);
  const by = (code: string) => r.get(`TK-03 Completion ${section!.conditions.find(c => c.code === code)?.text} ${v}`);
  checkPartition('Completion Is/Is Not 50', truth, by('is'), by('is_not'));
  checkPartition('Completion < 50 / ≥ 50', truth, by('less_than'), by('greater_than_or_equal'));
  checkPartition('Completion > 50 / ≤ 50', truth, by('greater_than'), by('less_than_or_equal'));
});

test('FLT-TK-04 Owner: Is a user · Is Unassigned · Is a team · Direct Reports Of · Subordinates Of', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const section = findSection(await fp.sections(), '5');
  test.skip(!section, 'portal has no Owner filter');
  await fp.expand(section!.field);
  const users = await fp.valueOptions(section!.field);
  const unassigned = users.find(o => /unassigned/i.test(o.label));
  const user = users.find(o => truth.owners.has(o.id) && !truth.owners.get(o.id)!.isResource) ?? users.find(o => o !== unassigned)!;
  const cases: FilterCase[] = [
    { name: `TK-04 Owner Is ${user.label}`, section: section!, code: 'is', tab: 'users', ids: [user.id], level: 'task',
      expectOwners: t => (t.owners.has(user.id) ? [user.id] : undefined), note: 'owner filter: only that user keeps work' },
  ];
  if (unassigned) cases.push({ name: 'TK-04 Owner Is Unassigned', section: section!, code: 'is', tab: 'users', ids: [unassigned.id], level: 'task', note: 'check spec: which rows an Unassigned owner filter shows' });
  const tabs = await fp.tabs(section!.field);
  if (tabs.some(t => t.value === 'teams')) {
    await fp.selectTab(section!.field, 'teams');
    const teams = await fp.valueOptions(section!.field);
    if (teams.length) cases.push({ name: `TK-04 Owner Is team ${teams[0]!.label}`, section: section!, code: 'is', tab: 'teams', ids: [teams[0]!.id], level: 'task' });
    await fp.selectTab(section!.field, 'users');
  }
  for (const code of ['direct_reports_of', 'subordinates_of']) {
    if (!section!.conditions.some(c => c.code === code)) continue;
    await fp.setConditionOf(section!.field, code);
    const managers = (await fp.valueOptions(section!.field)).filter(o => o.id !== '-1');
    if (managers.length) cases.push({ name: `TK-04 Owner ${code} ${managers[0]!.label}`, section: section!, code, ids: [managers[0]!.id], level: 'task' });
    else test.info().annotations.push({ type: 'skip', description: `${code}: no manager offered (user hierarchy not configured)` });
  }
  await fp.setConditionOf(section!.field, 'is');
  await runCases(wl, fp, truth, cases);
});

test('FLT-TK-05 Created By: Is / Is Not a user · team tab · Direct Reports Of · Subordinates Of', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const section = findSection(await fp.sections(), '11');
  test.skip(!section, 'portal has no Created By filter');
  await fp.expand(section!.field);
  const users = await fp.valueOptions(section!.field);
  test.skip(!users.length, 'no users offered');
  const u = users[0]!;
  const cases: FilterCase[] = [
    { name: `TK-05 Created By Is ${u.label}`, section: section!, code: 'is', tab: 'users', ids: [u.id], level: 'task' },
    { name: `TK-05 Created By Is Not ${u.label}`, section: section!, code: 'is_not', tab: 'users', ids: [u.id], level: 'task' },
  ];
  if ((await fp.tabs(section!.field)).some(t => t.value === 'teams')) {
    await fp.selectTab(section!.field, 'teams');
    const teams = await fp.valueOptions(section!.field);
    if (teams.length) cases.push({ name: `TK-05 Created By Is team ${teams[0]!.label}`, section: section!, code: 'is', tab: 'teams', ids: [teams[0]!.id], level: 'task' });
    await fp.selectTab(section!.field, 'users');
  }
  for (const code of ['direct_reports_of', 'subordinates_of']) {
    if (!section!.conditions.some(c => c.code === code)) continue;
    await fp.setConditionOf(section!.field, code);
    const managers = (await fp.valueOptions(section!.field)).filter(o => o.id !== '-1');
    if (managers.length) cases.push({ name: `TK-05 Created By ${code} ${managers[0]!.label}`, section: section!, code, ids: [managers[0]!.id], level: 'task' });
  }
  await fp.setConditionOf(section!.field, 'is');
  const r = await runCases(wl, fp, truth, cases);
  checkPartition(`Created By ${u.label}`, truth, r.get(`TK-05 Created By Is ${u.label}`), r.get(`TK-05 Created By Is Not ${u.label}`));
});

for (const [key, label] of [['6', 'Priority'], ['26', 'Associated Team'], ['47', 'Task List'], ['14', 'Tags'], ['25', 'Billing Type']] as const) {
  test(`FLT-TK ${label}: Is / Is Not × first, two, all values (partition on the first)`, async ({ wl }) => {
    const fp = new FilterPanel(wl.page); await fp.open();
    const section = findSection(await fp.sections(), key);
    test.skip(!section, `portal has no ${label} filter`);
    expect(section!.conditions.map(c => c.code), `${label} conditions`).toEqual(['is', 'is_not']);
    await fp.expand(section!.field);
    const options = await fp.valueOptions(section!.field);
    test.skip(!options.length, `${label} offers no values in this portal`);
    test.info().annotations.push({ type: 'values', description: `${label}: ${options.map(o => o.label).join(', ')}` });
    const cases = key === '6'
      ? [...options.map(o => ({ name: `TK ${label} Is ${o.label}`, section: section!, code: 'is', ids: [o.id], level: 'task' as const })), ...listCases(`TK ${label}`, section!, options, 'task').slice(1)]
      : listCases(`TK ${label}`, section!, options, 'task');
    const r = await runCases(wl, fp, truth, cases);
    checkPartition(`${label} ${options[0]!.label}`, truth, r.get(`TK ${label} Is ${options[0]!.label}`), r.get(`TK ${label} Is Not ${options[0]!.label}`));
    if (key === '6') {
      // every priority together = all work
      const sum = new Map<string, number>();
      for (const o of options) for (const [id, row] of r.get(`TK ${label} Is ${o.label}`)?.owners ?? []) sum.set(id, (sum.get(id) ?? 0) + row.totalWork);
      for (const [id, base] of truth.owners) expect.soft(sum.get(id) ?? 0, `Priority: ${base.name} work over all priorities = unfiltered`).toBe(base.totalWork);
    }
  });
}
