/**
 * Locator registry for the global workload report.
 *
 * Defaults are written against accessible names / text / generic attribute
 * fragments rather than generated ids, so they survive build differences
 * between dev, staging and customer sandboxes. If a portal's DOM differs,
 * override any key per portal via `selectors` in config/portals.json
 * (any Playwright selector string: CSS, XPath, text=, data-testid=...).
 */
import type { Locator, Page } from '@playwright/test';

export type SelectorKey =
  | 'reportRoot'
  | 'loadingIndicator'
  | 'viewSwitcher'
  | 'viewDropdownPanel'
  | 'favouriteToggle'
  | 'favouritesSection'
  | 'refreshButton'
  | 'dateRangeLabel'
  | 'userRows'
  | 'errorToast';

type Factory = (page: Page) => Locator;

const FAV = /favou?rites?/i;

export const defaultSelectors: Record<SelectorKey, Factory> = {
  reportRoot: (p) =>
    p.locator('[data-testid*="workload" i], [id*="workload" i], [class*="workload" i]').first(),

  loadingIndicator: (p) =>
    p.locator(
      '[aria-busy="true"], [role="progressbar"], [class*="loader" i]:not([class*="loaded" i]), [class*="spinner" i], [class*="loading" i]',
    ),

  /** The control showing the current view name that opens the view list. */
  viewSwitcher: (p) =>
    p
      .locator(
        '[data-testid*="view-switch" i], [data-testid*="viewselect" i], [class*="view-select" i], [class*="viewselect" i], [class*="view-switch" i], [class*="viewname" i], [class*="view-name" i]',
      )
      .first(),

  viewDropdownPanel: (p) =>
    p.locator('[role="listbox"], [role="menu"], [class*="dropdown" i][class*="open" i], [class*="popover" i]').last(),

  /** Star / "Add to favourite" control for the currently selected view. */
  favouriteToggle: (p) =>
    p
      .getByRole('button', { name: FAV })
      .or(
        p.locator(
          '[title*="favourite" i], [title*="favorite" i], [aria-label*="favourite" i], [aria-label*="favorite" i], [data-tooltip*="favou" i], [class*="star" i][class*="icon" i], [class*="fav-icon" i]',
        ),
      )
      .first(),

  /** "Favourites" group inside the view list. */
  favouritesSection: (p) =>
    p
      .locator('[role="group"], [class*="group" i], [class*="section" i], ul, div')
      .filter({ has: p.getByText(FAV, { exact: false }) })
      .last(),

  refreshButton: (p) =>
    p
      .getByRole('button', { name: /refresh|reload/i })
      .or(p.locator('[title*="refresh" i], [aria-label*="refresh" i], [data-tooltip*="refresh" i], [class*="refresh" i]'))
      .first(),

  /** Text that shows the currently applied period (week/month/custom range). */
  dateRangeLabel: (p) =>
    p
      .locator(
        '[data-testid*="date-range" i], [class*="date-range" i], [class*="daterange" i], [class*="duration" i], [class*="period" i]',
      )
      .first(),

  /** One element per user row in the workload grid. */
  userRows: (p) =>
    p.locator(
      '[data-userid], [data-zpuid], [data-user-id], [class*="user-row" i], [class*="userrow" i], [class*="workload" i] [role="row"]',
    ),

  errorToast: (p) =>
    p
      .locator('[role="alert"], [class*="toast" i], [class*="notification" i], [class*="error-msg" i]')
      .filter({ hasText: /error|failed|went wrong|unable|try again/i }),
};

export class Selectors {
  constructor(
    private readonly page: Page,
    private readonly overrides: Partial<Record<SelectorKey, string>> = {},
  ) {}

  get(key: SelectorKey): Locator {
    const override = this.overrides[key];
    return override ? this.page.locator(override).first() : defaultSelectors[key](this.page);
  }

  /** Same as get() but without `.first()` on overrides – for collections such as rows. */
  all(key: SelectorKey): Locator {
    const override = this.overrides[key];
    return override ? this.page.locator(override) : defaultSelectors[key](this.page);
  }
}
