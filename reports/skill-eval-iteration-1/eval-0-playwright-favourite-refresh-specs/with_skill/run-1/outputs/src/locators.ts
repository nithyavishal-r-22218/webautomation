import type { Locator, Page } from '@playwright/test';

/** `data-zpqa` is the app's own QA attribute and the primary locator everywhere. */
export const qa = (root: Page | Locator, key: string) => root.locator(`[data-zpqa="${key}"]`);
export const qaStarts = (root: Page | Locator, prefix: string) => root.locator(`[data-zpqa^="${prefix}"]`);

/** Keys confirmed live (see the skill's references/locators.md). No IDs in here: they differ per portal. */
export const K = {
  workloadTab: 'tab_resourceutilpage',
  viewDropdown: 'topbar_cview',
  favourite: 'favourite_icon',      // child <i> carries class `fav` / `unfav`
  refresh: 'refresh_status',
  calendar: 'topbar_calendar',
  chartType: 'kanban_changecv',
  dataLabel: 'data-label-select',
  groupBy: 'group-by-nav-item',
  userRowPrefix: 'username-',
  viewSearch: 'search_input',
  // Group titles are cv_exp_col_title_<n>; <n> shifts when "Favorite Views" appears — always match by text.
  viewGroupTitlePrefix: 'cv_exp_col_title',
} as const;

export const CSS = {
  userListScroller: '.resourceutilTableholder',
  viewGroup: '.cvdrop-group',
  viewName: (name: string) => `.customview-name[data-tooltip="${name.replace(/"/g, '\\"')}"]`,
} as const;
