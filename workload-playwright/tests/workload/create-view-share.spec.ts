import fs from 'fs';
import path from 'path';
import { test, expect, knownDefect } from '../../src/fixtures';
import { ZpApi, type Scope, type WlAction } from '../../src/api';
import { env, stateExists } from '../../src/env';
import { K, qa } from '../../src/locators';
import { CreateViewPage } from '../../src/pages/CreateViewPage';
import { WorkloadPage } from '../../src/pages/WorkloadPage';
import { createCase, checkDefinition, leaveToAllUsers, removeView, waitLoaded, idOf, type CaseSpec, type Built } from '../../src/createChecks';

/**
 * Create Workload Report › Share / Show in other Projects — verified as the OTHER user, not only from the definition.
 *
 *   CVS-01…05  share none / all / this user / another user / two users → what the second user sees (API list, view
 *              dropdown, opening the view) and the stored definition
 *   CVS-06     the Specific Users picker: a picked user is not offered again, the owner is not offered, a removed
 *              chip is not saved
 *   CVS-07     two specific projects: definition, listed in both project reports and in no other
 *   CVS-08a-c  a user × a project they are a member of / are not a member of / all projects — what they see globally
 *              and inside the project
 *   CVS-09     editing the share after create (user → nobody → all users) changes what the user sees
 *   CVS-10     the Specific Projects picker offers every active project and no trashed one
 *
 * The second user is the saved login ZP_PERM_USER_STATE (default auth/wl.cp.json, profile ZP_PERM_PROFILE, default CP).
 * Its profile gets Workload "view" at both levels for the run and is restored with a read-back afterwards, so the
 * as-user tests need ZP_ALLOW_PROFILE_CHANGES=1 (the user approved this on 15-10-2026). CVS-06 and CVS-10 need only the Admin.
 */
const PROFILE = process.env.ZP_PERM_PROFILE || 'CP';
const USER_STATE = process.env.ZP_SHARE_USER_STATE || process.env.ZP_PERM_USER_STATE || 'auth/wl.cp.json';
const SCOPES: Scope[] = ['global', 'project'];
const canSwitchUser = stateExists(USER_STATE) && process.env.ZP_ALLOW_PROFILE_CHANGES === '1';
const SNAPSHOT_FILE = `${env.reportsDir}/perm-snapshot-share-${PROFILE}.json`;

test.describe.configure({ mode: 'default', timeout: 480_000 });

type Side = { api: ZpApi; ctx: import('@playwright/test').BrowserContext; page: import('@playwright/test').Page };
let admin: Side | undefined, user: Side | undefined;
let profileId = '';
const snapshot: Partial<Record<Scope, WlAction[]>> = {};
let userName = '';

test.beforeAll(async ({ browser }) => {
  if (!canSwitchUser) return;
  test.setTimeout(300_000);
  admin = await ZpApi.open(browser, env.adminState);
  user = await ZpApi.open(browser, USER_STATE);
  profileId = await admin.api.profileId(PROFILE);
  const me = await user.api.me(); userName = me.full_name;
  expect(me.profile?.name, `saved login ${USER_STATE} must have profile ${PROFILE}`).toBe(PROFILE);
  // a snapshot left by a killed run is the ORIGINAL state: never re-read a changed profile
  const saved = fs.existsSync(SNAPSHOT_FILE) ? JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')) : undefined;
  if (saved && saved.profileId === profileId) Object.assign(snapshot, saved.snapshot);
  else for (const s of SCOPES) snapshot[s] = await admin.api.perms(profileId, s);
  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ profile: PROFILE, profileId, snapshot, at: new Date().toISOString() }, null, 2));
  for (const s of SCOPES) await admin.api.setPerms(profileId, s, ['view']);
});
test.afterAll(async () => {
  try {
    if (admin && SCOPES.every(s => snapshot[s])) {
      for (const s of SCOPES) await admin.api.setPerms(profileId, s, snapshot[s]!);
      for (const s of SCOPES) expect(await admin.api.perms(profileId, s), `${s} restored`).toEqual(snapshot[s]);
      fs.rmSync(SNAPSHOT_FILE, { force: true });
    }
  } finally { await admin?.ctx.close(); await user?.ctx.close(); }
});

// ---------- portal facts, discovered once per worker ----------
interface Ctx { me: string; other: string; member: { id: string; name: string }; nonMember?: { id: string; name: string }; third?: { id: string; name: string }; active: string[] }
let ctx: Ctx | undefined;
async function context(wl: WorkloadPage): Promise<Ctx> {
  if (ctx) return ctx;
  const api = new ZpApi(wl.page, wl.d);
  const me = await api.me(); const users = await api.users();
  if (!userName) userName = String((users.find((u: any) => /customprofile/i.test(u.email)) ?? users.find((u: any) => String(u.id) !== String(me.id)))?.full_name ?? '');
  const other = String((users.find((u: any) => String(u.id) !== String(me.id) && u.full_name !== userName && /plemployee/i.test(u.email))
    ?? users.find((u: any) => String(u.id) !== String(me.id) && u.full_name !== userName))?.full_name ?? '');
  const projects = (await api.getJson<any[]>('/projects?page=1&per_page=100')).filter(p => !/^Bugs$/.test(p.name));
  const membership = new Map<string, boolean>();
  for (const p of projects) membership.set(String(p.id), (await api.projectUsers(String(p.id))).some((u: any) => (u.full_name || u.name) === userName));
  const pref = process.env.ZP_PERM_PROJECT_ID || '';
  const member = projects.find(p => String(p.id) === pref && membership.get(String(p.id))) ?? projects.find(p => membership.get(String(p.id)));
  expect(member, `a project ${userName} is a member of`).toBeTruthy();
  const nonMember = projects.find(p => !membership.get(String(p.id)));
  const third = projects.find(p => String(p.id) !== String(member!.id) && String(p.id) !== String(nonMember?.id));
  ctx = { me: me.full_name, other, member: { id: String(member!.id), name: member!.name }, nonMember: nonMember ? { id: String(nonMember.id), name: nonMember.name } : undefined, third: third ? { id: String(third.id), name: third.name } : undefined, active: projects.map(p => p.name) };
  test.info().annotations.push({ type: 'context', description: JSON.stringify({ ...ctx, user: userName }) });
  return ctx;
}
const nameOf = (tag: string) => `${env.runId}-${tag}`;

// ---------- what the second user sees ----------
/** API list (user-views as the user), the view dropdown of the global report, and the group it is listed under. */
async function userSees(name: string): Promise<{ api: boolean; group?: string; ui: boolean }> {
  const v = (await user!.api.allViews()).get(name);
  const uwl = new WorkloadPage(user!.page); await uwl.goto(); await uwl.openViews();
  const ui = (await user!.page.locator('.customview-name').filter({ hasText: name }).filter({ visible: true }).count()) > 0;
  await uwl.closeViews();
  return { api: !!v, group: v?.group, ui };
}
/** The user opens the view from the dropdown of the report that is open: the data request must succeed. */
async function userOpens(name: string): Promise<number> {
  const uwl = new WorkloadPage(user!.page); await uwl.openViews();
  const loaded = user!.page.waitForResponse(r => /\/reports\/workload\?/.test(r.url()), { timeout: 150_000 });
  await user!.page.locator('.customview-name').filter({ hasText: name }).filter({ visible: true }).first().click();
  const st = (await loaded).status();
  if (st === 200) await expect(qa(user!.page, K.calendar)).toBeVisible({ timeout: 150_000 });
  return st;
}
async function userSeesInProject(projectId: string, name: string): Promise<boolean> {
  const uwl = new WorkloadPage(user!.page); await uwl.gotoProject(projectId); await waitLoaded(uwl); await uwl.openViews();
  const n = await user!.page.locator('.customview-name').filter({ hasText: name }).filter({ visible: true }).count();
  await uwl.closeViews(); return n > 0;
}
async function adminSeesInProject(wl: WorkloadPage, projectId: string, name: string): Promise<boolean> {
  await wl.gotoProject(projectId); await waitLoaded(wl); await wl.openViews();
  const n = await wl.page.locator('.customview-name').filter({ hasText: name }).filter({ visible: true }).count();
  await wl.closeViews(); return n > 0;
}
const expectSeen = (label: string, seen: { api: boolean; group?: string; ui: boolean }, yes: boolean) => {
  expect.soft(seen.api, `${label}: in the user's view list (API)`).toBe(yes);
  expect.soft(seen.ui, `${label}: in the user's view dropdown`).toBe(yes);
  if (yes) expect.soft(seen.group, `${label}: listed under Shared Views`).toBe('shared_views');
};

/** Create through the form (admin), check request + definition, run the as-user checks, always delete. */
async function shareCase(wl: WorkloadPage, spec: CaseSpec, body: (b: Built) => Promise<void>) {
  const api = new ZpApi(wl.page, wl.d); let b: Built | undefined;
  try { b = await createCase(wl, spec); await checkDefinition(api, b); await body(b); }
  finally { await wl.goto().catch(() => {}); await leaveToAllUsers(wl); await removeView(api, b?.id ?? '', spec.name); }
}

test.describe('as the other user', () => {
  test.skip(!canSwitchUser, `needs ${USER_STATE} and ZP_ALLOW_PROFILE_CHANGES=1`);

  test('CVS-01 not shared: the other user does not see the view', async ({ wl }) => {
    await context(wl); const name = nameOf('CVS-01');
    await shareCase(wl, { name }, async () => { expectSeen(name, await userSees(name), false); });
  });

  test('CVS-02 shared with All Users: the other user sees it under Shared Views and can open it', async ({ wl }) => {
    await context(wl); const name = nameOf('CVS-02');
    await shareCase(wl, { name, share: { mode: 'all' } }, async () => {
      expectSeen(name, await userSees(name), true);
      expect.soft(await userOpens(name), `${name}: the user's data request`).toBe(200);
    });
  });

  test('CVS-03 shared with this specific user: they see it and can open it', async ({ wl }) => {
    await context(wl); const name = nameOf('CVS-03');
    await shareCase(wl, { name, share: { mode: 'users', users: [userName] } }, async b => {
      expect.soft((b.def.shared_users ?? []).map((u: any) => u.full_name), 'definition shared_users').toEqual([userName]);
      expectSeen(name, await userSees(name), true);
      expect.soft(await userOpens(name), `${name}: the user's data request`).toBe(200);
    });
  });

  test('CVS-04 shared with a different specific user: this user does not see it', async ({ wl }) => {
    const c = await context(wl); const name = nameOf('CVS-04');
    test.skip(!c.other, 'no third user in the portal');
    await shareCase(wl, { name, share: { mode: 'users', users: [c.other] } }, async b => {
      expect.soft((b.def.shared_users ?? []).map((u: any) => u.full_name), 'definition shared_users').toEqual([c.other]);
      expectSeen(name, await userSees(name), false);
    });
  });

  test('CVS-05 shared with two specific users: both stored, this user sees it', async ({ wl }) => {
    const c = await context(wl); const name = nameOf('CVS-05');
    test.skip(!c.other, 'no third user in the portal');
    await shareCase(wl, { name, share: { mode: 'users', users: [userName, c.other] } }, async b => {
      expect.soft((b.def.shared_users ?? []).map((u: any) => u.full_name).sort(), 'definition shared_users').toEqual([userName, c.other].sort());
      expectSeen(name, await userSees(name), true);
    });
  });

  test('CVS-08a user × a project they belong to: seen globally and inside that project', async ({ wl }) => {
    const c = await context(wl); const name = nameOf('CVS-08a');
    await shareCase(wl, { name, share: { mode: 'users', users: [userName] }, projects: { mode: 'projects', projects: [c.member.name] } }, async () => {
      expectSeen(name, await userSees(name), true);
      expect.soft(await userSeesInProject(c.member.id, name), `${name}: in ${c.member.name}'s report as the user`).toBe(true);
    });
  });

  test('CVS-08b user × a project they are not a member of: seen globally, the project is not theirs to open', async ({ wl }) => {
    const c = await context(wl); const name = nameOf('CVS-08b');
    test.skip(!c.nonMember, `${userName} is a member of every project`);
    await shareCase(wl, { name, share: { mode: 'users', users: [userName] }, projects: { mode: 'projects', projects: [c.nonMember!.name] } }, async b => {
      expect.soft((b.def.shared_projects ?? []).map((p: any) => String(p.id)), 'definition shared_projects').toEqual([c.nonMember!.id]);
      expectSeen(name, await userSees(name), true);
      // the user is not in that project: its report is not reachable for them, so the view cannot be listed there
      expect.soft(await userSeesInProject(c.member.id, name), `${name}: not in ${c.member.name}'s report (the view is shown in ${c.nonMember!.name} only)`).toBe(false);
    });
  });

  test('CVS-08c user × all projects: seen globally and inside their project', async ({ wl }) => {
    const c = await context(wl); const name = nameOf('CVS-08c');
    await shareCase(wl, { name, share: { mode: 'users', users: [userName] }, projects: { mode: 'all' } }, async () => {
      expectSeen(name, await userSees(name), true);
      expect.soft(await userSeesInProject(c.member.id, name), `${name}: in ${c.member.name}'s report as the user`).toBe(true);
    });
  });

  test('CVS-09 editing the share after create: user → nobody → all users changes what the user sees', async ({ wl }) => {
    await context(wl); const name = nameOf('CVS-09'); const page = wl.page, cv = new CreateViewPage(page), api = new ZpApi(page, wl.d);
    await shareCase(wl, { name, share: { mode: 'users', users: [userName] } }, async b => {
      expectSeen(`${name} (created)`, await userSees(name), true);
      // edit 1: nobody
      await waitLoaded(wl); await cv.openEdit(); await cv.share('none');
      let r = await saveEdit(cv);
      expect.soft(r.status, 'edit saved (nobody)').toBe(200);
      let v = await api.view(b.id);
      test.info().annotations.push({ type: 'evidence', description: `edit 1 request: view_access_type ${r.body.view_access_type}, shared_users ${JSON.stringify(r.body.shared_users ?? [])}; stored: ${v.view_access_type}, shared_users ${(v.shared_users ?? []).map((u: any) => u.full_name).join(', ') || '-'}` });
      expect.soft(['only_to_me', 'private'], `after edit 1 view_access_type ${v.view_access_type}`).toContain(v.view_access_type);
      // WL-D-38 (candidate, 15-10-2026): un-sharing keeps the old shared_users in the stored definition (the access type does change)
      if ((v.shared_users ?? []).length) knownDefect('WL-D-38', `after un-sharing, the form still sends and the definition still lists shared_users ${(v.shared_users ?? []).map((u: any) => u.full_name).join(', ')} with view_access_type ${v.view_access_type}`);
      expect.soft((v.shared_users ?? []).length, 'after edit 1 shared_users (WL-D-38)').toBe(0);
      expectSeen(`${name} (after edit → nobody)`, await userSees(name), false);
      // edit 2: all users
      await wl.goto(); await leaveToAllUsers(wl).catch(() => {}); await reopen(wl, name);
      await cv.openEdit(); await cv.share('all');
      r = await saveEdit(cv);
      expect.soft(r.status, 'edit saved (all users)').toBe(200);
      v = await api.view(b.id);
      expect.soft(v.view_access_type, 'after edit 2 view_access_type').toBe('public');
      expectSeen(`${name} (after edit → all users)`, await userSees(name), true);
    });
  });
});

/** Save the edit form and return the PUT's status and request body. */
async function saveEdit(cv: CreateViewPage) {
  const put = cv.page.waitForResponse(r => r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT', { timeout: 150_000 });
  await qa(cv.page, K.save).click();
  const p = await put; return { status: p.status(), body: JSON.parse(p.request().postData() ?? '{}') };
}
/** Open a created view from the dropdown of the global report (it is listed under My Custom Views). */
async function reopen(wl: WorkloadPage, name: string) {
  const loaded = wl.page.waitForResponse(r => /\/reports\/workload\?/.test(r.url()), { timeout: 150_000 });
  await wl.openViews(); await wl.page.locator('.customview-name').filter({ hasText: name }).filter({ visible: true }).first().click();
  await loaded; await waitLoaded(wl);
}

// ---------- pickers and multi-select (Admin only) ----------
test('CVS-06 Specific Users picker: no duplicate, not the owner, a removed user is not saved', async ({ wl }) => {
  const c = await context(wl); const page = wl.page, api = new ZpApi(page, wl.d), cv = new CreateViewPage(page);
  const name = nameOf('CVS-06'); let id = '';
  test.skip(!c.other, 'no third user in the portal');
  try {
    await cv.open(wl); await cv.setName(name);
    await cv.share('users', [userName, c.other]);
    expect.soft(await cv.tokenTexts('users'), 'two chips').toEqual([userName, c.other]);
    expect.soft(await cv.pickerOptions('users', userName.slice(0, 10)), `${userName} is not offered a second time`).toEqual([]);
    expect.soft(await cv.pickerOptions('users', c.me.slice(0, 10)), `the owner (${c.me}) is not offered`).toEqual([]);
    await cv.removeToken('users', c.other);
    expect.soft(await cv.tokenTexts('users'), 'one chip after removing').toEqual([userName]);
    const r = await cv.create(); id = r.id || await idOf(api, name);
    expect(r.put.status(), 'created').toBe(201);
    expect.soft((r.body.shared_users ?? []).length, 'request shared_users').toBe(1);
    const v = await api.view(id);
    expect.soft((v.shared_users ?? []).map((u: any) => u.full_name), 'definition shared_users').toEqual([userName]);
  } finally { await wl.goto().catch(() => {}); await leaveToAllUsers(wl); await removeView(api, id, name); }
});

test('CVS-07 two Specific Projects: both stored, listed in both project reports and in no other', async ({ wl }) => {
  const c = await context(wl); const name = nameOf('CVS-07');
  const second = c.nonMember ?? c.third;
  test.skip(!second, 'the portal has one project only');
  await shareCase(wl, { name, projects: { mode: 'projects', projects: [c.member.name, second!.name] } }, async b => {
    expect.soft((b.def.shared_projects ?? []).map((p: any) => String(p.id)).sort(), 'definition shared_projects').toEqual([c.member.id, second!.id].sort());
    expect.soft(await adminSeesInProject(wl, c.member.id, name), `${name}: in ${c.member.name}'s report`).toBe(true);
    expect.soft(await adminSeesInProject(wl, second!.id, name), `${name}: in ${second!.name}'s report`).toBe(true);
    const third = [c.nonMember, c.third].find(p => p && p.id !== second!.id && p.id !== c.member.id);
    if (third) expect.soft(await adminSeesInProject(wl, third.id, name), `${name}: not in ${third.name}'s report`).toBe(false);
    else test.info().annotations.push({ type: 'note', description: 'no third project to check the negative' });
  });
});

test('CVS-10 Specific Projects picker: every active project is offered, a trashed one is not', async ({ wl }) => {
  const c = await context(wl); const page = wl.page, cv = new CreateViewPage(page);
  const trashed = process.env.ZP_TRASHED_PROJECT || 'WL_API_FullCoverage';
  await cv.open(wl); await cv.setName(nameOf('CVS-10'));
  try {
    await cv.otherProjects('projects', []);
    for (const p of c.active) {
      const offered = (await cv.pickerOptions('projects', p.slice(0, 8))).map(o => o.replace(/^[A-Z]+-\d+\s*/, ''));
      expect.soft(offered.some(o => o.includes(p)), `active project "${p}" offered`).toBe(true);
    }
    const t = await cv.pickerOptions('projects', trashed.slice(0, 8));
    expect.soft(t, `trashed project "${trashed}" not offered`).toEqual([]);
    test.info().annotations.push({ type: 'evidence', description: `active offered: ${c.active.join(', ')}; "${trashed.slice(0, 8)}" → ${JSON.stringify(t)} (the trashed project exists on customworkload only; elsewhere the check is vacuous)` });
  } finally { await cv.cancel(); }
});
