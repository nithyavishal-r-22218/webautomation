---
name: zoho-workload-report-qa
description: Test the Zoho Projects Workload Report end to end — live in the user's Chrome or as Playwright code. Use for workload report permissions (View/Manage/Delete), All Users/view loading, favourites, refresh, edit combinations (view type, time period, view style, data labels), re-verifying workload bugs, or writing workload automation, even if the user only says "workload report" or names a flow.
---

# Zoho Projects Workload Report — QA and automation

You are QA Lead, Automation Architect and Browser Analyst at once: decide what to test and what passes, drive the user's shared Chrome tab (Claude in Chrome tools) to test it, prove each result in more than one layer, document it in a Claude Doc, and leave the portal as you found it.

Files in this skill:
- `scripts/wl-helper.js` — browser helper (`window.__wl`) for the edit form and layered reads. Install with the javascript tool once per page load.
- `references/locators.md` — every `data-zpqa` key, control structure, option list and API call seen live. Read before writing selectors or API checks.
- `references/automation.md` — how to turn a run into Playwright code that works in any portal. Read when asked for code.
- `assets/workload-playwright` — the Playwright project (edit combinations and edge cases, API-switched permission levels, real-data import check, defect regressions). Extend it rather than starting over; its README lists every spec, setting and endpoint.

## 1. Before touching anything

- Work in the user's current tab; open another tab only to read reference pages (e.g. `/api-docs`), then close it.
- Saving view settings changes shared state. Before the first change, open Edit and record the original settings (view type, unit, mode, option or custom range, view style, data label, show options, description). Restore them at the end and prove it by reopening the form. Users rely on these views; a QA run that silently changes them causes confusion later.
- If the toolbar shows "Save as" or a red dot on the view name, the user has unsaved toolbar changes; say that saving through Edit will clear them. After your own toolbar changes, use Save as › Discard.
- Permission checkboxes in Setup › Profiles affect real users: change them only after explicit approval in chat, record the original state first, and restore it at the end with a readback.
- Never type passwords. When another user must be signed in, ask the user to sign in themselves and wait; confirm who is signed in with `GET /users/me` before testing.
- If an action the user names seems missing, look again before saying so (the "More Actions" tooltip hides the Edit item).

## 2. Document as you go

Use Claude Docs; keep editing the conversation's existing playbook doc if there is one. Plant a pending block for the flow before running it, then fill it with: a one-line verdict with counts, a step table (Action · Expected · Actual · Evidence · Result), a defects table (ID · Severity · Summary · Expected · Actual), and an automation snippet. Defect IDs continue the existing series (WL-D-nn; last used WL-D-20).

## 3. Data is different in every portal

Never rely on a portal ID, view ID, profile ID, user name, user count or date seen once. Discover them (see `references/locators.md` › API) and assert relations: UI rows = API owners (+ Unassigned); header = expected range; header total = sum of working days × business hours (minus holidays); before = after for refresh. The Users module list is not a valid count oracle (it filters by invitation status). Label any number you quote in the doc as "example from portal <name>".

## 4. Driving the page

- Radios (view type, Days/Weeks/Months, view style) and checkboxes need real clicks; get coordinates with `__wl.pos(value)` because the layout shifts when the left nav collapses.
- Setup › Profiles checkboxes: `ruc-checkbox[rc-qa="profile_checkbox_<profileId>_<module>_<view|manage|delete>"]` (`workloadreport` global, `projectworkloadreport` project); state is the `ruc-checked` class; each click saves at once (PATCH 200). Scroll the profile's column into view before clicking.
- `ruc-select` dropdowns open and select via dispatched pointer events (`__wl.pick`); plain `.click()` does nothing.
- Date, week and month pickers: real clicks, a zoom screenshot after each click (the picker can move after the first click), then OK and read the input value.
- Keep each javascript call to 2–3 saves; longer ones time out. After a timeout or an extension failure, re-read state (a reload drops installed helpers) before continuing; never assume the last call ran.
- Output containing full URLs, cookies or `key=value` text is blocked: print only parsed params (`__wl.lastReq()`) and replace `=` before returning text.
- In-page API calls: build the CSRF header with the app's own globals — `{'X-ZCSRF-TOKEN': getZPCSRFName() + '=' + getZPCSRFValue()}` — and `fetch('/api/v3/portal/<portalId>' + path, {credentials: 'include'})`.
- Clicking a project or profile name cell starts inline rename (press Escape); open projects with the row's `open_detail` icon. Clicking empty grid space can open a task detail panel; close it with its Close button. A cold deep link to `#zp/projects/<id>/tasks` lands on the Projects list.

## 5. Flows

- **View load (All Users):** select the view, scroll `.resourceutilTableholder` until the last `index=` page arrives (`page_info.has_next` false); compare row count with owners.
- **Favourite:** normalise from `is_favorite`; add → toast, POST 204, star `fav`, listed under Favorite Views; remove → DELETE 204, star `unfav`, gone from Favorite Views after reopening the dropdown.
- **Refresh:** note selections, scroll mid-list, refresh; expect user-views ×4, meta and first data page reloaded, selections unchanged, list at top.
- **Edit combinations** (one factor at a time, every value, reopen the form after each save): description + Bar/Heatmap/Timeline; for each unit every Relative option read from the dropdown plus one Custom range crossing a month or year; view style Gantt/Timeline; every data label for each view type (labels differ by unit); Show Options for Timeline. Edge cases: Cancel discards (no PUT), 255-char description, emoji, picker reopen, 6-month limit, double-click Save, toolbar arrows, Save as › Existing / New / Discard, network failure on save, keyboard-only use.
- **Permissions:** for each profile or level (None, View, View+Manage, View+Delete, Full, project-only, global-only) at Global and Project level check: report opens; "+ Create Workload Report" in the view list; Save as › New Workload Report enabled/disabled after a toolbar change; ••• menu items on the user's own view and on an Admin-shared view; API create/edit (`PUT /reports/custom-workload` → 201/200 or 403) and delete (`DELETE /views/{id}?module=workload` → 204 or 401). A hidden button is not a pass if the API call succeeds, and a shown item that ends in "Permission Denied" is a UI defect. View must not allow create, edit or delete; Manage allows create/edit of own views; Delete allows delete of own views; nobody but the owner/Admin edits or deletes another user's shared view.
  - Switch levels by API as Admin: `PATCH /profiles/{id}/{globalreport|projectreport}/permissions/{revoke|grant}` with a JSON **array** body `[{"module":"workloadreport","actions":["view"]}]` (module `projectworkloadreport` for project); read back with `GET /profiles/{scope}/permissions?profile_ids={id}`. Other body shapes return 400 JSON_PARSE_ERROR.
  - In Chrome, one browser session is one user, so each level needs the user to sign in twice (Admin, then the test user). In Playwright, keep both signed in as two contexts (`tests/permissions/permission-levels.spec.ts`) — no re-login.
- **Real allocated data:** create a project (`POST /projects`), add users (`POST /projects/{id}/projectusers`, form-encoded `userdetails` JSON + `notify=false`; a JSON body is rejected), add resources in the UI (Add Resource, which calls `POST /projects/{id}/resources`), import tasks with the Import wizard (date format must match the file; map XLS users to project users or tasks import unassigned), then compare `GET /reports/workload?project_id=…&from_date=YYYY-MM-DDT00:00:00.000Z&to_date=…T23:59:59.999Z&time_period=days` (`owners[].work.total_date_work[] {date, allocation, work minutes}`; `fetch_unassignee=true` for Unassigned) day by day against the file. Remove the project with `POST /projects/{id}/trash` (reversible); never a permanent DELETE.
  - The importer reads rows from EVERY sheet of a workbook: the import file must contain only the Tasks sheet; keep expected-results sheets in a separate workbook.
  - Import units: `hrs/day`, `%/day`, `hrs` (total). The wizard's last step is `#assignUsers` (Import Now); `taskimport_cancel_import` discards safely at any earlier step.

Verify each save in layers with `__wl.run(mode, option)`: header (`period`), grid first/last column (`cols`), API from/to (`req`), header total (`summary`), first user row (`row1()`), and the reopened form (`before` of the next run). Compute expected ranges from today: This/Last/Next Week = 7 days from the portal's week start, Last/Next N Days = N days ending/starting today, Weeks options in whole weeks, Months in calendar months. When the spec doesn't define an option (Days › Last 3 Months rolls from today), mark it "check spec" rather than pass or fail.

## 6. Defects and re-verification

Each defect needs exact steps, expected vs actual, and evidence from at least two layers. To re-verify, reload, re-install the helper, reproduce through header + grid + API, then report Confirmed / Not reproduced / Refined with updated severity, and say whether it is functional or cosmetic (e.g. click OK without changes and check the saved value). Known defects from 8 Oct 2026 to re-check, not assume:
- WL-D-01 Favorite Views stale after removing a favourite · D-02 Days-unit relative windows one day long (7 Days = 8, weeks Sun–Sun, 180 = 181) · D-03 Weeks unit buckets from the range start and overruns the end, so the header total exceeds the user total · D-04 percentage summary 26.49 % with uniform cells · D-05 header summary stays in hours for Minutes and Available Man Weeks · D-06 month picker end panel shows the start year.
- D-07 picker can't reopen after OK/Cancel · D-08 emoji saved as "?" · D-09 toolbar arrows step wrong · D-10 Weeks end week only on the right calendar (improvement) · D-11 picker enables dates beyond 6 months, then OK rejects · D-12 double-click Save sends 2 PUTs.
- D-13 Edit shown on own view without Manage (click → Permission Denied page) · D-14 Delete shown on another user's shared view (server 401) · D-15 `is_editable`/`is_deletable` on own views ignore the profile.
- D-16 import caps %/day at 100 silently · D-17 weekend-only task allocated on Sat/Sun · D-18 Cancelled tasks stored as 100 % complete (confirm intent) · D-19 Associated Team and Tags don't import · D-20 import creates duplicate task lists instead of reusing same-named ones.

## 7. Finish

Restore and confirm the original settings (view settings by reopening the form; profile permissions by API readback), delete every `QA-WL-*` view you created (`DELETE /views/{id}?module=workload`), switch the Admin back to the view they were on, close any open form, and tell the user about side effects (cleared toolbar state, collapsed nav, users added to projects, projects in trash, pending invitations, any `QA-WL-*` records left). Reply briefly: verdict, top defects with one line each, decisions needed, the doc link.
