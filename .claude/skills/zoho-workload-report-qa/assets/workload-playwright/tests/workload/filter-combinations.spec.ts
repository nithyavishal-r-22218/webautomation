import { test, expect } from '../../src/fixtures';
import { K, qa } from '../../src/locators';
import { FilterPanel, criteriaOf, type OwnerRow } from '../../src/pages/FilterPanel';
import { assertSavedViewUnchanged, clearAndDiscard, findSection, readTruth, type Truth } from '../../src/filterChecks';

/**
 * FLT-CB — several sections at once. The request pattern is "1 AND 2 AND …" in panel order; a section × renumbers it;
 * the combined result is a subset of each single filter (owners and per-owner work); Reset clears every section.
 */
test.describe.configure({ mode: 'default', timeout: 1200_000 });
let truth: Truth;
test.beforeAll(async ({ browser }, info) => { test.setTimeout(300_000); truth = await readTruth(browser, info.project.use.storageState as string | undefined); });
test.afterAll(async ({ browser }, info) => { if (truth) await assertSavedViewUnchanged(browser, info.project.use.storageState as string | undefined, truth); });

interface Applied { pattern: string; fields: string[]; owners: Map<string, OwnerRow>; rows: number; chips: string }
async function findAndRead(wl: Parameters<typeof clearAndDiscard>[0], fp: FilterPanel): Promise<Applied> {
  const cap = fp.capture(); wl.d.resetOwners();
  const first = await fp.find(); await wl.loadAllRows(); cap.stop();
  const f = JSON.parse(new URL(first.url()).searchParams.get('filter') ?? '{}');
  return { pattern: String(f.pattern ?? ''), fields: criteriaOf(JSON.stringify(f)).map(c => c.field_name), owners: cap.data.owners, rows: await wl.rows().count(), chips: await fp.chips() };
}
const subset = (name: string, a: Applied, b: Applied) => {
  for (const [id, o] of a.owners) {
    expect.soft(b.owners.has(id), `${name}: ${o.name} is also in the wider result`).toBe(true);
    if (b.owners.has(id)) expect.soft(o.totalWork, `${name}: ${o.name} work ≤ wider result`).toBeLessThanOrEqual(b.owners.get(id)!.totalWork);
  }
};

test('FLT-CB-01 three sections: pattern "1 AND 2 AND 3", three chips, result ⊆ each single filter', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const s = await fp.sections();
  const rt = findSection(s, 'resourcetype'), st = findSection(s, '4'), pr = findSection(s, '6');
  test.skip(!rt || !st || !pr, 'needs User/Resource, Status and Priority');
  await fp.expand(pr!.field); const prio = (await fp.valueOptions(pr!.field))[0]!;
  // singles first
  await fp.reset();
  await fp.expand(rt!.field); await fp.setConditionOf(rt!.field, 'is'); await fp.tickIds(rt!.field, ['1']);
  const A = await findAndRead(wl, fp);
  await fp.open(); await fp.clearSection(rt!.field); await fp.expand(st!.field); await fp.setConditionOf(st!.field, 'all_open');
  const B = await findAndRead(wl, fp);
  await fp.open(); await fp.clearSection(st!.field); await fp.expand(pr!.field); await fp.setConditionOf(pr!.field, 'is'); await fp.tickIds(pr!.field, [prio.id]);
  const C = await findAndRead(wl, fp);
  // all three
  await fp.open();
  await fp.expand(rt!.field); await fp.setConditionOf(rt!.field, 'is'); await fp.tickIds(rt!.field, ['1']);
  await fp.expand(st!.field); await fp.setConditionOf(st!.field, 'all_open');
  const ABC = await findAndRead(wl, fp);
  expect(ABC.fields.sort(), 'three criteria').toEqual(['priority', 'resource_type', 'status']);
  expect(ABC.pattern, 'AND pattern over three').toMatch(/^\d AND \d AND \d$/);
  for (const label of ['User/Resource: Is Users', 'Status: All Open', `Priority: Is ${prio.label}`]) expect.soft(ABC.chips, `chip "${label}"`).toContain(label);
  subset('ABC ⊆ A', ABC, A); subset('ABC ⊆ B', ABC, B); subset('ABC ⊆ C', ABC, C);
  test.info().annotations.push({ type: 'evidence', description: `A ${A.owners.size} · B ${B.owners.size} · C ${C.owners.size} · A∧B∧C ${ABC.owners.size} owners; pattern "${ABC.pattern}"` });
  // section × on the middle one: pattern renumbered, two criteria left
  await fp.open(); await fp.clearSection(st!.field);
  const AC = await findAndRead(wl, fp);
  expect(AC.fields.sort(), 'middle criterion removed').toEqual(['priority', 'resource_type']);
  expect(AC.pattern, 'pattern renumbered').toMatch(/^\d AND \d$/);
  expect(AC.chips, 'Status chip gone').not.toContain('Status');
  subset('AC ⊆ A', AC, A); subset('AC ⊆ C', AC, C);
  await clearAndDiscard(wl, fp, truth, 'CB-01');
});

test('FLT-CB-02 four sections across groups (Projects + Task + Workload); Is Not inside an AND', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const s = await fp.sections();
  const rt = findSection(s, 'resourcetype'), pj = findSection(s, '1'), st = findSection(s, '4'), tl = findSection(s, '47');
  test.skip(!rt || !pj || !st || !tl, 'needs User/Resource, Project, Status and Task List');
  await fp.expand(pj!.field); const project = (await fp.valueOptions(pj!.field))[0];
  await fp.expand(tl!.field); const list = (await fp.valueOptions(tl!.field))[0];
  test.skip(!project || !list, 'no project or task list offered');
  await fp.expand(rt!.field); await fp.setConditionOf(rt!.field, 'is_not'); await fp.tickIds(rt!.field, ['6']);          // Is Not Resources
  await fp.expand(pj!.field); await fp.setConditionOf(pj!.field, 'is'); await fp.tickIds(pj!.field, [project!.id]);
  await fp.expand(st!.field); await fp.setConditionOf(st!.field, 'is_not'); await fp.tickIds(st!.field, [(await fp.valueOptions(st!.field))[0]!.id]);
  await fp.expand(tl!.field); await fp.setConditionOf(tl!.field, 'is'); await fp.tickIds(tl!.field, [list!.id]);
  const all = await findAndRead(wl, fp);
  expect(all.fields.length, 'four criteria').toBe(4);
  expect(all.pattern).toMatch(/^\d AND \d AND \d AND \d$/);
  for (const o of all.owners.values()) {
    expect.soft(o.isResource, `${o.name}: Is Not Resources keeps users only`).toBe(false);
    expect.soft(o.totalWork, `${o.name}: work ≤ unfiltered`).toBeLessThanOrEqual(truth.owners.get(o.id)?.totalWork ?? 0);
  }
  expect(all.rows, 'UI rows = API owners (+ Unassigned when shown)').toBeGreaterThanOrEqual(all.owners.size);
  test.info().annotations.push({ type: 'evidence', description: `pattern "${all.pattern}", fields ${all.fields.join(',')}, ${all.owners.size} owners, chips "${all.chips}"` });
  // Reset clears every section's badge at once
  await fp.open(); await fp.reset();
  for (const f of [rt!, pj!, st!, tl!]) expect.soft(await fp.selectionCount(f.field), `${f.label} badge cleared by Reset`).toBe(0);
  wl.d.resetOwners(); const after = await fp.find(); await wl.loadAllRows();
  expect(criteriaOf(new URL(after.url()).searchParams.get('filter') ?? ''), 'no criteria after Reset + Find').toEqual([]);
  await expect(wl.rows()).toHaveCount(truth.owners.size + (truth.unassignedId ? 1 : 0));
  await expect(qa(wl.page, K.saveAs)).toBeHidden();
});

test('FLT-CB-03 two conditions on the same field are not possible: changing the condition replaces the previous one', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const st = findSection(await fp.sections(), '4');
  test.skip(!st, 'no Status');
  await fp.expand(st!.field);
  const ids = (await fp.valueOptions(st!.field)).slice(0, 2).map(o => o.id);
  await fp.setConditionOf(st!.field, 'is'); await fp.tickIds(st!.field, [ids[0]!]);
  const a = await findAndRead(wl, fp);
  await fp.open(); await fp.expand(st!.field); await fp.setConditionOf(st!.field, 'is_not');
  const kept = await fp.tickedIds(st!.field);
  test.info().annotations.push({ type: 'check spec', description: `switching Is → Is Not keeps ticks: ${JSON.stringify(kept)}` });
  if (!kept.length) await fp.tickIds(st!.field, [ids[0]!]);
  const b = await findAndRead(wl, fp);
  expect(a.fields, 'one criterion').toEqual(['status']); expect(b.fields, 'still one criterion').toEqual(['status']);
  expect(b.chips, 'chip shows the new condition').toContain('Status: Is Not');
  expect(b.chips, 'old condition chip gone').not.toMatch(/Status: Is [^N]/);
  await clearAndDiscard(wl, fp, truth, 'CB-03');
});
