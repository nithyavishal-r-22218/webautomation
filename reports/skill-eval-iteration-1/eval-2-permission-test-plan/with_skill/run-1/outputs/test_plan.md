# Workload Report Permissions: Test Plan (Zoho Projects)

| | |
| --- | --- |
| Feature | Setup › Profiles and Roles › Profiles › User Profiles › **Project Reports › Workload Report** and **Global Reports › Workload Report**, each with **View / Manage / Delete** |
| Scope | What each checkbox combination allows at each level (open, create, clone, edit, delete, personal actions), checked in the UI **and** through the API |
| Author / date | QA, 8 Oct 2026 |
| Status | Plan only. Nothing here has been run live yet. Rows marked **check spec** need a product decision before they count as pass or fail. |

---

## 1. Requirement and expected behaviour

### 1.1 Requirement as given

- **View**: the user can open the Workload Report and use views. They **must not** be able to create or delete a workload view.
- **Manage**: the user can **create** a workload view (and edit one).
- **Delete**: the user can **delete** a workload view.
- The same three checkboxes exist under **Project Reports** (the Workload Report inside a project) and **Global Reports** (Reports › Workload Report across projects). Each level is controlled on its own.

### 1.2 Expected permission matrix (one level at a time)

"Personal actions" means Favourite, Set as default view and Copy link. These change only the user's own preferences, not the shared view.

| # | Profile (ticked at the level under test) | Open report | Create view | Clone view | Edit view | Delete view | Personal actions |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | None | No | No | No | No | No | No |
| P1 | View | Yes | **No** | **No** | No | **No** | Yes (check spec) |
| P2 | View + Manage | Yes | **Yes** | Yes | **Yes** | No | Yes |
| P3 | View + Delete | Yes | No | No | No (check spec) | **Yes** | Yes |
| P4 | View + Manage + Delete (Full) | Yes | Yes | Yes | Yes | Yes | Yes |
| P5 | Manage only (no View), if Setup allows it | see SET-03 | | | | | |
| P6 | Delete only (no View), if Setup allows it | see SET-03 | | | | | |
| P7 | Project-level Full, Global-level None ("project-only") | Global: No. Project: as P4 | | | | | |
| P8 | Global-level Full, Project-level None ("global-only") | Global: as P4. Project: No | | | | | |

Rules that hold across every row:

- **A hidden button is not a pass.** For each "No" cell, the matching API call made with that user's session must also be refused, and the data must be unchanged afterwards.
- **Predefined views** (All Users and the others): no profile can delete them, Admin included (`is_deletable=false`). Edit on a predefined view shows only the Time Period and Report Preference tabs and keeps the name locked. Whether Manage allows editing a predefined view is **check spec**.
- **Clone** creates a view, so it follows Create.

### 1.3 Open questions (confirm with product before sign-off)

| ID | Question | Why it matters |
| --- | --- | --- |
| Q1 | Does ticking Manage or Delete auto-tick View? Does unticking View clear Manage/Delete? | Tells us whether P5/P6 exist |
| Q2 | Does Delete-only (P3) also allow Edit? | Fills the P3 Edit cell |
| Q3 | Does Manage/Delete apply to views **shared by other users**, or only to views the user owns? | Ownership cases E-03 and E-04 |
| Q4 | Can a View-only user still favourite, set default and copy link? | P1 personal actions |
| Q5 | If a user created views while they had Manage and is then downgraded to View, can they still edit or delete those views? | E-05 |
| Q6 | Does a permission change apply on the next request, or only after re-login? | CHG cases |
| Q7 | Is the Admin profile column locked (always Full)? | SET-06 |
| Q8 | Is a project-level permission set per profile for the whole portal, or can project roles override it? | Project-level cases |

---

## 2. Test environment and data

### 2.1 Never rely on fixed IDs

Portal ID, profile IDs, view IDs, user names and counts are different in every portal. Discover them each run:

- **Portal ID**: read it from the app's own `/api/v3/portal/<id>/` requests.
- **Profile IDs**: read them from the Setup grid checkbox keys `input_profile_checkbox_<profileId>_workloadreport_<perm>`.
- **View IDs and flags**: read them from `GET /user-views?module=workload…`.
- **Permission flags**: read them from `GET /reports/workload/meta` › `user_premission_details`.

Any number written in results must be labelled "example from portal <name>".

### 2.2 Users and profiles

Use **dedicated QA profiles and QA users**. Do not change the profiles real users are on.

| Key | QA profile (suggested name) | Project Reports › Workload | Global Reports › Workload | Test user |
| --- | --- | --- | --- | --- |
| `none` | QA-WL-None | none | none | qa.wl.none |
| `view` | QA-WL-View | View | View | qa.wl.view |
| `manage` | QA-WL-Manage | View+Manage | View+Manage | qa.wl.manage |
| `delete` | QA-WL-Delete | View+Delete | View+Delete | qa.wl.delete |
| `full` | QA-WL-Full | V+M+D | V+M+D | qa.wl.full |
| `projonly` | QA-WL-ProjOnly | V+M+D | none | qa.wl.projonly |
| `globonly` | QA-WL-GlobOnly | none | V+M+D | qa.wl.globonly |
| `admin` | Admin (existing) | Full | Full | the portal admin |

- Add every test user to one QA project (`ZP_PROJECT`). The project needs a few tasks with owners and dates so the grid has rows.
- Any change to a profile checkbox needs **explicit approval** first. In automation, changes are blocked unless `ZP_ALLOW_PROFILE_CHANGES=1` is set.
- Logins are captured by a person (`npm run auth`). Only session storage states are saved. Passwords are never stored or typed.

### 2.3 Seed views (created by Admin before the run, removed after)

All created records carry the run prefix `RUN_ID` (default `QA-WL-<timestamp>`).

| Seed | Owner | Shared with | Used by |
| --- | --- | --- | --- |
| `<RUN_ID>-shared-<key>` (one per profile key) | Admin | All users | Edit and delete attempts by that profile. Each profile gets its own seed, so one profile's successful delete doesn't break the next profile's test |
| `<RUN_ID>-private-admin` | Admin | Only me | Visibility check (must not appear to others) |
| `<RUN_ID>-own-<key>` | the profile user (created while they hold Manage) | Only me | Ownership and downgrade cases (E-04, E-05) |

Teardown: Admin deletes every `QA-WL-*` view that is left over. Delete it in the UI if no delete endpoint has been confirmed yet. Then list `user-views` and confirm none remain.

### 2.4 Evidence: four layers for each case

Every case must be proven in at least two of these layers. Permission cases should cover all four where possible.

1. **UI control**: is the control present, hidden or disabled (`create_customview`, `clone_customview`, `edit_customview`, and the Delete item in the view's ••• menu)?
2. **UI outcome**: what actually happens: the form opens, the save toast appears, the view appears in or leaves the dropdown.
3. **API flags**: `user-views` › `is_editable` / `is_deletable` for the target view, and `meta` › `user_premission_details`.
4. **API enforcement**: replay the real call with this user's session. Allowed calls must return 2xx and change state. Denied calls must return non-2xx **and** leave the state unchanged (re-read as Admin).

---

## 3. Test cases

Each case runs for both levels unless it says otherwise:

- **G** = Global (Reports › Workload Report, API `project_id=0`)
- **P** = Project (Project › Reports › Workload Report, API `project_id=<projectId>`)

Case IDs are written once with a level placeholder. For example, `G-OPEN-01` and `P-OPEN-01` are the same steps at the two levels.

### 3.1 Setup screen (Admin)

| ID | Title | Steps | Expected | Evidence |
| --- | --- | --- | --- | --- |
| SET-01 | Workload rows exist at both levels | Setup › Profiles › User tab. Expand Project Reports, then Workload Report. Repeat for Global Reports. | Both groups show a Workload Report row with View / Manage / Delete for every profile column | Screenshot. Grid keys `*_profile_base_group_projectreport`, `*_profile_base_group_globalreport`, `*_profile_base_menu_workloadreport` |
| SET-02 | Read state correctly | For each QA profile, read the 3 checkboxes at each level | Matches the table in §2.2. **Read `ruc-checkbox[rc-checked]`; the native `input.checked` is always false** | `rc-checked` attribute values |
| SET-03 | Dependency rules | On QA-WL-View: tick Manage while View is off. Tick Delete while View is off. Untick View while Manage and Delete are on. | Behaviour matches the Q1 answer (e.g. View auto-ticks, or Manage/Delete are cleared). Note the actual behaviour. **check spec** | Before/after `rc-checked` |
| SET-04 | Save persists | Change one checkbox on a QA profile, save if a Save button exists, then reload | The value survives the reload. Other checkboxes are unchanged | `rc-checked` after reload |
| SET-05 | Levels are independent | On QA-WL-ProjOnly, toggle Global › Workload › View | Project › Workload checkboxes don't change, and the reverse also holds (the keys are shared, so read only the visible group) | `rc-checked` in both groups |
| SET-06 | Admin column | Inspect the Admin profile's workload checkboxes | Locked and ticked, or editable, as Q7 decides. **check spec** | Screenshot |
| SET-07 | Non-admin can't change permissions | Sign in as `full`. Open `#setup/profiles/user` | No access to Setup › Profiles, or the page is read-only | UI + network status |

### 3.2 Open the report (`{G,P}-OPEN-*`)

| ID | Profile | Steps | Expected |
| --- | --- | --- | --- |
| OPEN-01 | view, manage, delete, full | Open Reports (Global) or Project › Reports (Project) | Workload tab `tab_resourceutilpage` is visible. The report loads with the header range and user rows. `meta` and the first `reports/workload?index=1` return 2xx |
| OPEN-02 | none | Same as OPEN-01 | Workload tab is absent (`toHaveCount(0)`) |
| OPEN-03 | none | Open a copied view link or the workload deep link directly | Access-denied or empty state. No data rendered |
| OPEN-04 | none | API: `GET /reports/workload/meta?project_id=…&view_id=<any>` and `GET /reports/workload?…` with this session | Non-2xx. No `owners[]` returned |
| OPEN-05 | projonly (G) / globonly (P) | Open the level the profile has no access to | Same as OPEN-02 to OPEN-04 at that level, while the other level opens normally |
| OPEN-06 | view | Compare `meta.user_premission_details` | The flags reflect View-only (e.g. no create/delete flags). Record the exact keys found |
| OPEN-07 | view | Load All Users fully: scroll `.resourceutilTableholder` until `page_info.has_next=false` | UI rows = API owners (+1 if there is an Unassigned row). A permission profile must not reduce the data the user is allowed to see |

### 3.3 Create (`{G,P}-CRT-*`)

| ID | Profile | Steps | Expected |
| --- | --- | --- | --- |
| CRT-01 | view, delete | Open the view dropdown (`topbar_cview`) | `create_customview` is hidden |
| CRT-02 | manage, full | Open the view dropdown | `create_customview` is visible |
| CRT-03 | manage, full | Create `<RUN_ID>-crt-<key>`: name, description, Bar, Days › This Week. Save | `PUT /reports/custom-workload` returns 200. Toast shown. The view is listed under My Custom Views. Reopening it shows the saved settings. `user-views` contains it with `is_editable=true` |
| CRT-04 | view, delete, none | **API**: replay a create body that **Admin's session has just accepted** (positive control) with this user's session and a new name | Non-2xx. The view is **absent** from Admin's `user-views` afterwards. The body was proven valid by Admin, so a 400 for a malformed body can't be mistaken for a permission denial |
| CRT-05 | view, delete | Open `••• › Clone` on a seed view | `clone_customview` is hidden |
| CRT-06 | manage, full | Clone a seed view and save as `<RUN_ID>-clone-<key>` | Created. Criteria and Grouping tabs are present in the Clone form |
| CRT-07 | view | **API**: replay Admin's captured Clone request | Non-2xx. Nothing created |
| CRT-08 | manage | Create with Share = All users, then sign in as `view` | The shared view is visible and usable for `view` (open only, no edit or delete) |

### 3.4 Edit (`{G,P}-EDT-*`)

| ID | Profile | Steps | Expected |
| --- | --- | --- | --- |
| EDT-01 | view | Select seed `-shared-view`. Open `more_actions` (••• ) | `edit_customview` is absent. **Click by locator: the More Actions tooltip covers this item** |
| EDT-02 | manage, full | Same steps. Edit, change the description only, save, reopen | PUT 200. The description persists after reopening. Restore it afterwards |
| EDT-03 | view, none | **API**: replay Admin's captured edit PUT for the seed view with a changed description | Non-2xx. Admin re-reads the view: the description is unchanged |
| EDT-04 | delete | EDT-01 and EDT-03 for the Delete-only profile | Per Q2 (default expectation: no edit). **check spec** |
| EDT-05 | manage | Edit predefined **All Users** (snapshot the form first, restore it after) | Per spec. Only the Time Period and Report Preference tabs show, and the name is locked. Restore and prove it by reopening the form |
| EDT-06 | all | Compare `user-views.is_editable` with the UI for each seed | Flag = UI for every profile |

### 3.5 Delete (`{G,P}-DEL-*`)

| ID | Profile | Steps | Expected |
| --- | --- | --- | --- |
| DEL-01 | view, manage | Select seed `-shared-<key>`. Open ••• | The Delete item is absent |
| DEL-02 | delete, full | Same steps, then Delete and confirm | Confirm dialog shown. Toast shown. The view is gone from the dropdown after reopening it, from `user-views` (this user and Admin), and from Favorite Views if it was a favourite |
| DEL-03 | view, manage, none | **API**: replay the delete request captured from Admin's UI delete of a throwaway view, aimed at seed `-shared-<key>` | Non-2xx. The seed still exists in Admin's `user-views` |
| DEL-04 | all incl. admin | Open ••• on a predefined view | Delete is never offered, and `is_deletable=false` |
| DEL-05 | all | Compare `user-views.is_deletable` with the UI for each seed | Flag = UI |
| DEL-06 | delete | Delete the view that is currently the user's default (`my_anchor_customview`) | The report falls back to a valid view (e.g. All Users) with no error |
| DEL-07 | delete | User A has seed open. User B (`full`) deletes it. A refreshes (`refresh_status`) | A gets a clean fallback or message. No blank grid, no JS error |

There is **no documented delete endpoint** for custom workload views. Before running DEL-03, capture the call the UI makes when Admin deletes a throwaway view (method, path, body) and record it in the locator reference.

### 3.6 Personal actions (`{G,P}-PERS-*`)

| ID | Profile | Steps | Expected |
| --- | --- | --- | --- |
| PERS-01 | view | Favourite the star on a seed view, then unfavourite it | Per Q4. If allowed: `POST /user-views/<id>/favorite` returns 204, star class becomes `fav`, the view appears under Favorite Views. Then `DELETE …/favorite?module=workload` returns 204 and the view is gone after reopening the dropdown. **Known defect WL-D-01 (stale Favorite Views): re-check it, don't assume it** |
| PERS-02 | view | ••• › Set as default view, then reload | Per Q4. Opening the report lands on that view |
| PERS-03 | view | ••• › Copy link. Open the link as `view` and as `none` | `view` opens the view. `none` is denied (OPEN-03) |
| PERS-04 | view | Toolbar changes (data label, chart type) | "Save as" or a red dot may appear. Saving must still be impossible: no Save, or Save is refused |

### 3.7 Cross-level isolation (`X-*`)

| ID | Steps | Expected |
| --- | --- | --- |
| X-01 | `projonly`: Global Reports | Workload tab hidden. `meta?project_id=0` refused |
| X-02 | `projonly`: Project › Reports › Workload | Full rights (CRT/EDT/DEL pass as `full`) |
| X-03 | `globonly`: Project › Reports | Workload hidden. `meta?project_id=<projectId>` refused |
| X-04 | `globonly`: Global | Full rights |
| X-05 | Mixed profile: Global View-only, Project Full | Project: can create. Global: cannot create. A view created at project level does not show the Global create rights |
| X-06 | A view created at Global with `input_cview_otherproj` (use in other projects) on | Visible at project level. Edit and delete there follow the **project-level** checkboxes (**check spec**) |

### 3.8 Change propagation (`CHG-*`)

These need `ZP_ALLOW_PROFILE_CHANGES=1` and approval. They change only the QA profiles.

| ID | Steps | Expected |
| --- | --- | --- |
| CHG-01 | `view` is logged in with the report open. Admin adds Manage to QA-WL-View | After a refresh or re-login (per Q6), Create appears and CRT-03 passes |
| CHG-02 | `manage` is logged in with the Edit form **open**. Admin removes Manage. The user clicks Save | Save is refused by the server (not just hidden later). The view is unchanged |
| CHG-03 | `delete` has ••• open. Admin removes Delete. The user confirms Delete | Server refuses. The view still exists |
| CHG-04 | Admin removes View from QA-WL-View while the user is on the report | On the next data call (refresh, scroll) access is denied cleanly |
| CHG-05 | Restore every QA profile to §2.2 | `rc-checked` matches the table again |

### 3.9 Edge and negative (`E-*`)

| ID | Steps | Expected |
| --- | --- | --- |
| E-01 | `view` uses the browser console or a modified request to un-hide `create_customview` and submit the form | Server refuses (same as CRT-04) |
| E-02 | `<RUN_ID>-private-admin` (Only me) | Not visible to any other profile, `full` included. A direct `view_id` call is refused |
| E-03 | `manage` edits a view **shared by Admin** (not owned) | Per Q3. **check spec** |
| E-04 | `delete` deletes a view **owned by another user** | Per Q3. **check spec** |
| E-05 | `manage` creates `<RUN_ID>-own-manage`. Admin downgrades the profile to View | Per Q5. Default expectation: edit and delete refused even on the user's own view |
| E-06 | Profile with Manage and **no** View (if SET-03 allows) | Report doesn't open, or opens. Either way, record it and raise it as a spec gap |
| E-07 | Name collision: `manage` creates a view with an existing name | Validation message. No duplicate created |
| E-08 | Portal Admin (`admin`) | Full rights at both levels. Can't delete predefined views |

---

## 4. Automation

### 4.1 Approach

Build on the portal-agnostic Playwright project that ships with the `zoho-workload-report-qa` skill (`assets/workload-playwright/`). It already has:

| Piece | Use here |
| --- | --- |
| `src/env.ts` | The only inputs: `ZP_BASE_URL`, `ZP_PORTAL`, `ZP_ADMIN_STATE`, `ZP_USER_STATES` (profile key → storage-state file), `RUN_ID`, `ZP_ALLOW_PROFILE_CHANGES` |
| `tests/auth.setup.ts` | `ZP_AUTH_TARGETS=admin,none,view,manage,delete,full,projonly,globonly npm run auth`. A person signs in once per user, and only the session is saved |
| `src/discover.ts` | `Discovery` reads portal ID, `user-views` (`is_editable` / `is_deletable`) and `meta` (`user_premission_details`) from the app's own responses. `callAsUser()` replays a call with the current user's app headers |
| `src/pages/ProfilesPage.ts` | `openWorkload('projectreport' \| 'globalreport')`, `profiles()` (IDs discovered from the grid), `isTicked()` (reads `rc-checked`), `set()` (blocked unless `ZP_ALLOW_PROFILE_CHANGES=1`) |
| `src/locators.ts` | `data-zpqa` keys: `create_customview`, `clone_customview`, `edit_customview`, `more_actions`, `topbar_cview`, `tab_resourceutilpage` |
| `tests/permissions/workload-permissions.spec.ts` | SET-01, G-01/03 (open), G-04 (Create shown/hidden), G-05 (edit item + API flags), G-06 (API create). Global only |

Rules: data is discovered, never hardcoded. Use web-first assertions with no fixed sleeps. Use `expect.soft` inside profile loops. Mutating specs run serially (`workers: 1`) and clean up in `afterAll`.

### 4.2 Gaps in the current permission spec (fix these first)

| # | Gap | Risk | Fix |
| --- | --- | --- | --- |
| A1 | G-06 sends a minimal create body. For denied users, a non-2xx can come from a malformed body rather than a permission check | **False pass** on the core requirement "View must not create" | Positive control: send the exact body with the Admin session first and require 200. Then replay as each profile. Also assert the view is absent afterwards |
| A2 | G-05 opens `more_actions` on the **current** view (usually predefined All Users) but asserts the API flags of the `QA-WL-*` seed | UI and API checks target different views | Select the seed view with `wl.selectView()` before opening the menu |
| A3 | No UI check of the Delete item, and no API delete check | The Delete checkbox is untested | Capture the delete call from Admin's UI delete (§4.4). Add DEL-01/02/03 |
| A4 | No Clone or Edit API enforcement | Edit/Clone can be hidden in the UI but allowed by the server | Capture and replay the edit/clone PUT (EDT-03, CRT-07) |
| A5 | Global only | Project-level checkboxes are untested | Add `ZP_PROJECT` and a level-parameterised matrix (§4.3) |
| A6 | G-06 creates `QA-WL-*` views for manage/full and never removes them | Leftover records in a shared portal | Track created IDs and delete them in `afterAll` as Admin, then verify none remain |
| A7 | Seeds are assumed to exist | Tests are skipped or ambiguous on a fresh portal | Seed fixture creates one shared view per profile key (§2.3) |

### 4.3 Matrix as data, run per level

```ts
// tests/permissions/matrix.ts
export type Level = 'global' | 'project';
export type Caps = { open: boolean; create: boolean; clone: boolean; edit: boolean; del: boolean };
const F: Caps = { open: true, create: true, clone: true, edit: true, del: true };
const N: Caps = { open: false, create: false, clone: false, edit: false, del: false };

export const MATRIX: Record<string, Record<Level, Caps>> = {
  none:     { global: N, project: N },
  view:     { global: { ...N, open: true }, project: { ...N, open: true } },
  manage:   { global: { ...F, del: false }, project: { ...F, del: false } },
  delete:   { global: { ...N, open: true, del: true }, project: { ...N, open: true, del: true } }, // edit: Q2 check-spec
  full:     { global: F, project: F },
  projonly: { global: N, project: F },
  globonly: { global: F, project: N },
};
export const CHECK_SPEC: Record<string, string> = { 'delete.edit': 'Q2', 'view.personal': 'Q4' };
```

Level navigation (an addition to `env.ts`):

```ts
export const projectReportsUrl = () => `${env.baseUrl}/portal/${env.portal}#zp/projects/${process.env.ZP_PROJECT}/reports`; // confirm route in first live run
export const levelUrl = (l: Level) => (l === 'global' ? reportsUrl() : projectReportsUrl());
export const levelProjectId = (l: Level, d: Discovery) => (l === 'global' ? '0' : d.meta!.project_id);
```

### 4.4 API enforcement: capture as Admin, replay as each profile

This is the key technique. Don't hand-build request bodies. Let Admin perform the real UI action, record the request, prove it succeeds, then replay the same request with each lower-privilege session against that profile's own seed.

```ts
// src/capture.ts
import type { Page, Request } from '@playwright/test';
export interface Captured { method: string; path: string; body: string | null }

/** Records the next app request matching `re` (path relative to /api/v3/portal/<id>). */
export function captureNext(page: Page, re: RegExp, method?: string): Promise<Captured> {
  return new Promise(resolve => {
    const h = (r: Request) => {
      const m = r.url().match(/\/api\/v3\/portal\/\d+(\/.*)$/);
      if (m && re.test(m[1]) && (!method || r.method() === method)) {
        page.off('request', h);
        resolve({ method: r.method(), path: m[1], body: r.postData() });
      }
    };
    page.on('request', h);
  });
}
```

```ts
// tests/permissions/workload-permissions-api.spec.ts  (sketch)
import { test, expect } from '@playwright/test';
import { env, stateExists } from '../../src/env';
import { Discovery, callAsUser } from '../../src/discover';
import { captureNext } from '../../src/capture';
import { MATRIX, type Level } from './matrix';

test.describe.configure({ mode: 'serial' });

for (const level of ['global', 'project'] as Level[]) {
  test.describe(`${level}: API enforcement`, () => {
    let createReq: { method: string; path: string; body: string | null };

    test.beforeAll(async ({ browser }) => {
      // Admin creates a throwaway view through the UI; we record the exact PUT it sends.
      const page = await (await browser.newContext({ storageState: env.adminState })).newPage();
      const d = new Discovery(page); await page.goto(levelUrl(level)); /* open Workload tab */ await d.ready();
      const cap = captureNext(page, /^\/reports\/custom-workload/, 'PUT');
      // ... UI create of `${env.runId}-${level}-control` via create_customview + bt_save_customview ...
      createReq = await cap;
      // Positive control: the same body is accepted when replayed as Admin (new name).
      const ok = await callAsUser(page, d, 'PUT', createReq.path, withName(createReq.body, `${env.runId}-${level}-ctrl2`));
      expect(ok.status(), 'positive control: Admin replay must succeed').toBe(200);
    });

    for (const [key, caps] of Object.entries(MATRIX)) {
      test(`${key}: create via API ${caps[level].create ? 'allowed' : 'denied'}`, async ({ browser }) => {
        test.skip(!stateExists(env.userStates[key]), `no saved login for ${key}`);
        const page = await (await browser.newContext({ storageState: env.userStates[key] })).newPage();
        const d = new Discovery(page); await page.goto(levelUrl(level));
        if (caps[level].open) await d.ready(); // a denied user still makes some API calls, which give us portal ID and headers
        const name = `${env.runId}-${level}-${key}-api`;
        const res = await callAsUser(page, d, 'PUT', createReq.path, withName(createReq.body, name));
        test.info().annotations.push({ type: 'api', description: `${res.status()} ${(await res.text()).slice(0, 200)}` });
        expect.soft(res.ok()).toBe(caps[level].create);
        expect.soft(await adminSeesView(browser, level, name), 'state oracle (Admin re-read)').toBe(caps[level].create);
      });
    }
  });
}
// withName(): JSON- or form-encoded body → replace `name`; adminSeesView(): Admin context lists user-views and looks for name.
```

Apply the same pattern to:

- **Edit (EDT-03)**: capture Admin's Edit-save PUT for a seed view. Replay it with a changed description against `-shared-<key>`. Oracle: Admin reopens the form, or reads the description from the view.
- **Clone (CRT-07)**: capture the request sent by `clone_customview` and its save.
- **Delete (DEL-03)**: capture whatever request Admin's UI delete of a throwaway view sends. Its method and path are unknown until observed, so record them in `references/locators.md` the first time. Replay it against `-shared-<key>`. Oracle: the seed is still in Admin's `user-views` (denied) or gone (allowed).
- **Open (OPEN-04)**: `GET /reports/workload/meta?project_id=<levelProjectId>&view_id=<id>` and `GET /reports/workload?…index=1…` must be non-2xx for profiles that can't open the report.

For each denied call, record the status code and error code in the annotations. Once they are consistent across runs, pin them (e.g. `expect(res.status()).toBe(<observed>)`), so that a 500 doesn't pass as a denial.

### 4.5 UI layer: per profile and level

```ts
// in workload-permissions.spec.ts, after selecting the per-profile seed view (fix A2)
await wl.selectView(seedName(key), 'Shared Views');
await wl.openViews();
await expect.soft(qa(page, K.createView)).toBeVisible({ visible: caps.create });
await wl.closeViews();
await wl.openMoreActions();
await expect.soft(qa(page, K.edit)).toHaveCount(caps.edit ? 1 : 0);
await expect.soft(qa(page, K.clone)).toHaveCount(caps.clone ? 1 : 0);
await expect.soft(deleteItem(page)).toHaveCount(caps.del ? 1 : 0); // locator to confirm live (A3)
// layer 3: flags must agree with the UI
const v = wl.d.view(seedName(key));
expect.soft(v.is_editable).toBe(caps.edit);
expect.soft(v.is_deletable).toBe(caps.del);
```

- **Positive flows** (CRT-03/06, EDT-02, DEL-02) drive the real form through `WorkloadEditPage`. Use `save()`, which waits for `PUT /reports/custom-workload` and the first data page. Reopen the form after each save.
- **The Delete menu locator is not in the reference yet.** Find its `data-zpqa` key in the first live run and add it to `K` in `src/locators.ts` (as with `edit_customview`). Use a role/text locator only as a temporary fallback.
- **Predefined view edits (EDT-05)** must use the existing `preserveViewSettings()` fixture (snapshot in `beforeAll`, restore and verify in `afterAll`).

### 4.6 Setup layer (Admin)

```ts
const pp = new ProfilesPage(page); await pp.goto();
for (const level of ['projectreport', 'globalreport'] as const) {
  await pp.openWorkload(level);
  const byName = new Map((await pp.profiles()).map(p => [p.name, p.id]));
  for (const [key, row] of Object.entries(EXPECTED_PROFILE_STATE)) {         // from §2.2
    const id = byName.get(row.profileName)!;
    for (const perm of ['view', 'manage', 'delete'] as const)
      expect.soft(await pp.isTicked(id, perm), `${level} ${row.profileName} ${perm}`).toBe(row[level][perm]);
  }
}
```

SET-03, SET-04 and CHG-* call `pp.set()`. These are tagged `@profile-change`. They run only with `ZP_ALLOW_PROFILE_CHANGES=1`, change **only** the `QA-WL-*` profiles, and restore §2.2 in `afterAll` (CHG-05).

### 4.7 Suite layout, tags and CI

| File | Cases | Mutates | Tag |
| --- | --- | --- | --- |
| `tests/permissions/setup-profiles.spec.ts` | SET-01, 02, 05, 06, 07 | No | `@perm` |
| `tests/permissions/setup-profile-changes.spec.ts` | SET-03, 04, CHG-01 to 05 | QA profiles (restored) | `@perm @profile-change` |
| `tests/permissions/workload-permissions.spec.ts` | OPEN, CRT-01/02/05, EDT-01/06, DEL-01/04/05, PERS (UI + flags) × level | Favourite/default only (restored) | `@perm` |
| `tests/permissions/workload-permissions-api.spec.ts` | OPEN-04, CRT-04/07, EDT-03, DEL-03 × level | Seeds and `QA-WL-*` (cleaned) | `@perm @api` |
| `tests/permissions/workload-permissions-flows.spec.ts` | CRT-03/06/08, EDT-02/05, DEL-02/06/07, X-*, E-* | Yes (cleaned and restored) | `@perm @mutating` |
| `tests/permissions/seed.setup.ts` / `teardown` | Seed views (§2.3), cleanup | Yes | n/a |

Ordering: `auth` (manual, once) → `seed.setup` → permission specs (serial, `workers: 1`) → teardown. Teardown always runs and asserts that no `QA-WL-*` view remains.

Commands:

```bash
npm run auth                                          # Admin + every key in ZP_AUTH_TARGETS
npx playwright test --project=permissions --grep @perm --grep-invert @profile-change
ZP_ALLOW_PROFILE_CHANGES=1 npx playwright test --grep @profile-change   # only with approval
```

- **Reports**: list, HTML, JSON and JUnit already come from `playwright.config.ts`. Each denied API call adds an `api` annotation with its status and body excerpt, which serves as the evidence for the defect table.
- **Missing logins**: a profile without a saved login is **skipped with a reason**, not failed.
- **check spec cells**: annotate them `check-spec` instead of asserting until Q1 to Q8 are answered.
- **Optional live run**: the same cases can be run by hand in Chrome with the skill's `scripts/wl-helper.js` (`__wl.lastReq()` and similar for the API layer). Results go into the playbook doc as step tables (Action · Expected · Actual · Evidence · Result) and defects continue the WL-D-nn series.

---

## 5. Exit criteria

- Every non-"check spec" cell of §1.2 has passed at **both** levels, in the UI **and** the API.
- No profile can create, clone, edit or delete through the API beyond its checkboxes, with the state oracle confirming it.
- SET-01 to SET-05 pass, and Q1 to Q8 are answered and folded into the matrix.
- The portal is left as found: QA profiles match §2.2, no `QA-WL-*` views remain, and any predefined view that was edited has been restored and checked by reopening the form.

## 6. Defect template (WL-D-nn, continue the series)

| ID | Severity | Level | Profile | Summary | Steps | Expected | Actual (UI) | Actual (API status / body) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WL-D-nn | e.g. Critical when the API allows an action the checkbox denies; Major when only the UI is wrong | G/P | key | | | | | |
