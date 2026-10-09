import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { env, stateExists, reportsUrl } from '../../src/env';
import { K, qa } from '../../src/locators';
import { ZpApi, viewId, type Scope, type WlAction } from '../../src/api';
import { WorkloadPage } from '../../src/pages/WorkloadPage';
import { WorkloadEditPage } from '../../src/pages/WorkloadEditPage';
import { knownDefect } from '../../src/fixtures';

/**
 * Workload Report permissions for ONE profile, switched by API (internal grant/revoke endpoints) while the
 * Admin and a user of that profile stay signed in in two separate browser contexts — no manual re-login.
 *
 *   ZP_PERM_PROFILE=CP                     profile under test (name as in Setup › Profiles)
 *   ZP_PERM_USER_STATE=auth/wl.cp.json     saved login of a user who has that profile (npm run auth)
 *   ZP_PERM_PROJECT_ID=…                   optional; default = first project the user can open
 *   ZP_ALLOW_PROFILE_CHANGES=1             required: the profile is changed and restored afterwards
 *
 * Expected rules (spec): View → open only; Manage → create/edit own views; Delete → delete own views.
 * Nobody but the owner/Admin may edit or delete another user's shared view.
 */
const PROFILE = process.env.ZP_PERM_PROFILE ?? '';
const USER_STATE = process.env.ZP_PERM_USER_STATE ?? '';
const SCOPES: Scope[] = ['global', 'project'];

interface Level { key: string; actions: WlAction[]; open: boolean; create: boolean; editOwn: boolean; deleteOwn: boolean }
const LEVELS: Level[] = [
  { key: 'view',        actions: ['view'],                     open: true,  create: false, editOwn: false, deleteOwn: false },
  { key: 'view+manage', actions: ['view', 'manage'],           open: true,  create: true,  editOwn: true,  deleteOwn: false },
  { key: 'view+delete', actions: ['view', 'delete'],           open: true,  create: false, editOwn: false, deleteOwn: true  },
  { key: 'full',        actions: ['view', 'manage', 'delete'], open: true,  create: true,  editOwn: true,  deleteOwn: true  },
  { key: 'none',        actions: [],                           open: false, create: false, editOwn: false, deleteOwn: false },
];

// Not serial: each level's beforeAll sets its own level, so one failure must not hide the rest of the matrix.
// workers=1 keeps the order; after a failure the new worker re-snapshots and the file afterAll restores.
test.describe.configure({ mode: 'default' });
test.skip(!PROFILE || !stateExists(USER_STATE) || !stateExists(env.adminState) || process.env.ZP_ALLOW_PROFILE_CHANGES !== '1',
  'needs ZP_PERM_PROFILE, ZP_PERM_USER_STATE, an Admin login and ZP_ALLOW_PROFILE_CHANGES=1');

type Side = { api: ZpApi; ctx: BrowserContext; page: Page };
let admin: Side, user: Side;
let profileId = '', projectId = '';
const snapshot: Partial<Record<Scope, WlAction[]>> = {};
const SNAPSHOT_FILE = `reports/perm-snapshot-${PROFILE}.json`; // removed once the profile is restored and read back
const SEED = `${env.runId}-admin-shared`;   // Admin-owned view shared with all users
const OWN = `${env.runId}-user-own`;        // view owned by the user under test (UI menu checks)
const THROWAWAY = `${env.runId}-user-tmp`;  // owned by the user, used for API delete attempts

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000); // two sign-ins, profile snapshot and the API-created seed view
  admin = await ZpApi.open(browser, env.adminState);
  user = await ZpApi.open(browser, USER_STATE);
  profileId = await admin.api.profileId(PROFILE);
  const me = await user.api.me();
  expect(me.profile?.name, `saved login ${USER_STATE} must have profile ${PROFILE}`).toBe(PROFILE);
  // A snapshot left by an earlier worker (or a killed run) is the ORIGINAL state: never re-read a changed profile
  const saved = fs.existsSync(SNAPSHOT_FILE) ? JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')) : undefined;
  if (saved && saved.profileId === profileId) Object.assign(snapshot, saved.snapshot);
  else for (const s of SCOPES) snapshot[s] = await admin.api.perms(profileId, s);
  test.info().annotations.push({ type: 'snapshot', description: JSON.stringify(snapshot) + (saved ? ' (from file)' : '') });
  // Kept on disk until the restore is read back, so a killed run still says what to put back
  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ profile: PROFILE, profileId, snapshot, at: new Date().toISOString() }, null, 2));
  projectId = process.env.ZP_PERM_PROJECT_ID
    || ((await user.api.getJson<{ projects?: { id: string }[] }>('/projects?page=1&per_page=10')).projects ?? [])[0]?.id || '';
  await createSharedViewAsAdmin(admin.api, SEED);
});

test.afterAll(async () => {
  try {
    if (admin && SCOPES.every(s => snapshot[s])) {
      try {
        await setLevel(['view', 'manage', 'delete']); // the user's own QA views can only be removed with Delete
        test.info().annotations.push({ type: 'cleanup', description: [
          ...(await user.api.deleteViewsByPrefix(env.runId)), ...(await admin.api.deleteViewsByPrefix(env.runId))].join('; ') });
      } finally {
        // Always put the profile back, even when the view cleanup above fails
        for (const s of SCOPES) await admin.api.setPerms(profileId, s, snapshot[s]!);
      }
      for (const s of SCOPES) expect(await admin.api.perms(profileId, s), `${s} restored`).toEqual(snapshot[s]);
      fs.rmSync(SNAPSHOT_FILE, { force: true });
    }
  } finally {
    await admin?.ctx.close(); await user?.ctx.close();
  }
});

async function setLevel(actions: WlAction[]) {
  for (const s of SCOPES) await admin.api.setPerms(profileId, s, actions);
  await user.page.goto(reportsUrl()); // the user's session picks up the new rights on reload
}
/** Make sure the user owns a view named `name` (temporarily granting Manage if the level lacks it). */
async function ensureOwnView(name: string, level: Level) {
  if ((await user.api.allViews()).has(name)) return;
  if (!level.create) await setLevel(['view', 'manage']);
  const r = await user.api.saveView(viewBody(name, 'QA permission run', false));
  expect(r.status(), `user creates ${name}`).toBe(201);
  if (!level.create) await setLevel(level.actions);
}
/** Full create body (as the Java suite's WorkloadReportApi.createView); shared = public to all users and projects. */
function viewBody(name: string, description: string, shared: boolean) {
  return {
    name, description, view_access_type: shared ? 'public' : 'only_to_me', shared_users: [],
    project_access_type: 'all_projects', shared_projects: [],
    report_preference: { report_based_on: 'users', bar_type: 'gantt', legend: 'nolegend', view_type: 'heatmap' },
    view_period: { time_period: 'days', time_period_type: 'relative', relative_time_period: 'current_month' },
    is_globally_accessible: true, group_by: [{ field_name: 'users', sort_by: 'asc', module: 'workload' }],
  };
}
/** Admin-owned view shared with all users and projects, created through the API (test data is API-first). */
async function createSharedViewAsAdmin(api: ZpApi, name: string) {
  const r = await api.saveView(viewBody(name, 'Admin seed for permission checks', true));
  expect(r.status(), 'Admin seed view created by API').toBe(201);
}

for (const level of LEVELS) {
  test.describe(`level ${level.key} [${level.actions.join(', ') || 'no access'}]`, () => {
    test.beforeAll(async () => {
      // Level first: without any Workload right even GET /user-views is refused (403), so the user's own views
      // can only be listed and created once the level is in place (ensureOwnView grants Manage briefly if needed).
      await setLevel(level.actions);
      if (level.open) { await ensureOwnView(OWN, level); await ensureOwnView(THROWAWAY, level); }
    });

    test(`${level.key} · global · report ${level.open ? 'opens' : 'is not available'}`, async () => {
      await user.page.goto(reportsUrl());
      if (level.open) await expect(qa(user.page, K.workloadTab)).toBeVisible();
      else await expect(qa(user.page, K.workloadTab)).toHaveCount(0);
    });

    if (!level.open) {
      test(`${level.key} · API refuses data and saves`, async () => {
        const r = await user.api.call('GET', '/reports/workload/meta?project_id=0');
        test.info().annotations.push({ type: 'api', description: `meta → ${r.status()}` });
        const c = await user.api.saveView({ name: `${env.runId}-none-create`, view_access_type: 'only_to_me', project_access_type: 'all_projects' });
        expect(c.ok(), 'create refused').toBe(false);
      });
      return;
    }

    test(`${level.key} · global · create link ${level.create ? 'shown' : 'hidden'}, Save as › New ${level.create ? 'enabled' : 'disabled'}`, async () => {
      const wl = new WorkloadPage(user.page); await wl.goto();
      expect(await wl.canCreateFromDropdown(), '+ Create Workload Report').toBe(level.create);
      await wl.step('next');
      const items = await wl.saveAsItems();
      expect(items[K.saveAsNew]?.disabled, 'Save as › New Workload Report disabled').toBe(!level.create);
      await wl.discard();
    });

    test(`${level.key} · global · ••• on own view: edit ${level.editOwn ? 'yes' : 'no'}, delete ${level.deleteOwn ? 'yes' : 'no'}`, async () => {
      if (!level.editOwn) knownDefect('WL-D-13', 'Edit stays in the ••• menu of an own view without Manage (click → Permission Denied)');
      const wl = new WorkloadPage(user.page); await wl.goto();
      await wl.selectView(OWN, 'My Custom Views');
      const items = await wl.moreActionItems();
      test.info().annotations.push({ type: 'menu', description: items.join(', ') });
      expect.soft(items.includes(K.deleteView), 'Delete item').toBe(level.deleteOwn);
      expect(items.includes(K.edit), 'Edit item').toBe(level.editOwn);
    });

    test(`${level.key} · global · ••• on the Admin's shared view: no edit, no delete`, async () => {
      if (level.deleteOwn) knownDefect('WL-D-14', "Delete offered on another user's shared view; the server then refuses (401)");
      const wl = new WorkloadPage(user.page); await wl.goto();
      await wl.selectView(SEED, 'Shared Views');
      const items = await wl.moreActionItems();
      test.info().annotations.push({ type: 'menu', description: items.join(', ') });
      expect.soft(items.includes(K.edit), 'Edit item').toBe(false);
      expect(items.includes(K.deleteView), 'Delete item').toBe(false);
    });

    test(`${level.key} · API · create ${level.create ? 201 : 403}, edit own ${level.editOwn ? 200 : 403}, delete own ${level.deleteOwn ? 204 : 'refused'}, Admin view never`, async () => {
      const views = await user.api.allViews();
      const create = await user.api.saveView({ name: `${env.runId}-${level.key}-api`, view_access_type: 'only_to_me', project_access_type: 'all_projects' });
      expect.soft(create.status(), 'create').toBe(level.create ? 201 : 403);
      const edit = await user.api.saveView({ id: views.get(OWN)!.id, name: OWN, description: `edited at level ${level.key}` });
      expect.soft(edit.status(), 'edit own').toBe(level.editOwn ? 200 : 403);
      const editSeed = await user.api.saveView({ id: views.get(SEED)!.id, name: SEED, description: 'edit attempt by user' });
      expect.soft(editSeed.status(), "edit Admin's view").toBe(403);
      const delSeed = await user.api.deleteView(viewId(views.get(SEED)!));
      expect.soft(delSeed.ok(), "delete Admin's view refused").toBe(false);
      if (delSeed.ok()) await createSharedViewAsAdmin(admin.api, SEED); // keep later levels meaningful
      const delOwn = await user.api.deleteView(viewId(views.get(THROWAWAY)!));
      if (level.deleteOwn) expect.soft(delOwn.status(), 'delete own').toBe(204);
      else expect.soft(delOwn.ok(), 'delete own refused without Delete').toBe(false);
      for (const r of [create, edit, editSeed, delSeed, delOwn]) expect(r.status(), 'no server error').toBeLessThan(500);
    });

    test(`${level.key} · API · view flags follow the permission`, async () => {
      if (!(level.editOwn && level.deleteOwn)) knownDefect('WL-D-15', 'is_editable / is_deletable on own views ignore the profile');
      const v = (await user.api.allViews()).get(OWN)!;
      expect.soft(v.is_editable, 'own is_editable').toBe(level.editOwn);
      expect(v.is_deletable, 'own is_deletable').toBe(level.deleteOwn);
      const seed = (await user.api.allViews()).get(SEED)!;
      expect(seed.is_editable || seed.is_deletable, "Admin's view never editable/deletable").toBe(false);
    });

    test(`${level.key} · project · report opens; create ${level.create ? 'shown' : 'hidden'}; predefined view has no edit/delete`, async () => {
      test.skip(!projectId, 'user has no project');
      const wl = new WorkloadPage(user.page); await wl.gotoProject(projectId);
      expect(await wl.canCreateFromDropdown(), 'project: + Create Workload Report').toBe(level.create);
      const items = await wl.moreActionItems();
      expect(items.includes(K.edit) || items.includes(K.deleteView), 'predefined view: no edit/delete for this profile').toBe(false);
      await wl.step('next');
      expect((await wl.saveAsItems())[K.saveAsNew]?.disabled, 'project: Save as › New disabled').toBe(!level.create);
      await wl.discard();
    });
  });
}
