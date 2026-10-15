import { test, expect } from '../../src/fixtures';
import { K, qa } from '../../src/locators';
import { ZpApi } from '../../src/api';
import { FilterPanel, criteriaOf, toOwnerRow } from '../../src/pages/FilterPanel';
import { applyCase, chipCondition, clearAndDiscard, findSection, STANDARD_FIELDS, type FilterCase, type Truth } from '../../src/filterChecks';

/**
 * FLT-PJ — the Project-level Workload Report (Project › Reports) has the same Filter panel without the Projects group,
 * plus a Phase section (seen 12-10-2026; User/Resource was offered in one run and absent in another — recorded). Truth is the unfiltered project report from the API.
 * Cases: Allocation Is, Role Is, Status All Open, Priority Is, Phase Is, Completion > 50, two sections AND, Reset.
 */
test.describe.configure({ mode: 'default', timeout: 1500_000 });
const projectId = process.env.ZP_PERM_PROJECT_ID || '';

async function projectTruth(wl: Parameters<typeof applyCase>[0]): Promise<Truth> {
  const api = new ZpApi(wl.page, wl.d);
  const ch = wl.d.meta!.chart_details; const iso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const from = iso(ch.start_date!), to = iso(ch.end_date!);
  const owners = new Map<string, ReturnType<typeof toOwnerRow>>();
  for (const o of await api.workload({ projectId, from, to, timePeriod: (ch.range as any) || 'days', viewId: wl.d.meta!.custom_view_id })) owners.set(String(o.id), toOwnerRow(o as any));
  const un = await api.workload({ projectId, from, to, timePeriod: (ch.range as any) || 'days', viewId: wl.d.meta!.custom_view_id, unassigned: true });
  const view = await api.getJson<{ determiner?: unknown }>(`/views/${wl.d.meta!.custom_view_id}?module=workload`).catch(() => ({ determiner: {} }));
  return { viewId: wl.d.meta!.custom_view_id, owners, unassignedId: String(un[0]?.id ?? ''), determiner: JSON.stringify(view.determiner ?? {}), from, to, range: ch.range || 'days', users: new Map() };
}

test('FLT-PJ-01 project report: panel sections, every standard section × a case, two sections AND, Reset', async ({ wl }) => {
  test.skip(!projectId, 'set ZP_PERM_PROJECT_ID to a project with tasks');
  await wl.gotoProject(projectId);
  await wl.d.ready();
  const truth = await projectTruth(wl);
  test.info().annotations.push({ type: 'truth', description: `project ${projectId}: ${truth.owners.size} owners, Unassigned ${truth.unassignedId ? 'yes' : 'no'}` });
  const fp = new FilterPanel(wl.page); await fp.open();
  const sections = await fp.sections();
  test.info().annotations.push({ type: 'sections', description: sections.map(s => `${s.group}/${s.label}`).join(' · ') });
  test.info().annotations.push({ type: 'evidence', description: `project level offers User/Resource: ${!!findSection(sections, 'resourcetype')}; Projects group: ${!!findSection(sections, '1')}` });
  expect.soft(findSection(sections, '1'), 'no Project section at project level').toBeUndefined();
  expect.soft(sections.some(s => s.label === 'Phase'), 'Phase section offered at project level').toBe(true);
  for (const key of ['allocation', 'userrole', '4', '6', '48', '47', '32']) expect.soft(findSection(sections, key), `${STANDARD_FIELDS[key]} offered`).toBeTruthy();

  const errors: string[] = [];
  const run = async (c: FilterCase) => {
    try { const r = await applyCase(wl, fp, truth, c); errors.push(...r.failures); }
    catch (e) { errors.push(`${c.name}: ${String(e).split('\n')[0]}`); await wl.gotoProject(projectId); await wl.d.ready(); }
    finally { await fp.open().catch(() => {}); await fp.clearSection(c.section.field).catch(() => {}); }
  };
  const alloc = findSection(sections, 'allocation');
  if (alloc) { await fp.expand(alloc.field); const o = (await fp.valueOptions(alloc.field))[1]; if (o) await run({ name: `PJ Allocation Is ${o.label}`, section: alloc, code: 'is', ids: [o.id], level: 'user' }); }
  const role = findSection(sections, 'userrole');
  if (role) { await fp.expand(role.field); const o = (await fp.valueOptions(role.field))[0]; if (o) await run({ name: `PJ Role Is ${o.label}`, section: role, code: 'is', ids: [o.id], level: 'user' }); }
  const status = findSection(sections, '4');
  if (status) await run({ name: 'PJ Status All Open', section: status, code: 'all_open', level: 'task' });
  const prio = findSection(sections, '6');
  if (prio) { await fp.expand(prio.field); const o = (await fp.valueOptions(prio.field))[0]; if (o) await run({ name: `PJ Priority Is ${o.label}`, section: prio, code: 'is', ids: [o.id], level: 'task' }); }
  const phase = sections.find(s => s.label === 'Phase');
  if (phase) { await fp.expand(phase.field); const o = (await fp.valueOptions(phase.field))[0]; if (o) await run({ name: `PJ Phase Is ${o.label}`, section: phase, code: 'is', ids: [o.id], level: 'task' }); else test.info().annotations.push({ type: 'skip', description: 'Phase offers no values' }); }
  const comp = findSection(sections, '48');
  if (comp) await run({ name: 'PJ Completion > 50', section: comp, code: 'greater_than', typed: ['50'], level: 'task' });
  // two sections AND
  if (status && prio) {
    await fp.open(); await fp.expand(status.field); await fp.setConditionOf(status.field, 'all_open');
    await fp.expand(prio.field); const o = (await fp.valueOptions(prio.field))[0]!; await fp.setConditionOf(prio.field, 'is'); await fp.tickIds(prio.field, [o.id]);
    wl.d.resetOwners(); const first = await fp.find(); await wl.loadAllRows();
    const f = JSON.parse(new URL(first.url()).searchParams.get('filter') ?? '{}');
    expect.soft(criteriaOf(JSON.stringify(f)).map(c => c.field_name).sort(), 'project: two criteria').toEqual(['priority', 'status']);
    expect.soft(String(f.pattern), 'project: AND pattern').toMatch(/^\d AND \d$/);
    expect.soft(await fp.chips(), 'project: chips').toContain(`Priority: ${chipCondition('is')} ${o.label}`);
    expect.soft(new URL(first.url()).searchParams.get('project_id'), 'request scoped to the project').toBe(projectId);
    await fp.open(); await fp.reset();
    for (const s of [status, prio]) expect.soft(await fp.selectionCount(s.field), `${s.label} badge cleared`).toBe(0);
    wl.d.resetOwners(); const after = await fp.find(); await wl.loadAllRows();
    expect.soft(criteriaOf(new URL(after.url()).searchParams.get('filter') ?? ''), 'project: Reset + Find clears').toEqual([]);
  }
  await clearAndDiscard(wl, fp, truth, 'PJ');
  await expect(qa(wl.page, K.saveAs)).toBeHidden();
  expect(errors, `failed layers:\n${errors.join('\n')}`).toEqual([]);
});
