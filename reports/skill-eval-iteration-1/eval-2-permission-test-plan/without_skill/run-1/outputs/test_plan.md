# Test Plan: Workload Report Permissions (Zoho Projects)

| Item | Detail |
|---|---|
| Feature | Profile-based permissions for the Workload Report: **View / Manage / Delete** |
| Location | Setup > Users > Profiles > *(profile)* > **Project Reports > Workload Report** and **Global Reports > Workload Report** |
| Test types | Functional UI, API enforcement (authorization), negative / security, regression, change propagation |
| Automation | UI: Playwright (TypeScript). API: Playwright `APIRequestContext` (or REST Assured / pytest + requests). Data-driven from one permission matrix. |

---

## 1. Scope

### 1.1 In scope
- The six checkboxes in the profile editor (3 under Project Reports, 3 under Global Reports): how they render, depend on each other, save and persist.
- What each permission does in the Workload Report UI:
  - **View**: open the report and see / switch between existing workload views. **Cannot** create or delete a view.
  - **Manage**: create a workload view (and, unless the spec says otherwise, edit / rename / save filters on it).
  - **Delete**: delete a workload view.
- Keeping the scopes separate: project-level Workload Report (inside a project) vs. Global Workload Report (portal-level Reports module).
- Checking the same rules on the server side through API calls, so a user can't get around a hidden button.
- What happens when a profile changes (users already logged in, open tabs, cached UI).

### 1.2 Out of scope
- Whether the workload numbers are correct (hours, allocation, capacity math). That gets its own functional test plan.
- Permissions for other reports (Timesheet, Task, Gantt, etc.). These are only checked as a regression smoke (section 4.10).
- Performance / load.

### 1.3 Assumptions (confirm with PM / dev before execution)
| # | Assumption | Why it matters |
|---|---|---|
| A1 | Checking **Manage** or **Delete** auto-checks **View**, and unchecking **View** clears Manage/Delete (or blocks the save). | Decides whether "Manage/Delete without View" can exist at all. Covered by PRF-004..007. |
| A2 | **Manage** = create + edit/rename/update filters of a view. It does **not** include delete. | Edit isn't in the original requirement. Treat it as Manage until told otherwise. |
| A3 | **Delete** works without Manage: the user can delete views but not create them. | Explicitly requested ("delete should allow delete"). |
| A4 | The system / default workload view (if there is one) can't be deleted by anyone. | Edge case WLV-DEL-008. |
| A5 | Portal Owner and Admin profiles can do everything, and their checkboxes are locked. | PRF-009. |
| A6 | Project-level and Global permissions are independent. Global Manage does not give project-level Manage, and the reverse also holds. | Scope isolation section 4.6. |
| A7 | A view's creator has no extra rights beyond their profile. A creator without Delete can't delete their own view. | WLV-DEL-006. |
| A8 | Views are either personal or shared. Delete on a shared view created by another user follows the profile, not ownership. | WLV-DEL-007. Confirm the sharing model. |

---

## 2. Permission Model Under Test

### 2.1 Expected behaviour per checkbox combination (applies to each scope independently)

| ID | View | Manage | Delete | Report visible | Switch / open existing views | Create view | Edit / rename view | Delete view |
|---|---|---|---|---|---|---|---|---|
| C0 | - | - | - | No (menu/tab hidden; deep link shows access denied) | No | No | No | No |
| C1 | Yes | - | - | Yes | Yes | **No** | **No** | **No** |
| C2 | Yes | Yes | - | Yes | Yes | **Yes** | Yes (A2) | **No** |
| C3 | Yes | - | Yes | Yes | Yes | **No** | **No** | **Yes** |
| C4 | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| C5 | - | Yes | - | Per A1: not saveable, or View auto-checks (then same as C2) | | | | |
| C6 | - | - | Yes | Per A1: not saveable, or View auto-checks (then same as C3) | | | | |
| C7 | - | Yes | Yes | Per A1: not saveable, or View auto-checks (then same as C4) | | | | |

### 2.2 Scope combinations
Each user's effective permissions come from a pair: *(Project scope combo, Global scope combo)*. Testing all 8 x 8 pairs isn't needed. Use these:
- Each valid combo (C0-C4) in one scope with the other scope set to **C0** (10 runs). This shows each scope works alone and doesn't leak.
- Opposite pairs: (C4, C1), (C1, C4), (C2, C3), (C3, C2) (4 runs).
- (C4, C4) and (C0, C0) as baselines.

---

## 3. Test Environment and Data

### 3.1 Portal and projects
- One test portal (a dedicated QA portal, never production).
- Projects: **P-Alpha** and **P-Beta**, each with at least 3 users who have tasks, work hours and allocations, so the report has data.
- Seeded views, created by Admin:
  - In P-Alpha project workload: `QA-Shared-Alpha` (shared), `QA-Admin-Private` (private to admin).
  - In Global workload: `QA-Shared-Global` (shared).
  - The system default view (if it exists).

### 3.2 Profiles (create in Setup > Users > Profiles)
| Profile name | Project WL (V/M/D) | Global WL (V/M/D) |
|---|---|---|
| `QA_WL_None` | -/-/- | -/-/- |
| `QA_WL_P_View` | V/-/- | -/-/- |
| `QA_WL_P_Manage` | V/M/- | -/-/- |
| `QA_WL_P_Delete` | V/-/D | -/-/- |
| `QA_WL_P_Full` | V/M/D | -/-/- |
| `QA_WL_G_View` | -/-/- | V/-/- |
| `QA_WL_G_Manage` | -/-/- | V/M/- |
| `QA_WL_G_Delete` | -/-/- | V/-/D |
| `QA_WL_G_Full` | -/-/- | V/M/D |
| `QA_WL_PFull_GView` | V/M/D | V/-/- |
| `QA_WL_PView_GFull` | V/-/- | V/M/D |
| `QA_WL_PManage_GDelete` | V/M/- | V/-/D |
| `QA_WL_PDelete_GManage` | V/-/D | V/M/- |
| `QA_WL_Full` | V/M/D | V/M/D |

Keep every other permission identical across these profiles (clone from one base profile, e.g. "Employee"). That way a difference in behaviour can only come from the workload checkboxes.

### 3.3 Users
- One test user per profile: `qa.wl.<profile>@<qa-domain>`, added to both P-Alpha and P-Beta.
- `qa.admin` (Admin profile) for setup, cleanup and verifying results.
- One **client user** (if the portal uses client users) to confirm the report is never shown to them, whatever the checkboxes say.
- Credentials and OAuth tokens live in the CI secret store. They are never committed.

---

## 4. Test Cases

Priority: **P1** = must pass for release, **P2** = important, **P3** = nice to have.
Each case lists the scope it targets: **PRJ** (project-level), **GLB** (global), or **BOTH**.

### 4.1 Profile Configuration UI (PRF)

| ID | Title | Scope | Steps | Expected | Pri |
|---|---|---|---|---|---|
| PRF-001 | Checkboxes are present | BOTH | Admin > Setup > Users > Profiles > open a custom profile. Expand Project Reports and Global Reports. | "Workload Report" row appears under both, with View, Manage and Delete checkboxes. Labels and tooltips are correct. | P1 |
| PRF-002 | Default state for a new profile | BOTH | Create a new profile from scratch, and another by cloning "Employee". | Defaults match the spec (document them). A clone copies the source profile's workload checkboxes exactly. | P2 |
| PRF-003 | Save and persist each combo | BOTH | For each combo C0-C4, set the checkboxes, save, reload the page, reopen the profile. | The checkbox state matches what was saved, with nothing dropped or flipped. | P1 |
| PRF-004 | Checking Manage implies View | BOTH | Start with all unchecked. Check Manage. | View is auto-checked (or Save is blocked with a clear message), per A1. | P1 |
| PRF-005 | Checking Delete implies View | BOTH | Start with all unchecked. Check Delete. | Same as PRF-004. | P1 |
| PRF-006 | Unchecking View clears dependents | BOTH | Start with V/M/D. Uncheck View. | Manage and Delete are cleared (or disabled), or Save is blocked, per A1. No profile can be saved as "-/M/-". | P1 |
| PRF-007 | Manage and Delete are independent | BOTH | Start with V/M/D. Uncheck Manage. Save. | Result is V/-/D. Delete stays checked. | P1 |
| PRF-008 | Scopes are independent in the editor | BOTH | Change only the Project WL checkboxes. Save. | Global WL checkboxes are unchanged, and the reverse also holds. | P1 |
| PRF-009 | Admin / Portal Owner profiles are locked | BOTH | Open the Admin and Portal Owner profiles. | Workload checkboxes are all checked and greyed out / not editable (A5). | P2 |
| PRF-010 | Parent "Project Reports" / "Global Reports" toggle | BOTH | If a module-level "select all" or a disabled Reports module exists, toggle it off. | The workload checkboxes follow (all cleared or disabled). The report is hidden for users with that profile. | P2 |
| PRF-011 | Cancel discards changes | BOTH | Change checkboxes, then click Cancel or navigate away. | Nothing is saved. An "unsaved changes" prompt appears if the product supports it. | P3 |
| PRF-012 | Non-admin can't edit profiles | - | Log in as `QA_WL_Full` and open Setup > Profiles (UI + deep link). | No access, or read-only. The profile edit API returns 403. | P1 |
| PRF-013 | Audit trail | BOTH | Change the workload checkboxes, then check the portal audit log / activity. | The change is logged with the actor, the profile and the before/after values (if the portal audits profile changes). | P3 |

### 4.2 Report Visibility / View Permission (VW)

| ID | Title | Scope | Profile | Steps | Expected | Pri |
|---|---|---|---|---|---|---|
| VW-001 | No permission: report hidden in project | PRJ | `QA_WL_None` | Open P-Alpha > Reports. | The Workload Report entry is not listed. | P1 |
| VW-002 | No permission: deep link blocked in project | PRJ | `QA_WL_None` | Paste the project workload report URL directly. | Access-denied page or redirect. No workload data is shown, even briefly. | P1 |
| VW-003 | No permission: global report hidden | GLB | `QA_WL_None` | Open the portal-level Reports module. | Workload Report is not listed. A deep link to it is blocked. | P1 |
| VW-004 | View: report opens in project | PRJ | `QA_WL_P_View` | P-Alpha > Reports > Workload. | The report loads with data. The default view is selected. | P1 |
| VW-005 | View: can switch between existing views | PRJ | `QA_WL_P_View` | Open the view dropdown and select `QA-Shared-Alpha`. | The view loads with its saved filters applied. | P1 |
| VW-006 | View: private views of others not visible | PRJ | `QA_WL_P_View` | Open the view dropdown. | `QA-Admin-Private` is not listed (per the sharing model, A8). | P2 |
| VW-007 | View: temporary filtering allowed, but can't save | PRJ | `QA_WL_P_View` | Change the date range or user filter on the report. | The data refreshes (ad-hoc filtering is fine). No "Save" / "Save as view" option is shown or enabled. | P1 |
| VW-008 | View: global report opens | GLB | `QA_WL_G_View` | Reports (global) > Workload. | The report loads across permitted projects. Views can be switched. | P1 |
| VW-009 | Export / print respects View | BOTH | `*_View` | Use Export / Print if they exist. | Allowed or blocked according to the export spec. Note the result; there's no separate checkbox for it. | P3 |
| VW-010 | Client user never sees it | BOTH | client user | Browse Reports in the project and globally. | Workload Report is not shown. Deep link is blocked. | P2 |

### 4.3 Create Workload View / Manage Permission (MNG)

| ID | Title | Scope | Profile | Steps | Expected | Pri |
|---|---|---|---|---|---|---|
| MNG-001 | View-only: no create control | PRJ | `QA_WL_P_View` | Open the project workload report and look for "New view", "+", "Save as" or "Create view". | No create control is present, or it is disabled with a tooltip. | P1 |
| MNG-002 | View-only: no create control (global) | GLB | `QA_WL_G_View` | Same, in the global report. | Same as MNG-001. | P1 |
| MNG-003 | View-only: create blocked by API | PRJ | `QA_WL_P_View` | Send the create-view API request (section 5.3) with this user's token. | 403 / permission-error code. A follow-up GET as admin shows no view was created. | P1 |
| MNG-004 | View-only: create blocked by API (global) | GLB | `QA_WL_G_View` | Same, against the global endpoint. | Same as MNG-003. | P1 |
| MNG-005 | Manage: create a view | PRJ | `QA_WL_P_Manage` | Click Create view, give it a name and filters, save. | The view is saved, shows in the dropdown, and its filters still apply after a reload. | P1 |
| MNG-006 | Manage: create a view (global) | GLB | `QA_WL_G_Manage` | Same, in the global report. | Same as MNG-005. | P1 |
| MNG-007 | Manage: edit / rename own view | BOTH | `*_Manage` | Change the filters and rename a view you created. Save. | Changes persist (A2). | P2 |
| MNG-008 | Manage: edit a shared view created by another user | BOTH | `*_Manage` | Edit `QA-Shared-*`. | Allowed or blocked per the sharing spec (A8). Record the actual result. | P2 |
| MNG-009 | View-only: edit blocked | BOTH | `*_View` | Look for rename/edit on an existing view in the UI. Send an update API request. | No UI control. API returns 403. The view is unchanged. | P1 |
| MNG-010 | Manage without Delete: delete hidden | BOTH | `*_Manage` | Open the actions menu of a view you created. | No Delete option is shown (or it is disabled). | P1 |
| MNG-011 | Field validation on create | BOTH | `*_Manage` | Try an empty name, a duplicate name, a 255+ character name, special characters / emoji, and HTML / script in the name. | A validation message appears. The name is escaped when displayed (no XSS). Duplicates are handled per the spec. | P2 |
| MNG-012 | Visibility of a view created by a Manage user | BOTH | `*_Manage` then `*_View` | User A (Manage) creates a shared view. User B (View) opens the report. | B sees the shared view and can open it, but can't edit or delete it. | P2 |
| MNG-013 | Delete-only: no create control | BOTH | `*_Delete` | Look for create controls. Send the create API request. | No create control in the UI. API returns 403. | P1 |

### 4.4 Delete Workload View / Delete Permission (DEL)

| ID | Title | Scope | Profile | Steps | Expected | Pri |
|---|---|---|---|---|---|---|
| DEL-001 | View-only: no delete control | PRJ | `QA_WL_P_View` | Open the view actions menu / hover over a view in the list. | No Delete option, or it's disabled. | P1 |
| DEL-002 | View-only: no delete control (global) | GLB | `QA_WL_G_View` | Same, in the global report. | Same as DEL-001. | P1 |
| DEL-003 | View-only: delete blocked by API | BOTH | `*_View` | Send the delete-view API request for `QA-Shared-*`. | 403. A follow-up GET as admin shows the view still exists. | P1 |
| DEL-004 | Delete: delete a view | PRJ | `QA_WL_P_Delete` | Delete a seeded disposable view and confirm the dialog. | The view is removed from the dropdown and stays gone after a reload. A GET returns 404 / the view isn't in the list. | P1 |
| DEL-005 | Delete: delete a view (global) | GLB | `QA_WL_G_Delete` | Same, in the global report. | Same as DEL-004. | P1 |
| DEL-006 | Creator without Delete can't delete own view | BOTH | `*_Manage` | Create a view, then try to delete it (UI + API). | Blocked (A7). If the product lets creators delete their own views, raise it as a spec question. | P1 |
| DEL-007 | Delete a view created by another user | BOTH | `*_Delete` | Delete a shared view created by admin. | Allowed or blocked per the sharing spec (A8). | P2 |
| DEL-008 | Default / system view can't be deleted | BOTH | `QA_WL_Full` | Try to delete the default view (UI + API). | Blocked for everyone, admin included (A4). | P2 |
| DEL-009 | Cancel in the confirm dialog | BOTH | `*_Delete` | Click Delete, then Cancel. | The view is not deleted. | P2 |
| DEL-010 | Deleting the currently selected view | BOTH | `*_Delete` | Select view X, then delete X. | The report falls back to the default view without errors. | P2 |
| DEL-011 | Deleted view open in another user's session | BOTH | `*_Delete` + `*_View` | User B has view X open. User A deletes X. User B refreshes or switches views. | B gets a "view not found" message and falls back cleanly. No stale data is saved. | P3 |
| DEL-012 | Full: create, then delete | BOTH | `*_Full` | Create view, then delete it, in one session. | Both succeed. | P1 |

### 4.5 Combined Permission Matrix (MTX)
Run one data-driven test per profile in section 3.2 for **each scope**. It checks the full row of table 2.1 (report visible, switch views, create, edit, delete) in both the UI and the API. This is the main regression suite. It overlaps with 4.2-4.4 on purpose; those sections give readable manual cases, and this one gives full coverage.

| ID | Profile | Project-scope expectation | Global-scope expectation | Pri |
|---|---|---|---|---|
| MTX-01 | `QA_WL_None` | C0 | C0 | P1 |
| MTX-02 | `QA_WL_P_View` | C1 | C0 | P1 |
| MTX-03 | `QA_WL_P_Manage` | C2 | C0 | P1 |
| MTX-04 | `QA_WL_P_Delete` | C3 | C0 | P1 |
| MTX-05 | `QA_WL_P_Full` | C4 | C0 | P1 |
| MTX-06 | `QA_WL_G_View` | C0 | C1 | P1 |
| MTX-07 | `QA_WL_G_Manage` | C0 | C2 | P1 |
| MTX-08 | `QA_WL_G_Delete` | C0 | C3 | P1 |
| MTX-09 | `QA_WL_G_Full` | C0 | C4 | P1 |
| MTX-10 | `QA_WL_PFull_GView` | C4 | C1 | P1 |
| MTX-11 | `QA_WL_PView_GFull` | C1 | C4 | P1 |
| MTX-12 | `QA_WL_PManage_GDelete` | C2 | C3 | P2 |
| MTX-13 | `QA_WL_PDelete_GManage` | C3 | C2 | P2 |
| MTX-14 | `QA_WL_Full` | C4 | C4 | P1 |

### 4.6 Scope Isolation (ISO)

| ID | Title | Profile | Steps | Expected | Pri |
|---|---|---|---|---|---|
| ISO-001 | Global Manage doesn't grant project create | `QA_WL_PView_GFull` | Try to create a view in the project workload report (UI + API). | Blocked. | P1 |
| ISO-002 | Project Manage doesn't grant global create | `QA_WL_PFull_GView` | Try to create a view in the global workload report (UI + API). | Blocked. | P1 |
| ISO-003 | Global Delete doesn't grant project delete | `QA_WL_PManage_GDelete` | Try to delete a project-level view. | Blocked. | P1 |
| ISO-004 | Project Delete doesn't grant global delete | `QA_WL_PDelete_GManage` | Try to delete a global view. | Blocked. | P1 |
| ISO-005 | View lists are separate | `QA_WL_Full` | Create a project view `ISO-P` and a global view `ISO-G`. | `ISO-P` is listed only in the project report, and `ISO-G` only in the global report (unless the spec says views are shared across scopes). | P2 |
| ISO-006 | Global report only shows permitted projects | `QA_WL_G_View` | User is a member of P-Alpha only. Open the global report. | Only P-Alpha data/users appear. P-Beta data does not leak. | P1 |
| ISO-007 | API: project view ID used on the global endpoint | `QA_WL_PFull_GView` | Call the global delete endpoint with a project-scoped view ID (and the reverse). | Rejected (403/404). Neither view is deleted. | P2 |
| ISO-008 | Cross-project ID tampering | `QA_WL_P_Full` (member of P-Alpha only) | Call the P-Beta view endpoints, or a P-Alpha endpoint with a P-Beta view ID. | 403/404. No data from P-Beta is returned. | P1 |

### 4.7 Permission Change Propagation (CHG)

| ID | Title | Steps | Expected | Pri |
|---|---|---|---|---|
| CHG-001 | Grant Manage while user is logged in | User (`*_View`) has the report open. Admin adds Manage to the profile. User refreshes. | The create control appears after a refresh or re-login (document which). The API allows create right after the change. | P1 |
| CHG-002 | Revoke Manage while user is logged in | User (`*_Manage`) has the create dialog open. Admin removes Manage. User clicks Save. | Server rejects with 403 and the UI shows an error message. No view is created. | P1 |
| CHG-003 | Revoke Delete while user is logged in | User has the delete confirmation open. Admin removes Delete. User confirms. | Server rejects with 403. The view still exists. | P1 |
| CHG-004 | Revoke View | User has the report open. Admin unchecks View. User refreshes. | The report is no longer accessible and its menu entry is gone. | P1 |
| CHG-005 | Change the user's profile assignment | Admin moves the user from `QA_WL_P_Full` to `QA_WL_P_View`. | The new permissions apply (same checks as CHG-001..004). | P1 |
| CHG-006 | Views survive a permission change | User creates views, then loses Manage. | Existing views remain and stay visible (View). The user can't edit or delete them. | P2 |
| CHG-007 | Deleting a profile | Delete a test profile that still has users (if allowed). | The product forces reassignment. Users end up with the reassigned profile's permissions. | P3 |

### 4.8 Security / Negative (SEC)

| ID | Title | Steps | Expected | Pri |
|---|---|---|---|---|
| SEC-001 | Re-enabling hidden or disabled buttons | As `*_View`, use DevTools to un-hide or enable the create/delete controls and click them. | The server rejects the request (403). Nothing changes. | P1 |
| SEC-002 | Replaying a captured admin request | Capture a create/delete request as admin. Replay it with the `*_View` user's session/token. | 403. | P1 |
| SEC-003 | Missing / expired / other-portal token | Call the endpoints without a token, with an expired token, or with a token from another portal. | 401 / 403. No data in the response. | P2 |
| SEC-004 | CSRF on create/delete | Send the web-client request without the CSRF parameter/header. | Rejected. | P2 |
| SEC-005 | Error messages don't leak data | Look at the 403/404 response bodies. | They contain no view filters, no other users' data and no stack traces. | P2 |
| SEC-006 | Brute-forcing view IDs | As `*_View`, loop the delete call over a range of IDs. | Every call is rejected. Rate limiting kicks in if it's configured. | P3 |

### 4.9 Cross-browser / Client (CLI)
| ID | Title | Expected | Pri |
|---|---|---|---|
| CLI-001 | Chrome, Firefox, Edge, Safari (latest) | The controls show or hide the same way for C1-C4. | P2 |
| CLI-002 | Zoho Projects mobile apps (Android / iOS), if the workload report is available there | The same permission rules apply. View-only users don't get a create/delete action. | P2 |
| CLI-003 | Localization (at least one RTL language and one non-English) | Checkbox labels are translated. Permission behaviour is unchanged. | P3 |

### 4.10 Regression (REG)
| ID | Title | Expected | Pri |
|---|---|---|---|
| REG-001 | Other report permissions are unaffected | Toggling the workload checkboxes doesn't change Timesheet / Task / other report checkboxes or behaviour. | P1 |
| REG-002 | Profiles created before this feature | Existing profiles migrate to the documented defaults (e.g. View on for profiles that had Reports access). Users keep the access they had. | P1 |
| REG-003 | Project roles vs profiles | A project-level role (e.g. Manager) doesn't override the profile's workload permissions, unless the spec says it does. | P2 |

---

## 5. Automation Strategy

### 5.1 Approach
- **One source of truth:** a `permission-matrix.json` file that encodes table 2.1 and the profile list in 3.2. The UI and API suites both generate their tests from it, so a spec change is a single-file edit.
- **Two layers:**
  - **API layer (fast, high coverage):** every matrix row x every action (list, get, create, update, delete), in both scopes. Runs on every build.
  - **UI layer (fewer tests):** checks that controls are present or absent, plus the happy-path create/delete. Runs nightly and before release.
- **Setup through API where possible:** profiles, users and seeded views are created or reset through the API (or a one-time admin UI script if there's no profile API). Each run ends with a cleanup step that deletes views with the `AUTO-` name prefix.
- **Test isolation:** every view an automated test creates is named `AUTO-<testId>-<timestamp>`. Tests never touch views created by other tests.

### 5.2 Tooling
| Concern | Choice |
|---|---|
| UI | Playwright Test (TypeScript), Chromium + Firefox + WebKit projects |
| API | Playwright `request` fixture (same repo and runner). Use REST Assured or pytest instead if the team's API suite already runs there. |
| Auth (UI) | One `storageState` file per test user, produced in `globalSetup` by logging in once through the Zoho Accounts login page. Accounts must be dedicated QA accounts with MFA exempted, or use a QA-portal SSO bypass approved by security. |
| Auth (API) | Zoho OAuth 2.0. One refresh token per test user (Self Client in the Zoho API console, scopes `ZohoProjects.portals.READ`, `ZohoProjects.projects.ALL` and any reports/users scopes the endpoints need). Exchange each refresh token for an access token at the start of the run. Store secrets in CI vault only. |
| Reporting | Playwright HTML report + JUnit XML for CI. Tag tests with case IDs (`@MNG-003`) so results trace back to this plan. |
| CI | Run the API suite on every PR/merge against the QA portal. Run the full UI suite nightly. Run with `workers` > 1, but give each worker its own users, or serialize profile-mutating tests (CHG-*), because those change shared state. |

### 5.3 API endpoints
The workload-view endpoints may not be in the public Zoho Projects REST API docs. Before writing the API tests:
1. Open the workload report in the browser as admin, with DevTools > Network (or a HAR export) recording.
2. Capture the requests for: list views, get view, create view, update view, delete view. Do this for both project and global scope. Also capture the requests for profile read/update in Setup.
3. Write them into `config/endpoints.json`. Tests read paths from that file and never hard-code them.

Example `config/endpoints.json` (the paths are **placeholders**; replace them with the captured ones):
```json
{
  "baseUrl": "https://projectsapi.zoho.com/restapi",
  "project": {
    "listViews":  "GET    /portal/{portalId}/projects/{projectId}/workload/views",
    "createView": "POST   /portal/{portalId}/projects/{projectId}/workload/views",
    "updateView": "PUT    /portal/{portalId}/projects/{projectId}/workload/views/{viewId}",
    "deleteView": "DELETE /portal/{portalId}/projects/{projectId}/workload/views/{viewId}"
  },
  "global": {
    "listViews":  "GET    /portal/{portalId}/workload/views",
    "createView": "POST   /portal/{portalId}/workload/views",
    "updateView": "PUT    /portal/{portalId}/workload/views/{viewId}",
    "deleteView": "DELETE /portal/{portalId}/workload/views/{viewId}"
  },
  "profiles": {
    "get":    "GET /portal/{portalId}/profiles/{profileId}",
    "update": "PUT /portal/{portalId}/profiles/{profileId}"
  }
}
```

**API assertions for a blocked action:**
- The HTTP status is 403 (or whatever status the product actually returns; record it once, then assert it exactly) and the body has the Zoho permission error code.
- **No side effect.** Re-query as admin: the view count is unchanged, the view still exists, or the name/filters are unchanged. A 403 that still writes the change is the most serious bug class this plan is looking for.

**API assertions for an allowed action:**
- 200/201/204, and the response has the expected shape (view ID, name).
- Re-query as the same user and as admin to confirm the change persisted.

### 5.4 Project layout
```
workload-permissions-tests/
  config/
    endpoints.json
    users.json                 # user -> profile mapping (no secrets)
  data/
    permission-matrix.json     # source of truth (table 2.1 + 3.2)
  fixtures/
    auth.ts                    # per-user storageState + OAuth token fixtures
    api-client.ts              # thin wrapper: listViews/createView/deleteView(scope, ...)
    seed.ts                    # create profiles, users, seed views; cleanup AUTO-*
  pages/
    ProfileEditorPage.ts       # Setup > Profiles checkbox interactions
    WorkloadReportPage.ts      # report, view dropdown, create/delete controls
  tests/
    api/
      matrix.api.spec.ts       # MTX-* x actions, ISO-*, SEC-*
      propagation.api.spec.ts  # CHG-* (serial)
    ui/
      profile-editor.spec.ts   # PRF-*
      matrix.ui.spec.ts        # VW-*, MNG-*, DEL-* via matrix
      propagation.ui.spec.ts   # CHG-001..004 (serial)
  global-setup.ts
  playwright.config.ts
```

### 5.5 Sample: permission matrix (excerpt)
```json
{
  "combos": {
    "C0": { "visible": false, "switch": false, "create": false, "edit": false, "delete": false },
    "C1": { "visible": true,  "switch": true,  "create": false, "edit": false, "delete": false },
    "C2": { "visible": true,  "switch": true,  "create": true,  "edit": true,  "delete": false },
    "C3": { "visible": true,  "switch": true,  "create": false, "edit": false, "delete": true  },
    "C4": { "visible": true,  "switch": true,  "create": true,  "edit": true,  "delete": true  }
  },
  "profiles": [
    { "id": "MTX-02", "profile": "QA_WL_P_View",  "user": "wl_p_view",  "project": "C1", "global": "C0" },
    { "id": "MTX-03", "profile": "QA_WL_P_Manage","user": "wl_p_manage","project": "C2", "global": "C0" },
    { "id": "MTX-10", "profile": "QA_WL_PFull_GView", "user": "wl_pfull_gview", "project": "C4", "global": "C1" }
  ]
}
```

### 5.6 Sample: API matrix test
```ts
// tests/api/matrix.api.spec.ts
import { test, expect } from '../../fixtures/auth';
import matrix from '../../data/permission-matrix.json';

const scopes = ['project', 'global'] as const;

for (const row of matrix.profiles) {
  for (const scope of scopes) {
    const exp = matrix.combos[row[scope] as keyof typeof matrix.combos];

    test.describe(`${row.id} ${row.profile} [${scope}]`, () => {
      test(`create view -> ${exp.create ? 'allowed' : 'blocked'} @${row.id}`, async ({ apiAs, adminApi }) => {
        const api = await apiAs(row.user);
        const before = await adminApi.listViews(scope);
        const name = `AUTO-${row.id}-${scope}-${Date.now()}`;

        const res = await api.createView(scope, { name, filters: { users: 'all' } });

        if (exp.create) {
          expect(res.status()).toBeLessThan(300);
          const after = await adminApi.listViews(scope);
          expect(after.map(v => v.name)).toContain(name);
        } else {
          expect([401, 403]).toContain(res.status());
          const after = await adminApi.listViews(scope);
          expect(after.length).toBe(before.length);               // no side effect
          expect(after.map(v => v.name)).not.toContain(name);
        }
      });

      test(`delete view -> ${exp.delete ? 'allowed' : 'blocked'} @${row.id}`, async ({ apiAs, adminApi }) => {
        const target = await adminApi.createView(scope, { name: `AUTO-DEL-${row.id}-${Date.now()}`, shared: true });
        const viewId = (await target.json()).id;
        const api = await apiAs(row.user);

        const res = await api.deleteView(scope, viewId);

        const stillThere = (await adminApi.listViews(scope)).some(v => v.id === viewId);
        if (exp.delete) {
          expect(res.status()).toBeLessThan(300);
          expect(stillThere).toBe(false);
        } else {
          expect([401, 403, 404]).toContain(res.status());
          expect(stillThere).toBe(true);
          await adminApi.deleteView(scope, viewId);               // cleanup
        }
      });

      test(`list views -> ${exp.switch ? 'allowed' : 'blocked'} @${row.id}`, async ({ apiAs }) => {
        const res = await (await apiAs(row.user)).listViewsRaw(scope);
        exp.switch ? expect(res.ok()).toBeTruthy()
                   : expect([401, 403]).toContain(res.status());
      });
    });
  }
}
```

### 5.7 Sample: UI matrix test with a page object
```ts
// pages/WorkloadReportPage.ts
import { Page, Locator, expect } from '@playwright/test';

export class WorkloadReportPage {
  readonly viewDropdown: Locator;
  readonly createViewBtn: Locator;
  constructor(private page: Page) {
    // Prefer stable data-* / aria attributes; confirm selectors against the live DOM.
    this.viewDropdown  = page.getByRole('combobox', { name: /view/i });
    this.createViewBtn = page.getByRole('button', { name: /(new|create) view|save as/i });
  }
  async open(scope: 'project' | 'global', projectId?: string) {
    const url = scope === 'project'
      ? `/portal/${process.env.PORTAL}#workloadreport/${projectId}`   // placeholder route
      : `/portal/${process.env.PORTAL}#reports/workload`;              // placeholder route
    await this.page.goto(url);
  }
  viewActions(name: string) {
    return this.page.getByRole('option', { name }).getByRole('button', { name: /more|actions/i });
  }
  deleteOption() {
    return this.page.getByRole('menuitem', { name: /delete/i });
  }
}
```

```ts
// tests/ui/matrix.ui.spec.ts
import { test, expect } from '../../fixtures/auth';
import { WorkloadReportPage } from '../../pages/WorkloadReportPage';
import matrix from '../../data/permission-matrix.json';

for (const row of matrix.profiles) {
  for (const scope of ['project', 'global'] as const) {
    const exp = matrix.combos[row[scope] as keyof typeof matrix.combos];

    test(`${row.id} ${row.profile} [${scope}] UI controls @${row.id}`, async ({ pageAs }) => {
      const page = await pageAs(row.user);                 // uses that user's storageState
      const wl = new WorkloadReportPage(page);
      await wl.open(scope, process.env.P_ALPHA_ID);

      if (!exp.visible) {
        await expect(page.getByText(/access denied|no permission/i)).toBeVisible();
        return;
      }
      await expect(wl.viewDropdown).toBeVisible();

      // Create control
      exp.create ? await expect(wl.createViewBtn).toBeEnabled()
                 : await expect(wl.createViewBtn).toHaveCount(0);

      // Delete control on a seeded shared view
      await wl.viewDropdown.click();
      await wl.viewActions(scope === 'project' ? 'QA-Shared-Alpha' : 'QA-Shared-Global').click();
      exp.delete ? await expect(wl.deleteOption()).toBeVisible()
                 : await expect(wl.deleteOption()).toHaveCount(0);
    });
  }
}
```
The `toHaveCount(0)` checks above assume a forbidden control is removed from the DOM. If the product disables it instead, use `toBeDisabled()`. Capture the real behaviour in the page object so the tests stay readable.

### 5.8 Sample: propagation test (serial)
```ts
// tests/api/propagation.api.spec.ts
test.describe.configure({ mode: 'serial' });

test('CHG-002 revoke Manage blocks next create @CHG-002', async ({ apiAs, adminApi }) => {
  const api = await apiAs('wl_chg_user');                        // dedicated user, profile QA_WL_CHG
  await adminApi.setProfileWorkload('QA_WL_CHG', 'project', { view: true, manage: true, delete: false });
  expect((await api.createView('project', { name: `AUTO-CHG-a-${Date.now()}` })).ok()).toBeTruthy();

  await adminApi.setProfileWorkload('QA_WL_CHG', 'project', { view: true, manage: false, delete: false });
  const res = await api.createView('project', { name: `AUTO-CHG-b-${Date.now()}` });
  expect([401, 403]).toContain(res.status());                    // must not rely on cached permissions
});
```
`setProfileWorkload` calls the profile-update API. If there's no such API, it drives `ProfileEditorPage` as admin.

### 5.9 Profile editor UI automation (PRF-*)
- `ProfileEditorPage` exposes `checkbox(scope, perm)` locators for the 6 checkboxes, plus `save()` and `reload()`.
- PRF-003 is a parameterized test over C0-C4 for each scope: set, save, reload, assert.
- PRF-004..006 check the dependency rule (A1) in both directions. A small table of `(action, expectedStateAfter)` drives the assertions.
- PRF-008: snapshot all 6 checkbox states before and after changing one scope. Only that scope's 3 values may differ.

### 5.10 Manual-only cases
These are not worth automating, or need human judgement:
- PRF-013 (audit log contents).
- CLI-002 (mobile apps), unless a mobile automation suite already exists.
- CLI-003 (localization visual checks).
- SEC-001 (DevTools manipulation). SEC-002 already covers the server-side part.
- DEL-011 (two concurrent sessions). It can be automated with two browser contexts, but it's lower priority.

---

## 6. Entry / Exit Criteria
**Entry**
- Feature is deployed to the QA portal. Assumptions A1-A8 are confirmed or answered.
- Test profiles, users and seed data are created (`global-setup` passes).
- Endpoints are captured into `config/endpoints.json`.

**Exit**
- 100% of P1 cases are executed and passing. No open Critical/High defects.
- The API matrix (MTX x actions x scopes) passes in full.
- No case where a 403 still applied the change (any such case is automatically Critical).
- Every P2 failure has a ticket with an agreed fix version.

## 7. Defect Severity Guide
| Severity | Example |
|---|---|
| Critical | The API lets a View-only user create or delete a view (UI-hidden but server-allowed). A cross-project/global data leak. A 403 that still applied the change. |
| High | The UI shows a working create/delete control to a user without permission. A checked permission doesn't work (Manage user can't create). |
| Medium | Profile checkbox dependencies are inconsistent. Permission change needs a re-login when the spec says a refresh is enough. |
| Low | Label/tooltip text, or a disabled-vs-hidden inconsistency between scopes. |

## 8. Traceability
| Requirement | Test cases |
|---|---|
| R1: View/Manage/Delete checkboxes exist under Project Reports > Workload Report | PRF-001, PRF-003..007 |
| R2: Same checkboxes exist under Global Reports > Workload Report | PRF-001, PRF-003..008 |
| R3: View can't create a workload view | MNG-001..004, MNG-009, MTX-02/06, SEC-001/002 |
| R4: View can't delete a workload view | DEL-001..003, MTX-02/06, SEC-001/002 |
| R5: Manage allows create | MNG-005..008, MNG-012, MTX-03/07, CHG-001/002 |
| R6: Delete allows delete | DEL-004..012, MTX-04/08, CHG-003 |
| R7: Project and Global scopes are independent | PRF-008, ISO-001..008, MTX-10..13 |
| R8: Permissions enforced server-side | All `*.api.spec.ts`, SEC-* |

## 9. Open Questions for PM / Dev
1. Does Manage include edit/rename, or only create (A2)?
2. When a forbidden control is shown, is it hidden or disabled? Is that the same in both scopes?
3. Can a view's creator always delete their own view, even without Delete (A7)?
4. What sharing model applies to workload views (private / shared / per-project), and how does Delete apply to views shared by others (A8)?
5. Do permission changes take effect immediately, or only after re-login or a cache expiry? If cached, what's the TTL?
6. Is there a public or internal API for workload views and for profile updates that QA can use for setup and enforcement tests?
7. What are the migration defaults for existing profiles (REG-002)?
8. Is the workload report available in the mobile apps, and do those apps use the same permission checks?
