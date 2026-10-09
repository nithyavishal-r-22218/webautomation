import type { Locator, Page } from '@playwright/test';

/** `data-zpqa` is the app's own QA attribute and the primary locator everywhere. */
export const qa = (page: Page | Locator, key: string) => page.locator(`[data-zpqa="${key}"]`);
export const qaStarts = (page: Page | Locator, prefix: string) => page.locator(`[data-zpqa^="${prefix}"]`);
/** Setup keys carry a random per-session prefix (e.g. `muz0scn48tcl6sfsk6c_`): always suffix-match. */
export const qaEnds = (page: Page | Locator, suffix: string) => page.locator(`[data-zpqa$="${suffix}"]`);

export const K = {
  // Reports > Workload Report
  workloadTab: 'tab_resourceutilpage',
  viewDropdown: 'topbar_cview',
  favourite: 'favourite_icon',
  refresh: 'refresh_status',
  moreActions: 'more_actions',
  calPrev: 'cal_left_arrow',
  calendar: 'topbar_calendar',
  calNext: 'cal_right_arrow',
  chartType: 'kanban_changecv',
  filter: 'filter',
  groupBy: 'group-by-nav-item',
  dataLabel: 'data-label-select',
  fullscreen: 'workload-report-fullscreen',
  showOptions: 'workload-report-options',
  legend: 'workload-report-legend-detail',
  exportPdf: 'reschart_pdfexport',
  userRowPrefix: 'username-',
  // View dropdown
  viewGroupTitlePrefix: 'cv_exp_col_title',
  createView: 'create_customview',
  viewRowMenuPrefix: 'cv_extra_options_',
  // ••• menu
  edit: 'edit_customview',
  copyLink: 'copylink_customview',
  clone: 'clone_customview',
  menuFavourite: 'makeFavourite_customview',
  setDefault: 'my_anchor_customview',
  deleteView: 'delete_customview',
  // toolbar "Save as" (appears after an unsaved toolbar change)
  saveAs: 'cview_save_as',
  saveAsExisting: 'existing_customview',
  saveAsNew: 'new_customview',
  discard: 'discard_cview',
  // Create / edit form
  name: 'input_customviewname',
  description: 'cviewdescription',
  share: 'input_share_cview',
  otherProjects: 'input_cview_otherproj',
  save: 'bt_save_customview',
  cancel: 'bt_cancel_customview',
  // Setup > Profiles (suffixes)
  groupProjectReport: '_profile_base_group_projectreport',
  groupGlobalReport: '_profile_base_group_globalreport',
  menuWorkload: '_profile_base_menu_workloadreport',
} as const;

/** CSS selectors for parts without a data-zpqa key (confirmed live on the reference portal). */
export const CSS = {
  userListScroller: '.resourceutilTableholder',
  viewGroup: '.cvdrop-group',
  viewName: (name: string) => `.customview-name[data-tooltip="${name}"]`,
  radio: 'ruc-radio-button',
  radioChecked: 'ruc-checked',
  select: 'ruc-select',
  selectText: '.zselectbox__text',
  selectOpener: '.zselectbox__selected',
  option: 'li.zdropdownlist__item',
  checkbox: 'ruc-checkbox',
  weekColumn: '.weekNameColumn',
} as const;
