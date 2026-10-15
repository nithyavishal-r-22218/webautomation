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
- Predefined views (13-10-2026, `GET /views/{id}?module=workload` determiners): Associated Teams `26 is_not [-1]` + `report_based_on: teams`; My Team Members `1004 current_login_user`; My Direct Reports `30 current_login_user`; My Subordinates `31 current_login_user`; Unallocated/Under/Optimally/Over-Allocated `38 is [0|1|2|3]`; Users by Profile/Role have no determiner and `group_by profiles|roles` → `/reports/workload/groups` (`parents[]` {id,name,associated_user_count}) and `/reports/workload/groups/owners?group_ids=[{id,count}]` (`parents_with_owners[]` {parent_id, owners[]}). My Team Members = members of the teams the signed-in user LEADS (`/teams` → `lead.id`; membership via `GET /users/{id}/teams`; `/teams/{id}/users` routes are not configured). Changes: `PATCH /teams/{id}` `{lead}` or `{user_ids:{add|remove}}`; `PATCH /api/v3.1/users/{id}` `{reporting_to:{id}}`. Custom views reject the hierarchy rule (`field 30 current_login_user` → 400). Toolbar period picker: `topbar_calendar` → tabs `day|week|month`; cells `[data-date]` (DD-MM-YYYY on customworkload, month names on the Month tab); the LEFT calendar sets the start, the RIGHT the end; OK. Reporting line: `/users` `reporting_to.zpuid`.
- Export to PDF (13-10-2026): `reschart_pdfexport` → "Attention! Do you wish to password-protect the file?" `alert-Yes` (password field, nothing downloads until set) / `alert-No` → `POST /portal/<portal>/ganttexport` (application/pdf) → download `workload_report_export_<id>.pdf`. PDF text: filter values (comma-separated) then "<Section>: <Condition>"; one line per row = total + one value per day (some cut to "0.3..."); row names "name(count)"; then "<portal>", "Workload Report view by <data label>", "Project:<name|All Projects>Date:<from> to <to>Exported On:<date> <time>". Heatmap with No Legend prints no numbers.
- Filter panel (09-10-2026): toolbar `filter` opens `div.zps-filter-popup` (closed = class `slide-hide`; it never leaves the DOM). Keys: `resourceutil_filter_find` / `_cancel`, `resourceutil_reset_filter`, `resourceutil_filter_clear` (chip bar "Clear filter"), sections `resourceutil_fltcheck_<field>` (e.g. `_resourcetype`, `_allocation`, `_userrole`, `_1` Project). User/Resource: condition `resourceutil_selcondiv_resourcetype` (Is / Is Not); values are native `input#resourcetype_1` (Users) / `#resourcetype_6` (Resources) toggled through `label[data-zpqa=resourceutil_resourcetype_<n>]`. Find sends `filter={"criteria":[{"criteria_condition":"is"|"is_not","value":["1","6"],"field_name":"resource_type"}],"pattern":"1","isclearfilter":true}` on the data and Unassigned requests; the view becomes "All Users *" with Save as. Is hides the Unassigned row, Is Not shows it; no value + Find sends no criterion.
- Filter panel, every section (12-10-2026, customworkload: 36 sections = Workload 3 · Projects 3 · Task 10 · 19 task custom fields). Section `#filterdiv_<field>`: `input#fltcatcheck_<field>` (checked = expanded), header `label[data-zpqa=resourceutil_fltcheck_<field>]` (`columnname`, `cfid`, `display_name` on the parent `#zpfilter_<field>`), badge `#selcount_<field>`, section × `resourceutil_clearfilter_<field>`, condition selector `resourceutil_selcondiv_<field>` (`span[value]` = code) with options `resourceutil_condval_<field>_<code>` (`value` = code; long lists have a search box `resourceutil_condsearch_<field>`), tabs `#subgroup_<field> .tab-item#subgrptit_<field>_<value>` (Allocation `hours|percent`, Owner/Created By/user fields `users|teams`, Date `range|date`), value area `#filtval_<field>[ftype]` loaded on expand (`picklist`, `multipicklist`, `userpicklist`, `singleline`, `multiline`, `Double`, `Date`). Values: checkbox lists `input#<field>_<id>` + `label[data-zpqa=resourceutil_<field>_<id>]` (`data-tooltip` = label; Status/Task List/user lists also have `resourceutil_search_<field>`); user lists `[data-zpqa=resourceutil_drpdwn_<field>_<id>]` (hidden checkbox inside; groups "Unassigned", "Project Users"); team tab = radios; text/number `[data-zpqa=resourceutil_<field>_value0]` (`_value1` for Between), textarea `resourceutil_<field>_value`; Date Range tab `input[type=number]` + `resourceutil_period<n>_<field>` (day(s)) + `resourceutil_reldiv<n>_<field>` (Current Date); Date tab read-only `#datavalue<n>_<field>` with calendar `#calholder_<n>_<field>`. No-value conditions (`is_empty`, `all_open`, `all_closed`, `today`, …) show a disabled box. **Typed values must be keyed in; `fill()` is ignored.**
  - Standard fields and codes: `resourcetype` is/is_not · `allocation` is/equal/less_than/greater_than/less_than_or_equal/greater_than_or_equal/between (Is = checkboxes 0 Unallocated · 1 Under · 2 Optimal · 3 Over; the rest a number on the Hours or Percentage tab) · `userrole` is/is_not · `1` Project, `2` Project Group, `3` Project Status is/is_not · `32` Task Name contains/is/is_not/not_contains/starts_with/ends_with · `4` Status is/is_not/all_open/all_closed · `48` Completion Percentage is/is_not/less_than/greater_than/less_than_or_equal/greater_than_or_equal · `5` Owner is/direct_reports_of/subordinates_of · `11` Created By is/is_not/direct_reports_of/subordinates_of · `26` Associated Team, `6` Priority (none/low/medium/high), `47` Task List, `14` Tags, `25` Billing Type is/is_not. Custom: pick lists add `is_empty`; text `contains/is/is_not/is_empty/not_contains/starts_with/ends_with`; numbers `is/is_not/is_empty/less_than/…`; dates `select/today/till_yesterday/unscheduled/yesterday/tomorrow/this_week/this_month/last_week/last_month/next_7_days/next_week/next_month/next_30_days/is/between/less_than/greater_than/less_than_or_equal/greater_than_or_equal/not_between`.
  - Request `filter` JSON: `field_name` resource_type · allocation · role · status · priority · owner · created_by · tags · name (Task Name) · completion_percentage · `id` + `module_name` projects / tasklist · custom fields = label in snake_case. `is_empty` → `criteria_condition: "custom_condition"`, value `["${IS_EMPTY}"]`; `all_open` → `["${ALL_OPEN}"]`, `today` → `["${TODAY}"]`. Percentage tab appends `#` (`"50#"`). Date Range tab sends `relative_columns:[{offset,unit:"days",prior:"before|after",cfid:"0"}]` and no value. Chips: `<Label>: <Condition> <values>` ("Allocation Type: Equal 10 hours", "Less Than 50%", "Status: Is Delayed Closed"); Chip bar `#filt_cont_value`: `resourceutil_filType_<field>` ("Status: Is"), one `.filter-category-items[value=<id>]` per value with its own ×, `resourceutil_more_filter` ("Show More" ⌄ / "+N") which expands the bar to a second row where `resourceutil_filter_clear` sits (collapsed = `display:none` until then; expected behaviour, confirmed 12-10-2026). Relative-date Range filters show **no chip bar at all** and Less Than / Greater Than N day(s) leave the report on a spinner (WL-D-22, reproduced three times 12-10-2026); Save as › Discard removes `*` and Save as; the chips and filtered rows stay until the next data load, which is unfiltered (expected behaviour, confirmed 12-10-2026).

## Added 14-10-2026 (Create Workload Report, view dropdown › `create_customview`, URL `#zp/reports/workload/custom-view/create`)

| Part | Locator / value |
| --- | --- |
| Name / description | `input_customviewname` (maxlength 100) / `cviewdescription` |
| Tabs | `tab_determiner` (Criteria) · `tab_view_period` · `tab_grouping` · `tab_report_preference` |
| Criteria match | `input_criteria-all-radio` (AND) / `input_criteria-any-radio` (OR); `clear_all_criteria`; `add_cri_row` (+; at 15 rows its tooltip says "You have reached the maximum limit.") |
| Criteria row | `zp-criteria criteria-row` › `.field-select-class ruc-select` (hidden `<select>` value = field code) › `.comparator-select-class ruc-select` (condition code) › value control |
| Value controls | token list `.condition-select-class .ztokenfield` (type, pick `li.zdropdownlist__item`) · `ruc-input` text · `ruc-decimal` number · `ruc-textarea` · disabled `ruc-input` with `${ALL_OPEN}` / `${TODAY}` / `${IS_EMPTY}` (no value) · `ruc-date` (calendar, "Today") · `ruc-date-range` (Not Between: two dates) · `daterange-picker` (Less/Greater Than, Between: `daterange_tab_range` / `daterange_tab_date`, `input_rangevalue_0/1`, Done) · `custom-allocation-range` (`custom-allocation-trigger`, `customalloc_tab_hours` / `customalloc_tab_percent`, `input_allocation_input_0/1`, Done) |
| Field codes | resource_type · allocation · role · projects.id · projects.project_group · projects.status · name · status · completion_percentage · owner · … (custom fields: snake_case label) |
| Grouping | two ruc-selects: None · Profiles · Roles · Reporting Manager · User/Resource, and Asc · Desc (Timeline: None only). Saved group_by ignores the choice (WL-D-31) |
| Report Preference | Reports For radios `users` / `teams`; style `gantt` / `timeline`; Data Label (No Legend + Allocated/Available Hours, Minutes, Man Days, Man Weeks (Weeks/Months only), Percentage) |
| Share | checkbox "Share Workload Report with other Users" (`input_share_cview`) › `input_alluser_cview` (public) / `input_specificusr_cview` (shared) + "Select User" |
| Accessibility | checkbox "Show Workload Report in other Projects" (`input_cview_otherproj`) › `input_cview_allproj` (all_projects) / `input_cview_specificproj` (selected_projects) |
| Save | `bt_save_customview` → `PUT /reports/custom-workload` 201 `{id, …}`; the app then opens `#zp/reports/workload/custom-view/<id>/details` |

Request body (live): `{name, description, view_access_type: only_to_me|public|shared, shared_users:[{zpuid}], project_access_type, shared_projects:[{id}], report_preference:{report_based_on, bar_type, legend, view_type}, view_period:{time_period, time_period_type, relative_time_period}, determiner:{criteria:[{field_name, condition, value:[…]}], pattern:"1 AND 2"}, module:"workload", is_globally_accessible:true, group_by:[{field_name, sort_by, module}]}`. Messages: "Workload Report Name is a mandatory field", "Please select atleast one user", "Please select at least one project".

