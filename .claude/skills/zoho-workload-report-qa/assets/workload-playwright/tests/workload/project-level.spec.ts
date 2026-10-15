import { test, expect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { K, qa } from '../../src/locators';
import { CreateViewPage } from '../../src/pages/CreateViewPage';
import { waitLoaded, leaveToAllUsers, removeView, idOf } from '../../src/createChecks';
import { env } from '../../src/env';
import type { WorkloadPage } from '../../src/pages/WorkloadPage';

/**
 * Project › Reports › Workload Report: parity with the global report (seen live 15-10-2026: same toolbar keys, the
 * predefined views plus "+ Create Workload Report", ••• without Delete on predefined views, the rail icons, the grid).
 * The project is ZP_PERM_PROJECT_ID (the seed writes it per portal), else UIAutomation_Workload_Project2, else the first.
 */
test.describe.configure({ mode: 'default', timeout: 300_000 });

const TOOLBAR = [K.viewDropdown, K.favourite, K.refresh, K.moreActions, K.calPrev, K.calendar, K.calNext, K.chartType, K.filter, K.groupBy, K.dataLabel, 'expand-collapse-all-tasklist', K.fullscreen, K.showOptions, K.legend, K.exportPdf];
async function projectId(api: ZpApi) {
  if (process.env.ZP_PERM_PROJECT_ID) return { id: process.env.ZP_PERM_PROJECT_ID, name: '' };
  const projects = await api.getJson<any[]>('/projects?page=1&per_page=50');
  const p = projects.find(x => /UIAutomation_Workload_Project2/.test(x.name)) ?? projects[0];
  return { id: String(p.id), name: String(p.name) };
}
async function openProject(wl: WorkloadPage, pid: string) { await wl.gotoProject(pid); await waitLoaded(wl); await expect(qa(wl.page, K.exportPdf)).toBeVisible({ timeout: 60_000 }); }
const present = (wl: WorkloadPage) => Promise.all(TOOLBAR.map(async k => [k, await qa(wl.page, k).filter({ visible: true }).count() > 0] as const));
async function pickView(wl: WorkloadPage, name: string) {
  const loaded = wl.page.waitForResponse(r => /\/reports\/workload\?/.test(r.url()), { timeout: 150_000 });
  await wl.openViews(); await wl.page.locator('.customview-name').filter({ hasText: name }).filter({ visible: true }).first().click();
  await loaded; await waitLoaded(wl);
}
const marker = (wl: WorkloadPage) => qa(wl.page, K.viewDropdown).locator('.cv-newfld-apply').filter({ visible: true }).count();

test('PL-01 the project report has every toolbar and rail control of the global report, and the URL carries the project', async ({ wl }) => {
  const api = new ZpApi(wl.page, wl.d); await waitLoaded(wl);
  await expect(qa(wl.page, K.exportPdf)).toBeVisible({ timeout: 60_000 });
  const global = await present(wl);
  const p = await projectId(api); await openProject(wl, p.id);
  const project = await present(wl);
  const missing = global.filter(([k, on]) => on && !project.find(([k2]) => k2 === k)![1]).map(([k]) => k);
  expect.soft(missing, 'controls present globally but missing at project level').toEqual([]);
  expect.soft(wl.page.url(), 'project URL').toContain(`#zp/projects/${p.id}/reports/workload`);
  const items = await wl.moreActionItems();
  expect.soft(items.includes(K.edit) && items.includes(K.copyLink) && items.includes(K.clone), `••• offers Edit, Copy Link, Clone (${items.join(', ')})`).toBe(true);
  expect.soft(items.includes(K.deleteView), 'no Delete on a predefined view').toBe(false);
  test.info().annotations.push({ type: 'evidence', description: `global: ${global.filter(([, on]) => on).map(([k]) => k).join(', ')} · project: ${project.filter(([, on]) => on).map(([k]) => k).join(', ')}` });
});

test('PL-02 the project view list has the predefined views and Create; a view kept to the global report is not listed, one shown in all projects is', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d); await waitLoaded(wl);
  const onlyGlobal = `${env.runId}-PL-02-global`, allProjects = `${env.runId}-PL-02-all`; const ids: string[] = [];
  try {
    for (const [name, access] of [[onlyGlobal, 'specific_project'], [allProjects, 'all_projects']] as const) {
      const r = await api.saveView({ name, description: '', view_access_type: 'only_to_me', shared_users: [], project_access_type: access, shared_projects: [], report_preference: { report_based_on: 'users', bar_type: 'gantt', legend: 'nolegend', view_type: 'heatmap' }, view_period: { time_period: 'days', time_period_type: 'relative', relative_time_period: 'current_month' }, is_globally_accessible: true, group_by: [{ field_name: 'users', sort_by: 'asc', module: 'workload' }] });
      expect(r.status(), `create ${name}`).toBe(201); ids.push(String((await r.json()).id));
    }
    const p = await projectId(api); await openProject(wl, p.id);
    await wl.openViews();
    const groups = (await page.locator('[data-zpqa^="cv_exp_col_title"]').filter({ visible: true }).allInnerTexts()).map(s => s.trim());
    const names = (await page.locator('.customview-name').filter({ visible: true }).allInnerTexts()).map(s => s.trim());
    expect.soft(groups, 'Predefined Views group').toContain('Predefined Views');
    for (const v of ['All Users', 'Unallocated Users', 'Over-Allocated Users', 'Users by Role']) expect.soft(names, `${v} listed`).toContain(v);
    expect.soft(names.includes(allProjects), 'view shown in all projects is listed').toBe(true);
    expect.soft(names.includes(onlyGlobal), 'view kept to the global report is not listed').toBe(false);
    expect.soft(await qa(page, K.createView).filter({ visible: true }).count(), '+ Create Workload Report').toBe(1);
    await wl.closeViews();
  } finally { await wl.goto().catch(() => {}); await leaveToAllUsers(wl); for (const [i, id] of ids.entries()) await removeView(api, id, i ? allProjects : onlyGlobal); }
});

test('PL-03 editing a view from the project report saves and reads back; the global definition is the same view', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d), cv = new CreateViewPage(page); await waitLoaded(wl);
  const name = `${env.runId}-PL-03`; let id = '';
  try {
    const r0 = await api.saveView({ name, description: 'before', view_access_type: 'only_to_me', shared_users: [], project_access_type: 'all_projects', shared_projects: [], report_preference: { report_based_on: 'users', bar_type: 'gantt', legend: 'nolegend', view_type: 'heatmap' }, view_period: { time_period: 'days', time_period_type: 'relative', relative_time_period: 'current_month' }, is_globally_accessible: true, group_by: [{ field_name: 'users', sort_by: 'asc', module: 'workload' }] });
    expect(r0.status(), 'created').toBe(201); id = String((await r0.json()).id);
    const p = await projectId(api); await openProject(wl, p.id); await pickView(wl, name);
    expect.soft((await wl.selection())[0], 'the QA view is open in the project').toContain(name);
    test.info().annotations.push({ type: 'evidence', description: `after picking the view: ${page.url().replace(/^https?:\/\/[^/]+/, '')}, toolbar ${await qa(page, K.viewDropdown).isVisible()}` });
    for (let attempt = 0; attempt < 2; attempt++) { try { await wl.openMoreActions(); await qa(page, K.edit).filter({ visible: true }).first().click(); await expect(qa(page, K.save)).toBeVisible({ timeout: 45_000 }); break; } catch (e) { if (attempt) throw e; await page.keyboard.press('Escape'); await page.waitForTimeout(1000); } }
    expect.soft(await qa(page, K.description).inputValue(), 'form shows the description').toBe('before');
    await qa(page, K.description).fill(''); await qa(page, K.description).pressSequentially('edited at project level');
    const put = page.waitForResponse(r => r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT', { timeout: 60_000 });
    await qa(page, K.save).click();
    // a confirmation may appear for a view shown in other projects
    const confirm = page.locator('.zpcustomalert [data-zpqa="popup_success"], [data-zpqa="alert-Yes"]').filter({ visible: true }).first();
    if (await confirm.waitFor({ timeout: 5000 }).then(() => true).catch(() => false)) { test.info().annotations.push({ type: 'evidence', description: `confirmation on save: "${(await page.locator('.zpcustomalert').filter({ visible: true }).first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)}"` }); await confirm.click(); }
    const pr = await put.catch(async e => { test.info().annotations.push({ type: 'evidence', description: `no PUT after Save; form open: ${await qa(page, K.save).isVisible()}, alerts: "${(await page.locator('.zpcustomalert, [class*="error" i]').filter({ visible: true }).allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ').slice(0, 200)}"` }); throw e; });
    expect.soft(pr.status(), 'PUT').toBe(200);
    const body = JSON.parse(pr.request().postData() ?? '{}'); const url = new URL(pr.url());
    test.info().annotations.push({ type: 'evidence', description: `PUT ${url.pathname.replace(/^.*\/portal\/\d+/, '')}${url.search} project_id in body: ${body.project_id ?? '-'}, access ${body.view_access_type}/${body.project_access_type}` });
    const v = await api.view(id);
    expect.soft(v.description, 'definition updated').toBe('edited at project level');
    expect.soft(v.project_access_type, 'project access unchanged').toBe('all_projects');
    await waitLoaded(wl);
    expect.soft((await wl.selection())[0], 'still on the view').toContain(name);
  } finally { await wl.goto().catch(() => {}); await leaveToAllUsers(wl); await removeView(api, id, name); }
});

test('PL-04 a toolbar change at project level marks the view unsaved; Save as › New creates a view shown in this project', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d), cv = new CreateViewPage(page); await waitLoaded(wl);
  const name = `${env.runId}-PL-04`; let id = ''; const p = await projectId(api);
  try {
    await openProject(wl, p.id);
    const start = await wl.chartType();
    await qa(page, K.chartType).click(); await page.getByText(/Bar/.test(start) ? /^Heatmap$/ : /^Bar$/).filter({ visible: true }).first().click(); await waitLoaded(wl);
    expect.soft(await marker(wl), 'unsaved marker').toBe(1);
    const items = await wl.saveAsItems();
    expect.soft(Object.keys(items), 'Save as offers New and Discard').toEqual(expect.arrayContaining([K.discard, K.saveAsNew]));
    test.info().annotations.push({ type: 'evidence', description: `Save as items on a predefined view at project level: ${Object.keys(items).join(', ')} (Existing is not offered for predefined views)` });
    await qa(page, K.saveAs).click(); await qa(page, K.saveAsNew).click();
    await expect(qa(page, K.name), 'create form').toBeVisible({ timeout: 60_000 });
    await cv.setName(name);
    const r = await cv.create(); id = r.id || await idOf(api, name);
    expect(r.put.status(), 'created').toBe(201);
    const v = await api.view(id);
    test.info().annotations.push({ type: 'evidence', description: `created from project ${p.id}: ${v.view_access_type}/${v.project_access_type}, projects ${(v.shared_projects ?? []).map((x: any) => x.name).join(', ') || '-'}; request project_id ${r.body.project_id ?? '-'}` });
    expect.soft(['all_projects', 'selected_projects', 'specific_project', 'only_this_project', 'current_project'], `project access ${v.project_access_type}`).toContain(v.project_access_type);
    await waitLoaded(wl);
    await wl.openViews(); expect.soft((await page.locator('.customview-name').filter({ visible: true }).allInnerTexts()).map(s => s.trim()), 'listed in this project').toContain(name); await wl.closeViews();
    expect.soft(await marker(wl), 'no marker on the new view').toBe(0);
  } finally { await wl.discard().catch(() => {}); await wl.goto().catch(() => {}); await leaveToAllUsers(wl); await removeView(api, id, name, p.id); }
});

test('PL-05 Discard at project level restores the saved chart type and data label', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d); await waitLoaded(wl);
  const p = await projectId(api); await openProject(wl, p.id);
  const chart = await wl.chartType(), label = await wl.dataLabel();
  await qa(page, K.chartType).click(); await page.getByText(/^Timeline$/).filter({ visible: true }).first().click(); await waitLoaded(wl);
  await qa(page, K.dataLabel).click(); await page.getByText(/^Allocated Percentage$/).filter({ visible: true }).first().click(); await waitLoaded(wl);
  expect.soft(await wl.chartType(), 'switched').toContain('Timeline');
  expect.soft(await marker(wl), 'marker').toBe(1);
  await wl.discard();
  expect.soft(await wl.chartType(), 'chart restored').toBe(chart);
  expect.soft(await wl.dataLabel(), 'label restored').toBe(label);
  expect.soft(await marker(wl), 'marker cleared').toBe(0);
});

test('PL-06 the project grid lists only this project\'s tasks under each user, and task detail opens inside the project', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d); await waitLoaded(wl);
  const p = await projectId(api); await openProject(wl, p.id);
  const tasks = new Set((await api.tasks(p.id)).map((t: any) => String(t.name)));
  const rows = wl.rows(); const n = await rows.count(); expect(n, 'user rows').toBeGreaterThan(0);
  let checked = 0;
  for (let i = 0; i < n && checked < 3; i++) {
    const r = rows.nth(i); const cnt = Number(((await r.locator('[name="child-entity-count"]').innerText().catch(() => '(0)')).match(/\d+/) || [0])[0]); if (!cnt) continue;
    const uid = (await r.getAttribute('data-zpqa'))!.slice('username-'.length);
    await qa(page, `expand-collapse-parent-${uid}`).click();
    const taskRows = page.locator(`[id^="tasknamerow_${uid}_"]`).filter({ visible: true });
    await expect.poll(() => taskRows.count(), { timeout: 30_000 }).toBe(cnt);
    const names = await taskRows.locator('[data-zpqa="resourcetil_taskname"]').evaluateAll(els => els.map(e => e.getAttribute('data-tooltip') || ''));
    const foreign = names.filter(nm => !tasks.has(nm));
    expect.soft(foreign, `${uid}: every listed task belongs to the project`).toEqual([]);
    expect.soft(await taskRows.locator('[data-zpqa="resourcetil_resgroupexpand"]').count(), `${uid}: at most one project group`).toBeLessThanOrEqual(1);
    await qa(page, `expand-collapse-parent-${uid}`).click(); checked++;
  }
  // task detail from the project report stays in the project URL
  const u = rows.first(); const uid = (await u.getAttribute('data-zpqa'))!.slice('username-'.length);
  await qa(page, `expand-collapse-parent-${uid}`).click();
  const t = page.locator(`[id^="tasknamerow_${uid}_"]`).locator('[data-zpqa="resourcetil_taskname"]').filter({ visible: true }).first();
  if (await t.count()) {
    await t.click();
    await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/task-detail\/\d+/);
    expect.soft(page.url(), 'detail URL stays under the project').toContain(`#zp/projects/${p.id}/`);
    await qa(page, 'closedetailpage').first().click(); await expect.poll(() => page.url()).not.toMatch(/task-detail/);
  }
  test.info().annotations.push({ type: 'evidence', description: `${checked} users checked against ${tasks.size} project tasks` });
});
