# Workload Report locators and API facts (confirmed live, 8 Oct 2026)

## data-zpqa keys

Report page: `tab_resourceutilpage`, `topbar_cview` (view dropdown), `favourite_icon` (child `i`: class `fav` / `unfav`), `refresh_status`, `more_actions`, `cal_left_arrow`, `topbar_calendar`, `cal_right_arrow`, `kanban_changecv` (chart type), `filter`, `group-by-nav-item`, `data-label-select`, `workload-report-fullscreen`, `workload-report-options` (Show Options panel), `workload-report-legend-detail`, `reschart_pdfexport`, user rows `[data-zpqa^="username-"]`.

View dropdown: `search_input`, group titles `cv_exp_col_title_<n>` (index changes when Favorite Views appears — match by text), `create_customview`, `cv_extra_options_<id>`. Items: `.cvdrop-group .customview-name[data-tooltip="<name>"]`.

••• menu: `edit_customview`, `copylink_customview`, `clone_customview`, `makeFavourite_customview`, `my_anchor_customview` (Set as default view).

Form: `input_customviewname` (locked on predefined views), `cviewdescription`, `input_criteria-all-radio`, `input_criteria-any-radio`, `add_cri_row`, `clear_all_criteria`, `input_share_cview`, `input_cview_otherproj`, `bt_save_customview`, `bt_cancel_customview`. Predefined-view Edit shows only Time Period and Report Preference tabs; Create/Clone also show Criteria and Grouping.

Controls: radios `ruc-radio-button` (checked ⇔ class `ruc-checked`; view type group has `rc-name="cv-style-option"`; values bar/heatmap/timeline, days/weeks/months, gantt/timeline), selects `ruc-select` → `.zselectbox__selected` / `.zselectbox__text`, options `li.zdropdownlist__item`, checkboxes `ruc-checkbox[rc-checked]`.

Grid: list scroller `.resourceutilTableholder`; day columns' textContent `"<d>Date: MM-DD-YYYYDay: <weekday>Type: Working day|Weekend"`; week columns `.weekNameColumn` ("Oct 1 - Oct 7").

Setup › Profiles (`#setup/profiles/user`): `gloabl-setup` (sic), `profiles`, `tab_user`, groups `[data-zpqa$="_profile_base_group_projectreport"]` / `globalreport`, menu `[data-zpqa$="_profile_base_menu_workloadreport"]` (random prefix per session), checkboxes `input_profile_checkbox_<profileId>_workloadreport_view|manage|delete` (state on the wrapping `ruc-checkbox[rc-checked]`; native `checked` is always false). Project and Global checkboxes share keys.

## Option lists seen

- Days relative (12): Last/Next 7 Days, Last/Next 180 Days, This/Last/Next Week, This/Last/Next Month, Last/Next 3 Months.
- Weeks relative (9): Last/Next 7, 15, 25 Weeks; This/Last/Next Month.
- Months relative (4): Last/Next 3 and 6 Months. Every unit also has Custom.
- Data labels: No Legend; Allocated / Available × Hours, Minutes, Man Days, Percentage (9 in Days); Weeks and Months add Allocated / Available Man Weeks (11).
- Report Preference: Bar & Heatmap → Task Expanded View Style (Gantt/Timeline) + Data Label; Timeline type → Data Label + Show Options (Task Title, Project Title).

## API (V3, under /api/v3/portal/<numericPortalId>)

| Call | Notes |
| --- | --- |
| `GET /user-views?module=workload&page=1&per_page=200&filter={"view_type":"predefined_views|created_views|shared_views|favourite_views"}` | `user_views[]` with id, name, is_favorite, is_anchored, is_default_view, is_editable, is_deletable |
| `GET /reports/workload/meta?project_id=0&view_id=…` | `custom_view_id`, `user_range` (page size), `chart_details`, `default_business_hours_details.working_day_availability` ({"1".."5": 540}), `user_premission_details` |
| `GET /reports/workload?project_id=0&from_date&to_date&time_period&report_based_on=users&index&range&view_id…` | `owners[]`, `page_info.has_next`; `fetch_unassignee=true` call returns the Unassigned row |
| `PUT /reports/custom-workload` | Save of Edit/Create (200). Body `module=workload`, name, description, view_access_type, project_access_type… |
| `POST /user-views/<id>/favorite` · `DELETE /user-views/<id>/favorite?module=workload` | 204 |
| Other documented GETs | `/reports/workload/details`, `/owner/<id>/details`, `/entity/<id>/details`, `/groups`, `/groups/owners`, `/groups/<id>/owners` |

No delete endpoint for custom workload views is documented; prove Delete in the UI and replay the UI's own call.

## Added 08-10-2026 (permissions, Save as, import)

| Area | Keys / selectors |
| --- | --- |
| ••• menu | `delete_customview` (Delete), plus `edit_customview`, `clone_customview`, `copylink_customview`, `makeFavourite_customview`, `my_anchor_customview` |
| Toolbar Save as (after an unsaved change) | `cview_save_as` → `existing_customview`, `new_customview` (has `disabled` attr without Manage), `discard_cview` |
| Delete confirm | checkbox "I understand…" + Delete button (text) |
| Setup › Profiles | `ruc-checkbox[rc-qa="profile_checkbox_<profileId>_<workloadreport|projectworkloadreport>_<view|manage|delete>"]`, state = class `ruc-checked` |
| Projects list | row icon `open_detail` (name cell = inline rename) |
| Project tabs | `upperTabs-Tasks`, `upperTabs-Users`, `upperTabs-Reports` |
| Tasks toolbar | `other_actions` → `menu_task_import`, `menu_task_export` |
| Import wizard | `import_filetype_xls`, `import_files_input`, `import_files_selectedfile`, `zpss-import-tasks` → `zpss-it-continue` / `zpss-it-back` → `alert-OK` → `#updateStatusType` → `input[name=assignUser][value=mapusers]` → `#assignUserSubmit` → `#assignUsers` (Import Now); `taskimport_cancel_import` = Discard |

| API (internal) | Notes |
| --- | --- |
| `PATCH /profiles/{id}/{globalreport\|projectreport}/permissions/{grant\|revoke}` | JSON array body `[{"module":"workloadreport","actions":["view"]}]`; 204 |
| `GET /profiles/{scope}/permissions?profile_ids=` | `{ id: [{module, actions}] }` |
| `DELETE /views/{id}?module=workload` | 204; 401 "You does not have permission to delete this view" |
| `POST /projects/{id}/projectusers` | form-encoded `userdetails` (JSON string) + `notify`; JSON body rejected |
| `POST /projects/{id}/trash` | 204; GET project → 410 RESOURCE_TRASHED; `POST …/restore` undoes |
| `GET /reports/workload?project_id=…` | dates must be ISO timestamps (`2026-10-01T00:00:00.000Z`); `owners[].work.total_date_work[] {date YYYYMMDD, allocation, work minutes}` |

## Added 09-10-2026 (from the Java suite in ~/UIautomation, confirmed live there)

- **Date order follows the user's date format.** customworkload shows `DD-MM-YYYY` in the header, the custom-period input and the picker's `data-date`; other portals (e.g. plautomation) `MM-DD-YYYY`. Detect it from the `topbar_calendar` text: a first part above 12 → day-month, a second part above 12 → month-day, otherwise the reading that gives a valid, shorter span (`detectDateOrder` in `src/dates.ts`).
- Custom period input `[data-zpqa='input_custom-date-input-element']`; OK `[data-zpqa='footer-cur-ok']`.
- Days: `lyte-daterangepicker [role='gridcell'][data-date='<date>']`. Progress shows in the element's `selected-date1` / `selected-date2` attributes. Wait for `selected-date1` and about 700 ms before the end click, or the range restarts. The element has no box, so never wait for it to be visible.
- Weeks / Months: two panels `.range-calendar-container ruc-calendar` (start, end); cells `[role='gridcell'][data-date='<date>']` for weeks, `data-date='<full month name>'` for months. The Weeks end snaps to the Saturday closing that week.
- The Java suite only picks dates inside the two rendered months; no month-navigation arrow is confirmed yet.
- Live 09-10-2026 (customworkload): a cold `#zp/reports` link can land on the Projects list (click the left-menu "Reports" item); the mobile-apps promo `#zpsHandheldsPromo` overlays the page and intercepts clicks (close it with its first child, the ×); the toolbar refresh `refresh_status` is `visibility:hidden` until the toolbar is hovered. Header shows `01-10-2026 to 31-10-2026` (DD-MM-YYYY).
- From the Java API layer (WorkloadReportApi / ProfilePermissionsApi / Api): predefined views are listed by i18n key (`zp.workload.customview.allusers` → "All Users", `…usersbyprofile` → "Users by Profile", etc.); the portal allows ~100 calls per API per 2 min and then blocks that API for ~30 min (pace at ≤80, retry `URL_ROLLING_THROTTLES_LIMIT_EXCEEDED` after 30 s); delete a view with `custom_view_id` when the listing has one; `working_day_availability` keys are ISO weekdays (1 = Mon … 7 = Sun); v3.1 `PATCH /users/{zpuid}` with `{"portal_profile":{"id"}}` assigns a profile (`profile` is ignored); `GET /reports/workload/groups` and `/groups/owners` serve Users by Profile/Role.
