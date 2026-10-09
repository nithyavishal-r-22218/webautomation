# Workload Report Permissions: QA and Automation Playbook

Oct 8, 2026 · @Vishal

## Scope

The goal is to prove that the **Workload Report** honours the three profile permissions — View, Manage, Delete — at both levels where it is configured: **Project Reports › Workload Reports** and **Global Reports › Workload Reports**, in both the UI and the REST API.

The acceptance rule given for this suite:

- **View** — the user can open and read the workload report, but cannot create, edit or delete a workload view.
- **Manage** — the user can create (and edit, clone, share) workload views.
- **Delete** — the user can delete workload views.

The AI agent plays three roles at once: **QA Lead** (decides what to test and what passes), **Automation Architect** (structures the Playwright + MCP suite) and **Browser Analyst** (inspects the live page and records locators). Every claim about the UI in this doc was observed on the shared Chrome session on 8 Oct 2026, portal `usercustomfield` on `projects.localzoho.com`.

References: [Workload Report help article](https://help.zoho.com/portal/en/kb/projects/reports/workload-report/articles/workload-report) · [API docs — Reports › Workload](https://projects.localzoho.com/api-docs#reports-workload).

Out of scope: business-hours maths, allocation colour thresholds, PDF export content, and plan gating (Global Workload needs Enterprise or Ultimate; Project Workload needs Premium or above) beyond a single smoke check.

## Dynamic data rules

No value seen in one portal may appear in a test. Portal IDs, view IDs, profile IDs, user names, user counts, dates and permission states all differ per portal, so the suite discovers each one at runtime and asserts relations (UI equals API, before equals after), never fixed numbers. Every ID, name and count quoted elsewhere in this doc is an **example from portal `usercustomfield`**, kept only to show the shape.

The only inputs a run takes, from environment variables:

| Variable | Example | Purpose |
| --- | --- | --- |
| `ZP_BASE_URL` | `https://projects.localzoho.com` | Data centre / environment |
| `ZP_PORTAL` | `usercustomfield` | Portal URL name |
| `ZP_ADMIN_STATE` | `auth/admin.json` | Saved login for the Admin |
| `ZP_USER_STATES` | `auth/wl.*.json` | Saved logins for each test user |
| `RUN_ID` | `20261008-1412` | Prefix for every record the run creates |

What is discovered, and from where:

| Value | Discover it from | Never |
| --- | --- | --- |
| Numeric portal ID | The first app request matching `/api/v3/portal/(\d+)/` after page load | Hardcode `122693125` |
| View ID of All Users (or any view) | `GET /user-views?module=workload&filter={"view_type":"predefined_views"}` → `user_views[]` where `name` matches; same call with `created_views`, `shared_views`, `favourite_views` | Hardcode `282542000000643014` |
| Favourite state | `user_views[].is_favorite`, then the star icon class `fav` / `unfav` | Assume the view starts unfavourited |
| Edit / delete rights on a view | `user_views[].is_editable`, `is_deletable` | Infer from profile name |
| Expected users in a view | Page `GET /reports/workload` with the view's ID until `page_info.has_next` is false; count `owners[]`, plus 1 when the unassigned call (`fetch_unassignee=true`) returns a row | Hardcode 137 / 138, or use the Users list |
| Report period, page size | `GET /reports/workload/meta` → `chart_details.start_date`, `end_date`, `user_range` | Hardcode October 2026 or 15 |
| Profile ID for a column | Read the column header text ("Employee"), then the `input_profile_checkbox_<id>_workloadreport_view` in that column | Hardcode profile IDs |
| Checkbox state | Wrapping `ruc-checkbox[rc-checked]` | Read `input.checked` |
| Setup random prefix | Suffix match `[data-zpqa$="_profile_base_group_globalreport"]` | Full `data-zpqa` value |

How the suite reads those values without handling tokens: it never calls the API on its own for discovery. It lets the app make its normal calls and reads the responses with `page.waitForResponse`, so the app's own session and headers are used.

```ts
// fixtures/discover.ts
export async function discover(page: Page) {
  const views = new Map<string, any>();
  page.on('response', async r => {
    if (/\/user-views\?module=workload/.test(r.url()) && r.ok()) {
      for (const v of (await r.json()).user_views ?? []) views.set(v.name, v);
    }
  });
  const metaResp = page.waitForResponse(r => r.url().includes('/reports/workload/meta') && r.ok());
  await page.goto(`${process.env.ZP_BASE_URL}/portal/${process.env.ZP_PORTAL}#zp/reports`);
  await qa(page, 'tab_resourceutilpage').click();
  const meta = await (await metaResp).json();
  const portalId = (await metaResp).url().match(/\/portal\/(\d+)\//)![1];
  await expect.poll(() => views.size).toBeGreaterThan(0);
  return { portalId, meta, views };
}

// Expected rows = sum of owners across every page the app fetched + unassigned row
export function collectOwners(page: Page) {
  const ids = new Set<string>(); let unassigned = 0; let lastPageSeen = false;
  page.on('response', async r => {
    if (!/\/reports\/workload\?/.test(r.url()) || !r.ok()) return;
    const j = await r.json();
    if (r.url().includes('fetch_unassignee=true')) { unassigned = j.owners?.length ? 1 : 0; return; }
    (j.owners ?? []).forEach((o: any) => ids.add(o.id));
    if (j.page_info?.has_next === false) lastPageSeen = true;
  });
  return { expected: () => ids.size + unassigned, done: () => lastPageSeen };
}
```

Test data the run creates (custom views, tasks) is named `QA-WL-${RUN_ID}-<case>` and deleted in teardown by that prefix, so parallel runs and other portals never collide. Assertions about a seed view look it up by that name, never by ID.

## Permission model

Each profile carries six independent checkboxes for this feature: View, Manage and Delete under **Project Reports › Workload Reports**, and the same three under **Global Reports › Workload Reports**. The project set governs the Workload tab inside a project's Reports; the global set governs **Reports › Workload Report** in the left navigation.

Path in the UI: **Setup › Profiles and Roles › Profiles › User Profiles › Project Reports (or Global Reports) › Workload Reports**, then the column of the profile under test (Manager shown as the default; Admin is fixed with all ticks and is not editable).

Expected behaviour per checkbox combination, applied separately to each level:

| Combination | Open report | Switch chart / period / group, filter | Create custom view | Edit / clone / share own view | Delete view | Export PDF |
| --- | --- | --- | --- | --- | --- | --- |
| None | Blocked: menu hidden, direct URL denied | — | No | No | No | No |
| View | Yes | Yes | No: create option hidden or disabled | No | No | Confirm (open question) |
| View + Manage | Yes | Yes | Yes | Yes | No | Confirm |
| View + Delete | Yes | Yes | No | No | Yes | Confirm |
| View + Manage + Delete | Yes | Yes | Yes | Yes | Yes | Yes |
| Manage or Delete without View | Verify: UI should force View on, or treat as None | — | — | — | — | — |

Rules the suite asserts on top of the matrix:

- A permission at the project level must not leak into Global Reports, and the reverse.
- Task actions inside the chart (the + to create a task, drag-to-reassign, drag-to-reschedule) follow the **Tasks** module permissions, not the Workload ones. They are tested only as a regression check that a View-only workload user cannot alter tasks they could not alter elsewhere.
- Every UI denial must also be enforced by the API: a hidden button is not a pass if the matching API call succeeds.

## Environment and test data

Profiles vary by portal and are read from the grid's column headers at runtime; in portal usercustomfield they are **Manager (Default)**, **Admin**, **Employee** and **Contractor**. Admin is locked to full access and acts as the control. Do not edit the built-in profiles; clone Employee into dedicated test profiles so every run starts from a known state.

| Test profile | Project Reports › Workload | Global Reports › Workload | Test user |
| --- | --- | --- | --- |
| QA-WL-None | — | — | wl.none@… |
| QA-WL-View | View | View | wl.view@… |
| QA-WL-Manage | View, Manage | View, Manage | wl.manage@… |
| QA-WL-Delete | View, Delete | View, Delete | wl.delete@… |
| QA-WL-Full | View, Manage, Delete | View, Manage, Delete | wl.full@… |
| QA-WL-ProjOnly | View, Manage, Delete | — | wl.projonly@… |
| QA-WL-GlobOnly | — | View, Manage, Delete | wl.globonly@… |

Test data each run needs:

- One project (for example **QA-Workload-Project**) with every test user added as a member, so project-level checks have a Reports tab.
- Five to ten tasks across two weeks, assigned to at least two test users with work hours, so the Bar, Heatmap and Timeline charts render rows.
- One seed custom workload view per level, created by Admin and shared publicly, as the target for View-only edit and delete attempts.
- One OAuth client per test user (or a self client) with scope `ZohoProjects.portals.READ` and `ZohoProjects.portals.CREATE`, for the API layer.

Plan check: Global Workload needs Enterprise or Ultimate; Project Workload needs Premium or above. Record the portal edition in the report header.

Access the agent needs before it starts (the **permission gate** of Phase 0): an Admin login to change profiles, a login for each test user, written approval to change profile checkboxes in this portal, and confirmation that `projects.localzoho.com` is a test environment.

## Live browser analysis

The app exposes a stable QA attribute, `data-zpqa`, on almost every control, so it is the primary locator. Some keys carry a numeric record ID (replace with a regex) and some setup keys carry a random per-session prefix such as `muz0scn48tcl6sfsk6c_` (match with a suffix selector, never the full value).

### Setup › Profiles (permission screen)

URL hash `#setup/profiles/user`. Tabs User Profiles, Client Profiles, System Profiles. Left list of groups; Project Reports and Global Reports each expand to Workload Reports and Custom Reports. The grid shows one column per profile: Manager (Default), Admin, Employee, Contractor.

| Element | Locator |
| --- | --- |
| Setup entry (gear) | `[data-zpqa="gloabl-setup"]` (spelling as shipped) |
| Profiles and Roles › Profiles | `[data-zpqa="profiles"]` |
| User Profiles tab | `[data-zpqa="tab_user"]` |
| Project Reports group | `[data-zpqa$="_profile_base_group_projectreport"]` |
| Global Reports group | `[data-zpqa$="_profile_base_group_globalreport"]` |
| Workload Reports sub-menu | `[data-zpqa$="_profile_base_menu_workloadreport"]` |
| View / Manage / Delete checkbox | `input[data-zpqa="input_profile_checkbox_<profileId>_workloadreport_view"]` (`_manage`, `_delete`) |
| Add profile | `[data-zpqa$="_profile_base_add_profile"]` |

Two traps found on this screen. First, the native `input` reports `checked=false` even when the box is ticked; read state from the wrapping `ruc-checkbox` element's `rc-checked="true"` attribute. Second, project and global checkboxes share the same `data-zpqa` key, so always scope the locator to the expanded group first, then the profile ID.

### Reports › Workload Report (global)

URL hash `#zp/reports`, first tab Workload Report. The default view is All Users in Heatmap for the current month (10-01-2026 to 10-31-2026), Group By None, data label Allocated Hours.

| Element | Locator |
| --- | --- |
| Workload Report tab | `[data-zpqa="tab_resourceutilpage"]` |
| View dropdown (All Users) | `[data-zpqa="topbar_cview"]` |
| Favourite / refresh / more | `favourite_icon`, `refresh_status`, `more_actions` |
| Period back / picker / next | `cal_left_arrow`, `topbar_calendar`, `cal_right_arrow` |
| Chart type (Bar, Heatmap, Timeline) | `[data-zpqa="kanban_changecv"]` |
| Filter | `[data-zpqa="filter"]` |
| Group By | `[data-zpqa="group-by-nav-item"]` |
| Data label | `[data-zpqa="data-label-select"]` |
| Full screen / Show Options / Legends | `workload-report-fullscreen`, `workload-report-options`, `workload-report-legend-detail` |
| Export to PDF | `[data-zpqa="reschart_pdfexport"]` |
| User row | `[data-zpqa^="username-"]` |
| **+ Create Workload Report** | `[data-zpqa="create_customview"]` |
| Custom view row menu (edit, clone, delete) | `[data-zpqa^="cv_extra_options_"]` |

The view dropdown lists 11 predefined views (All Users, Associated Teams, My Team Members, My Direct Reports, My Subordinates, Users by Profile, Users by Role, Unallocated, Under-, Optimally- and Over-Allocated Users) and no custom views yet, so the seed view in section 3 must be created first.

### Create Workload Report form

Fields: Workload Report Name (required), Description, view type Bar / Heatmap / Timeline, then tabs Criteria, Time Period, Grouping, Report Preference; Share Workload Report with other Users; Accessibility › Show Workload Report in other Projects.

| Element | Locator |
| --- | --- |
| Name | `[data-zpqa="input_customviewname"]` |
| Description | `[data-zpqa="cviewdescription"]` |
| Criteria all / any | `input_criteria-all-radio`, `input_criteria-any-radio` |
| Add criteria / clear | `add_cri_row`, `clear_all_criteria` |
| Share checkbox | `[data-zpqa="input_share_cview"]` |
| Other projects checkbox | `[data-zpqa="input_cview_otherproj"]` |
| Save / Cancel | `bt_save_customview`, `bt_cancel_customview` |

The project-level Workload page (Project › Reports) is expected to use the same keys; the agent must confirm this in Phase 2 and record any difference.

## API reference

The V3 API documents nine Workload endpoints: eight reads and one create-or-update. It documents **no delete endpoint** for a custom workload report, so the Delete permission can only be proven in the UI (or through the UI's own network call, captured in Phase 2). All paths are under `/api/v3/portal/[PORTALID]`; pass `project_id` for project-level reports and omit it for global.

| Method | Path | Scope | Purpose and key parameters |
| --- | --- | --- | --- |
| GET | `/reports/workload/meta` | `ZohoProjects.portals.READ` | Report meta. `project_id`, `from_date`, `to_date`, `time_period` (days, weeks, months), `filter`, `view_id` |
| GET | `/reports/workload` | `ZohoProjects.portals.READ` | Report data. Adds `report_based_on`, `page`, `per_page`, `index`, `range`, `fetch_unassignee`, `grouped_ids`, `search_term`, `sort_order`, `next_token` |
| GET | `/reports/workload/details` | `ZohoProjects.portals.READ` | Workload details |
| GET | `/reports/workload/owner/[OWNERID]/details` | `ZohoProjects.portals.READ` | One owner's tasks |
| GET | `/reports/workload/entity/[ENTITYID]/details` | `ZohoProjects.portals.READ` | One task entity. `project_id`, `report_based_on`, `from_date`, `to_date`, `view_id` |
| GET | `/reports/workload/groups` | `ZohoProjects.portals.READ` | Groups. `group_by`, paging, `filter`, `search_term` |
| GET | `/reports/workload/groups/owners` | `ZohoProjects.portals.READ` | Owners across groups |
| GET | `/reports/workload/groups/[GROUPID]/owners` | `ZohoProjects.portals.READ` | Owners in one group |
| PUT | `/reports/custom-workload` | `ZohoProjects.portals.CREATE` | Create (no `id`) or update (`id` = view ID) a custom view. `module` (required), `name` (max 100), `description` (max 255), `view_access_type` (only\_to\_me, public, shared, internal), `project_access_type` (all\_projects, specific\_project, selected\_projects), `is_globally_accessible`, criteria object |

Documented errors on the PUT: `NO_PROJECTS`, `INVALID_PROJECT_IDS` (400), `UNSUPPORTED_MODULE` (400), `INVALID_ENTITY_IDS` (400). The docs list no permission error code, so the suite must record what a View-only user actually gets (expected 401/403 with a permission code) and treat a 200 as a defect.

API expectations per profile:

- **None** — every GET is denied.
- **View** — every GET returns 200; the PUT (create and update) is denied.
- **Manage** — GETs return 200; the PUT returns 200 and the new view appears in the dropdown.
- **Delete only (with View)** — GETs return 200; the PUT is denied.
- **Project-only vs global-only** — calls with `project_id` succeed only for the project-level grant; calls without it succeed only for the global grant.

## Test flow

&#91;embedded content: permission test loop · one pass per profile × level\]

Each of the seven profiles runs this loop once per level; a case passes only when the UI and the API both agree with the matrix in section 2.

## Test cases

40 executions from 23 rows: each scenario below runs twice, once for the Project level (prefix P) and once for Global (prefix G), except the setup and isolation cases. Priority P1 blocks release.

| ID | Profile | Level | Steps | Expected | Layer | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| SET-01 | Admin | Both | Open Setup › Profiles › Project Reports › Workload Reports | View, Manage, Delete rows visible for every profile column; Admin column read-only | UI | P2 |
| SET-02 | Admin | Both | Tick Manage on a profile with View unticked | View auto-ticks, or save is blocked with a message (record which) | UI | P1 |
| SET-03 | Admin | Both | Untick View while Manage and Delete are ticked | Manage and Delete clear, or untick is blocked (record which) | UI | P1 |
| SET-04 | Admin | Both | Change a box, reload the page | Change persists; `rc-checked` matches | UI | P1 |
| P/G-01 | None | each | Open Reports; deep-link to `#zp/reports` | Workload tab hidden; deep link shows no-permission state | UI | P1 |
| P/G-02 | None | each | GET `/reports/workload` | Denied (non-200) | API | P1 |
| P/G-03 | View | each | Open Workload Report; switch Bar, Heatmap, Timeline; change period; Group By; filter | All render; no error toast | UI | P1 |
| P/G-04 | View | each | Open view dropdown | `create_customview` absent or disabled | UI | P1 |
| P/G-05 | View | each | Open seed view menu `cv_extra_options_*` | No Edit, Clone or Delete option | UI | P1 |
| P/G-06 | View | each | PUT `/reports/custom-workload` without `id` | Denied; no new view in dropdown | API | P1 |
| P/G-07 | View | each | PUT with seed view `id` | Denied; seed view unchanged | API | P1 |
| P/G-08 | Manage | each | Create Workload Report: name `QA-WL-<run>`, Heatmap, Save | Saved; appears under My Custom Views | UI | P1 |
| P/G-09 | Manage | each | Edit own view name, Save; then Save as new; then Clone | Each succeeds | UI | P2 |
| P/G-10 | Manage | each | Share view with a View-only user | That user sees it under Shared views but cannot edit it | UI | P2 |
| P/G-11 | Manage | each | PUT create and update | 200; view visible in UI | API | P1 |
| P/G-12 | Manage (no Delete) | each | Open own view menu | Delete option absent | UI | P1 |
| P/G-13 | Delete (no Manage) | each | Open seed view menu; Delete; confirm | View removed; Create still absent | UI | P1 |
| P/G-14 | Full | each | Create, edit, delete a view end to end | All succeed | UI | P2 |
| P/G-15 | View | each | Export to PDF `reschart_pdfexport` | Record actual behaviour (spec is silent) | UI | P3 |
| ISO-01 | ProjOnly | Global | Open Reports › Workload Report | Denied, while project-level Workload works | UI + API | P1 |
| ISO-02 | GlobOnly | Project | Open project › Reports › Workload | Denied, while global Workload works | UI + API | P1 |
| REG-01 | View | each | In chart: + on a user bar, drag a task to another user | Governed by Tasks permissions only; no workload view created | UI | P2 |
| SEC-01 | View | each | Replay the UI's captured delete request as the View user | Denied | API | P1 |

SEC-01 matters because the API docs show no delete endpoint: the agent captures the delete call the UI sends in P/G-13 (via the network log) and replays it with a View-only session.

## Automation architecture

Two modes share one locator map. **Exploration mode**: the AI drives the browser through an MCP server (Playwright MCP `@playwright/mcp`, or Claude in Chrome on a shared session) to analyse pages, capture network calls and confirm locators. **Regression mode**: a committed Playwright Test project runs the cases headless in CI. The AI writes the spec files from what exploration confirmed.

MCP server config for exploration (Claude Code / Claude Desktop):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--browser", "chromium", "--save-trace", "--output-dir", "./mcp-artifacts"]
    }
  }
}
```

Project layout:

```
workload-permissions/
  playwright.config.ts        # one project per profile, storageState per user
  auth/                       # *.json storage states, git-ignored
  locators/zpqa.ts            # the tables in section 4, as constants
  pages/ProfilesPage.ts       # set / read View, Manage, Delete per level
  pages/WorkloadPage.ts       # open, switch chart, create / edit / delete view
  api/workloadApi.ts          # GET + PUT wrappers, returns status + body
  tests/setup.spec.ts         # SET-01..04, run as Admin
  tests/workload.perm.spec.ts # P/G cases, parameterised by profile x level
  tests/isolation.spec.ts     # ISO, REG, SEC
  fixtures/data.ts            # project, tasks, seed views
```

Locator helper — suffix match for random prefixes, regex for IDs:

```ts
export const qa = (page: Page, key: string) => page.locator(`[data-zpqa="${key}"]`);
export const qaEnds = (page: Page, suffix: string) => page.locator(`[data-zpqa$="${suffix}"]`);
export const qaStarts = (page: Page, prefix: string) => page.locator(`[data-zpqa^="${prefix}"]`);
```

Reading a permission checkbox correctly:

```ts
async isTicked(level: 'projectreport' | 'globalreport', profileId: string, perm: 'view' | 'manage' | 'delete') {
  await qaEnds(this.page, `_profile_base_group_${level}`).click();
  await qaEnds(this.page, '_profile_base_menu_workloadreport').click();
  const input = qa(this.page, `input_profile_checkbox_${profileId}_workloadreport_${perm}`);
  return (await input.locator('xpath=ancestor::ruc-checkbox[1]').getAttribute('rc-checked')) === 'true';
}
```

The View-only core assertion, UI plus API in one test:

```ts
test('G-04/G-06 View cannot create a workload view', async ({ page, request }) => {
  await page.goto(`${BASE}#zp/reports`);
  await qa(page, 'tab_resourceutilpage').click();
  await qa(page, 'topbar_cview').click();
  await expect(qa(page, 'create_customview')).toBeHidden();
  const res = await workloadApi(request).putCustomWorkload({ module: 'workload', name: `QA-WL-${RUN}` });
  expect(res.status(), await res.text()).not.toBe(200);
});
```

Rules for the generated code: no hard waits (use web-first assertions); every test cleans up the views it created through an Admin context in `afterEach`; screenshots and traces on failure only; profile changes run serially in the setup project, user tests run in parallel.

## Execution and final report

The agent runs the phases in this order and stops at each gate until a person says go:

1. **Phase 0 — Permission gate.** Confirm test portal, Admin access, approval to edit profiles, and the edition. Gate: written yes.
2. **Phase 1 — Setup.** Clone Employee into the seven QA profiles, set the boxes per section 3, assign users, seed project, tasks and views. Gate: SET-01..04 green.
3. **Phase 2 — Explore.** Through MCP, log in as each user, walk both Workload pages, confirm every locator in section 4, capture the network calls for create, edit and delete.
4. **Phase 3 — Generate.** Write page objects and specs from the confirmed locators.
5. **Phase 4 — Run.** `npx playwright test --reporter=html,json,junit`; retries 1; trace on first retry.
6. **Phase 5 — Triage.** Re-run failures once by hand through MCP; classify as product defect, test defect or environment.
7. **Phase 6 — Report and clean up.** Publish the report below; delete QA views; restore profiles if the run changed shared ones.

Report template the agent fills in:

```markdown
# Workload Report Permissions — Test Report
Run: <run id> · Date: <date> · Build: <app build> · Portal edition: <edition> · Browser: Chromium <ver>

## Verdict
<PASS | FAIL> — <n> of 40 executions passed; <n> P1 defects open.

## Permission matrix result
| Profile | Level | View | Create | Edit | Delete | API GET | API PUT |
| View | Project | pass | blocked | blocked | blocked | 200 | 403 |
...

## Defects
| ID | Case | Severity | Actual vs expected | Evidence (trace, screenshot, HAR) |

## Not tested and why
## Environment notes
## Clean-up confirmation
```

Evidence per failed case: screenshot, Playwright trace zip, the request and response pair for API cases, and the profile checkbox state read at run time.

## Flow run: Global Workload — All Users, favourite, refresh

Run live on the shared Chrome session on 8 Oct 2026 as the portal owner, Global level. **Result: 3 of 4 checks pass, 1 defect** — after Remove from favourite, the dropdown still lists All Users under Favorite Views until the page is reloaded. The counts, names and IDs in the table are what portal `usercustomfield` returned that day; the spec below derives every one of them at runtime (see Dynamic data rules).

| ID | Step | Expected | Actual | Evidence | Result |
| --- | --- | --- | --- | --- | --- |
| WL-G-01 | Reports › Workload Report › `topbar_cview` › pick **All Users** under Predefined Views | Every user loads | 138 rows: Unassigned User + 137 users, first `../../etc/passwd`, last `zvnunpnk`. Loaded lazily in 10 pages of 15 as the list scrolls | `GET /reports/workload?project_id=0&view_id=282542000000643014&index=1..136&range=15` all 200 | Pass |
| WL-G-02 | Click `favourite_icon` (tooltip "Add to Favorite") | View marked favourite and listed under Favorite Views | Toast "Added to favorite"; star filled (`i.zoho-cfs-star.fav`); tooltip turns "Remove Favorite"; dropdown shows a new **Favorite Views** group with All Users | `POST /user-views/282542000000643014/favorite` → 204 | Pass |
| WL-G-03 | Click the star again | View unmarked and gone from Favorite Views | Toast "Removed from favorite"; star outline (`i.zoho-cfs-star-line.unfav`); tooltip "Add to Favorite". **Favorite Views group still lists All Users** until a page reload | `DELETE /user-views/282542000000643014/favorite?module=workload` → 204 | **Fail** |
| WL-G-04 | Scroll the list down (scrollTop 1500), click `refresh_status` (tooltip "Refresh") | Data reloaded; selections kept | Spinner, then grid re-rendered from the top (scrollTop 0, 31 rows, new DOM). View, period, Heatmap, Group By None, Allocated Hours all kept | 4 × `GET /user-views?module=workload` (predefined, created, shared, favourite), `GET /reports/workload/meta`, `GET /reports/workload` index 1 and 16, all 200 | Pass |

**Defect WL-D-01 (minor, UI state):** after Remove from favourite the server call succeeds (204), but the view dropdown keeps the stale Favorite Views group. Steps: add All Users to favourite → open the dropdown (group shows) → close → remove favourite → open the dropdown again. Expected: no Favorite Views group. Actual: group still shows All Users, without a star. A reload clears it.

Locators and network facts this run added:

- Favourite state: `[data-zpqa="favourite_icon"] i` has class `fav` when on and `unfav` when off. Assert on the class, not the tooltip.
- Favorite Views group: `[data-zpqa="cv_exp_col_title_0"]` with text "Favorite Views"; its items are `.cvdrop-group .customview-name[data-tooltip="All Users"]`. When no favourites exist, `cv_exp_col_title_0` is Predefined Views instead, so match on text, not index.
- All Users list container: `.resourceutilTableholder`; rows `[data-zpqa^="username-"]`. Scroll it to the bottom until the row count stops growing before asserting "all loaded".
- `module=workload` is the value the API expects, which answers the open question about the PUT `module` field.

Playwright spec for this flow:

```ts
import { discover, collectOwners } from '../fixtures/discover';

const SELECTIONS = ['topbar_cview', 'topbar_calendar', 'kanban_changecv', 'data-label-select'];
const readSelections = (page: Page) => Promise.all(SELECTIONS.map(k => qa(page, k).innerText()));
const viewItem = (page: Page, group: string, name: string) =>
  page.locator('.cvdrop-group', { has: page.locator('[data-zpqa^="cv_exp_col_title"]', { hasText: group }) })
      .locator(`.customview-name[data-tooltip="${name}"]`);

test.describe('Global Workload — All Users view', () => {
  let ctx: Awaited<ReturnType<typeof discover>>;
  test.beforeEach(async ({ page }) => { ctx = await discover(page); });

  test('WL-G-01 All Users loads every user', async ({ page }) => {
    const allUsers = ctx.views.get('All Users');
    test.skip(!allUsers, 'All Users view not present in this portal');
    const owners = collectOwners(page);
    await qa(page, 'topbar_cview').click();
    await viewItem(page, 'Predefined Views', 'All Users').click();
    await page.waitForResponse(r => r.url().includes(`view_id=${allUsers.id}`));
    const list = page.locator('.resourceutilTableholder');
    const rows = page.locator('[data-zpqa^="username-"]');
    await expect.poll(async () => {
      await list.evaluate(el => (el.scrollTop = el.scrollHeight));
      return owners.done();
    }, { timeout: 120_000 }).toBe(true);
    await expect(rows).toHaveCount(owners.expected());  // UI rows == API owners (+ unassigned)
  });

  test('WL-G-02/03 add and remove favourite', async ({ page }) => {
    const view = ctx.views.get('All Users');
    const star = qa(page, 'favourite_icon').locator('i');
    const favGroup = page.locator('[data-zpqa^="cv_exp_col_title"]', { hasText: 'Favorite Views' });
    if (view.is_favorite) {                      // normalise start state, whatever the portal has
      await qa(page, 'favourite_icon').click();
      await expect(star).toHaveClass(/\bunfav\b/);
    }
    const add = page.waitForResponse(r => r.url().includes(`/user-views/${view.id}/favorite`) && r.request().method() === 'POST');
    await qa(page, 'favourite_icon').click();
    expect((await add).ok()).toBe(true);
    await expect(star).toHaveClass(/\bfav\b/);
    await qa(page, 'topbar_cview').click();
    await expect(viewItem(page, 'Favorite Views', 'All Users')).toBeVisible();
    await page.keyboard.press('Escape');

    const del = page.waitForResponse(r => r.url().includes(`/user-views/${view.id}/favorite`) && r.request().method() === 'DELETE');
    await qa(page, 'favourite_icon').click();
    expect((await del).ok()).toBe(true);
    await expect(star).toHaveClass(/\bunfav\b/);
    await qa(page, 'topbar_cview').click();
    await expect(viewItem(page, 'Favorite Views', 'All Users')).toBeHidden();  // fails today: WL-D-01
  });

  test('WL-G-04 refresh reloads data and keeps selections', async ({ page }) => {
    const before = await readSelections(page);
    const viewId = ctx.meta.custom_view_id;
    const data = page.waitForResponse(r => /reports\/workload\?/.test(r.url()) && r.url().includes(`view_id=${viewId}`) && /[?&]index=1&/.test(r.url()));
    const meta = page.waitForResponse(r => r.url().includes('/reports/workload/meta'));
    const views = page.waitForResponse(r => r.url().includes('/user-views?module=workload'));
    await page.locator('.resourceutilTableholder').evaluate(el => (el.scrollTop = el.scrollHeight / 2));
    await qa(page, 'refresh_status').click();
    for (const r of [await data, await meta, await views]) expect(r.ok()).toBe(true);
    expect(await readSelections(page)).toEqual(before);
    await expect.poll(() => page.locator('.resourceutilTableholder').evaluate(el => el.scrollTop)).toBe(0);
    const firstPage = await (await data).json();
    const firstUser = firstPage.owners[0]?.name;
    if (firstUser) await expect(page.locator('[data-zpqa^="username-"]').filter({ hasText: firstUser }).first()).toBeVisible();
  });
});
```

Why WL-G-01 uses the API as its oracle: in this portal the Users module (All Active Users, invitation Accepted) showed 4 users while the workload listed 137, because the report also counts invited users. Any portal can differ the same way, so the expected count is the sum of `owners[]` across every page the app fetched for that view, plus the unassigned row — never a number and never the Users list.

WL-G-04 checks freshness without a fixed count: the grid must show the first owner the refreshed API page returned, whatever that name is in the portal under test. Unused `favGroup` stays declared in WL-G-02/03 for the version of the check that asserts the whole group disappears once WL-D-01 is fixed.

## Flow run: edit a workload view (all combinations)

Run live on 8 Oct 2026 (a Thursday) on the predefined **All Users** view, Global level, as the portal owner. **63 saves, every one persisted and reopened with the same values; 5 defects found**, the most important being that relative day and week ranges include one extra day. The view was restored afterwards to its original settings: Heatmap, Days, Relative, This Month, Gantt, Allocated Hours, no description.

Path: Reports › Workload Report › `more_actions` (••• next to Refresh) › **Edit** (`edit_customview`). The menu also holds Copy Link (`copylink_customview`), Clone (`clone_customview`), Add to Favorite (`makeFavourite_customview`) and Set as default view (`my_anchor_customview`). The "More Actions" tooltip covers the Edit item when the menu opens, so click by locator, not by position.

What the edit form offers on a predefined view: name locked, Description, view type Bar / Heatmap / Timeline, and two tabs only — Time Period and Report Preference (Criteria and Grouping appear only in Create and Clone). Save sends `PUT /reports/custom-workload` (200) and the page reloads the four `user-views` lists, `meta` and the first data pages.

### Step 1 — description and view type

| Action | Header after save | Reopened form | Result |
| --- | --- | --- | --- |
| Description set, view type Bar | Chart `Bar`, toast "All Users Custom View has been updated." | Description and Bar kept | Pass |
| View type Heatmap | Chart `Heatmap` | Heatmap kept | Pass |
| View type Timeline | Chart `Timeline`; summary column and cell labels gone; months as columns | Timeline kept | Pass |

### Step 2 — Time Period, every option (view type Bar)

Business hours here are 9 h on Monday to Friday, so each summary is working days × 9. Every row below reopened with the same unit, mode and option.

| Unit | Option | Displayed range | Days shown | Summary | Result |
| --- | --- | --- | --- | --- | --- |
| Days | Last 7 Days | 10-01-2026 to 10-08-2026 | 8 | 54 h | **Fail (D-02)** |
| Days | Next 7 Days | 10-08-2026 to 10-15-2026 | 8 | 54 h | **Fail (D-02)** |
| Days | Last 180 Days | 04-11-2026 to 10-08-2026 | 181 | 1161 h | **Fail (D-02)** |
| Days | Next 180 Days | 10-08-2026 to 04-06-2027 | 181 | 1161 h | **Fail (D-02)** |
| Days | This Week | 10-04-2026 to 10-11-2026 | 8 (Sun–Sun) | 45 h | **Fail (D-02)** |
| Days | Last Week | 09-27-2026 to 10-04-2026 | 8, overlaps This Week on Oct 4 | 45 h | **Fail (D-02)** |
| Days | Next Week | 10-11-2026 to 10-18-2026 | 8 | 45 h | **Fail (D-02)** |
| Days | This Month | 10-01-2026 to 10-31-2026 | 31 | 198 h | Pass |
| Days | Last Month | 09-01-2026 to 09-30-2026 | 30 | 198 h | Pass |
| Days | Next Month | 11-01-2026 to 11-30-2026 | 30 | 189 h | Pass |
| Days | Last 3 Months | 07-08-2026 to 10-08-2026 | 93 | 603 h | Check spec (rolling, not calendar) |
| Days | Next 3 Months | 10-08-2026 to 01-08-2027 | 93 | 603 h | Check spec (rolling, not calendar) |
| Days | Custom Oct 12–Nov 6 | 10-12-2026 to 11-06-2026 | 26 | 180 h | Pass |
| Weeks | Last 7 Weeks | 08-23-2026 to 10-10-2026 | 7 weeks Sun–Sat | 315 h | Pass |
| Weeks | Next 7 Weeks | 10-04-2026 to 11-21-2026 | 7 weeks | 315 h | Pass |
| Weeks | Last 15 Weeks | 06-28-2026 to 10-10-2026 | 15 weeks | 675 h | Pass |
| Weeks | Next 15 Weeks | 10-04-2026 to 01-16-2027 | 15 weeks | 675 h | Pass |
| Weeks | Last 25 Weeks | 04-19-2026 to 10-10-2026 | 25 weeks | 1125 h | Pass |
| Weeks | Next 25 Weeks | 10-04-2026 to 03-27-2027 | 25 weeks | 1125 h | Pass |
| Weeks | This Month | 10-01-2026 to 10-31-2026 | 31 | 225 h (Days unit: 198 h) | **Fail (D-03)** |
| Weeks | Last Month | 09-01-2026 to 09-30-2026 | 30 | 225 h (Days unit: 198 h) | **Fail (D-03)** |
| Weeks | Next Month | 11-01-2026 to 11-30-2026 | 30 | 225 h (Days unit: 189 h) | **Fail (D-03)** |
| Weeks | Custom wk 42–47 | 10-11-2026 to 11-21-2026 | 6 weeks | 270 h | Pass |
| Months | Last 3 Months | 08-01-2026 to 10-31-2026 | Aug–Oct | 585 h | Pass |
| Months | Next 3 Months | 10-01-2026 to 12-31-2026 | Oct–Dec | 594 h | Pass |
| Months | Last 6 Months | 05-01-2026 to 10-31-2026 | May–Oct | 1179 h | Pass |
| Months | Next 6 Months | 10-01-2026 to 03-31-2027 | Oct–Mar | 1170 h | Pass |
| Months | Custom Nov 2026–Jan 2027 | 11-01-2026 to 01-31-2027 | Nov–Jan | 585 h | Pass; picker shows **D-06** |

Option lists observed: Days has 12 relative options; Weeks has 9 (Last/Next 7, 15, 25 Weeks; This, Last, Next Month); Months has 4 (Last/Next 3 and 6 Months). Every unit has Relative and Custom. Switching to Custom pre-fills a default per unit (Days: current month; Weeks: 10-04 to 11-14; Months: 10-01-2026 to 03-31-2027), not the previous relative range.

### Step 3 — Report Preference

What the tab holds depends on the view type: Bar and Heatmap show Task Expanded View Style (Gantt / Timeline) and Data Label; Timeline shows Data Label and Show Options (Task Title, Project Title). Data Label has 9 options in the Days unit and 11 in Weeks or Months (adds Allocated Man Weeks and Available Man Weeks).

| Setting | Saved as | Verified in UI | Result |
| --- | --- | --- | --- |
| View style Timeline (Bar) | Timeline | Show Options panel (`workload-report-options`) shows Timeline selected; reopened form keeps it | Pass |
| View style Gantt (Heatmap) | Gantt | Reopened form keeps it | Pass |
| Show Options Task Title + Project Title (Timeline type) | Both ticked | Reopened form keeps both | Pass |

Data labels, Months unit, range Nov 2026 – Jan 2027 (no tasks are allocated in this portal, so Allocated values are zero):

| Data label | Cell format (Bar and Heatmap) | Summary column | Timeline type header | Result |
| --- | --- | --- | --- | --- |
| No Legend | empty cells | 585 hours | No Legend | Pass |
| Allocated Hours | 0h | 585 hours | Allocated Hours | Pass |
| Allocated Minutes | 0m | 585 hours | Allocated Minutes | Minor (D-05) |
| Allocated Man Days | 0d | 65 Man Days | Allocated Man Days | Pass |
| Allocated Man Weeks | 0w | 13 Man Weeks | Allocated Man Weeks | Pass |
| Allocated Percentage | 0% | 26.49 % | Allocated Percentage | **Fail (D-04)** |
| Available Hours | 189h / 207h per month | 585 hours | Available Hours | Pass |
| Available Minutes | 11340m / 12420m | 585 hours | Available Minutes | Minor (D-05) |
| Available Man Days | 21d / 23d | 65 Man Days | Available Man Days | Pass |
| Available Man Weeks | 4.2w / 4.6w | 585 hours | Available Man Weeks | **Fail (D-05)** |
| Available Percentage | 100% | 26.49 % | Available Percentage | **Fail (D-04)** |

### Defects from this run

| ID | Severity | Summary | Expected | Actual |
| --- | --- | --- | --- | --- |
| WL-D-02 | Major | Days-unit relative ranges are one day too long | Last 7 Days = 7 days; This Week = Sun–Sat (Oct 4–10); Last Week ends the day before This Week starts | 8-day windows; This Week Oct 4–11; Last Week Sep 27–Oct 4 overlaps This Week; 180 Days = 181 days. API confirms (`to_date` 23:59:59 of the extra day). Weeks unit is correct. |
| WL-D-03 | Major | Weeks unit + month options: total disagrees with displayed range | Summary for Oct 1–31 = 198 h (22 working days) | 225 h = 5 whole weeks (Sep 27–Oct 31) while the header still says Oct 1–Oct 31 |
| WL-D-04 | Major | Percentage summary is unexplained | Allocated % summary 0 % when every cell is 0 %; Available % 100 % | Both show 26.49 % |
| WL-D-05 | Minor | Summary unit does not follow the label | Minutes → minutes; Available Man Weeks → man weeks | "585 hours" for both Minutes labels and for Available Man Weeks (Allocated Man Weeks correctly shows "13 Man Weeks") |
| WL-D-06 | Minor | Custom month picker shows the wrong year on the end calendar | End panel opens on 2027 for a range ending Mar 2027 | End panel opens on 2026 and highlights Mar in both years |

### Re-verification of D-02, D-03, D-05, D-06

Re-run on 8 Oct 2026 in a fresh page load, checking each defect through three independent layers where possible: the header text, the grid's own column dates (read from each column's tooltip), and the `from_date` / `to_date` the app sent to `GET /reports/workload`. **All four reproduce.** D-03 is narrower and clearer than first reported, and D-06 is cosmetic only.

| ID | Verdict | Evidence from the second run |
| --- | --- | --- |
| WL-D-02 | **Confirmed** | Last 7 Days: header 10-01 to 10-08, API 2026-10-01 → 2026-10-08T23:59:59, grid columns Oct 1 … Oct 8. Next Week: grid has 8 day columns, Sun Oct 11 … Sun Oct 18. This Week: 8 columns Oct 4 … Oct 11. Last Week: 8 columns Sep 27 … Oct 4, so Oct 4 appears in both Last Week and This Week. Last 180 Days: 181 grid columns, Apr 11 … Oct 8. Header, grid and API agree, so the extra day is in the range the app computes, not a display rounding. |
| WL-D-03 | **Confirmed, refined** | Weeks unit + This Month: API sends Oct 1 → Oct 31, but the grid buckets weeks from the range start (Thursday) instead of the week start (Sunday): Oct 1–7, 8–14, 15–21, 22–28, **Oct 29 – Nov 4**. The last bucket runs 4 days past the range and is filled as a full week (45 h available, though only Oct 29–30 are in range = 18 h). Result: header total 225 hours and weekly cells 5 × 45 h, while the same user's row total says 198 h. Man Days disagrees too: row total 25d (= 225 h) against 198 h in the Hours label. |
| WL-D-05 | **Confirmed** | Weeks unit, This Month: Available Minutes → header "225 hours", row 11880m; Available Man Weeks → header "225 hours", row 5w; Allocated Minutes → header "225 hours". By contrast Allocated Man Weeks → "5 Man Weeks" and Available Man Days → "25 Man Days" do convert. Days unit: Available Minutes → header "198 hours", row 11880m. So the header summary never converts for either Minutes label or for Available Man Weeks, in any unit. |
| WL-D-06 | **Confirmed, cosmetic** | Months + Custom with saved value 10-01-2026 to 03-31-2027: the end panel opens on **2026** with Mar highlighted. Clicking OK without changes keeps 03-31-2027, so the saved range is not corrupted; only the picker's year display is wrong. |

Suggested severity after re-verification: D-02 Major (wrong data window for 7 of 12 Days options), D-03 Major (header total and weekly cells overstate availability by 27 h for October), D-05 Minor, D-06 Trivial.

What the automation should assert so these stay caught, with nothing hardcoded: the header range, the first and last grid column date (`Date: MM-DD-YYYY` in each column tooltip) and the API `from_date` / `to_date` must all equal `expectedRange()`; no grid column may start before or end after the range; the header summary must equal the sum of the user rows' totals; and the header unit must match the selected data label (minutes → `m`, man weeks → `Man Weeks`).

### Automating this flow without fixed values

The expected range is computed from the run date and the portal's own settings, never typed in: week start from the calendar header, business hours from `meta.default_business_hours_details.working_day_availability` (minutes per weekday), option lists read from the open dropdown.

```ts
// Expected window for relative options, from today in the portal's time zone
function expectedRange(unit: 'days'|'weeks'|'months', option: string, today: Date, weekStartsOn = 0) {
  const d = (y: number, m: number, day: number) => new Date(y, m, day);
  const add = (x: Date, n: number) => new Date(x.getFullYear(), x.getMonth(), x.getDate() + n);
  const sow = add(today, -((today.getDay() - weekStartsOn + 7) % 7));
  const y = today.getFullYear(), m = today.getMonth();
  const n = Number(option.match(/\d+/)?.[0] ?? 0);
  if (/^This Week$/.test(option)) return [sow, add(sow, 6)];
  if (/^Last Week$/.test(option)) return [add(sow, -7), add(sow, -1)];
  if (/^Next Week$/.test(option)) return [add(sow, 7), add(sow, 13)];
  if (/^This Month$/.test(option)) return [d(y, m, 1), d(y, m + 1, 0)];
  if (/^Last Month$/.test(option)) return [d(y, m - 1, 1), d(y, m, 0)];
  if (/^Next Month$/.test(option)) return [d(y, m + 1, 1), d(y, m + 2, 0)];
  if (unit === 'days' && /Days$/.test(option)) return option.startsWith('Last') ? [add(today, -(n - 1)), today] : [today, add(today, n - 1)];
  if (unit === 'weeks') return option.startsWith('Last') ? [add(sow, -7 * (n - 1)), add(sow, 6)] : [sow, add(sow, 7 * n - 1)];
  if (unit === 'months') return option.startsWith('Last') ? [d(y, m - n + 1, 1), d(y, m + 1, 0)] : [d(y, m, 1), d(y, m + n, 0)];
  throw new Error(`No rule for ${unit} / ${option} — confirm the spec`);
}

test.describe('Edit view — every time period', () => {
  for (const unit of ['days', 'weeks', 'months'] as const) {
    test(`relative options — ${unit}`, async ({ page }) => {
      const wl = new WorkloadEditPage(page);
      await wl.openEdit();                          // more_actions › edit_customview
      await wl.setUnit(unit);
      const options = await wl.relativeOptions();   // read from the dropdown, never hardcoded
      await wl.cancel();
      for (const option of options) {
        await wl.openEdit();
        await wl.setUnit(unit);
        await wl.pickRelative(option);
        await wl.save();                            // waits for PUT /reports/custom-workload 200
        const [from, to] = expectedRange(unit, option, new Date());
        await expect(qa(page, 'topbar_calendar')).toHaveText(`${fmt(from)} to ${fmt(to)}`);
        await wl.openEdit();
        expect(await wl.formState()).toMatchObject({ unit, mode: 'Relative', option });
        await wl.cancel();
      }
    });
  }
});
```

The 3-month Days options roll from today (Jul 8 – Oct 8). `expectedRange` throws for them until the spec confirms rolling or calendar months, so the test can't silently pass on a guess. Restore the view's original settings in `afterAll`, read from `formState()` before the first change.

## Flow run: All Users edit — remaining gaps

Second pass on the same predefined **All Users** view (Global, 8 Oct 2026), closing the gaps left by the first edit run. Starting saved state found: Heatmap, Weeks › Relative › This Month, Gantt, No Legend (it had been changed since the first run's restore); the toolbar also held unsaved changes ("All Users \*", Available Minutes), which the first save cleared.

### Gap 1 — every data label in the Days and Weeks units (Bar, This Month)

All 20 saves kept their label in the header and on reopen. Days offers 9 labels, Weeks 11 (adds both Man Weeks).

| Data label | Days: header total | Days: user row | Weeks: header total | Weeks: user row | Result |
| --- | --- | --- | --- | --- | --- |
| No Legend | — | empty | 225 hours | empty | Pass |
| Allocated Hours | 198 hours | 0h cells | 225 hours | 0h | Weeks total: D-03 |
| Allocated Minutes | **198 hours** | 0m | **225 hours** | 0m | D-05 (also Allocated, also Days) |
| Allocated Man Days | 22 Man Days | 0d | **25 Man Days** | 0d | Weeks: D-03 |
| Allocated Man Weeks | not offered | — | 5 Man Weeks | 0w | Pass (unit) |
| Allocated Percentage | **26.61 %** | 0% | **30.24 %** | 0% | D-04 |
| Available Hours | 198 hours | 198h total, 9h / 0h per day | 225 hours | 198h total, 45h per week | Weeks: D-03 |
| Available Minutes | **198 hours** | 11880m, 540m per day | **225 hours** | 11880m, 2700m per week | D-05 |
| Available Man Days | 22 Man Days | 22d, 1d per day | **25 Man Days** | 25d, 5d per week | Weeks: D-03 |
| Available Man Weeks | not offered | — | **225 hours** | 5w, 1w per week | D-05 |
| Available Percentage | **26.61 %** | 100% total, 100% / 0% per day | **30.24 %** | 100% | D-04 |

New evidence: D-05 also affects **Allocated** Minutes, not only Available; D-04's percentage changes with the period (26.49 % for Nov–Jan, 26.61 % for Oct in Days, 30.24 % for Oct in Weeks) while every cell is 0 % or 100 %.

### Gap 2 — every Relative period with Heatmap and Timeline

50 saves (25 per view type: 12 Days, 9 Weeks, 4 Months). For every option, header, grid columns, API `from_date` / `to_date` and `time_period` matched each other and matched the Bar results from the first run exactly; chart type stayed as saved.

| Unit | Heatmap | Timeline | Notes |
| --- | --- | --- | --- |
| Days (12) | Same ranges as Bar | Same ranges as Bar | **D-02 reproduces in both**: Last/Next 7 Days 8 columns, This/Last/Next Week Sun–Sun 8 columns, Last/Next 180 Days 181 columns. This/Last/Next Month correct (31/30/30). Last/Next 3 Months rolling (07-08→10-08, 10-08→01-08) |
| Weeks (9) | Same as Bar | Same as Bar | Last/Next 7, 15, 25 Weeks correct Sun–Sat buckets. **D-03 reproduces in both** and for all three month options: This Month ends Oct 29 – Nov 4, Last Month Sep 29 – Oct 5, Next Month Nov 29 – Dec 5 |
| Months (4) | Same as Bar | Same as Bar | Month columns exactly as expected (e.g. Next 6 Months: Oct 2026 … Mar 2027) |

Timeline type shows no summary column, so header totals are only checked on Bar and Heatmap.

### Gaps 3–8 — results

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 3a | Show Options appear on Bar and Heatmap when view style = Timeline | Pass | Form shows Task Title / Project Title under the style when Timeline is chosen; hidden with Gantt |
| 3b | Tick both on Bar (style Timeline), save, reopen | Pass | Kept ticked; toolbar Show Options panel also shows Timeline + both ticked |
| 3c | Untick both on Bar, save, reopen | Pass | Kept unticked |
| 3d | Tick / untick on Heatmap (style Timeline), save, reopen | Pass | Both directions kept |
| 3e | Untick on Timeline type, save, reopen | Pass | Kept unticked |
| 3f | Show Options shared across view types | Observed | Values set on Heatmap appear on Timeline type unsaved; form says "Task Title / Project Title", the toolbar panel says "Title / Project Name" (label mismatch, cosmetic) |
| 4a | Days custom, single day (Oct 15 – Oct 15) | Pass | Header 10-15 to 10-15, 1 column, API 10-15 → 10-15, 9 hours, kept on reopen |
| 4b | Days custom across the year (Dec 28 2026 – Jan 5 2027) | Pass | 9 columns, API 2026-12-28 → 2027-01-05, 63 hours (7 working days) |
| 4c | Picker Cancel after clicking new dates | Pass | Range stays 12-28-2026 to 01-05-2027 |
| 4d | Reopen the picker after Cancel or OK in the same form | **Fail — WL-D-07** | Field click does nothing until the form is closed and Edit reopened |
| 4e | Days “Current Month” link | Pass | Sets 10-01-2026 to 10-31-2026 and closes the picker |
| 4f | Weeks custom, single week by clicking the same week twice (or its Sun then Sat) | **Pass via end calendar (WL-D-10 improvement)** | Two clicks on the left calendar only move the start (10-18 to 11-14); picking the same week on the right (end) calendar does give a one-week range — see WL-D-10 correction |
| 4g | Weeks “Current Week” link | Pass | 10-04 to 10-10, 1 bucket, 45 hours, kept on reopen |
| 4h | Months custom, single month (Nov – Nov 2026) | Pass | 11-01 to 11-30, 1 month column, 189 hours, kept on reopen |
| 4i | Months “Current Month” link | Pass | Sets 10-01-2026 to 10-31-2026 |
| 5 | Cancel discards unsaved description, view type and range | Pass | No `PUT /reports/custom-workload` sent; header unchanged; reopened form shows the saved values |
| 6a | Description length | Pass | `maxlength=255`; a 301-character entry is cut to 255, saved and reloaded as 255 |
| 6b | HTML and special characters (`<b>`, `<img>`, quotes, é, ñ, ₹, backslash) | Pass | Saved as text, nothing rendered as HTML |
| 6c | Emoji in description | **Fail — WL-D-08** | Typed “emoji 😀 test”, saved and reloaded as “emoji ? test” |
| 7 | Name field locked on the predefined view | Pass | Input is `disabled`; clicking and typing leaves “All Users” |
| 8a | Toolbar change after a saved edit shows unsaved state | Pass | View name becomes “All Users \*” and a “Save as” button appears (menu: New Workload Report, Discard) |
| 8b | Edit form ignores unsaved toolbar changes | Pass | Toolbar Timeline / moved period, Edit still shows saved Heatmap / range |
| 8c | Discard | Pass | Toolbar returns to the saved view; “\*” and Save as disappear |
| 8d | Unsaved toolbar state across navigation | Observed | Survives in-app navigation; cleared by a full page reload; cleared by any Edit save |
| 8e | Period arrows step by the selected range | **Fail — WL-D-09** | Months custom Nov 2026 → next gives 12-01-2026 to 05-31-2027 (6 months), back gives 06-01 to 11-30-2026. Weeks This Month (Oct) → next gives Nov 1–7, back gives Sep 20–26, back again Aug 9–15 |

The view was restored to the state found at the start of this pass (Heatmap, Weeks › Relative › This Month, Gantt, No Legend, Show Options ticked, empty description) and confirmed by reopening Edit; the toolbar was discarded back to the saved view.

### Third pass — remaining combinations

Run on the same All Users view. Saved state found at the start had changed again since the last pass: Heatmap, Weeks › Custom 10-11-2026 to 10-17-2026, Gantt, No Legend, Show Options off, empty description (toolbar also held unsaved changes, cleared by the first save). It was restored to exactly that at the end and confirmed by reopening Edit.

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1a | Every data label, Heatmap, Days (This Month) | Pass (9/9 kept) | Same values as Bar: 198 hours, 22 Man Days; D-04 26.61 % and D-05 “198 hours” for both Minutes labels reproduce |
| 1b | Every data label, Heatmap, Weeks (This Month) | Pass (11/11 kept) | Same as Bar: 225 hours (D-03), 25 Man Days, 5 Man Weeks; D-04 30.24 %; D-05 for both Minutes and Available Man Weeks |
| 1c | Every data label, Timeline, Weeks | Pass (11/11 kept) | Header label and reopened form match; Timeline has no summary column or cell values, so no totals to check |
| 1d | Every data label, Timeline, Days | Pass (9/9 kept) | As above |
| 1e | Label not offered in the new unit (Available Man Weeks, then switch Weeks → Days) | Observed | Label silently resets to No Legend before saving; saved and reopened as No Legend. No message tells the user |
| 2 | Custom range with the Timeline view type (Days, Apr 12 – Oct 11 2026) | Pass | Header 04-12-2026 to 10-11-2026, 183 day columns, API 2026-04-12 → 2026-10-11, kept on reopen |
| 3 | Picker » and « year jumps | Pass | Oct/Nov 2026 → » → Oct/Nov 2027; « → 2026; « → 2025; both panels move together |
| 4 | Very long custom range | **Fail — WL-D-11** | From start Oct 13 2025 the picker enables end dates up to Apr 17 2026 (187 days); choosing Apr 17 and OK shows the toast “Custom date range should be within 6 months” and the picker stays open. A 183-day range (Apr 12 – Oct 11) is accepted |
| 5 | Double-click Save | **Fail — WL-D-12** | Two `PUT /reports/custom-workload` requests (both 200) for one double-click; no error shown, final state correct. On an edit this is harmless; on Create it risks duplicate views |

Correction to WL-D-10: a one-week custom range **can** be picked. The Weeks picker has independent start (left) and end (right) calendars; choosing the start week on the left and the same week on the right gives 10-11-2026 to 10-17-2026. Two clicks on the left calendar only move the start, unlike the Days picker where two clicks on the same calendar set start and end. Reclassified as an Improvement (Trivial): make the end panel behaviour discoverable or consistent with Days.

## Bug reports

Nine bugs and one improvement are open. Bugs: three Major, five Minor, one Trivial. All were found on 8 Oct 2026 (D-02 to D-06 re-verified in a second pass, D-07 to D-12 reproduced at least twice or in two set-ups) in portal `usercustomfield` (Global Workload Report, All Users view), checked through the header, the grid columns and the API request where they apply. Update Status here as they move.

| ID | Title | Type | Severity | Status | Found / re-verified |
| --- | --- | --- | --- | --- | --- |
| WL-D-02 | Days-unit relative ranges are one day too long | Bug | Major | Open | 8 Oct 2026 / 8 Oct 2026 (also Heatmap, Timeline) |
| WL-D-03 | Weeks › This Month: last week runs past the month and inflates the total | Bug | Major | Open | 8 Oct 2026 / 8 Oct 2026 (also Last/Next Month, Heatmap) |
| WL-D-05 | Header total stays in hours for Minutes and Available Man Weeks | Bug | Minor | Open | 8 Oct 2026 / 8 Oct 2026 (also Allocated Minutes, Heatmap) |
| WL-D-06 | Month picker end calendar shows the start year | Bug | Trivial | Open | 8 Oct 2026 / 8 Oct 2026 |
| WL-D-07 | Custom date picker cannot be reopened after OK or Cancel in the same form | Bug | Minor | Open | 8 Oct 2026 (reproduced 3×) |
| WL-D-08 | Emoji in description saved as “?” | Bug | Minor | Open | 8 Oct 2026 (reproduced 2×) |
| WL-D-09 | Toolbar period arrows do not step by the selected range | Bug | Major | Open | 8 Oct 2026 (Months and Weeks) |
| WL-D-10 | Weeks picker: second click on the start calendar does not set the end (end must be picked on the right calendar) | Improvement | Trivial | Open | 8 Oct 2026, reclassified from Bug in the third pass |
| WL-D-11 | Picker enables end dates beyond the 6-month limit that OK then rejects | Bug | Minor | Open | 8 Oct 2026 (two start dates) |
| WL-D-12 | Double-click on Save sends two save requests | Bug | Minor | Open | 8 Oct 2026 |

Common preconditions for every report below: user with Workload View + Manage (Admin used); business hours Mon–Fri 9 h; week starts Sunday; values shown are for Thu 8 Oct 2026 and shift with the run date. Record the view's settings before reproducing and restore them afterwards (All Users original: Heatmap, Days › Relative › This Month, Gantt, Allocated Hours, no description).

### Bug WL-D-02 — Days-unit relative ranges are one day too long

Type: Bug · Severity: Major · Status: Open · Area: Global Workload Report › Edit › Time Period · Affects 7 of 12 Days options (Last/Next 7 Days, Last/Next 180 Days, This/Last/Next Week).

Steps to reproduce:

1. Go to Reports › Workload Report and pick **All Users** in the view dropdown.
2. Click ••• next to Refresh › **Edit** (first menu item; partly hidden under the tooltip).
3. Open the **Time Period** tab, choose **Days** › **Relative** › **Last 7 Days**, click **Save**.
4. Read the header date range and count the day columns in the grid (each column tooltip shows its date).
5. Optional: in DevTools › Network, open the `GET /reports/workload?…index=1…` request and read `from_date` and `to_date`.
6. Repeat steps 2–5 with **This Week**, **Last Week** and **Last 180 Days**.

| Option | Expected | Actual |
| --- | --- | --- |
| Last 7 Days | 10-02-2026 to 10-08-2026, 7 columns | 10-01-2026 to 10-08-2026, 8 columns; API 2026-10-01 → 2026-10-08T23:59:59 |
| This Week | Sun 10-04 to Sat 10-10 | 10-04 to 10-11 (Sunday to Sunday, 8 columns) |
| Last Week | 09-27 to 10-03 | 09-27 to 10-04, so Oct 4 is in both Last Week and This Week |
| Last 180 Days | 180 columns | 181 columns (04-11 to 10-08) |

Impact: every Days-unit window reports one extra day of capacity and allocation, and consecutive weeks double-count their shared Sunday. Header, grid and API all agree, so the range itself is computed wrong, not just displayed. The same options in the Weeks unit are correct.

### Bug WL-D-03 — Weeks › This Month: last week runs past the month and inflates the total

Type: Bug · Severity: Major · Status: Open · Area: Global Workload Report, Weeks unit with month-based options (This / Last / Next Month).

Steps to reproduce:

1. Reports › Workload Report › **All Users** › ••• › **Edit**.
2. **Time Period** tab: choose **Weeks** › **Relative** › **This Month**.
3. **Report Preference** tab: set **Data Label** to **Available Hours**. Click **Save**.
4. Read the week column headers, the header total in the summary column, and the first user's row total.
5. Change **Data Label** to **Available Man Days**, save, and read the first user's row total again.

| Check | Expected | Actual |
| --- | --- | --- |
| Week columns | Inside Oct 1–31 (e.g. Oct 1–3, then Sun–Sat weeks to Oct 31) | Oct 1 - Oct 7, 8 - 14, 15 - 21, 22 - 28, **Oct 29 - Nov 4**; each 45h |
| Header total | 198 hours (22 working days × 9 h) | **225 hours** |
| User row total (Hours) | 198h | 198h (correct) |
| User row total (Man Days) | 22d | **25d** |

Impact: weeks are bucketed from the range start (Thursday) instead of the week start, and the last bucket counts Nov 2–4 as part of October. The header total and every weekly cell overstate October by 27 h, and the header no longer equals the users' totals. The API request itself is correct (`from_date` 2026-10-01, `to_date` 2026-10-31). Last Month and Next Month show the same pattern (225 h vs 198 h and 189 h in the Days unit).

### Bug WL-D-05 — Header total stays in hours for Minutes and Available Man Weeks

Type: Bug · Severity: Minor · Status: Open · Area: Global Workload Report › summary column, all units.

Steps to reproduce:

1. Reports › Workload Report › **All Users** › ••• › **Edit** › **Time Period**: **Weeks** › **Relative** › **This Month**. Save.
2. ••• › **Edit** › **Report Preference** › **Data Label** › **Available Minutes**. Save. Read the header total and the first user's row.
3. Repeat with **Available Man Weeks**.
4. For comparison, repeat with **Allocated Man Weeks** and **Available Man Days**.
5. Switch to **Days** › **This Month** and repeat step 2.

| Data label | Expected header | Actual header | User row |
| --- | --- | --- | --- |
| Available Minutes (Weeks) | minutes | **225 hours** | 11880m |
| Allocated Minutes (Weeks) | minutes | **225 hours** | 0m |
| Available Man Weeks (Weeks) | Man Weeks | **225 hours** | 5w |
| Allocated Man Weeks (Weeks) | Man Weeks | 5 Man Weeks (correct) | 0w |
| Available Man Days (Weeks) | Man Days | 25 Man Days (correct unit) | 25d |
| Available Minutes (Days) | minutes | **198 hours** | 11880m |

Impact: the header total's unit does not match the selected label, so it cannot be compared with the cells. Man Days and Allocated Man Weeks convert correctly, so the fault is limited to both Minutes labels and Available Man Weeks.

### Bug WL-D-06 — Month picker end calendar shows the start year

Type: Bug · Severity: Trivial (display only) · Status: Open · Area: Edit › Time Period › Months › Custom date picker.

Steps to reproduce:

1. Reports › Workload Report › **All Users** › ••• › **Edit** › **Time Period**.
2. Choose **Months** › **Custom**. The range fills in as 10-01-2026 to 03-31-2027 (if not, pick Oct 2026 to Mar 2027 and Save, then reopen Edit).
3. Click the date range field to open the picker.
4. Look at the right-hand (end) calendar; then click its › arrow to move to the next year.
5. Click **OK** without changes and read the range field.

| Check | Expected | Actual |
| --- | --- | --- |
| End calendar on open | **2027**, Mar selected | **2026**, Mar highlighted |
| End calendar after › | 2027, Mar selected | 2027, Mar highlighted too (marked in both years) |
| Range after OK | 10-01-2026 to 03-31-2027 | 10-01-2026 to 03-31-2027 (unchanged) |

Impact: misleading picker state that can make a user re-pick the end month; the saved range is not corrupted.

### Bug WL-D-07 — Custom date picker cannot be reopened after OK or Cancel

Type: Bug · Severity: Minor · Status: Open · Area: Edit › Time Period › Custom (seen in Days; same picker component in Weeks and Months).

Steps to reproduce:

1. Reports › Workload Report › **All Users** › ••• › **Edit** › **Time Period** › **Days** › **Custom**.
2. Click the date range field. The picker opens.
3. Click **Cancel** in the picker (or **OK**).
4. Click the date range field again. Optionally click elsewhere or press Tab first, then click it again.

| Expected | Actual |
| --- | --- |
| The picker opens again so the range can be adjusted | Nothing happens; the picker only opens again after closing the form (Cancel) and reopening Edit |

Impact: a user who wants to correct a custom range must discard the whole form and start again.

### Bug WL-D-08 — Emoji in the description is saved as “?”

Type: Bug · Severity: Minor · Status: Open · Area: Edit › Description (save).

Steps to reproduce:

1. Reports › Workload Report › **All Users** › ••• › **Edit**.
2. In **Description**, type `emoji 😀 test`. The field shows the emoji (code point U+1F600).
3. Click **Save**, then reopen ••• › **Edit**.

| Expected | Actual |
| --- | --- |
| `emoji 😀 test` | `emoji ? test` (the emoji is replaced by “?”, U+003F) |

Other characters round-trip correctly: `<b>`, `<img>`, quotes, é, ñ, ₹ and backslash are kept as text. Likely cause: 4-byte UTF-8 characters are not stored (non-utf8mb4 column or encoding step). Impact: silent data loss in user text.

### Bug WL-D-09 — Toolbar period arrows do not step by the selected range

Type: Bug · Severity: Major · Status: Open · Area: Workload Report toolbar › previous / next period arrows (`cal_left_arrow`, `cal_right_arrow`).

Steps to reproduce (Months):

1. ••• › **Edit** › **Time Period** › **Months** › **Custom** › Nov 2026 to Nov 2026. Save. Header: 11-01-2026 to 11-30-2026.
2. Click the **›** (next) arrow next to the date range.
3. Click **‹** (previous) once, then again.

Steps to reproduce (Weeks):

1. ••• › **Edit** › **Time Period** › **Weeks** › **Relative** › **This Month**. Save. Header: 10-01-2026 to 10-31-2026.
2. Click **›** once, then **‹** twice.

| Start | Action | Expected | Actual |
| --- | --- | --- | --- |
| Months, Nov 2026 | › | 12-01-2026 to 12-31-2026 | **12-01-2026 to 05-31-2027** (6 months) |
| (after ›) | ‹ | Back to 11-01-2026 to 11-30-2026 | **06-01-2026 to 11-30-2026** |
| (after ‹) | ‹ | 10-01-2026 to 10-31-2026 | **12-01-2025 to 05-31-2026** |
| Weeks, Oct 1–31 | › | 11-01-2026 to 11-30-2026 | **11-01-2026 to 11-07-2026** (one week) |
| (after ›) | ‹ | Back to 10-01-2026 to 10-31-2026 | **09-20-2026 to 09-26-2026** |
| (after ‹) | ‹ | 09-01-2026 to 09-30-2026 | **08-09-2026 to 08-15-2026** |

Impact: › then ‹ does not return to where the user started, and the window size changes with each click, so users cannot page through periods reliably. The toolbar shows “All Users \*” after each click; **Save as › Discard** restores the saved view.

### Improvement WL-D-10 — Weeks picker: second click on the start calendar does not set the end

Type: Improvement (reclassified from Bug) · Severity: Trivial · Status: Open · Area: Edit › Time Period › Weeks › Custom picker.

Steps to reproduce:

1. ••• › **Edit** › **Time Period** › **Weeks** › **Custom** (pre-filled 10-04-2026 to 11-14-2026).
2. Open the picker and click any day of the week Oct 18–24, then click a day of the same week again (or Sun Oct 18 then Sat Oct 24).
3. Click **OK** and read the range field.

| Expected | Actual |
| --- | --- |
| 10-18-2026 to 10-24-2026 (one week) | **10-18-2026 to 11-14-2026**: only the start moved, the old end stayed |

Workaround: the **Current Week** link sets a one-week range (10-04 to 10-10) correctly. By contrast, in Days clicking the same date twice gives a valid one-day range, and in Months picking the same month on both panels gives a valid one-month range.

Correction (third pass): the Weeks picker has independent start (left) and end (right) calendars. Picking Oct 11–17 on the left and the same week on the right (move the right calendar back to Oct with its ‹) gives 10-11-2026 to 10-17-2026 correctly. The remaining issue is discoverability and consistency: in the Days picker, two clicks on the same calendar set start and end; in Weeks the second click only moves the start, with no hint.

### Bug WL-D-11 — Picker enables end dates beyond the 6-month limit that OK then rejects

Type: Bug · Severity: Minor · Status: Open · Area: Edit › Time Period › Days › Custom picker (seen on Timeline and Heatmap).

Steps to reproduce:

1. ••• › **Edit** › **Time Period** › **Days** › **Custom**, open the picker.
2. Click **«** to Oct 2025 and click **Oct 13 2025** as the start.
3. Click **›** to Apr 2026. Dates up to **Apr 17 2026** are enabled; Apr 18 onwards are disabled.
4. Click **Apr 17 2026**, then **OK**.

| Expected | Actual |
| --- | --- |
| Only dates that pass the limit are enabled (end ≤ 6 months after start), or OK accepts every enabled date | Toast “Custom date range should be within 6 months”; picker stays open, range unchanged. Same pattern from start Apr 12 2026: enabled up to Oct 15 2026, while Oct 11 2026 (183 days) is accepted |

Impact: users can select an end date the form will refuse; the enabled window (start + 186 days) and the validation (6 months) disagree.

### Bug WL-D-12 — Double-click on Save sends two save requests

Type: Bug · Severity: Minor · Status: Open · Area: Edit form › Save (`bt_save_customview`).

Steps to reproduce:

1. ••• › **Edit**, change **Data Label** (e.g. to Allocated Hours).
2. Open DevTools › Network, filter `custom-workload`.
3. Double-click **Save**.

| Expected | Actual |
| --- | --- |
| One `PUT /reports/custom-workload`; Save disabled while it runs | Two PUT requests, both 200; no message; final state correct |

Impact: harmless for Edit (same payload twice), but the same button pattern on Create Workload Report could create duplicate views; not reproduced on Create to avoid leaving records.

## Risks and open questions

- [ ] Does ticking Manage or Delete without View auto-enable View, and does unticking View clear the others? (SET-02, SET-03 record the answer.)
- [ ] Delete without Manage: should the user also be able to delete views they did not create, or only shared ones?
- [ ] Which error code and HTTP status does the API return on a permission denial? The docs list none.
- [x] What value does the PUT `module` field expect for workload? Answered in the flow run: \`workload\` (seen on the favourite DELETE call).
- [ ] Is PDF export tied to View, or to a separate permission?
- [ ] Do permission changes apply to a logged-in user immediately, or only after re-login? Tests re-login after every change until this is known.

Risks: the portal user list contains path-traversal names (for example `../../etc/passwd`), which suggests other security tests share this portal — use a dedicated project and prefix all test data with `QA-WL-`. Setup locators carry a random prefix, so any full-value `data-zpqa` match will break across sessions.

## Automation project and skill

The flows above now ship as a Playwright project (`workload-playwright.zip`) and as the `zoho-workload-report-qa` skill, which bundles the same project, the browser helper and the locator reference. The project has 28 offline date-oracle tests (passing) plus workload, defect and permission suites that need a saved login (`npm run auth`) to run against a portal; none has been run live yet. In the skill eval, the skill scored 24/24 checks against 14/24 without it; the gains came from real locators, endpoints and the checkbox-state trap, and the date-maths eval did not discriminate (both 8/8).
