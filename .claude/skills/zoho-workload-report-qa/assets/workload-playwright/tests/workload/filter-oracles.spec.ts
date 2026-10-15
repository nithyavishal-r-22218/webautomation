import { test, expect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { FilterPanel, type OwnerRow } from '../../src/pages/FilterPanel';
import { assertSavedViewUnchanged, findSection, readTruth, runCases, type FilterCase, type Truth } from '../../src/filterChecks';

/**
 * FLT-OR — task-level filters checked against the TASK DATA, not only against the report's own API: every project
 * listed in the Project filter is read through /projects/{id}/tasks, and for each filter the owners of the matching
 * tasks (that overlap the report period) form the expected set. The report may legitimately show fewer owners (a
 * matching task can carry no work in the period), so the rule is: every owner the filtered report shows with work
 * must own at least one matching task, and an owner whose only tasks are excluded must not keep work.
 * Fields: Status Is, Status All Open/Closed, Priority Is, Task List Is, Tags Is, Billing Type Is, Project Is,
 * Completion > 50 / ≤ 50, Task Name Contains, Owner Is.
 */
test.describe.configure({ mode: 'default', timeout: 1800_000 });
let truth: Truth;
interface Task { id: string; name: string; owners: string[]; statusId: string; closed: boolean; priority: string; tasklistId: string; tagIds: string[]; billing: string; projectId: string; completion: number; start?: string; end?: string }
let tasks: Task[] = [];

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(600_000);
  truth = await readTruth(browser, info.project.use.storageState as string | undefined);
});
test.afterAll(async ({ browser }, info) => { if (truth) await assertSavedViewUnchanged(browser, info.project.use.storageState as string | undefined, truth); });

async function loadTasks(wl: Parameters<typeof runCases>[0], fp: FilterPanel) {
  if (tasks.length) return;
  const api = new ZpApi(wl.page, wl.d);
  await fp.open(); await fp.expand('1');
  const projects = (await fp.valueOptions('1')).map(o => o.id);
  for (const pid of projects) {
    for (const t of await api.tasks(pid).catch(() => [] as any[])) tasks.push({
      id: String(t.id), name: String(t.name ?? ''), owners: ((t.owners_and_work?.owners ?? []) as any[]).map(o => String(o.zpuid ?? o.id ?? '')),
      statusId: String(t.status?.id ?? ''), closed: !!t.status?.is_closed_type || !!t.is_completed, priority: String(t.priority ?? '').toLowerCase(),
      tasklistId: String(t.tasklist?.id ?? ''), tagIds: ((t.tags ?? []) as any[]).map(x => String(x.id)), billing: String(t.billing_type ?? '').toLowerCase(),
      projectId: pid, completion: Number(t.completion_percentage ?? t.percent_complete ?? 0), start: t.start_date, end: t.end_date,
    });
  }
  test.info().annotations.push({ type: 'tasks', description: `${tasks.length} tasks in ${projects.length} project(s)` });
}
/** tasks that overlap the report period */
const inPeriod = (t: Task) => !t.start || !t.end || (t.start.slice(0, 10) <= truth.to && t.end.slice(0, 10) >= truth.from);
const ownersOf = (pred: (t: Task) => boolean) => new Set(tasks.filter(t => inPeriod(t) && pred(t)).flatMap(t => t.owners));

/** Oracle as a soft layer applied after runCases: shown owners with work ⊆ owners of matching tasks. */
function checkAgainstTasks(name: string, shown: Map<string, OwnerRow>, pred: (t: Task) => boolean) {
  const expected = ownersOf(pred);
  const unexpected = [...shown.values()].filter(o => o.totalWork > 0 && !expected.has(o.id));
  // "None" (no value set) has no counterpart in the task API fields read here: recorded, not judged
  const noneValue = /\bIs None$/i.test(name);
  if (noneValue && unexpected.length) test.info().annotations.push({ type: 'check spec', description: `${name}: keeps work for ${unexpected.length} owner(s) although the task API reports a value for their tasks (does "None" match tasks with the default?)` });
  else for (const o of shown.values()) if (o.totalWork > 0) expect.soft(expected.has(o.id), `${name}: ${o.name} (work ${o.totalWork}) owns a matching task`).toBe(true);
  test.info().annotations.push({ type: 'oracle', description: `${name}: ${shown.size} owners shown, ${expected.size} owners of matching tasks${unexpected.length ? `; unexpected ${unexpected.map(o => o.name).join(', ')}` : ''}` });
}

test('FLT-OR-01 Status, Priority, Task List, Tags, Billing Type, Project: Is first value vs the owners of matching tasks', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  await loadTasks(wl, fp);
  test.skip(!tasks.length, 'no tasks readable through the API');
  const s = await fp.sections();
  const picks: { key: string; label: string; pred: (id: string) => (t: Task) => boolean; match?: (opt: { id: string; label: string }) => boolean }[] = [
    { key: '4', label: 'Status', pred: id => t => t.statusId === id },
    { key: '6', label: 'Priority', pred: id => t => t.priority === id.toLowerCase() },
    { key: '47', label: 'Task List', pred: id => t => t.tasklistId === id },
    { key: '14', label: 'Tags', pred: id => t => t.tagIds.includes(id) },
    { key: '25', label: 'Billing Type', pred: id => t => t.billing === id.toLowerCase() || t.billing.replace(/[^a-z]/g, '') === id.toLowerCase().replace(/[^a-z]/g, '') },
    { key: '1', label: 'Project', pred: id => t => t.projectId === id },
  ];
  const cases: FilterCase[] = []; const preds = new Map<string, (t: Task) => boolean>();
  for (const p of picks) {
    const sec = findSection(s, p.key); if (!sec) continue;
    await fp.expand(sec.field);
    const options = await fp.valueOptions(sec.field);
    // prefer a value that at least one task in the period actually has
    const used = options.find(o => tasks.some(t => inPeriod(t) && p.pred(o.id)(t))) ?? options[0];
    if (!used) continue;
    const name = `OR ${p.label} Is ${used.label}`;
    cases.push({ name, section: sec, code: 'is', ids: [used.id], level: 'task' });
    preds.set(name, p.pred(used.id));
    await fp.collapse(sec.field);
  }
  const results = await runCases(wl, fp, truth, cases);
  for (const [name, pred] of preds) { const r = results.get(name); if (r) checkAgainstTasks(name, r.owners, pred); }
});

test('FLT-OR-02 Status All Open / All Closed, Completion > 50 / ≤ 50, Task Name Contains, Owner Is: against the task data', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  await loadTasks(wl, fp);
  test.skip(!tasks.length, 'no tasks readable through the API');
  const s = await fp.sections();
  const st = findSection(s, '4'), comp = findSection(s, '48'), nm = findSection(s, '32'), ow = findSection(s, '5');
  const word = (tasks.find(t => inPeriod(t) && t.name.trim())?.name ?? 'a').split(/\s+/)[0]!;
  const cases: FilterCase[] = []; const preds = new Map<string, (t: Task) => boolean>();
  if (st) { cases.push({ name: 'OR Status All Open', section: st, code: 'all_open', level: 'task' }); preds.set('OR Status All Open', t => !t.closed);
            cases.push({ name: 'OR Status All Closed', section: st, code: 'all_closed', level: 'task' }); preds.set('OR Status All Closed', t => t.closed); }
  if (comp) { cases.push({ name: 'OR Completion > 50', section: comp, code: 'greater_than', typed: ['50'], level: 'task' }); preds.set('OR Completion > 50', t => t.completion > 50);
              cases.push({ name: 'OR Completion ≤ 50', section: comp, code: 'less_than_or_equal', typed: ['50'], level: 'task' }); preds.set('OR Completion ≤ 50', t => t.completion <= 50); }
  if (nm) { cases.push({ name: `OR Task Name Contains ${word}`, section: nm, code: 'contains', typed: [word], level: 'task' }); preds.set(`OR Task Name Contains ${word}`, t => t.name.toLowerCase().includes(word.toLowerCase())); }
  if (ow) {
    await fp.expand(ow.field);
    const user = (await fp.valueOptions(ow.field)).find(o => tasks.some(t => t.owners.includes(o.id)));
    if (user) { cases.push({ name: `OR Owner Is ${user.label}`, section: ow, code: 'is', tab: 'users', ids: [user.id], level: 'task' }); preds.set(`OR Owner Is ${user.label}`, t => t.owners.includes(user.id)); }
    await fp.collapse(ow.field);
  }
  const results = await runCases(wl, fp, truth, cases);
  for (const [name, pred] of preds) { const r = results.get(name); if (r) checkAgainstTasks(name, r.owners, pred); }
  // Open + Closed cover every owner that has work
  const open = results.get('OR Status All Open'), closed = results.get('OR Status All Closed');
  if (open && closed) for (const [id, o] of truth.owners) if (o.totalWork > 0) expect.soft(open.owners.has(id) || closed.owners.has(id), `${o.name} appears under All Open or All Closed`).toBe(true);
});
