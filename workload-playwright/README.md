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

## What runs (377 tests in 32 files)

| File | Cases | Mutates the portal? |
| --- | --- | --- |
| `tests/unit/dates.spec.ts` (33) | Date oracle: every relative option, N-day lengths, week overlap, business-hours totals, UI date order (DD-MM vs MM-DD) | No |
| `tests/unit/calendar-and-data.spec.ts` (15) | Monday week start · holidays from meta · data fixture: 111 tasks, 525 owner-day checks, monthly totals, every state per user per month | No |
| `tests/workload/views-favourite-refresh.spec.ts` (3) | WL-G-01 All Users loads every user · WL-G-02/03 favourite add/remove · WL-G-04 refresh | Favourite only (restored) |
| `tests/workload/default-views.spec.ts` (11) | DV every predefined view against an independent oracle — All Users (all owners + Unassigned) · Associated Teams (rows = `/teams`) · My Team Members (members of the teams the signed-in user **leads**: `/teams` lead + `/users/{id}/teams`) · My Direct Reports / My Subordinates (`reporting_to`, direct and transitive) · Users by Profile / Role (each user under its profile / role group) · Unallocated / Under / Optimally / Over-Allocated (`overall_allocation` from All Users, incl. Unassigned). Per view: loads with its name and no unsaved marker · UI rows = API owners = rule · work unchanged vs All Users · "No data found" when empty · Status All Open on top re-queries the same view and narrows it, Clear filter returns to the view's rows · PDF export (view by, range, rows in order, totals = UI) | Toolbar only — cleared and discarded |
| `tests/workload/default-views-edge.spec.ts` (8) | DVE edge cases of the default views — 01 Week and Month ranges from the toolbar picker on Over/Under-Allocated (rule recomputed for the range) · 02 non-empty Unallocated and Optimally-Allocated (QA project, one task for the Admin in March 2027, trashed after) · 03 toolbar Group By on Users by Profile (Roles = Users by Role; Reporting Manager; None) · 04 Save as › New from My Direct Reports (WL-D-28) · 05 favourite, set as default and refresh on all 11 views · 06 all 11 views on the project-level report · 07 team membership vs team lead (`ZP_ALLOW_DATA_CHANGES=1`) · 08 signed in as CP with View: own team, empty reports (WL-D-29), then plemployee reports to CP (`ZP_ALLOW_PROFILE_CHANGES=1` + `ZP_ALLOW_DATA_CHANGES=1`) | Yes — default view, favourites, team lead/membership, reporting line and CP permissions snapshotted to `reports/dve-snapshot.json` and restored with read-back; QA project trashed; QA views deleted |
| `tests/workload/default-views-actions.spec.ts` (11) | DVA ••• actions on every predefined view — **Copy link** (toast, clipboard holds `#zp/reports/workload/custom-view/<id>/details`, the link opened in a new page shows the same view and rows) · **Edit** (form = saved definition: locked name, description, view type, unit; Cancel sends no PUT) · **Edit › Save** a description (one PUT 200, rule, report preference, grouping, name and rows unchanged) then restore · **Clone** (create form "<view> (1)", saved clone's view type, legend and grouping match the source; rule and rows compared, WL-D-30) | Yes — description snapshotted to `reports/dva-snapshot.json` with the app's own save body, restored by replaying that PUT (UI fallback) and read back; clones deleted |
| `tests/workload/create-view.spec.ts` (71) | CV **Create Workload Report**, every option: 00 defaults (name only) · PW-01…56 pairwise over view type × unit × expanded-view style × data label × reports-for × grouping × order × share × other projects (every pair of values in some case; Man Weeks needs Weeks/Months, Timeline groups by None only) · TP every Relative option per unit + a Custom range · SP share none/all/specific user × projects none/all/specific project, with the project-level reports of the chosen and another project checked in the UI. Each case: request body, stored definition, listed, the view the app opens (name, URL, period, type, data label), its data (UI rows = API owners; work = All Users for the period), Edit reopened | Yes — every created view deleted (`QA-WL-<run>-CV-*`) |
| `tests/workload/create-view-criteria.spec.ts` (47) | CVC every criteria field × every condition the form offers (read live), one created view per condition — the first condition of each value-control kind through the form, the others through the API with the form's own body (`ZP_CREATE_UI_ALL=1` drives the form for all); one test per standard field and per custom-field position: User/Resource and Role = exact owner sets, Allocation Type Is = the matching predefined view, task-level fields never add work, paired conditions (Is/Is Not, Contains/Doesn't Contain, Less Than/≥, Greater Than/≤) split All Users work; all custom fields; CVC-M All of these / Any of these with 2 and 3 criteria, removed row, Clear All | Yes — every created view deleted |
| `tests/workload/create-view-edge.spec.ts` (21) | CVE 01 Cancel · 02/03 empty and blank name · 04 duplicate names · 05 100-character limit · 06 HTML/emoji/non-Latin (WL-D-08) · 07 description 255/256 · 08 surrounding spaces (WL-D-33) · 09 double-click Save · 10 criterion without a value · 11 Specific Users/Projects with none picked · 12 custom range > 6 months · 13 network failure · 14 keyboard only (WL-D-37) · 15 reload / Back / Copy link · 16 criterion matching no task · 17 create from a project-level report · 18 maximum criteria rows (15) · 19 view deleted while open elsewhere (WL-D-32) · 20 Multi Select › Is Empty view loads (WL-D-36) | Yes — every created view deleted |
| `tests/workload/create-view-share.spec.ts` (12) | CVS Share / Show in other Projects verified **as the other user** (CP signed in in a second context, Workload *view* granted for the run and restored with a read-back; `ZP_ALLOW_PROFILE_CHANGES=1`): 01 not shared → unseen · 02 All Users → under Shared Views, opens · 03 this specific user → seen, opens · 04 another specific user → unseen · 05 two users · 08a/b/c user × project they belong to / don't / all projects (globally and inside the project) · 09 edit after create user → nobody → all users; Admin-only: 06 Specific Users picker (no duplicate, owner not offered, removed chip not saved) · 07 two specific projects listed in both reports and no other · 10 Specific Projects picker offers every active project, no trashed one | Yes — every created view deleted; the profile restored |
| `tests/workload/grid-interactions.spec.ts` (7) | GI the grid: 01 expand a user → exactly its "(n)" tasks, each with a bar and name tooltip, collapse · 02 Expand All / Collapse All = sum of the counts, chevrons follow · 03 task-bar hover "N hours allocated for this day", empty cell hover "Add Task" · 04 task name → detail panel on `…/task-detail/<id>` with name and key, close returns to the view with the grid intact · 05 user search box (substring, case-insensitive, clear, no match) · 06 Today line in today's column, none in a period without today (WL-D-39 candidate when drawn) · 07 narrow window: `.resourceutilTableholder` scrolls the day columns, the user column stays pinned | No |
| `tests/workload/rail-toolbar.spec.ts` (8) | RT rail + toolbar switches: 01 Full Screen (`ganttmax`, tooltip toggles) · 02 Legends bands (= 0 %, < 100 %, = 100 %, > 100 %) and close · 03 Show Options per type (Gantt/Timeline style; Title / Project Name on Timeline) · 04 chart type Bar/Timeline/Heatmap from the toolbar: grid re-renders, "*" unsaved marker, Save as, Discard restores · 05 every data label changes the unit in the cells, Discard restores · 06 Save as › Existing writes the change into the open custom view · 07 Save as › New opens the create form prefilled · 08 Export to PDF asks about a password (declined) | Yes — QA views deleted; toolbar state discarded |
| `tests/workload/view-menu.spec.ts` (4) | VM 01 ••• Delete as a UI flow: "Delete Workload Report?" dialog, Delete disabled until "I understand…" is ticked, Cancel keeps the view, confirm → DELETE 204, gone from list and dropdown, report moves off it · 02 no Delete on predefined views · 03 dropdown `search_input`: substring across groups, no-match state, clear, open a result · 04 Set as default view: reload opens it; the default moves by choosing another view (no "remove default" item: check-spec); the user's default restored | Yes — QA views deleted; default view restored |
| `tests/workload/project-level.spec.ts` (6) | PL Project › Reports › Workload: 01 every global toolbar/rail control present, URL under the project, ••• without Delete on predefined · 02 predefined views + Create listed; a global-only view absent, an all-projects view present · 03 Edit a view from the project report saves and reads back · 04 toolbar change → "*", Save as (New + Discard on predefined), Save as › New creates a view shown in the project · 05 Discard restores chart type and label · 06 each user's expanded tasks belong to the project, task detail stays under the project URL | Yes — QA views deleted |
| `tests/workload/portal-settings.spec.ts` (3) | PS portal capacity settings, effective today (`ZP_ALLOW_SETTINGS_CHANGES=1`): 01 shorter Monday (09–13) → each user's `total_availability` for the month drops by 5 h × Mondays, meta shows 240 · 02 a holiday list with one working day (associated to the hours) → minus that day, column marked, meta lists it · 03 Friday removed from the working days → Fridays render as weekends, availability drops; the hours are restored with the live id and read back, the work compared (drift = WL-D-41), `reports/<portal>/business-hours-snapshot.json` survives a killed run (`npm run restore:hours`) | Yes — business hours restored, holiday list deleted; the Admin's task work may shift (WL-D-41) |
| `tests/workload/portal-timezone.spec.ts` (2) | TZ the **portal time zone** (Setup › Portal Configuration › Configuration › Portal Settings, replayed with the captured `updatecompanyprofile.do` call; `ZP_ALLOW_SETTINGS_CHANGES=1`): switched to UTC+14 and UTC−11 — 01 Today column/line and the "This Month" range follow the zone's calendar date, the request's from/to match · 02 task bars keep their calendar dates (bar offsets by task identical) and the API work for the same dates is unchanged; restored and read back | Yes — zone restored |
| `tests/workload/user-deactivation.spec.ts` (1) | UD one seeded user (`ZP_DEACTIVATE_USER`, default Vishal plreadonly) deactivated with the Users page's own call (`POST /users/{id}/deactivate`, `ZP_ALLOW_USER_CHANGES=1`): no row in All Users, not among the API owners, not offered in Specific Users, exactly one row/owner fewer; reactivated (`POST /users/{id}/activate`) with role and profile read back and everything restored | Yes — user reactivated |
| `tests/workload/performance.spec.ts` (3) | PF load/performance, nothing changed: 01 cold open → header → first row → full load (all pages) and warm reload, with the report's own request timings (meta, data pages) · 02 API latency min/median/p95 of `/reports/workload`, `/meta`, `/user-views` · 03 Expand All, data-label switch, Export to PDF; results in `reports/<portal>/perf.json` and the test annotations, soft budgets `ZP_PERF_*` | No |
| `tests/workload/grid-editing.spec.ts` (32) | GE editing from the grid, on a QA project created by API (tasks with `copy_task_duration:false`) and trashed after each test: 01–04 task hover card (`#taskhover`: completion, dates, status, owner, business hours, Duration = working days, Total Work Hours = hrs/day × days, Days = ÷ 9 h) in Heatmap / Bar / Timeline, title → task detail, pencil → editor · 05–10 work-hours editor (bar click / pencil): Standard hrs/day with % of day and total → `PATCH /tasks/{id}` and bar cells, 100 %/150 %/8 %, invalid values, Cancel sends nothing, Flexible per-day inputs (weekends blank) → per-day `work_values`, back to Standard, Copy the actual duration → `copy_task_duration` · 11–12 Add Task from a cell (`add-date-task`: owner and day prefilled, full-day work, Cancel, empty name) · 13 drag a bar onto another user → owner PATCH · 14–15 Assign User (adds a co-owner on an assigned task, sets the owner on an Unassigned one) · 16–17 global group header: Replace Task Owner (`.zpsPopUpDefault`), Assign Task New / Existing · 18 resize handle (+3 days: bar 12 → 15, `tasks/bulk-update {end_date}`, hrs/day kept; the drop snaps to the column under the pointer, so shrinking back can land a day off; the handle only reacts to dispatched DOM mouse events, not to the automation's trusted pointer) · 21 Existing Task tab of the group header (search never loads: WL-D-45) · 22 Flexible on a weekend date (accepted and stored, the bar shows it) and a 0:00 day (stored as no entry, no cell, total reduced) · 23 Duration is read-only (derived from the task dates), Total Hours follows Standard and Flexible edits, Cancel keeps everything · 24 sideways drag within the own row (does nothing: check-spec) · 25 owner change inside the editor (options: Unassigned + project users) · 26 two-owner task: one Standard row per owner, Flexible rows per owner, each saved separately · 27 resource row (seeded project): card, editor, the picker offers resources · 28 Unassigned row: availability card and Add Task create an unassigned task · 29 in-progress (40 %) and completed (100 %, Closed) cards · 30 the editor opens from the bar in Bar and Timeline · 31 Add Task › Add More (the first click right after typing is swallowed, a second submits: check-spec) · 32 the Business Hours name in the card looks like a link but is inert (check-spec) · 19 user-cell card (`Total Availability 100% 9h 00m 1d`, `Work Hours Assigned 50% 4h 30m 0.5d`, `Free time`, legend; empty / working / weekend / over-allocated days) · 20 avatar, name, count, summary (month totals) and header hovers. Calls seen: owner picker → `updateaction.do operation=owner`, Replace Task Owner → `bulkupdatetask.do ownerupdatetype=swap`, Add Task → `addcalendartask.do` | Yes — QA project trashed after each test |
| `tests/unit/pairwise.spec.ts` (2) | The pairwise generator covers every valid pair, never emits an invalid case, and is deterministic | No |
| `tests/workload/edit-combinations.spec.ts` (12) | Description + 3 view types · every Relative option per unit · Custom per unit · view style × view type · every data label × view type · Show Options · totals honour holidays | Yes — snapshotted and restored |
| `tests/workload/edit-edge.spec.ts` (12) | E-01 Cancel discards · E-02 255-char description · WL-D-07 picker reopens · D-08 emoji · D-09 toolbar arrows + Discard · D-10 Weeks custom range · D-11 6-month limit · D-12 double-click Save · E-03 Save as › Existing · E-04 Save as › New · E-05 network failure on save · E-06 keyboard | Yes — restored; Save-as-New view deleted |
| `tests/workload/api-create-ui-edit.spec.ts` (1) | API-01 view created by OAuth API → description edited in the UI → read back and deleted by API | Yes — view deleted by API |
| `tests/workload/filter-user-resource.spec.ts` (8) | FLT-UR-01…06 Filter › User/Resource, Is / Is Not × Users / Resources / both: request criterion, API owners by `is_resource`, per-owner work, UI rows by owner id, chips, unsaved marker, panel state, Clear filter · 07 Cancel · 08 no value (check spec) | Toolbar only — cleared and discarded; saved view checked unchanged |
| `tests/workload/filter-panel.spec.ts` (9) | FLT-PN panel mechanics: every section and its conditions discovered · Reset · section × · two sections at once (AND) · value-list and panel search · Cancel after changes · Find with no value · chip × and the Show More overflow · Save as › Discard · filtered pagination (skips on a one-page portal) | Toolbar only — cleared and discarded |
| `tests/workload/filter-workload.spec.ts` (5) | FLT-WL Allocation Type: Is × 4 classes + all (oracle `overall_allocation`) · Hours and Percentage × Equal / < / > / ≤ / ≥ / Between (oracle `total_work`, `total_availability`) · Role Is / Is Not × every role (oracle `/users` role) · no-value and section × | Toolbar only — cleared and discarded; saved view checked unchanged |
| `tests/workload/filter-projects.spec.ts` (3) | FLT-PR Project · Project Group · Project Status: Is / Is Not × first, two, all values; work(Is) + work(Is Not) = unfiltered per owner | Toolbar only — cleared and discarded; saved view checked unchanged |
| `tests/workload/filter-task.spec.ts` (10) | FLT-TK Task Name (6 text conditions, sample from a live task) · Status (Is / Is Not / All Open / All Closed) · Completion % (6 numeric) · Owner (user, Unassigned, team, Direct Reports Of, Subordinates Of) · Created By · Priority (each + all) · Associated Team · Task List · Tags · Billing Type; partitions | Toolbar only — cleared and discarded; saved view checked unchanged |
| `tests/workload/filter-custom-fields.spec.ts` (11) | FLT-CF every task custom field discovered from the panel, by value type: pick lists (Is / Is Not / all / Is Empty), user lists (+ team tab), text (7 conditions), numbers (7), dates (every relative option, Range tab, Date tab calendar) | Toolbar only — cleared and discarded; saved view checked unchanged |
| `tests/workload/filter-saved-views.spec.ts` (3) | FLT-SV end to end: Save as › New keeps the filter (API determiner, reopened chips, rows) · API-created filtered view opens filtered, Save as › Existing adds a filter, Clear on a saved filter (check spec) · shared filtered view seen by a second user | Yes — views created with the run id, deleted by API |
| `tests/workload/filter-combinations.spec.ts` (3) | FLT-CB three and four sections ("1 AND 2 AND 3…"), result ⊆ each single filter, section × renumbers, Is Not inside AND, Reset clears all, condition switch replaces | Toolbar only — cleared and discarded |
| `tests/workload/filter-toolbar.spec.ts` (8) | FLT-TI filter + period arrows · refresh · Group By · chart type · data label · full screen · switching view (check spec) · reload | Toolbar only — cleared and discarded |
| `tests/workload/filter-edge-values.spec.ts` (7) | FLT-EV numbers (0, negative, decimal, huge, letters, empty, spaces, inverted / half-empty Between, exponent, >100 %), text (special characters, 255 / 1000 chars, spaces, case, unicode), dates (inverted Not Between, previous year, two years ahead), WL-D-22 ×3, stale ticks after Clear | Toolbar only — cleared and discarded |
| `tests/workload/filter-oracles.spec.ts` (2) | FLT-OR task-level filters against `/projects/{id}/tasks`: shown owners with work own a matching task (Status, Priority, Task List, Tags, Billing, Project, All Open/Closed, Completion, Task Name, Owner) | Toolbar only — cleared and discarded |
| `tests/workload/filter-project.spec.ts` (1) | FLT-PJ project-level report (`ZP_PERM_PROJECT_ID`): panel sections (no Projects group / User/Resource, Phase present), Allocation, Role, Status, Priority, Phase, Completion, two sections AND, Reset | Toolbar only — cleared and discarded |
| `tests/workload/filter-permissions.spec.ts` (3) | FLT-PM View only filters but cannot save (UI + API 403) · View+Manage saves a filtered view, delete refused · Admin's shared filtered view read-only for the user — needs `ZP_ALLOW_PROFILE_CHANGES=1` | Yes — profile snapshotted and restored, QA views deleted |
| `tests/workload/filter-export.spec.ts` (8) | FLT-EX Export to PDF with filters, validated from the downloaded file (`src/pdfExport.ts`, text via `pdf-parse`): file (%PDF-, name, pages, `application/pdf`) · header (portal, "view by" = data label, Project, Date = toolbar range, Exported On = now) · every applied section and value printed · rows in UI order · each row total = UI and = API in man days · every day value = API (cut values matched as prefixes). Cases: no filter · Users · Users + All Open · all 8 statuses (Show More overflow) · Allocated Hours label · project-level report · saved filtered view (WL-D-26) · password-protect Yes shows a password field and downloads nothing (no password typed) | Downloads PDFs to `reports/export/`; toolbar only — cleared and discarded |
| `tests/workload/edit-scope.spec.ts` (1) | SCOPE-01 does an Admin edit change the view for other users? (`check spec` until `ZP_EDIT_SCOPE` is set) | Yes — restored |
| `tests/workload/defects.spec.ts` (5) | WL-D-02 · D-03 · D-04 · D-05 · D-06 (`@defect`) | Yes — restored |
| `tests/permissions/workload-permissions.spec.ts` (37) | Matrix with one saved login per profile: open, Create option, seed-view menu, API flags, API edit/create replaying the app's own save body | API create for Manage/Full (deleted via API) |
| `tests/permissions/permission-levels.spec.ts` (30) | ONE profile, levels switched by API while Admin and user stay signed in: View · View+Manage · View+Delete · Full · None × Global and Project; create link, Save as › New, ••• menus on own and Admin views, API create/edit/delete, view flags; D-13/14/15 | Yes — profile snapshotted and restored, QA views deleted |
| `tests/data/workload-data.spec.ts` (3) | Project via API → users via API → resource → Import wizard → DATA-01 every task field · DATA-02 every owner-day (hours + label) · DATA-03 monthly totals and no unplanned allocation → project trashed | Yes — project trashed (reversible) |

Every range check uses four layers: header text (`topbar_calendar`), grid column dates (column tooltips),
API `from_date`/`to_date` of the data request, and the reopened edit form.

## Control Center (control-center/index.html)

A Test Automation Control Center for this suite, served on localhost by the runner:

```
npm run runner            # (or npm start) serves http://localhost:9323 and opens it; keep the terminal open
```

The page connects to the runner on load, lists the real suite (383 tests) and starts real Playwright runs with the
page's choices: environment (`ZP_BASE_URL`), portal (session, folders and seeded ids per `portals.json`, like
`scripts/parallel.mjs`), browser (Chrome / Edge through `ZP_BROWSER_CHANNEL`; Firefox / WebKit fall back to Chromium
with a note), **Show browser window** (`--headed`), workers, retries, timeout, trace, week start, known-defects and
profile-change switches. There is no demo mode: without the runner the page shows "Runner not connected".

Screens: Run Configuration (environment, portal, browser, show/hide browser window, viewport, run settings, known-bugs
switch; developer options under Settings), Test Explorer (project › file › test tree with plain-language names,
checkboxes, search, filter chips, per-row Run / last result / context menu), Live Run (progress ring, counters, ETA
from recorded durations, per-test queue, streaming step log with Action · Expected · Actual · layer), Bugs (one per
failed test, WL-D-nn series continues from the README table and ids are never reused; a repeat failure updates the bug (seen ×n,
history); when the test passes again the bug is **removed from the list** into a collapsed *Fixed* section (restorable), and a
later failure reopens it under the same id with status Reopened; a known-defect test that unexpectedly passes counts as fixed;
severity/kind/status, steps from `test.step()` titles or the recorded browser actions, Expected vs Actual, the real
screenshot and video from `test-results/`, Markdown / ZIP export) and Reports (run history, diff between two runs,
KPIs and charts, HTML / JSON / JUnit / ZIP exports). Pinned CDNs only: Lucide icons, Chart.js, GSAP, canvas-confetti,
JSZip. **Imported results** (Settings: drop `reports/results.json`, `junit.xml` or a `test-results/` folder) show an
earlier run in the same screens; "Back to live" returns to the runner.

How the runner works: `scripts/runner-server.mjs` (dev dependency `ws`, `PORT` to change 9323, `NO_OPEN=1` not to open
the browser) spawns one Playwright process per run with `--reporter=./scripts/stream-reporter.js,json` (the reporter
prints one JSON line per step/result), relays `progress · step · result · log · end` over the WebSocket, serves videos,
screenshots and traces from `test-results/` and `reports/` on `/file?p=…` (other paths are refused) and writes
`reports/<portal>/runner-<runId>.json` (Playwright JSON) and `.log` (raw output) per run. Stop sends SIGTERM (SIGKILL
after 8 s); Pause/Resume suspend the process (SIGSTOP/SIGCONT). One run at a time per runner; the saved sessions in
`auth/` must exist (`npm run auth:portals`), the runner never signs in. Checked live on 15-10-2026: auto-connect →
383 tests, a unit test, and WL-G-01 with the browser window on (a Chromium window opened; video and screenshot shown
in the bug view).

Environments: all 88 development domains from `.vscode/environments.txt` are seeded (searchable dropdown, one badge colour each, portal `customworkload` by default) plus Staging / Production placeholders; a saved state gains new seeded domains on load, and the Environments dialog can add, edit or restore them.

Honest limits: the page cannot read `auth/*.json`, so saved-login chips are set by hand; Firefox/WebKit need a
project in `playwright.config.ts` (the CLI says so); Staging/Production URLs are placeholders to edit; videos and
screenshots are served by the runner, so they play only while `npm run runner` is up; settings, run history and bugs
live in the browser's localStorage.

## Portal settings (business hours, holidays, time zone, users)

`tests/workload/portal-settings.spec.ts` changes the portal's **default business hours** and adds a **holiday list**, then
restores both (`npm run test:settings`, needs `ZP_ALLOW_SETTINGS_CHANGES=1`). Facts learned live on 15-10-2026:
`PUT /business-hours` creates a new version and the server **clamps `effective_from` to today** (a future date is not
honoured), so the change applies immediately and task work is recomputed; the new version has a **new id**, and a PUT that
still carries the superseded id is refused with **403 BUSINESS_HOUR_STATUS_RESTRICTION** — read `GET /business-hours` for the
current id before every update (the spec does; its first version did not, which is why two restores failed). Each test
snapshots the hours to `reports/<portal>/business-hours-snapshot.json`, dumps every owner's day work for the month before,
and after the restore proves the hours are back and compares the work (a difference is recorded as WL-D-41, see Defects: the
product recomputes task work and does not undo it, so these tests do move the Admin owner's work by a day's capacity —
run them on a portal whose data may drift, or re-seed afterwards); the snapshot is removed once the hours match. If a run
is killed, restore first with `npm run restore:hours` (per portal: `ZP_PORTAL=<p> ZP_REPORTS_DIR=reports/<p> …`), which PUTs the
snapshot's `working_hours` effective today, retries through the 403 window, removes the snapshot once `GET /business-hours`
equals it and dumps the month's work to `reports/<portal>/work-oct-2026.json` for a twin comparison; QA holiday lists are named `QA-WL-<run>-PS-02` (`DELETE /holiday-list/{id}`).
Twin portals make drift visible: compare `GET /reports/workload` day work between customworkload and customworkload2.

Captured from the Setup / Users UI on 15-10-2026 (the user's rule: do it in the UI once with the network captured, then use the
API to change and revert) — see `src/portalSettings.ts`: **portal time zone** read `POST companyprofile.do todisp=profile&showPage=portalset`
(`TIMEZONE`), write `POST updatecompanyprofile.do` (form `companyname, timezone, business_hours_id, charset, webaddress…, <csrf>, toupdate=cprofile`
→ "PROFILE UPDATED"; `npm run portal:timezone`, `ZP_SET_TIMEZONE=…`); **users** `POST /users/{id}/deactivate` and `POST /users/{id}/activate`,
both with the form field `notify=true|false` (required); a deactivated user leaves `GET /users` but `GET /users/{id}` still answers
(`npm run user:activate`, `ZP_REACTIVATE_EMAIL` / `ZP_REACTIVATE_ID`). `npm run test:env` runs the three environment specs.

## Parallel runs across portals

The suite can run against several portals at once, one Playwright process per portal (`scripts/parallel.mjs`,
portals listed in `portals.json`). Each process has its own Admin session, report folder, output folder and API
budget, so the portals never share state. Same users must exist in every portal; the CP session is account-wide,
so `auth/wl.cp.json` works in all of them.

```bash
npm run auth:portals                          # DB sign-in for every portal's Admin (auth/<portal>/admin.json)
npm run seed                                  # copy the source portal's data into every other portal (idempotent)
npm run test:parallel -- tests/workload/filter-*.spec.ts   # queue: every test goes to whichever portal is free
npm run test:mirror -- tests/workload/default-views.spec.ts # run them on every portal
npm run test:parallel -- --portals=customworkload,customworkload2 --grep @defect
```

- **Queue (default, `test`):** every selected test goes into one queue, longest first (durations from
  `reports/test-durations.json`, kept by the runner; 2 min when unknown). Each portal takes the next test the moment it
  is free, so no portal waits while work is left and no case is tied to a portal. Each test runs as its own Playwright
  process (`tests/<file>:<line>` + its exact title); a test whose process dies without a result goes back into the queue
  once. Results are merged into `reports/parallel-results.json` (every test, its portal, status, known defects, errors)
  and `reports/parallel-summary.json` (counts, minutes per portal, failures). Tests must stay independent (each creates and
  deletes its own data) so they can run on any portal in any order.
- **Other modes:** `files` assigns whole spec files up front (older behaviour); `shard` runs `--shard=i/N` per portal;
  `mirror` runs everything on every portal.
- **Per-portal folders:** `reports/<portal>/` (HTML, JSON, JUnit, snapshots, exports), `test-results/<portal>/`,
  `auth/<portal>/` (session and OAuth token). The source portal keeps `reports/` and `auth/` as before.
- **Settings that are ids** (`ZP_PERM_PROJECT_ID`, `ZP_BUG_PROJECT_ID`) never leak from the source portal: the seed writes
  the target's own project id to `reports/<portal>/portal-settings.json`, which the runner merges in.
- **Add a portal:** add its DB row (Admin), add it to `portals.json`, invite the same users, then `npm run auth:portals`
  and `npm run seed`. A portal entry may restrict what it takes with `only` / `skip` (regexes on spec paths).

### Seeding a portal (`tests/tools/seed-portal.spec.ts`)

`npm run seed [portal…]` first saves the source portal's inventory (`tests/tools/portal-probe.spec.ts` →
`reports/inventory.json`), then copies it into each target and inventories the target. It matches by name, so a re-run
only adds what is missing and repairs tasks whose work differs.

| Copied | How |
| --- | --- |
| Tags, project groups | `POST /tags` (form `tags=[…]`), `POST /project-groups` |
| Projects (not "Bugs" or the sample project), with group and users | `POST /projects` `{project_group:{id}}`, form-encoded `/projectusers` |
| The resource | UI: Users › Resources › Add Resource with the project ticked; Add New Category when missing (no API exists) |
| Task lists, in order, duplicates kept | `POST /projects/{id}/tasklists` |
| Tasks: status, priority, billing, completion, dates and times, owners with work | `POST /projects/{id}/tasks`; `copy_task_duration` must be sent as in the source (the default `true` replaces every owner's work with the task duration); work on "Unassigned User" maps to the target's unassigned owner |
| Teams with lead and members | `POST /teams {name, lead, user_ids:{add}, project_ids:{add:[]}}` |
| Reporting hierarchy and reporting lines | `POST /hierarchy/settings?is_hierarchy_enable=true` when the source has it on, then `PATCH v3.1:/users/{id}` |

Users are matched by email; the source Portal Owner maps to the target Portal Owner. Not copied: custom-field values
(none are set in the source) and the 20 custom task fields themselves (create them once per portal; both portals have them).
Everything created is listed in `reports/<portal>/seed-manifest.json`. Check parity with
`python3 scripts/compare-portals.py reports/inventory.json reports/<portal>/inventory.json`: it compares every task
(fields, owners, work), project users, lists, groups, teams, reporting lines, tags and every owner's report total per
month from October 2026 to March 2027. On 13-10-2026 customworkload2 matched customworkload with 0 differences.

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
| `ZP_REPORTS_DIR`, `ZP_OUTPUT_DIR`, `ZP_AUTH_DIR` | Report, test-output and session folders (default `reports`, `test-results`, `auth`); the parallel runner sets one set per portal |
| `ZP_PORTALS` | Portals for `scripts/parallel.mjs` (default: every portal in `portals.json`; `--portals=a,b` overrides) |
| `ZP_SEED_SOURCE`, `ZP_SEED_SKIP_PROJECTS`, `ZP_SEED_RESOURCE_CATEGORY` | Seed: source inventory file, projects not copied (regex, default `^(Bugs\|Explore Zoho Projects)$`), category for a new resource |

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
- The portal allows about 200 API calls per 2 minutes in total. `src/rate.ts` holds every portal API request —
  the web app's own (via `context.route`) and the suite's direct calls — once the last 2 minutes reach
  `ZP_API_BUDGET` (default 190 since 15-10-2026; it was 150 — the user's cap is about 200), and each case starts only with room for ~60 calls. UI actions also have
  `ZP_SLOW_MO` (default 250 ms). Expect waits are 60 s and the test timeout 300 s to absorb held requests.
- Per API, the portal also blocks for ~30 min after ~100 calls in 2 min: `ZpApi.call` paces to 80 per API per 2 min
  (`ZP_API_RATE_LIMIT`) and retries `THROTTLES_LIMIT_EXCEEDED` after 30 s.
- Predefined views are listed by i18n key (`zp.workload.customview.allusers`); `Discovery.view()` also accepts the label.
- **Date-picker navigation** (`setCustom`, D-11): the "next" arrow and the disabled-cell class are best guesses.
- `Days › Last/Next 3 Months` roll from today; reported as `check-spec` until product confirms the rule.
- The data fixture is fixed to Q4 2026 and to 9 h Mon–Fri business hours; regenerate it for another quarter.
- **Local proxy in front of the portal** (seen 12-10-2026): the portal host resolved to a proxy on the machine that refused Node's
  TLS sockets ("tlsv13 alert certificate required" / `UND_ERR_SOCKET`) while Chromium and curl still connected. `ZpApi` then
  makes the call from inside the page with the app's CSRF header (one `[api] … using in-page fetch` line is logged). `OAuthApi`
  (`adminApi`) has no page to fall back to, so specs that need API-created data use `ZpApi.createView` / `view` / `deleteView`.
- **Zero-trust proxy requiring a device client certificate** (evening of 12-10-2026): the portal was reachable only through
  `127.0.0.1:3128` (`https_proxy`), which started demanding a client certificate — Playwright's Chromium and the installed
  Chrome launched by Playwright both fail with `ERR_BAD_SSL_CLIENT_AUTH_CERT`; the user's own Chrome profile passes. Until
  the proxy exempts local tooling or a certificate is available for `clientCertificates`, browser specs cannot run from
  Playwright. `ignoreHTTPSErrors` and `ZP_BROWSER_CHANNEL=chrome` are in place for the certificate-mismatch stage.
- **Predefined views** (13-10-2026): their saved definitions are fixed determiners — Associated Teams `field 26 is_not -1`
  with `report_based_on: teams` (rows are teams); My Team Members `1004`, My Direct Reports `30`, My Subordinates `31`, each
  `current_login_user`; allocation views `field 38 is 0|1|2|3`; Users by Profile / Role group through
  `/reports/workload/groups` and `/groups/owners?group_ids=[{id,count}]` (owners under `parents_with_owners[].parent_id`).
  All except All Users are Heatmap · Allocated Hours; their PDF prints each row total on its own line above the day values.
  Check spec: **Users by Profile has no group for the "Lite User" profile**, so Vishal liteuser is in no group there although
  Users by Role and All Users list them. **My Team Members lists the members of the teams the signed-in user leads** (joining a
  team as a member changes nothing; becoming its lead adds its members). **Under-Allocated Users also lists owners with no
  work at all ("free")**, so they appear in both Unallocated and Under-Allocated (visible for Week/Month ranges and empty
  months). **A custom view cannot hold the "current user" hierarchy rule**: `PUT /reports/custom-workload` rejects
  `{field_name: 30, condition: current_login_user}` with 400 INVALID_PARAMETER_VALUE. In the toolbar Week and Month pickers
  the left calendar sets the start and the right one the end.
- **PDF export** (`src/pdfExport.ts`): Export to PDF first asks "Do you wish to password-protect the file?" (`alert-Yes` /
  `alert-No`); No posts `/portal/<portal>/ganttexport` and downloads `workload_report_export_<id>.pdf`, a headless-Chrome print
  of the rendered report. Its text lists the filter values first (comma-separated) and then "<Section>: <Condition>", one line
  per row (total, then one value per day), the row names, and the header lines. A Heatmap with No Legend exports no numbers.
  Recorded as check spec on 13-10-2026: 15–22 % of the day values are cut in the PDF ("0.3..." for 0.333d, "1.33..." for
  1.333d), so the exported number cannot be read exactly; all 8 applied Status values are printed even when the chip bar
  folds them behind Show More.
- **Filter panel** (`src/pages/FilterPanel.ts`, `src/filterChecks.ts`): sections, condition codes and value types are read
  from the open panel, so the specs run on any portal; the task custom-field cases depend on the portal's own fields.
  Typed values must be keyed in (`pressSequentially`) — `fill()` is not seen by the app. Each case runs one Find and
  checks: request criterion · UI rows = API owners (+ Unassigned) · owners ⊆ unfiltered and the work rule (user-level
  filters keep work, task-level filters only remove it) · chips · unsaved marker · reopened panel · section badge.
  Expected semantics that the spec does not define (Between inclusive, Is Not every value, an Unassigned owner filter)
  are annotated `check spec`. `npm run test:filters` runs the fourteen filter specs (including the PDF export) (about 4 h with the API budget; `ZP_EXPECT_KNOWN_DEFECTS=1` turns the open filter defects into expected failures). Passing `--reporter=list` on the command line replaces the configured reporters, so `reports/results.json` (per-case annotations) is only written when no reporter flag is given.

- `is_default_view` is **true for every predefined view** (it marks built-in views). The view a user picked with ••• › Set as default view is
  `is_anchored` in `/user-views` (All Users on customworkload). DVE-05 asserts `is_anchored`.
- A predefined view with no description has **no `description` key** in `GET /views/{id}`; treat a missing key as `""`.

- Create Workload Report (14-10-2026), check spec: Allocation Type offers number conditions (Equals, Less Than, … Between, with an Hours / Percentage popover) besides Is; a new view may reuse the name of an existing custom view or of a predefined view ("All Users") — both portals create the duplicate; the name input stops at 100 characters; Back after a create returns to the empty create form; a task-level criterion that matches nothing keeps every owner with 0 work (no "No data found"); Role Is / Is Not leave resources and Unassigned in neither half; the Checkbox custom field offers a plain Yes/No dropdown (no token field); the Timeline view type offers Grouping "None" only, no Reports For and no expanded-view style, and fewer data labels; Months has no "This Month" (a new Months view opens on Next 6 Months); at most 15 criteria rows ("You have reached the maximum limit.").

## Filing defects (tests/tools)

- `tests/tools/repro-videos.spec.ts` records one video per open filter defect (WL-D-24…27; D-27 needs `ZP_ALLOW_PROFILE_CHANGES=1`
  and restores the profile). Copy each `test-results/<test>/video.webm` to `reports/repro/<ID>.webm` and convert:
  `ffmpeg -i reports/repro/<ID>.webm -vf scale=1280:-2 -c:v libx264 -pix_fmt yuv420p -movflags +faststart reports/repro/<ID>.mp4`.
- `tests/tools/file-bugs.spec.ts` files them through the portal's own API from inside the page (title, numbered steps,
  video): `POST /attachments` (multipart `upload_file`) → `POST /projects/{id}/issues` → `POST /entity-attachments`
  (`entity_type: bug`, `thirdparty_id` = the upload's `third_party_file_id`; the issue-scoped associate endpoint returned 500
  on 13-10-2026). Run with `ZP_BUG_PROJECT_ID=<project id> … --project=tools`; `reports/repro/filed.json` keeps the issue ids
  so a re-run never files twice.
- Filed on 13-10-2026 in project "Bugs" (NI-10): WL-D-24 → BU1-I1, WL-D-25 → BU1-I2, WL-D-26 → BU1-I3, WL-D-27 → BU1-I4.

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
| WL-D-21 | *Closed — expected behaviour (confirmed 12-10-2026):* with many chips the bar collapses behind a "Show More" ⌄ control and **Clear filter** appears once it is expanded. PN-08 verifies the control and the expanded bar | filter-panel PN-08 |
| WL-D-22 | **Report freezes after certain filters.** The data request fails (console shows an HTTP **500** from `/reports/workload`) and the UI stays on a spinner with the panel unable to reopen; only a page reload recovers. Reproduced 12-10-2026 with the Date custom field › Range tab › Less Than / Greater Than N day(s) (3 of 3 in two evening runs, 0 of 2 at noon), Completion Percentage › Less Than 99999999 and Is 100, Allocation › Between 100 and 1 hours (inverted), custom Number › Less Than -1 and Greater Than 1.5, and an inverted Not Between on a date. Relative-date Range filters additionally apply with **no chip bar, no Clear filter and badge 0**  Also through **Create Workload Report** (14-10-2026): a view saved with the Date custom field › **Less Than** gets HTTP 500 from `GET /reports/workload/meta` and never renders (saved with that criterion, on customworkload) | filter-custom-fields `date:*:ranged`, filter-edge-values EV-01/02/03/05/06 |
| WL-D-24 | Group By (e.g. Roles) with a toolbar filter applied: the grid stays filtered and the view stays unsaved, but the **chip bar disappears** — no indication of the active filter and no Clear filter while grouped (12-10-2026) | filter-toolbar TI-03 |
| WL-D-25 | Period arrows with a toolbar filter leave the state **inconsistent**: in one run the chips stayed and **Clear filter did nothing** (no request); in the recorded run the **chips disappeared and every row returned while the view stayed unsaved** with Save as shown (12/13-10-2026) | filter-toolbar TI-01; repro video WL-D-25 |
| WL-D-26 | A filter **saved with a view** (Save as › New after a toolbar filter, or a view created by the API with a determiner, or an Admin-shared one) is applied to the data when the view opens, but is **shown nowhere**: no chips, panel sections unticked, badge 0 — the user cannot tell the view is filtered or remove the filter from the toolbar (12-10-2026) | filter-saved-views SV-01/02/03 |
| WL-D-27 | **View-only profile:** after a toolbar filter, Save as › Discard is offered and enabled but does nothing — the filter, the unsaved marker and Save as stay; only Clear filter removes it (13-10-2026, CP profile with View at both levels) | filter-permissions PM-01 |
| WL-D-28 | *Candidate (13-10-2026):* Save as › New from **My Direct Reports** (after any toolbar change) sends and saves `determiner: {}` — the new view lists **every user** instead of the direct reports, with no warning that the hierarchy rule cannot be kept (custom views reject it) | default-views-edge DVE-04 |
| WL-D-29 | *Candidate (13-10-2026):* for a user with **no subordinates** (CP), **My Subordinates lists every owner** (9 rows from the view's own API response) while My Direct Reports correctly shows "No data found"; once someone reports to that user both views show only them | default-views-edge DVE-08 |
| WL-D-30 | *Candidate (13-10-2026):* ••• › **Clone** on a predefined view drops its rule: the clone saves `determiner: {}` (or no determiner) and lists every user instead of the source view's rows — e.g. a clone of Over-Allocated Users or My Team Members shows all owners. The view type, legend and grouping are kept. Same family as WL-D-28 | default-views-actions DVA |
| WL-D-31 | *Candidate (14-10-2026):* **Create Workload Report › Grouping is not saved.** The form shows the chosen field and order (e.g. Roles · Desc) up to Save, but the request and the stored view carry `group_by` = the Reports For field (`users` or `teams`), ascending; the new view opens ungrouped. Seen on both portals for Profiles, Roles, Reporting Manager and User/Resource | create-view CV-PW-* |
| WL-D-32 | *Candidate (14-10-2026):* a tab that is on a custom view which is then deleted elsewhere (API, another tab or user) **reopens the deleted view** from Reports › Workload (its name and URL, or the **"Ouch ! Permission Denied"** page) instead of falling back to the default view; a fresh tab falls back correctly | create-view-edge CVE-19 |
| WL-D-33 | *Candidate (14-10-2026):* the Create form **keeps leading and trailing spaces** in the report name (`"   name   "` is stored as typed), although an empty or spaces-only name is refused as mandatory | create-view-edge CVE-08 |
| WL-D-34 | *Candidate (14-10-2026):* `DELETE /views/{id}?module=workload` for a view **created from a project-level report** answers **500 INTERNAL_SERVER_ERROR**; with `&project_id=<project>` it deletes (204). A missing parameter should be a 4xx | create-view-edge CVE-17 (clean-up retries with the project id) |
| WL-D-35 | *Candidate (14-10-2026):* criteria saved with **"Any of these"** (pattern `1 OR 2`, e.g. Role Is Employee OR Status Is Open) show the **"All of these" result**: owners get less work than either criterion alone (an Employee with 6 615 min under Role alone shows 0) | create-view-criteria CVC-M |
| WL-D-36 | *Candidate (14-10-2026):* a view created with the criterion **Multi Select › Is Empty** is saved (PUT 201, `{"field_name":"multi_select","condition":"is_empty","value":["${IS_EMPTY}"]}`) but **`GET /reports/workload/meta?view_id=…` answers 400**, so the report never renders (no toolbar, no rows) | create-view-edge CVE-20, create-view-criteria custom fields |
| WL-D-37 | *Candidate (15-10-2026):* in **Create Workload Report**, pressing **Tab** in the name field does nothing: the keydown is cancelled (`defaultPrevented`) by **`window._lyteUiUtils.trapFocusFun`**, the Lyte focus trap of the **views dropdown popup the form was opened from** — a `lyte-wormhole` that is **no longer in the DOM** (`document.contains` false) when the form is open, so its trap keeps running and `LytePopup.initializeFocus` points at a detached element. Focus stays in the name field and whatever is typed next lands in the name (`"QA-WL-…-CVE-14typed with the keyboard"`). Reproduced on customworkload headless and headed, on the first or a later opening of the form; a keyboard-only user cannot reach Description or Save by Tab. Found by CVE-14; stack: `trapFocusFun (app-init-….js) ← murphy.min.js` delegated `keydown` on `document`. |
| WL-D-38 | *Candidate (15-10-2026):* editing a view that was **shared with specific users** and clearing **Share Workload Report with other Users** saves `view_access_type` **only_to_me** (the user indeed no longer sees the view) but the edit form **still sends the old `shared_users`** (`PUT /reports/custom-workload` body `view_access_type: only_to_me, shared_users: [{zpuid}]`) and the server stores it: `GET /views/{id}` keeps listing the user. The user indeed no longer sees the view, so harmless today; stale data that resurfaces if the share is re-enabled or read by another client. Reproduced by CVS-09 on auto and customworkload2. |
| WL-D-39 | *Reserved (15-10-2026):* GI-06 records it only when the Today line is drawn in a period that does not include today; not seen in the runs so far (the arrows move the period and the line disappears). |
| WL-D-41 | *Candidate (15-10-2026):* **changing the default business hours and putting them back does not put the task work back**: after Monday 09–13 → 09–18 again (or a holiday list added and deleted) the Admin owner's work on the next working day is **+540 min** (`GET /reports/workload` `total_date_work`, e.g. Vishal cwlr2 2026-10-16 3780 → 4320, total 70920 → 71460) while every other owner is unchanged. Seen on customworkload2 and auto2; customworkload matched its twin after the same change. Found by PS-01/02 (`portal-settings.spec.ts`), which now records it and restores the hours only. |
| WL-D-42 | *Candidate (15-10-2026):* on an own custom view, change the **chart type from the toolbar** (Heatmap → Bar: the view gets the `*` marker) and choose **Save as › Existing**: the marker clears but **no request is sent**, `GET /views/{id}` still says `view_type: heatmap` and the view reopens as Heatmap. Save as › New with the same change creates a Bar view (RT-07), and Save as › Existing after a **period** change does PUT (E-03). Seen on auto2 and customworkload2 (RT-06, three runs). |
| WL-D-43 | *Candidate (15-10-2026):* **the portal time zone moves day work between days.** With the portal set to UTC+14 (Pacific/Kiritimati) or UTC−11 (Pacific/Pago_Pago) and the same `from_date`/`to_date`, `GET /reports/workload` returns different `total_date_work` per day for date-only tasks (e.g. the resource's 570/540/510-minute days shift), and the task bars' day offsets change (one bar moved from day 4 to day 0 in Pago_Pago). Putting the zone back restores the values. Seen on customworkload2 (TZ-02). |
| WL-D-44 | *Candidate (15-10-2026):* **the Today line follows the browser's date, not the portal time zone.** Portal at UTC+14: the portal's today is 16-10-2026 and "This Month" is right, but `#today_line` stays on the 15-10 column (the browser's / server's date). Seen on customworkload2 (TZ-01). |
| WL-D-45 | *Candidate (15/16-10-2026):* global Workload Report › a user's **project group header › + (Assign Task)**: **New Task › Add** throws `Uncaught TypeError: userDetailUtils.isProjectPageVisible is not a function` (sent to `/api/v3/logger`), the form stays open with no message and no task is created; **Existing Task** throws the same on typing in the task search, whose suggestion list stays in `zdropdownlist--loading`, so nothing can be assigned. The same form opened from a day cell (`add-date-task` on the cell → `addcalendartask.do`) works. Seen on auto and auto2 (GE-17, GE-21). |
| WL-D-23 | *Closed — expected behaviour (confirmed 12-10-2026):* Save as › Discard removes the unsaved marker and Save as; the chips and filtered rows stay on screen until the next data load, which carries no filter. PN-07 verifies this | filter-panel PN-07 |
