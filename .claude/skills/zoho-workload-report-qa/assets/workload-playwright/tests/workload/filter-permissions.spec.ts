import { test, expect } from '@playwright/test';
import { knownDefect } from '../../src/fixtures';
import fs from 'fs';
import { env, reportsUrl, stateExists } from '../../src/env';
import { K, qa } from '../../src/locators';
import { ZpApi, type Scope, type WlAction } from '../../src/api';
import { WorkloadPage } from '../../src/pages/WorkloadPage';
import { FilterPanel, criteriaOf } from '../../src/pages/FilterPanel';
const isoDay = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

/**
 * FLT-PM — filters under a restricted profile. A View-only user must be able to filter the report (toolbar change)
 * but not keep it: Save as › New disabled without Manage; a Manage user can save a filtered view and delete needs Delete.
 * Levels are switched by API as Admin and restored in afterAll (snapshot on disk until read back). Guarded by
 * ZP_ALLOW_PROFILE_CHANGES=1 and a saved login for the profile (ZP_PERM_USER_STATE), like permission-levels.spec.ts.
 */
const PROFILE = process.env.ZP_PERM_PROFILE || 'CP';
const USER_STATE = process.env.ZP_PERM_USER_STATE || 'auth/wl.cp.json';
const SCOPES: Scope[] = ['global', 'project'];
const SNAPSHOT_FILE = `${env.reportsDir}/perm-snapshot-${PROFILE}-filters.json`;
const allowed = process.env.ZP_ALLOW_PROFILE_CHANGES === '1' && stateExists(USER_STATE) && stateExists(env.adminState);

test.describe.configure({ mode: 'serial', timeout: 900_000 });
let admin: Awaited<ReturnType<typeof ZpApi.open>>, user: Awaited<ReturnType<typeof ZpApi.open>>;
let profileId = '';
const snapshot: Partial<Record<Scope, WlAction[]>> = {};
const created: string[] = [];

test.beforeAll(async ({ browser }) => {
  test.skip(!allowed, 'needs ZP_ALLOW_PROFILE_CHANGES=1, a saved Admin login and ZP_PERM_USER_STATE');
  test.setTimeout(300_000);
  admin = await ZpApi.open(browser, env.adminState); user = await ZpApi.open(browser, USER_STATE);
  profileId = await admin.api.profileId(PROFILE);
  expect((await user.api.me()).profile?.name, `saved login has profile ${PROFILE}`).toBe(PROFILE);
  const saved = fs.existsSync(SNAPSHOT_FILE) ? JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')) : undefined;
  if (saved && saved.profileId === profileId) Object.assign(snapshot, saved.snapshot);
  else for (const s of SCOPES) snapshot[s] = await admin.api.perms(profileId, s);
  fs.mkdirSync(env.reportsDir, { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ profile: PROFILE, profileId, snapshot, at: new Date().toISOString() }, null, 2));
});
test.afterAll(async () => {
  if (!admin) return;
  try {
    for (const id of created) await admin.api.deleteView(id).catch(() => {});
    await user.api.deleteViewsByPrefix(env.runId).catch(() => {});
  } finally {
    if (SCOPES.every(s => snapshot[s])) {
      for (const s of SCOPES) await admin.api.setPerms(profileId, s, snapshot[s]!);
      for (const s of SCOPES) expect(await admin.api.perms(profileId, s), `${s} restored`).toEqual(snapshot[s]);
      fs.rmSync(SNAPSHOT_FILE, { force: true });
    }
    await admin.ctx.close(); await user.ctx.close();
  }
});
async function setLevel(actions: WlAction[]) { for (const s of SCOPES) await admin.api.setPerms(profileId, s, actions); await user.page.goto(reportsUrl()); }

test('FLT-PM-01 View only: can apply a toolbar filter (request, chips, rows) but Save as › New is disabled', async () => {
  await setLevel(['view']);
  const wl = new WorkloadPage(user.page); await wl.goto();
  const fp = new FilterPanel(user.page);
  await fp.open(); await fp.expand('resourcetype'); await fp.setConditionOf('resourcetype', 'is'); await fp.tickIds('resourcetype', ['1']);
  const cap = fp.capture(); wl.d.resetOwners(); const first = await fp.find(); await wl.loadAllRows(); cap.stop();
  expect(criteriaOf(new URL(first.url()).searchParams.get('filter') ?? '').map(c => c.field_name), 'View-only user filters').toEqual(['resource_type']);
  expect(await fp.chips()).toContain('User/Resource: Is Users');
  for (const o of cap.data.owners.values()) expect.soft(o.isResource, `${o.name} is a user`).toBe(false);
  const items = await wl.saveAsItems();
  expect(items[K.saveAsNew]?.disabled, 'Save as › New disabled without Manage').toBe(true);
  expect(items[K.saveAsExisting], 'no Existing on a predefined view').toBeUndefined();
  // API: saving a filtered view is refused
  const r = await user.api.saveView({ name: `${env.runId}-pm-view`, view_access_type: 'only_to_me', shared_users: [], project_access_type: 'all_projects', shared_projects: [],
    report_preference: { report_based_on: 'users', bar_type: 'gantt', legend: 'nolegend', view_type: 'heatmap' },
    view_period: { time_period: 'days', time_period_type: 'relative', relative_time_period: 'current_month' },
    determiner: { pattern: '1', criteria: [{ field_name: 'resource_type', condition: 'is', value: ['1'] }] },
    is_globally_accessible: true, group_by: [{ field_name: 'users', sort_by: 'asc', module: 'workload' }] });
  expect(r.status(), 'API create refused for View only').toBe(403);
  // Save as › Discard for a View-only user: seen 13-10-2026 leaving the filter, the * and Save as in place (WL-D-27)
  const menu = await wl.saveAsItems();
  test.info().annotations.push({ type: 'evidence', description: `View only · Save as menu: ${JSON.stringify(menu)}` });
  if (menu[K.discard]?.disabled) test.info().annotations.push({ type: 'check spec', description: 'Discard is disabled for View only: the toolbar filter can only be removed with Clear filter' });
  else {
    const discarded = await wl.discard().then(() => true, () => false);
    if (!discarded) { knownDefect('WL-D-27', 'View-only profile: Save as › Discard leaves the toolbar filter, the unsaved marker and Save as in place'); expect.soft(discarded, 'Discard drops the toolbar filter for a View-only user').toBe(true); }
  }
  if (await qa(user.page, K.filterClear).isVisible()) { await fp.clear(); await wl.loadAllRows(); }
});

test('FLT-PM-02 View + Manage: Save as › New keeps the filter in the user\'s own view; delete needs Delete', async () => {
  await setLevel(['view', 'manage']);
  const wl = new WorkloadPage(user.page); await wl.goto();
  const fp = new FilterPanel(user.page);
  const name = `${env.runId}-pm-filter`;
  await fp.open(); await fp.expand('resourcetype'); await fp.setConditionOf('resourcetype', 'is'); await fp.tickIds('resourcetype', ['1']);
  wl.d.resetOwners(); await fp.find(); await wl.loadAllRows();
  expect((await wl.saveAsItems())[K.saveAsNew]?.disabled, 'Save as › New enabled with Manage').toBe(false);
  await qa(user.page, K.saveAs).click(); await qa(user.page, K.saveAsNew).click();
  await qa(user.page, K.name).fill(name);
  const put = user.page.waitForResponse(r => r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT', { timeout: 150_000 });
  await qa(user.page, K.save).click();
  expect((await put).status(), 'Manage user saves a filtered view').toBe(201);
  const own = (await user.api.allViews()).get(name);
  expect(own, 'own filtered view listed').toBeTruthy();
  const saved = await user.api.getJson<Record<string, any>>(`/views/${own!.custom_view_id || own!.id}?module=workload`);
  expect(JSON.stringify(saved.determiner ?? {}), 'saved with the filter').toContain('resource_type');
  // without Delete the user cannot remove it; the Admin can
  const del = await user.api.deleteView(own!.custom_view_id || own!.id);
  expect.soft(del.ok(), 'delete refused without Delete').toBe(false);
  if (!del.ok()) created.push(own!.custom_view_id || own!.id);
});

test('FLT-PM-03 a shared filtered view from the Admin is visible to the user with the filter; the user cannot edit or delete it', async () => {
  await setLevel(['view']);
  const name = `${env.runId}-pm-shared`;
  const r = await admin.api.saveView({ name, description: 'shared filtered seed', view_access_type: 'public', shared_users: [], project_access_type: 'all_projects', shared_projects: [],
    report_preference: { report_based_on: 'users', bar_type: 'gantt', legend: 'nolegend', view_type: 'heatmap' },
    view_period: { time_period: 'days', time_period_type: 'relative', relative_time_period: 'current_month' },
    determiner: { pattern: '1', criteria: [{ field_name: 'resource_type', condition: 'is', value: ['1'] }] },
    is_globally_accessible: true, group_by: [{ field_name: 'users', sort_by: 'asc', module: 'workload' }] });
  expect(r.status(), 'Admin creates the shared filtered view').toBe(201);
  const id = String((await r.json()).id); created.push(id);
  const wl = new WorkloadPage(user.page); await wl.goto();
  const fp = new FilterPanel(user.page);
  wl.d.resetOwners();
  const before = wl.d.meta?.custom_view_id; // pin it: Discovery updates meta as soon as the new view's meta arrives
  const data = user.page.waitForResponse(x => /\/reports\/workload\?/.test(x.url()) && !x.url().includes('fetch_unassignee=true') && new URL(x.url()).searchParams.get('view_id') !== before, { timeout: 150_000 });
  await wl.openViews(); await wl.viewItem('Shared Views', name).click();
  await data; await wl.loadAllRows();
  // the saved filter is applied through the view (not the filter parameter) and shown nowhere (WL-D-26): check the rows
  const rows = await wl.rows().evaluateAll(es => es.map(e => (e.getAttribute('data-zpqa') ?? '').replace('username-', '')));
  const owners = await user.api.workload({ from: isoDay(wl.d.meta!.chart_details.start_date!), to: isoDay(wl.d.meta!.chart_details.end_date!), viewId: wl.d.meta!.custom_view_id });
  const resources = new Set(owners.filter(o => o.is_resource).map(o => String(o.id)));
  expect(rows.length, 'the user sees rows in the shared filtered view').toBeGreaterThan(0);
  for (const id of rows) expect.soft(resources.has(id), `${id} is not a resource row (Users filter applied for the user)`).toBe(false);
  test.info().annotations.push({ type: 'evidence', description: `user chips on the shared filtered view: "${await fp.chips()}" (WL-D-26 when empty); ${rows.length} rows` });
  const items = await wl.moreActionItems();
  expect(items.includes(K.edit) || items.includes(K.deleteView), 'no edit/delete on the Admin\'s shared view').toBe(false);
  expect((await user.api.deleteView(id)).ok(), 'API delete refused').toBe(false);
});
