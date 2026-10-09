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
Internal endpoints (`permissions/grant|revoke` with a JSON array body, `DELETE /views/{id}`, form-encoded `/projectusers`) are listed in README › Endpoints.

## Status
- Suite: 154 tests. Typecheck and the 48 unit tests pass. Live on 09-10-2026: `npm run auth:db` (Admin), WL-G-01, WL-G-04 and API-01 pass;
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
- Defects WL-D-01…D-20: see README › Defects covered.
- Open decisions for the user/product: edit scope (`ZP_EDIT_SCOPE`); whether Cancelled = 100 % is intended (D-18); Days › Last/Next 3 Months rule.
