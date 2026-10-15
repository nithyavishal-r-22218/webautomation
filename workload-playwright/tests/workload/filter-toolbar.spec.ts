import { test, expect, knownDefect } from '../../src/fixtures';
import { K, qa } from '../../src/locators';
import { env } from '../../src/env';
import { FilterPanel, criteriaOf } from '../../src/pages/FilterPanel';
import { assertSavedViewUnchanged, clearAndDiscard, readTruth, type Truth } from '../../src/filterChecks';

/**
 * FLT-TI — an applied toolbar filter combined with the other toolbar controls. With User/Resource › Is Users applied:
 * period arrows, refresh, Group By, chart type, data label, full screen keep the filter (request criterion, chips,
 * users-only rows); switching to another view and reloading the page are recorded (check spec). Everything is
 * discarded at the end and the saved view is checked unchanged.
 */
test.describe.configure({ mode: 'default', timeout: 1200_000 });
let truth: Truth;
test.beforeAll(async ({ browser }, info) => { test.setTimeout(300_000); truth = await readTruth(browser, info.project.use.storageState as string | undefined); });
test.afterAll(async ({ browser }, info) => { if (truth) await assertSavedViewUnchanged(browser, info.project.use.storageState as string | undefined, truth); });

const usersOnly = () => [...truth.owners.values()].filter(o => !o.isResource).map(o => o.id).sort();
const DATA = (r: { url(): string }) => /\/reports\/workload\?/.test(r.url()) && /[?&]index=1&/.test(r.url()) && !r.url().includes('fetch_unassignee=true');

async function applyUsers(wl: Parameters<typeof clearAndDiscard>[0], fp: FilterPanel) {
  await fp.open(); await fp.expand('resourcetype'); await fp.setConditionOf('resourcetype', 'is'); await fp.tickIds('resourcetype', ['1']);
  wl.d.resetOwners(); await fp.find(); await wl.loadAllRows();
  expect(await fp.chips()).toContain('User/Resource: Is Users');
}
async function rowsNow(wl: Parameters<typeof clearAndDiscard>[0]) {
  return (await wl.rows().evaluateAll(es => es.map(e => (e.getAttribute('data-zpqa') ?? '').replace('username-', '')))).sort();
}
function keeps(name: string, url: string, chips: string, rows: string[]) {
  expect.soft(criteriaOf(new URL(url).searchParams.get('filter') ?? '').map(c => c.field_name), `${name}: request keeps the criterion`).toEqual(['resource_type']);
  expect.soft(chips, `${name}: chips kept`).toContain('User/Resource: Is Users');
  expect.soft(rows, `${name}: rows still users only`).toEqual(usersOnly());
}

test('FLT-TI-01 period arrows (next, previous) keep the filter and re-query with it', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await applyUsers(wl, fp);
  const before = await wl.headerRange();
  wl.d.resetOwners(); const next = await wl.step('next'); await wl.loadAllRows();
  expect((await wl.headerRange())[0].getTime(), 'period moved').not.toBe(before[0].getTime());
  keeps('next', next.url(), await fp.chips(), await rowsNow(wl));
  wl.d.resetOwners(); const prev = await wl.step('prev'); await wl.loadAllRows();
  keeps('prev', prev.url(), await fp.chips(), await rowsNow(wl));
  // WL-D-25: after the arrows, Clear filter sends no request and the chips stay (12-10-2026)
  const cleared = await Promise.race([fp.clear().then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), 30_000))]);
  const chipsAfterClear = await fp.chips();
  test.info().annotations.push({ type: 'evidence', description: `Clear filter after the arrows: data request ${cleared}; chips "${chipsAfterClear}"` });
  if (!cleared || chipsAfterClear) knownDefect('WL-D-25', 'Clear filter does nothing after the period arrows were used with a filter');
  await fp.open(); await fp.reset(); wl.d.resetOwners(); await fp.find(); await wl.loadAllRows();
  if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard();
  expect(cleared && !chipsAfterClear, 'Clear filter re-queries and removes the chips after the arrows').toBe(true);
});

test('FLT-TI-02 toolbar refresh: does it keep the unsaved filter? (check spec)', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await applyUsers(wl, fp);
  wl.d.resetOwners(); const [data] = await wl.refresh(); await wl.loadAllRows();
  const crit = criteriaOf(new URL(data.url()).searchParams.get('filter') ?? '').map(c => c.field_name);
  const chips = await fp.chips(); const rows = await rowsNow(wl); const unsaved = await qa(wl.page, K.saveAs).isVisible();
  // seen 12-10-2026: refresh reloads the saved view — the toolbar filter, its chips and the unsaved marker are dropped
  test.info().annotations.push({ type: 'check spec', description: `after refresh: criteria ${JSON.stringify(crit)}; chips "${chips}"; rows ${rows.length}; unsaved ${unsaved}` });
  expect(crit.length === 0 ? chips === '' && !unsaved && rows.length === truth.owners.size + (truth.unassignedId ? 1 : 0) : chips.includes('User/Resource: Is Users') && unsaved,
    'refresh is consistent: either the filter is kept everywhere or dropped everywhere').toBe(true);
  await clearAndDiscard(wl, fp, truth, 'TI-02');
});

test('FLT-TI-03 Group By (Roles) with the filter: grouped rows are users only; back to None', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await applyUsers(wl, fp);
  await qa(wl.page, K.groupBy).click();
  const listbox = wl.page.locator('[id$="-listbox"], .zdropdownlist').filter({ visible: true }).last();
  await expect(listbox, 'Group By list open').toBeVisible();
  const options = (await listbox.innerText()).split('\n').map(t => t.trim()).filter(Boolean);
  test.info().annotations.push({ type: 'options', description: `Group By: ${options.join(', ')}` });
  const reqs: string[] = [];
  const on = (r: any) => { if (DATA(r)) reqs.push(r.url()); };
  wl.page.on('request', on);
  wl.d.resetOwners();
  await listbox.getByText('Roles', { exact: true }).click();
  await wl.page.waitForTimeout(4000);
  const apply = wl.page.getByRole('button', { name: /^(apply|ok|done)$/i }).filter({ visible: true }).first();
  if (await apply.isVisible().catch(() => false)) { await apply.click(); await wl.page.waitForTimeout(4000); }
  wl.page.off('request', on);
  await wl.page.keyboard.press('Escape');
  const groupText = (await qa(wl.page, K.groupBy).innerText()).replace(/\s+/g, ' ').trim();
  test.info().annotations.push({ type: 'evidence', description: `Group By now "${groupText}"; ${reqs.length} data request(s); criteria ${JSON.stringify(reqs.map(u => criteriaOf(new URL(u).searchParams.get('filter') ?? '').map(c => c.field_name)))}; chips "${await fp.chips()}"` });
  // seen 12-10-2026: grouping by Roles re-renders through the groups endpoint and the chip bar disappears — recorded
  const groupedChips = await fp.chips();
  const rows = await rowsNow(wl);
  const resourceRows = rows.filter(id => truth.owners.get(id)?.isResource).map(id => truth.owners.get(id)!.name);
  test.info().annotations.push({ type: 'check spec', description: `grouped: chips "${groupedChips}"; ${rows.length} rows; resource rows ${JSON.stringify(resourceRows)}; unsaved ${await qa(wl.page, K.saveAs).isVisible()}` });
  // WL-D-24: grouped rows stay filtered (users only, unsaved) while the chip bar disappears (12-10-2026)
  const inconsistent = groupedChips === '' && rows.length > 0 && resourceRows.length === 0;
  if (inconsistent) knownDefect('WL-D-24', 'Group By hides the chip bar while the toolbar filter stays applied');
  expect(inconsistent, 'grouping keeps the chip bar in step with the applied filter').toBe(false);
  await wl.page.screenshot({ path: `${env.reportsDir}/filter-ti-03-grouped.png` }).catch(() => {});
  // back to None
  await qa(wl.page, K.groupBy).click();
  const lb = wl.page.locator('[id$="-listbox"], .zdropdownlist').filter({ visible: true }).last();
  await lb.getByText('None', { exact: true }).first().click().catch(() => {});
  await wl.page.waitForTimeout(3000); await wl.page.keyboard.press('Escape');
  await clearAndDiscard(wl, fp, truth, 'TI-03');
});

test('FLT-TI-04 chart type Heatmap and Timeline keep the filter; back to the original', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await applyUsers(wl, fp);
  const original = await wl.chartType();
  for (const type of ['heatmap', 'timeline', 'bar']) {
    await qa(wl.page, K.chartType).click();
    const item = wl.page.locator(`#${type}.popuplist`);
    if (!(await item.isVisible().catch(() => false))) { await wl.page.keyboard.press('Escape'); test.info().annotations.push({ type: 'skip', description: `chart type ${type} not offered` }); continue; }
    const reqs: string[] = []; const on = (r: any) => { if (DATA(r)) reqs.push(r.url()); }; wl.page.on('request', on);
    await item.click(); await wl.page.waitForTimeout(4000); wl.page.off('request', on);
    expect.soft((await wl.chartType()).toLowerCase(), `chart type switched to ${type}`).toContain(type);
    expect.soft(await fp.chips(), `${type}: chips kept`).toContain('User/Resource: Is Users');
    for (const u of reqs) expect.soft(criteriaOf(new URL(u).searchParams.get('filter') ?? '').map(c => c.field_name), `${type}: data request keeps the criterion`).toEqual(['resource_type']);
    const rows = await rowsNow(wl);
    if (rows.length) expect.soft(rows, `${type}: rows still users only`).toEqual(usersOnly());
    test.info().annotations.push({ type: 'evidence', description: `${type}: ${reqs.length} data request(s), ${rows.length} rows` });
  }
  if (!(await wl.chartType()).includes(original)) { await qa(wl.page, K.chartType).click(); await wl.page.locator(`#${original.toLowerCase()}.popuplist`).click().catch(() => wl.page.keyboard.press('Escape')); }
  await clearAndDiscard(wl, fp, truth, 'TI-04');
});

test('FLT-TI-05 data label change keeps the filter', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await applyUsers(wl, fp);
  const original = await wl.dataLabel();
  await qa(wl.page, K.dataLabel).click();
  const items = wl.page.locator('.popuplist.cradio').filter({ visible: true });
  const labels = await items.allInnerTexts();
  test.info().annotations.push({ type: 'options', description: `data labels: ${labels.map(t => t.trim()).join(', ')}` });
  const other = labels.findIndex(t => t.trim() && t.trim() !== original);
  test.skip(other < 0, 'only one data label offered');
  const reqs: string[] = []; const on = (r: any) => { if (DATA(r)) reqs.push(r.url()); }; wl.page.on('request', on);
  await items.nth(other).click(); await wl.page.waitForTimeout(4000); wl.page.off('request', on);
  expect.soft(await wl.dataLabel(), 'data label changed').not.toBe(original);
  expect.soft(await fp.chips(), 'chips kept').toContain('User/Resource: Is Users');
  for (const u of reqs) expect.soft(criteriaOf(new URL(u).searchParams.get('filter') ?? '').map(c => c.field_name), 'data request keeps the criterion').toEqual(['resource_type']);
  expect.soft(await rowsNow(wl), 'rows still users only').toEqual(usersOnly());
  // back
  await qa(wl.page, K.dataLabel).click();
  await wl.page.locator('.popuplist.cradio').filter({ visible: true }).filter({ hasText: original }).first().click().catch(() => wl.page.keyboard.press('Escape'));
  await wl.page.waitForTimeout(2000);
  await clearAndDiscard(wl, fp, truth, 'TI-05');
});

test('FLT-TI-06 full screen shows the chips and the filtered rows; leaving full screen keeps them', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await applyUsers(wl, fp);
  await qa(wl.page, K.fullscreen).click();
  await wl.page.waitForTimeout(1500);
  expect.soft(await fp.chips(), 'chips in full screen').toContain('User/Resource: Is Users');
  expect.soft(await rowsNow(wl), 'rows in full screen').toEqual(usersOnly());
  await wl.page.screenshot({ path: `${env.reportsDir}/filter-ti-06-fullscreen.png` }).catch(() => {});
  // leave: the same control toggles back, else Escape
  if (await qa(wl.page, K.fullscreen).isVisible()) await qa(wl.page, K.fullscreen).click(); else await wl.page.keyboard.press('Escape');
  await wl.page.waitForTimeout(1500);
  expect.soft(await fp.chips(), 'chips after leaving full screen').toContain('User/Resource: Is Users');
  await clearAndDiscard(wl, fp, truth, 'TI-06');
});

test('FLT-TI-07 switching to another view drops the toolbar filter (check spec); the view is clean afterwards', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await applyUsers(wl, fp);
  const other = ['Over-Allocated Users', 'Users by Role', 'Users by Profile'].find(n => wl.d.views.has(n) || [...wl.d.views.values()].some(v => v.name.endsWith(n.toLowerCase().replace(/[^a-z]/g, ''))));
  await wl.openViews();
  const target = wl.page.locator('.customview-name').filter({ hasText: other ?? 'Users by Role' }).first();
  test.skip(!(await target.count()), 'no second predefined view to switch to');
  wl.d.resetOwners();
  const data = wl.page.waitForResponse(DATA, { timeout: 150_000 });
  await target.click();
  const first = await data; await wl.page.waitForTimeout(2000);
  const crit = criteriaOf(new URL(first.url()).searchParams.get('filter') ?? '');
  const chips = await fp.chips();
  test.info().annotations.push({ type: 'check spec', description: `after switching to "${other}": request criteria ${JSON.stringify(crit.map(c => c.field_name))}; chips "${chips}"; unsaved ${await qa(wl.page, K.saveAs).isVisible()}` });
  expect.soft(crit.length === 0 && chips === '', 'a toolbar filter does not leak into another view').toBe(true);
  if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard();
  // back to the original view: clean
  await wl.goto();
  expect(await fp.chips(), 'original view clean').toBe('');
  await expect(qa(wl.page, K.saveAs)).toBeHidden();
});

test('FLT-TI-08 a page reload drops the unsaved toolbar filter (check spec) and leaves no unsaved marker', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await applyUsers(wl, fp);
  await wl.goto();
  const chips = await fp.chips();
  test.info().annotations.push({ type: 'check spec', description: `after reload: chips "${chips}", rows ${await wl.rows().count()}, unsaved ${await qa(wl.page, K.saveAs).isVisible()}` });
  await expect(qa(wl.page, K.saveAs), 'no unsaved marker after reload').toBeHidden();
  await wl.loadAllRows();
  await expect(wl.rows(), 'every row back after reload').toHaveCount(truth.owners.size + (truth.unassignedId ? 1 : 0));
});
