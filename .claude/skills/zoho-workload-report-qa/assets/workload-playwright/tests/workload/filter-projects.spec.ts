import { test, expect } from '../../src/fixtures';
import { FilterPanel } from '../../src/pages/FilterPanel';
import { assertSavedViewUnchanged, checkPartition, findSection, listCases, readTruth, runCases, type Truth } from '../../src/filterChecks';

/**
 * FLT-PR — Toolbar › Filter › Projects group: Project, Project Group, Project Status — Is / Is Not × first value,
 * two values and every value. Task-level filters: each owner keeps at most the unfiltered work, and for one value
 * work(Is) + work(Is Not) must equal the unfiltered work (partition). Values are read from the open panel.
 */
test.describe.configure({ mode: 'default', timeout: 1800_000 });
let truth: Truth;
test.beforeAll(async ({ browser }, info) => { test.setTimeout(300_000); truth = await readTruth(browser, info.project.use.storageState as string | undefined); });
test.afterAll(async ({ browser }, info) => { if (truth) await assertSavedViewUnchanged(browser, info.project.use.storageState as string | undefined, truth); });


for (const [key, label] of [['1', 'Project'], ['2', 'Project Group'], ['3', 'Project Status']] as const) {
  test(`FLT-PR ${label}: Is / Is Not × first, two, all values; partition work(Is) + work(Is Not) = unfiltered`, async ({ wl }) => {
    const fp = new FilterPanel(wl.page); await fp.open();
    const section = findSection(await fp.sections(), key);
    test.skip(!section, `portal has no ${label} filter`);
    expect(section!.conditions.map(c => c.code), `${label} conditions`).toEqual(['is', 'is_not']);
    await fp.expand(section!.field);
    const options = await fp.valueOptions(section!.field);
    test.skip(!options.length, `${label} offers no values in this portal`);
    test.info().annotations.push({ type: 'values', description: `${label}: ${options.map(o => o.label).join(', ')}` });
    const results = await runCases(wl, fp, truth, listCases(`PR ${label}`, section!, options, 'task'));
    checkPartition(`${label} ${options[0]!.label}`, truth, results.get(`PR ${label} Is ${options[0]!.label}`), results.get(`PR ${label} Is Not ${options[0]!.label}`));
    if (key === '1') {
      const isAll = results.get(`PR ${label} Is all values`);
      if (isAll) for (const [id, base] of truth.owners) expect.soft(isAll.owners.get(id)?.totalWork ?? 0, `Project Is all: ${base.name} keeps all work`).toBe(base.totalWork);
    }
  });
}
