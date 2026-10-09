# Zoho Projects — Workload Report QA suite (Playwright)

Portal-agnostic regression suite for the **Workload Report** (Global and Project level): views, favourites, refresh,
every edit combination and edge case, the View / Manage / Delete permission matrix, real allocated data end to end,
and regressions for every defect found on 8 Oct 2026. Nothing portal-specific is hardcoded — portal ID, view IDs,
profile IDs, user counts, option lists, dates and business hours are discovered at runtime from the app's own requests.

## Quick start

```bash
npm install --include=dev       # --include=dev: NODE_ENV=production would otherwise skip every dependency
cp .env.example .env            # set ZP_BASE_URL and ZP_PORTAL
npm run auth                    # headed browser: sign in as Admin; session saved to auth/admin.json
npm run auth:db                 # or: sign in automatically with the credentials DB (same table/env as the Java suite)
ZP_AUTH_TARGETS=cp npm run auth # one sign-in for the profile under test (e.g. a CP user) → auth/wl.cp.json
npm run test:unit               # offline: date oracle + data fixture (no portal needed)
npm test                        # unit + workload + permissions
npm run test:levels             # permission levels switched by API (needs ZP_ALLOW_PROFILE_CHANGES=1)
npm run test:data               # real-data run: creates a project, imports 111 tasks, compares, trashes it
npm run test:defects            # only the @defect regressions
npm run report                  # HTML report (also JSON + JUnit in reports/)
```

`npm run auth` waits for a person to sign in. `npm run auth:db` reads the account from the credentials DB
(`DB_URL`/`DB_USER`/`DB_PASSWORD`, table `portalcredslocal` for localzoho, else `portalcredsidc`; pick the role with
`ZP_DB_ROLE_<TARGET>` when it is not obvious) and types it into the accounts page; that project runs with trace, video
and screenshots off and never logs the password. Either way only the session (storage state) is saved.
`auth/` and `.env` are git-ignored.

## What runs (154 tests in 13 files)

| File | Cases | Mutates the portal? |
| --- | --- | --- |
| `tests/unit/dates.spec.ts` (33) | Date oracle: every relative option, N-day lengths, week overlap, business-hours totals, UI date order (DD-MM vs MM-DD) | No |
| `tests/unit/calendar-and-data.spec.ts` (15) | Monday week start · holidays from meta · data fixture: 111 tasks, 525 owner-day checks, monthly totals, every state per user per month | No |
| `tests/workload/views-favourite-refresh.spec.ts` (3) | WL-G-01 All Users loads every user · WL-G-02/03 favourite add/remove · WL-G-04 refresh | Favourite only (restored) |
| `tests/workload/edit-combinations.spec.ts` (12) | Description + 3 view types · every Relative option per unit · Custom per unit · view style × view type · every data label × view type · Show Options · totals honour holidays | Yes — snapshotted and restored |
| `tests/workload/edit-edge.spec.ts` (12) | E-01 Cancel discards · E-02 255-char description · WL-D-07 picker reopens · D-08 emoji · D-09 toolbar arrows + Discard · D-10 Weeks custom range · D-11 6-month limit · D-12 double-click Save · E-03 Save as › Existing · E-04 Save as › New · E-05 network failure on save · E-06 keyboard | Yes — restored; Save-as-New view deleted |
| `tests/workload/api-create-ui-edit.spec.ts` (1) | API-01 view created by OAuth API → description edited in the UI → read back and deleted by API | Yes — view deleted by API |
| `tests/workload/edit-scope.spec.ts` (1) | SCOPE-01 does an Admin edit change the view for other users? (`check spec` until `ZP_EDIT_SCOPE` is set) | Yes — restored |
| `tests/workload/defects.spec.ts` (5) | WL-D-02 · D-03 · D-04 · D-05 · D-06 (`@defect`) | Yes — restored |
| `tests/permissions/workload-permissions.spec.ts` (37) | Matrix with one saved login per profile: open, Create option, seed-view menu, API flags, API edit/create replaying the app's own save body | API create for Manage/Full (deleted via API) |
| `tests/permissions/permission-levels.spec.ts` (30) | ONE profile, levels switched by API while Admin and user stay signed in: View · View+Manage · View+Delete · Full · None × Global and Project; create link, Save as › New, ••• menus on own and Admin views, API create/edit/delete, view flags; D-13/14/15 | Yes — profile snapshotted and restored, QA views deleted |
| `tests/data/workload-data.spec.ts` (3) | Project via API → users via API → resource → Import wizard → DATA-01 every task field · DATA-02 every owner-day (hours + label) · DATA-03 monthly totals and no unplanned allocation → project trashed | Yes — project trashed (reversible) |

Every range check uses four layers: header text (`topbar_calendar`), grid column dates (column tooltips),
API `from_date`/`to_date` of the data request, and the reopened edit form.

## Test data through the API (OAuth)

Edit and delete cases create their data with the API, act in the UI, and delete with the API:

```ts
test.beforeAll(async ({ adminApi }) => { id = await adminApi.createView(name, { description: 'created by API' }); });
test.afterAll(async ({ adminApi }) => { await adminApi.deleteView(id); });          // runs even when the test fails
test('edit in UI', async ({ wl, edit, adminApi }) => { await wl.selectView(name, 'My Custom Views'); … });
```

`adminApi` (`src/oauth.ts`) is an OAuth client for the Admin DB account — the port of the Java `ApiTokenGenerator` + `Api`:
client id/secret and refresh token come from the same credentials-DB row as `npm run auth:db`; the access token is cached
in `auth/oauth.<target>.json` (git-ignored, mode 600) and refreshed on 401; calls are paced and retried like `ZpApi`.
`OAuthApi.create('<target>')` gives the same for another DB role. Permission checks keep using `ZpApi`, which acts with the
signed-in user's own session. Example: `tests/workload/api-create-ui-edit.spec.ts` (API-01).

## Configuration

| Variable | Meaning |
| --- | --- |
| `ZP_BASE_URL`, `ZP_PORTAL` | Environment and portal URL name |
| `ZP_ADMIN_STATE`, `ZP_USER_STATES` | Saved sessions (Admin; JSON map of profile key → file for the matrix spec) |
| `ZP_PERM_PROFILE`, `ZP_PERM_USER_STATE` | Profile name and saved login for `permission-levels` (e.g. `CP`, `auth/wl.cp.json`) |
| `ZP_PERM_PROJECT_ID` | Project for project-level checks (default: first project the user can open) |
| `ZP_ALLOW_PROFILE_CHANGES` | `1` allows profile permission changes (Setup checkboxes or API); off by default |
| `ZP_SCOPE_USER_STATE`, `ZP_EDIT_SCOPE` | Second user for SCOPE-01; expected scope `portal` or `user` once the spec decides |
| `ZP_RUN_DATA_SPEC`, `ZP_KEEP_DATA_PROJECT` | `1` runs the data spec; `1` keeps its project instead of trashing it |
| `ZP_EDIT_VIEW` | View to edit (default the view open on load, normally All Users) |
| `ZP_WEEK_START` | 0 = Sunday (reference portal), 1 = Monday |
| `ZP_DATE_ORDER` | Date order the UI shows: `dmy` (customworkload) or `mdy`; empty = detected from the report header |
| `ZP_EXPECT_KNOWN_DEFECTS` | `1` turns open-defect tests into expected failures so CI stays green until fixed |
| `ZP_SEED_VIEW_PREFIX` | Name prefix of the Admin-shared seed view used by the matrix spec (default `QA-WL-SEED`) |
| `RUN_ID` | Prefix for created records (default `QA-WL-<timestamp>`) |

## Endpoints used (confirmed live 8 Oct 2026)

Public docs: `GET/POST /projects`, `GET /projects/{id}`, `POST /projects/{id}/trash`, `GET /projects/{id}/tasks`,
`GET /users`, `GET /users/me`, `GET /profiles`, `GET /reports/workload[/meta]`, `PUT /reports/custom-workload`, `GET /user-views`.
Internal (what the web app calls; not in the public docs):

| Call | Notes |
| --- | --- |
| `PATCH /profiles/{id}/globalreport/permissions/grant` · `/revoke` (and `projectreport`) | Body is a JSON **array**: `[{"module":"workloadreport","actions":["view"]}]` (`projectworkloadreport` for project). 204 |
| `GET /profiles/{globalreport,projectreport}/permissions?profile_ids=…` | Readback `{ "<id>": [{module, actions}] }` |
| `DELETE /views/{id}?module=workload` | Deletes a custom workload view. 204; 401 when not allowed |
| `POST /projects/{id}/projectusers` | Must be **form-encoded** (`userdetails` JSON string, `notify=false`); a JSON body is rejected |
| `POST /projects/{id}/resources` | Used by the UI's Add Resource (body not captured — the suite adds resources through the UI) |

All API calls replay the headers of the app's own last request, so they run with exactly the signed-in user's rights.

## Known limits — confirm in your first live run

- If a mutating run is killed, `reports/perm-snapshot-<profile>.json` (profile permissions) and `reports/view-snapshot.json`
  (edited view settings) hold the state to put back; both are deleted after a successful, read-back restore.

- Every spec type-checks and the unit projects pass; the browser specs need your saved logins to run.
  Text locators (no `data-zpqa`) are used for: Share / Other-projects labels in the create form, Resources and
  Add Resource in project Users, and the import date-format box. Everything else uses `data-zpqa` keys read live.
- A cold deep link to `#zp/projects/<id>/tasks` lands on the Projects list — `ProjectPage.open()` uses the row's `open_detail` icon.
  `#zp/reports` can do the same; `openReports()` then clicks Reports in the left menu.
- The mobile-apps promo `#zpsHandheldsPromo` blocks every click; a locator handler closes it whenever it appears.
- The toolbar icons (favourite, `refresh_status`, `more_actions`) are hidden until the toolbar is hovered; use `toolbarIcon()`.
- The portal blocks an API for ~30 min after ~100 calls in 2 min: `ZpApi.call` paces to 80 per API per 2 min
  (`ZP_API_RATE_LIMIT`) and retries `THROTTLES_LIMIT_EXCEEDED` after 30 s.
- Predefined views are listed by i18n key (`zp.workload.customview.allusers`); `Discovery.view()` also accepts the label.
- **Date-picker navigation** (`setCustom`, D-11): the "next" arrow and the disabled-cell class are best guesses.
- `Days › Last/Next 3 Months` roll from today; reported as `check-spec` until product confirms the rule.
- The data fixture is fixed to Q4 2026 and to 9 h Mon–Fri business hours; regenerate it for another quarter.

## Defects covered

| ID | Summary | Spec |
| --- | --- | --- |
| WL-D-01 | Favorite Views group stale after removing a favourite | views-favourite-refresh |
| WL-D-02 | Days-unit relative ranges one day too long | defects |
| WL-D-03 | Weeks unit buckets overrun the range end; header total ≠ user total | defects |
| WL-D-04 | Percentage summary shows an unexplained value | defects |
| WL-D-05 | Header summary stays in hours for Minutes / Man Weeks | defects |
| WL-D-06 | Month picker end panel shows the start year (cosmetic) | defects |
| WL-D-07 | Picker can't reopen after OK/Cancel | edit-edge |
| WL-D-08 | Emoji in the description saved as "?" | edit-edge |
| WL-D-09 | Toolbar arrows step to the wrong period | edit-edge |
| WL-D-10 | Weeks picker: end week must be picked on the right calendar (improvement) | edit-edge |
| WL-D-11 | Picker enables dates beyond 6 months, then OK rejects | edit-edge |
| WL-D-12 | Double-click Save sends 2 PUTs | edit-edge |
| WL-D-13 | Edit offered on own view without Manage (→ Permission Denied page) | permission-levels |
| WL-D-14 | Delete offered on another user's shared view; server refuses (401) | permission-levels |
| WL-D-15 | `is_editable`/`is_deletable` on own views ignore the profile | permission-levels |
| WL-D-16 | Import caps Work %/day at 100 without warning | data |
| WL-D-17 | Weekend-only task allocated on Sat/Sun | data |
| WL-D-18 | Cancelled tasks stored as 100 % complete (confirm intent) | data |
| WL-D-19 | Associated Team and Tags do not import | data (UI-confirmed) |
| WL-D-20 | Import creates a duplicate task list instead of reusing one with the same name | — (manual) |
