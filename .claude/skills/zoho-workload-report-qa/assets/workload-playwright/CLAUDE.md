# Context for Claude — Zoho Projects Workload Report QA

Hand-off from a Cowork session (08-10-2026). Read this first, then `README.md`.

## Environment
- Base URL `https://projects.localzoho.com`, portal **customworkload** (numeric portal id is discovered at runtime; it was 131176135).
- Business hours: Mon–Fri 09:00–18:00 = 540 min/day, no holidays. Weeks start Sunday.
- Dates in the UI are **DD-MM-YYYY** here (user date format; other portals MM-DD-YYYY). `WorkloadPage.goto()` detects the order
  from the header (`ZP_DATE_ORDER` overrides); compare UI text with `shown()`/`parseShown()`, not `fmt()`/`parseMDY()`.
- Admin: Vishal workload (Portal Owner). Test user for permissions: **Vishal customprofile**, profile **CP** (Employee role).
- Other users: Vishal PLAdmin, vishal PL manager, Vishal plemployee, Vishal plreadonly, Vishal liteuser; resource UIAutomation_Workload_Resource.
- Project NI-2 UIAutomation_Workload_Project2 holds 124 tasks (UI1-T1, 12 earlier tasks, 111 from `tests/data/fixtures/workload_full_coverage_import.xlsx`).
- NI-8 WL_API_FullCoverage_20261008112546 is in the trash (not permanently deleted).

## Rules we follow
- Sign-in: `npm run auth:db` (credentials DB, approved by the user 09-10-2026) or `npm run auth` (the user signs in).
  Never print, log or store a password; only the session goes to `auth/*.json`. Confirm who is signed in with `GET /users/me`.
- Change Setup › Profiles permissions only with explicit approval. Snapshot first, restore and read back at the end.
  CP Workload permissions are currently **all off** at both levels (the original state).
- Before editing a view, snapshot its settings and restore them afterwards. Discard toolbar changes with Save as › Discard.
- Remove projects with `POST /projects/{id}/trash` only. Never permanently delete without the user doing it.
- Delete every `QA-WL-*` view you create (`DELETE /views/{id}?module=workload`).

## Calling the API from the browser page
`fetch('/api/v3/portal/<portalId>' + path, {credentials:'include', headers:{'X-ZCSRF-TOKEN': getZPCSRFName() + '=' + getZPCSRFValue()}})`
Internal endpoints (`permissions/grant|revoke` with a JSON array body, `DELETE /views/{id}`, form-encoded `/projectusers`) are listed in README › Endpoints. The internal API reference is `https://projects.localzoho.com/api-docs/internal/<module>` (one page per module, e.g. `teams`, `tasks`, `projects/project_group`, `users/user_hierarchy`).

## Status
- Suite: 377 tests. Typecheck and the 48 unit tests pass. Live on 09-10-2026: `npm run auth:db` (Admin), WL-G-01, WL-G-04 and API-01 pass;
  the other browser specs have not run live yet.
  First run: `npm install --include=dev` (this shell has `NODE_ENV=production`, which makes plain `npm install` install nothing) → `npx playwright install chromium` → `.env` → `npm run auth` (admin) → `ZP_AUTH_TARGETS=cp npm run auth` → `npm test`, `npm run test:levels`, `npm run test:data`.
- Confirm on the first live run: the D-11 picker disabled-cell class, the "next" arrow in `setCustom`, the text locators in `ProjectPage.addResource` and the create-form Share checkbox, and the import date-format box.
- Cleanup hardening (09-10-2026, not yet run live): permission-levels always restores the profile (try/finally); the
  Manage-profile API view is deleted by the Admin; the favourite test leaves All Users as found; snapshot/restore use
  `ZP_EDIT_VIEW`; hidden Show Options and past custom ranges are restored; prefix deletes refuse prefixes that would
  match `QA-WL-SEED*`. If a run is killed, `reports/perm-snapshot-<profile>.json` / `reports/view-snapshot.json`
  hold what to put back (each file is removed after a successful restore).
- Live fixes (09-10-2026): `openReports()` falls back to the Reports menu when `#zp/reports` lands on Projects; the
  `#zpsHandheldsPromo` overlay is closed by a locator handler; `refresh()` hovers the toolbar so `refresh_status` shows.
- API budget (user's requirement 09-10-2026): at most ~200 portal API calls per 2 minutes. `src/rate.ts` holds
  browser and direct calls at 150 (`ZP_API_BUDGET`); counting alone peaked at 322, so requests are routed and held.
  Give the portal a cool-down (the user asked for 7 min) before re-running after a heavy run.
- Test data pattern (user's decision 09-10-2026): create with the OAuth API, act in the UI, delete with the API —
  `adminApi` fixture (`src/oauth.ts`, token from the credentials-DB row, cached in `auth/oauth.<target>.json`); see API-01.
  Toolbar icons (favourite, refresh, •••) are hidden until hover: click them through `toolbarIcon()`.
- Ported from the Java API layer (`~/UIautomation/src/test/java/api`, 09-10-2026): predefined views are listed under
  i18n keys (`zp.workload.customview.allusers`) and are now also found by their dropdown label (`viewLabel`);
  `ZpApi.call` paces each API to 80 calls / 2 min (`ZP_API_RATE_LIMIT`) and retries THROTTLES_LIMIT_EXCEEDED after 30 s
  (the portal blocks an API for ~30 min past ~100 calls / 2 min); view deletes use `custom_view_id` when present;
  `setPerms` grants only missing and revokes only extra actions; business-hours keys are ISO weekdays (1 = Mon … 7 = Sun).
- Picker (09-10-2026): `setCustom` first clicks cells by `data-date` (lyte-daterangepicker for Days, `.range-calendar-container
  ruc-calendar` panels for Weeks/Months, OK = `footer-cur-ok`), as confirmed live by the Java suite in `~/UIautomation`;
  it falls back to arrow navigation only for dates outside the two rendered months. Confirm live whether grid column
  tooltips also follow the DD-MM order.
- Also confirm live: the "previous" arrow (`‹` / `[class*=prev]`) in `navigateTo`, and that a predefined view's
  user-views `name` is the label "All Users".
- Defects WL-D-01…D-36 (D-28…D-36 are candidates from 13-10-2026, not filed): see README › Defects covered. New on 12-10-2026 (evening): D-22 is a server 500 on some filter values with the UI stuck on a spinner; D-24 Group By hides the chip bar while the filter stays applied; D-25 Clear filter inert after the period arrows; D-26 a filter saved with a view is applied but invisible; D-27 (13-10-2026) Discard is inert for a View-only profile. Found by the filter specs on 12-10-2026: D-21 closed as expected behaviour (Show More reveals Clear filter; confirmed by the user 12-10-2026), D-22 (relative-date Range filter: applied silently with no chip bar; Less Than freezes the report), D-23 closed as expected behaviour (Discard clears the unsaved state; chips and grid refresh on the next data load; confirmed by the user 12-10-2026). PN-07 and PN-08 assert the confirmed expected behaviour and pass.
- Default-view edge cases (13-10-2026): `tests/workload/default-views-edge.spec.ts` — periods, non-empty Unallocated/Optimal via a QA project, Group By, Save as (WL-D-28), favourite/default/refresh on all 11, project level, team lead vs membership, CP with View and a reporting-line change (WL-D-29). Mutating cases need `ZP_ALLOW_DATA_CHANGES=1` / `ZP_ALLOW_PROFILE_CHANGES=1`; state goes to `reports/dve-snapshot.json` and is restored with read-back. All pass live or fail only as D-28/D-29.
- Default-view actions (13-10-2026): `tests/workload/default-views-actions.spec.ts` — ••• Copy link, Edit (form = definition, Cancel, save a description and restore) and Clone on all 11 predefined views. The restore replays the app's own PUT with the original description (UI fallback; an empty description must be cleared with keys, `fill('')` is not registered); a killed run leaves `reports/dva-snapshot.json` with that body. Clone keeps view type, legend and grouping but drops the rule (WL-D-30). `is_default_view` is true on every predefined view; the user's default is `is_anchored`.
- Parallel runs (13-10-2026): `scripts/parallel.mjs` + `portals.json` run one Playwright process per portal (own session, `reports/<portal>/`, `test-results/<portal>/`, `auth/<portal>/`, API budget). `npm run test:parallel -- <specs>` is a QUEUE: every test goes to whichever portal is free (the user's rule 14-10-2026: never pin cases to a portal, never leave a portal idle); `npm run test:mirror` runs them on each; results merge into `reports/parallel-results.json`. Portals: customworkload (source), customworkload2 (Admin Vishal cwlr2, id 131512698), auto (Vishal Auto, id 131652166) and auto2 (Vishal auto2, id 131652358), all with the same invited users; the CP session `auth/wl.cp.json` is account-wide. All three targets were seeded on 13/14-10-2026 and match the source with 0 differences. `ZP_PORTAL_ID` overrides a DB row's portalID for the OAuth client if a row is ever wrong (auto2's was, fixed by the user 14-10-2026).
- Seeding (13-10-2026, the user asked for the same data in every new portal): `npm run seed` inventories the source (`tests/tools/portal-probe.spec.ts`) and copies tags, groups, NI-2 and NI-6 with users, the resource (UI only), lists, 136 tasks, teams, hierarchy + reporting lines into each target (`tests/tools/seed-portal.spec.ts`, idempotent, manifest in `reports/<portal>/seed-manifest.json`). `python3 scripts/compare-portals.py` checks parity; customworkload2 matched with 0 differences. Seeding also switched reporting hierarchy ON in customworkload2 (to match the source). Gotcha: task create defaults `copy_task_duration` to true, which overwrites every owner's work.
- Live on both portals (13/14-10-2026): split run default-views (customworkload2, 11/11) + default-views-actions (customworkload); a network drop (ERR_INTERNET_DISCONNECTED) failed 7 DVA tests before they touched anything, and the re-run passed 7/7; DVA on customworkload2 11/11. All failures are the expected WL-D-30. Check: on customworkload the allocation views (Unallocated, Optimally-, Over-Allocated) and some clones stayed on a spinner past 150 s and a reload (reports/dva-*-spinner.png, soft-asserted); the same views loaded on customworkload2 with the same data and API budget. Capacity: about 1.2 GB per portal process; 4 portals is the practical limit on the 24 GB Mac.
- Create Workload Report (14-10-2026, user's request: every combination, edge cases, data and view validated): `tests/workload/create-view.spec.ts` (CV, pairwise + periods + share×projects), `create-view-criteria.spec.ts` (CVC, every field × condition), `create-view-edge.spec.ts` (CVE); shared layers in `src/createChecks.ts`, page object `src/pages/CreateViewPage.ts`, form map `tests/tools/create-form-probe.spec.ts` (→ `reports/<portal>/create-form-map.json`). `npm run test:create`. Candidates: WL-D-31 grouping not saved, WL-D-32 deleted-view tab reopens it, WL-D-33 name not trimmed, WL-D-34 DELETE of a project-created view without project_id → 500, WL-D-35 "Any of these" behaves as AND, WL-D-36 Multi Select › Is Empty view: meta 400, never renders; WL-D-08 also hits the create name. Before deleting a view a test switches the tab to All Users (`leaveToAllUsers`).
- Create Workload Report live (14/15-10-2026, all four portals through the queue): CV 71, CVC 47 (10 custom-field positions skipped: portals have 20–23 custom fields), CVE 21 — every test passes or fails only as a known defect (WL-D-02, 08, 12, 22, 31–36). The Date › Less Than saved view → meta 500 (WL-D-22 family) was seen on customworkload.
- Predefined views (13-10-2026): `tests/workload/default-views.spec.ts` (`npm run test:views`) checks all 11 default views against independent oracles (teams, `/users/{id}/teams`, `reporting_to`, profiles/roles, allocation) with a filter on top, Clear back to the view and a PDF export; all 11 pass live. Check spec: Users by Profile has no Lite User group.
- PDF export with filters (13-10-2026): `tests/workload/filter-export.spec.ts` + `src/pdfExport.ts` (dev dependency `pdf-parse`) export through the UI (password prompt → No), parse the PDF and compare header, filter text, rows, totals and every day value with the UI and the API; all 8 cases pass live, EX-07 is the expected WL-D-26 failure. Check spec: day values cut in the PDF ("0.3...").
- Filters e2e status (13-10-2026): all thirteen filter specs ran live on customworkload; everything passes or fails only as a recorded known defect (D-22, D-24, D-25, D-26 under `ZP_EXPECT_KNOWN_DEFECTS=1`). Skipped by design: FLT-PM-* (needs `ZP_ALLOW_PROFILE_CHANGES=1`), PN-09 (portal has ≤ 15 owners), SV-03 second-user part (CP has no report rights). The portal sits behind a local zero-trust proxy: see README › Known limits.
- Filters (12-10-2026): thirteen `tests/workload/filter-*.spec.ts` (+ `src/pages/FilterPanel.ts`, `src/filterChecks.ts`) cover every section × condition of the toolbar Filter panel; `npm run test:filters`. Live on 12-10-2026: panel, User/Resource, Allocation, Role, Task Name, Completion %, Owner, Created By, Priority, Tags, Billing Type, Project Group, custom pick lists / user lists / numbers pass; Project, Project Status, Status, Associated Team, Task List pass once the chip bar is expanded with Show More (expected behaviour). Typed values must be keyed in (`pressSequentially`), never `fill()`.
- Open decisions for the user/product: edit scope (`ZP_EDIT_SCOPE`); whether Cancelled = 100 % is intended (D-18); Days › Last/Next 3 Months rule.
