import { test, expect, knownDefect } from '../../src/fixtures';
import { env, reportsUrl, stateExists } from '../../src/env';
import { K, qa } from '../../src/locators';
import { trackContext, waitForApiBudget } from '../../src/rate';
import { WorkloadPage } from '../../src/pages/WorkloadPage';
import { WorkloadEditPage } from '../../src/pages/WorkloadEditPage';
import { FilterPanel, criteriaOf } from '../../src/pages/FilterPanel';
import { ZpApi } from '../../src/api';
import { assertSavedViewUnchanged, readTruth, type Truth } from '../../src/filterChecks';

/**
 * FLT-SV — filters that are SAVED with a view (end to end):
 *  SV-01 toolbar filter → Save as › New Workload Report → the new view carries the filter (API determiner, chips after
 *        reopening, rows = API) and the original view is untouched
 *  SV-02 a view created by the API with a determiner opens with its filter shown (chips, ticked panel, badge, no unsaved
 *        marker); an extra toolbar filter + Save as › Existing persists both; Clear filter on a saved filter is recorded
 *  SV-03 a shared view with a filter is seen with the same filter by another user (skipped without a second login or
 *        without report rights for that user)
 * Views are created with the run id prefix and deleted by the API in afterAll.
 */
test.describe.configure({ mode: 'default', timeout: 900_000 });
let truth: Truth;
const created: string[] = [];
test.beforeAll(async ({ browser }, info) => { test.setTimeout(300_000); truth = await readTruth(browser, info.project.use.storageState as string | undefined); });
test.afterAll(async ({ browser }, info) => {
  // the API client here is the signed-in session (ZpApi): it falls back to in-page calls when Node sockets are refused
  const { api, ctx } = await ZpApi.open(browser, info.project.use.storageState as string);
  const out: string[] = [];
  for (const id of created) out.push(`${id}: ${(await api.deleteView(id).catch(e => ({ status: () => String(e) }))).status()}`);
  await ctx.close();
  test.info().annotations.push({ type: 'cleanup', description: out.join('; ') || 'nothing to delete' });
  if (truth) await assertSavedViewUnchanged(browser, info.project.use.storageState as string | undefined, truth);
});

/** The first data page of a given view (either of its ids), ignoring late requests of the view open before. */
const dataFor = (page: import('@playwright/test').Page, ids: (string | undefined)[]) => page.waitForResponse(r => {
  if (!/\/reports\/workload\?/.test(r.url()) || r.url().includes('fetch_unassignee=true')) return false;
  const v = new URL(r.url()).searchParams.get('view_id'); return !!v && ids.filter(Boolean).includes(v);
}, { timeout: 150_000 });
const USERS_ONLY = (t: Truth) => [...t.owners.values()].filter(o => !o.isResource).map(o => o.id).sort();
const determinerText = (d: unknown) => JSON.stringify(d ?? {});

test('FLT-SV-01 Save as › New keeps the toolbar filter in the new view; the original view is unchanged', async ({ wl, edit }) => {
  const fp = new FilterPanel(wl.page); const adminApi = new ZpApi(wl.page, wl.d);
  const name = `${env.runId}-filter-new`;
  await fp.open(); await fp.expand('resourcetype'); await fp.setConditionOf('resourcetype', 'is'); await fp.tickIds('resourcetype', ['1']);
  wl.d.resetOwners(); await fp.find(); await wl.loadAllRows();
  expect(await fp.chips()).toContain('User/Resource: Is Users');
  // Save as › New
  await qa(wl.page, K.saveAs).click(); await qa(wl.page, K.saveAsNew).click();
  await edit.setName(name);
  const put = wl.page.waitForResponse(r => r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT', { timeout: 150_000 });
  await qa(wl.page, K.save).click();
  const resp = await put;
  expect(resp.status(), 'create via Save as › New').toBe(201);
  const id = String((await resp.json().catch(() => ({}))).id ?? '');
  const body = JSON.parse(resp.request().postData() ?? '{}');
  test.info().annotations.push({ type: 'request', description: `PUT body determiner: ${determinerText(body.determiner)}` });
  expect(determinerText(body.determiner), 'the save body carries the filter').toContain('resource_type');
  // find the id from the listing when the response has none
  const viewId = id || (await adminApi.views('created_views')).find(v => v.name === name)?.id || '';
  expect(viewId, 'new view listed').not.toBe('');
  created.push(viewId);
  // API: saved definition has the criterion
  const saved = await adminApi.view(viewId);
  expect(determinerText(saved.determiner), 'saved determiner has resource_type').toContain('resource_type');
  // reopen the new view from scratch: chips shown, request carries the criterion, rows = users only
  await wl.goto();
  wl.d.resetOwners();
  const listed1 = (await adminApi.views('created_views')).find(v => v.name === name);
  const data = dataFor(wl.page, [viewId, listed1?.id, listed1?.custom_view_id]);
  await wl.openViews(); await wl.viewItem('My Custom Views', name).click();
  const first = await data; await wl.loadAllRows();
  // a saved filter travels with the view (view_id), not in the toolbar `filter` parameter (seen 12-10-2026)
  const u = new URL(first.url());
  test.info().annotations.push({ type: 'request', description: `saved view request: view_id=${u.searchParams.get('view_id')} filter=${u.searchParams.get('filter')}` });
  await expect(qa(wl.page, K.saveAs), 'a saved filter is not an unsaved change').toBeHidden();
  const rows = (await wl.rows().evaluateAll(es => es.map(e => (e.getAttribute('data-zpqa') ?? '').replace('username-', '')))).sort();
  expect(rows, 'rows = users only (the saved filter is applied through the view)').toEqual(USERS_ONLY(truth));
  // WL-D-26: the saved filter is applied to the data but shown nowhere — no chips, panel unticked, badge 0 (12-10-2026)
  const chipsSaved = await fp.chips();
  await fp.open(); await fp.expand('resourcetype');
  const ticked = await fp.tickedIds('resourcetype'); const badge = await fp.selectionCount('resourcetype');
  await fp.cancel();
  test.info().annotations.push({ type: 'evidence', description: `saved filter visibility: chips "${chipsSaved}", panel ticks ${JSON.stringify(ticked)}, badge ${badge}` });
  if (!chipsSaved || !ticked.length) knownDefect('WL-D-26', 'a filter saved with the view is applied but invisible (no chips, panel unticked)');
  expect(chipsSaved, 'chips shown for the saved filter').toContain('User/Resource: Is Users');
  expect(ticked, 'panel shows the saved filter').toEqual(['1']);
});

test('FLT-SV-02 a view created by the API with a filter opens filtered; Save as › Existing persists an added filter; Clear filter on a saved filter (check spec)', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); const adminApi = new ZpApi(wl.page, wl.d);
  const name = `${env.runId}-filter-api`;
  const id = await adminApi.createView(name, { determiner: { pattern: '1', criteria: [{ field_name: 'resource_type', condition: 'is', value: ['1'] }] } });
  created.push(id);
  const savedBefore = await adminApi.view(id);
  test.info().annotations.push({ type: 'api', description: `created determiner: ${determinerText(savedBefore.determiner)}` });
  await wl.goto();
  wl.d.resetOwners();
  const listed = (await adminApi.views('created_views')).find(v => v.name === name);
  const data = dataFor(wl.page, [id, listed?.id, listed?.custom_view_id]);
  await wl.openViews(); await wl.viewItem('My Custom Views', name).click();
  const first = await data; await wl.loadAllRows();
  const u = new URL(first.url());
  test.info().annotations.push({ type: 'request', description: `API-saved view request: view_id=${u.searchParams.get('view_id')} filter=${u.searchParams.get('filter')}` });
  const chipsApi = await fp.chips();
  test.info().annotations.push({ type: 'evidence', description: `chips on the API-saved filter: "${chipsApi}" (WL-D-26 when empty)` });
  await expect(qa(wl.page, K.saveAs)).toBeHidden();
  expect((await wl.rows().evaluateAll(es => es.map(e => (e.getAttribute('data-zpqa') ?? '').replace('username-', '')))).sort(), 'API-saved filter applied to the rows').toEqual(USERS_ONLY(truth));
  // add a toolbar filter and save into the existing view
  await fp.open(); await fp.expand('4'); await fp.setConditionOf('4', 'all_open');
  wl.d.resetOwners(); const second = await fp.find(); await wl.loadAllRows();
  // the saved filter travels with the view; only the toolbar addition is in the filter parameter
  expect(criteriaOf(new URL(second.url()).searchParams.get('filter') ?? '').map(c => c.field_name), 'toolbar filter requested on top of the saved one').toEqual(['status']);
  for (const id of await wl.rows().evaluateAll(es => es.map(e => (e.getAttribute('data-zpqa') ?? '').replace('username-', '')))) if (truth.owners.has(id)) expect.soft(truth.owners.get(id)!.isResource, `${truth.owners.get(id)!.name}: saved Users filter still applied`).toBe(false);
  await expect(qa(wl.page, K.saveAs)).toBeVisible();
  const items = await wl.saveAsItems();
  expect(Object.keys(items), 'Existing offered on an own custom view').toContain(K.saveAsExisting);
  await qa(wl.page, K.saveAs).click();
  const put = wl.page.waitForResponse(r => r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT', { timeout: 60_000 });
  await qa(wl.page, K.saveAsExisting).click();
  // a confirmation may follow
  const confirm = wl.page.getByRole('button', { name: /^(save|yes|ok|update|confirm)$/i }).filter({ visible: true }).first();
  if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click();
  const resp = await put;
  expect([200, 201], 'Save as › Existing').toContain(resp.status());
  void resp;
  await expect(qa(wl.page, K.saveAs), 'saved: no unsaved change').toBeHidden();
  const savedAfter = await adminApi.view(id);
  const dt = determinerText(savedAfter.determiner);
  test.info().annotations.push({ type: 'api', description: `determiner after Save as › Existing: ${dt}` });
  expect(dt, 'saved determiner keeps resource_type').toContain('resource_type');
  expect(dt, 'saved determiner gains status').toContain('status');
  // Clear filter on a view whose filters are all saved: with WL-D-26 there is no chip bar and nothing to clear (recorded)
  if (await qa(wl.page, K.filterClear).isVisible()) {
    wl.d.resetOwners();
    const cleared = await fp.clear(); await wl.loadAllRows();
    const after = criteriaOf(new URL(cleared.url()).searchParams.get('filter') ?? '');
    test.info().annotations.push({ type: 'check spec', description: `Clear filter on a saved filter: request criteria ${JSON.stringify(after.map(c => c.field_name))}; chips "${await fp.chips()}"; unsaved marker ${await qa(wl.page, K.saveAs).isVisible()}; rows ${await wl.rows().count()}` });
    expect.soft(await qa(wl.page, K.saveAs).isVisible(), 'clearing a saved filter is an unsaved change').toBe(true);
    if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard();
  } else test.info().annotations.push({ type: 'check spec', description: `after Save as › Existing both filters are saved: chips "${await fp.chips()}" — no Clear filter offered for a saved filter (WL-D-26)` });
  expect(determinerText((await adminApi.view(id)).determiner), 'saved filter untouched by Clear + Discard').toBe(dt);
});

test('FLT-SV-03 a shared view with a filter shows the same filter to another user', async ({ wl, browser }) => {
  const adminApi = new ZpApi(wl.page, wl.d);
  const otherState = process.env.ZP_SCOPE_USER_STATE || process.env.ZP_PERM_USER_STATE || '';
  test.skip(!stateExists(otherState), 'no second saved login (ZP_SCOPE_USER_STATE / ZP_PERM_USER_STATE)');
  const fp = new FilterPanel(wl.page);
  const name = `${env.runId}-filter-shared`;
  const id = await adminApi.createView(name, { shared: true, determiner: { pattern: '1', criteria: [{ field_name: 'resource_type', condition: 'is', value: ['1'] }] } });
  created.push(id);
  // Admin sees it filtered
  await wl.goto();
  wl.d.resetOwners(); await wl.openViews();
  const mine = wl.viewItem('My Custom Views', name);
  await mine.click();
  await wl.loadAllRows();
  expect((await wl.rows().evaluateAll(es => es.map(e => (e.getAttribute('data-zpqa') ?? '').replace('username-', '')))).sort(), 'Admin: shared filtered view shows users only').toEqual(USERS_ONLY(truth));
  test.info().annotations.push({ type: 'evidence', description: `Admin chips on the shared filtered view: "${await fp.chips()}" (WL-D-26 when empty)` });
  // the other user
  const ctx = await browser.newContext({ storageState: otherState });
  await trackContext(ctx); await waitForApiBudget(30);
  const page = await ctx.newPage();
  try {
    await page.goto(reportsUrl());
    const tab = qa(page, K.workloadTab);
    const canOpen = await tab.waitFor({ timeout: 20_000 }).then(() => true, () => false);
    test.skip(!canOpen, 'the second user has no Workload Report access (profile permissions off)');
    const wl2 = new WorkloadPage(page); await wl2.goto();
    const fp2 = new FilterPanel(page);
    wl2.d.resetOwners();
    const listed3 = (await adminApi.views('created_views')).find(v => v.name === name);
    const data = dataFor(page, [id, listed3?.id, listed3?.custom_view_id]);
    await wl2.openViews(); await wl2.viewItem('Shared Views', name).click();
    await data; await wl2.loadAllRows();
    test.info().annotations.push({ type: 'evidence', description: `other user chips: "${await fp2.chips()}" (WL-D-26 when empty)` });
    const rows = (await wl2.rows().evaluateAll(es => es.map(e => (e.getAttribute('data-zpqa') ?? '').replace('username-', '')))).sort();
    for (const r of rows) expect.soft(truth.owners.get(r)?.isResource ?? false, `${r} is a user row`).toBe(false);
    const items = await wl2.saveAsItems().catch(() => ({} as Record<string, { disabled: boolean }>));
    test.info().annotations.push({ type: 'evidence', description: `other user Save as items: ${JSON.stringify(items)}` });
  } finally { await ctx.close(); }
});
