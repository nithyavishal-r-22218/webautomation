/**
 * Page object for the Zoho Projects global workload report.
 *
 * All portal-specific data (URL, portal, view name, view id, dates, users) is
 * either read from PortalConfig or discovered from the live page at runtime.
 * The page object never asserts on concrete values - it only returns them so
 * specs can compare "before" vs "after".
 */
import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { type PortalConfig, workloadUrl } from '../support/portal-config';
import { Selectors } from '../support/selectors';

export interface ReportSnapshot {
  url: string;
  viewName: string;
  viewId: string | null;
  dateRange: string;
  userRowCount: number;
  /** Normalised first-cell text of each user row (order preserved). */
  userLabels: string[];
}

const exactText = (s: string) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export class WorkloadReportPage {
  readonly sel: Selectors;
  private readonly dataRe: RegExp;
  private readonly favRe: RegExp | null;
  private readonly viewIdRe: RegExp;

  constructor(
    readonly page: Page,
    readonly cfg: PortalConfig,
  ) {
    this.sel = new Selectors(page, cfg.selectors);
    this.dataRe = new RegExp(cfg.dataRequestPattern, 'i');
    this.favRe = cfg.favouriteRequestPattern ? new RegExp(cfg.favouriteRequestPattern, 'i') : null;
    this.viewIdRe = new RegExp(cfg.viewIdUrlPattern, 'i');
  }

  // ---------------------------------------------------------------- navigation

  async goto(): Promise<void> {
    await this.page.goto(workloadUrl(this.cfg), { waitUntil: 'domcontentloaded' });
    await this.waitForReady();
  }

  async reload(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.waitForReady();
  }

  /** Report root visible and no visible loading indicator. */
  async waitForReady(timeout = this.cfg.readyTimeoutMs): Promise<void> {
    await expect(this.sel.get('reportRoot'), 'workload report did not render').toBeVisible({ timeout });
    await expect(this.sel.all('loadingIndicator').filter({ visible: true })).toHaveCount(0, { timeout });
  }

  // --------------------------------------------------------------------- views

  async currentViewName(): Promise<string> {
    return squash(await this.sel.get('viewSwitcher').innerText());
  }

  /** View id from the URL (preferred) or from data attributes on the switcher. */
  async currentViewId(): Promise<string | null> {
    const fromUrl = decodeURIComponent(this.page.url()).match(this.viewIdRe);
    if (fromUrl?.[1]) return fromUrl[1];
    const sw = this.sel.get('viewSwitcher');
    for (const attr of ['data-viewid', 'data-view-id', 'data-id', 'data-value']) {
      const v = await sw.getAttribute(attr).catch(() => null);
      if (v) return v;
    }
    return null;
  }

  async openViewList(): Promise<Locator> {
    const panel = this.sel.get('viewDropdownPanel');
    if (!(await panel.isVisible().catch(() => false))) {
      await this.sel.get('viewSwitcher').click();
    }
    await expect(panel).toBeVisible();
    return panel;
  }

  async closeViewList(): Promise<void> {
    const panel = this.sel.get('viewDropdownPanel');
    if (await panel.isVisible().catch(() => false)) {
      await this.page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    }
  }

  private viewOption(panel: Locator, viewName: string): Locator {
    const re = exactText(viewName);
    return panel
      .getByRole('option', { name: re })
      .or(panel.getByRole('menuitem', { name: re }))
      .or(panel.locator('li, [role="treeitem"], a').filter({ hasText: re }))
      .first();
  }

  /** Select a view by its display name; no-op if it is already selected. */
  async selectView(viewName: string): Promise<void> {
    if (exactText(viewName).test(await this.currentViewName())) return;
    const panel = await this.openViewList();
    const option = this.viewOption(panel, viewName);
    await expect(option, `view "${viewName}" not found in view list`).toBeVisible();
    await Promise.all([this.waitForDataResponse().catch(() => null), option.click()]);
    await this.waitForReady();
    await expect.poll(() => this.currentViewName()).toMatch(exactText(viewName));
  }

  // ---------------------------------------------------------------- favourites

  /**
   * Favourite state of the current view, read from the toggle:
   *  1. aria-pressed / aria-checked
   *  2. title / aria-label / tooltip wording ("Remove from favourite" => favourited)
   *  3. CSS class hints (active / selected / filled / starred ...)
   */
  async isFavourite(): Promise<boolean> {
    const t = this.sel.get('favouriteToggle');
    await expect(t, 'favourite toggle not visible').toBeVisible();
    const state = await t.evaluate((el) => {
      const nodes = [el, ...Array.from(el.querySelectorAll('*'))] as Element[];
      for (const n of nodes) {
        const pressed = n.getAttribute('aria-pressed') ?? n.getAttribute('aria-checked');
        if (pressed === 'true') return true;
        if (pressed === 'false') return false;
      }
      for (const n of nodes) {
        const label = [n.getAttribute('title'), n.getAttribute('aria-label'), n.getAttribute('data-tooltip')]
          .filter(Boolean)
          .join(' ');
        if (/remove|unmark|un-?favou?rite/i.test(label)) return true;
        if (/\badd\b|mark as/i.test(label)) return false;
      }
      const cls = nodes.map((n) => (typeof n.className === 'string' ? n.className : n.getAttribute('class') ?? '')).join(' ');
      if (/(^|[\s_-])(active|selected|filled|starred|is-?fav|fav-?on|checked)([\s_-]|$)/i.test(cls)) return true;
      return null;
    });
    if (state !== null) return state;
    // Fallback: membership in the Favourites group of the view list.
    return this.isListedInFavourites(await this.currentViewName());
  }

  /** True when `viewName` is shown under the "Favourites" group of the view list. */
  async isListedInFavourites(viewName: string): Promise<boolean> {
    await this.openViewList();
    const section = this.sel.get('favouritesSection');
    const listed =
      (await section.isVisible().catch(() => false)) &&
      (await section.getByText(exactText(viewName)).count()) > 0;
    await this.closeViewList();
    return listed;
  }

  async addToFavourite(): Promise<void> {
    expect(await this.isFavourite(), 'precondition: view should not already be a favourite').toBe(false);
    await this.clickFavouriteAction('add');
    await expect.poll(() => this.isFavourite(), { message: 'view did not become favourite' }).toBe(true);
  }

  async removeFromFavourite(): Promise<void> {
    expect(await this.isFavourite(), 'precondition: view should be a favourite').toBe(true);
    await this.clickFavouriteAction('remove');
    await expect.poll(() => this.isFavourite(), { message: 'view is still a favourite' }).toBe(false);
  }

  /** Bring the current view into the requested favourite state (test setup / cleanup). */
  async ensureFavourite(wanted: boolean): Promise<void> {
    if ((await this.isFavourite()) === wanted) return;
    if (wanted) await this.addToFavourite();
    else await this.removeFromFavourite();
  }

  /**
   * Supports both UI variants: an explicit "Add to / Remove from favourite"
   * menu item or button, and a single star toggle next to the view name.
   */
  private async clickFavouriteAction(action: 'add' | 'remove'): Promise<void> {
    const wording =
      action === 'add' ? /^\s*(add to|mark as) favou?rites?\s*$/i : /^\s*(remove from|unmark) favou?rites?\s*$/i;
    const explicit = this.page
      .getByRole('menuitem', { name: wording })
      .or(this.page.getByRole('button', { name: wording }))
      .first();
    const target = (await explicit.isVisible().catch(() => false)) ? explicit : this.sel.get('favouriteToggle');

    const response = this.favRe
      ? this.page
          .waitForResponse((r) => this.favRe!.test(r.url()) && r.request().method() !== 'OPTIONS', { timeout: 15_000 })
          .catch(() => null)
      : Promise.resolve(null);
    await target.click();
    const res = await response;
    if (res) expect(res.status(), `favourite ${action} request failed: ${res.url()}`).toBeLessThan(400);
  }

  // ------------------------------------------------------------------- refresh

  refreshButton(): Locator {
    return this.sel.get('refreshButton');
  }

  waitForDataResponse(timeout = this.cfg.readyTimeoutMs): Promise<Response> {
    return this.page.waitForResponse(
      (r) => this.dataRe.test(r.url()) && r.request().method() !== 'OPTIONS' && r.request().resourceType() !== 'document',
      { timeout },
    );
  }

  /** Clicks the refresh icon and returns the workload data response it triggered. */
  async refresh(): Promise<Response> {
    const btn = this.refreshButton();
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    const [res] = await Promise.all([this.waitForDataResponse(), btn.click()]);
    await this.waitForReady();
    return res;
  }

  async visibleErrorCount(): Promise<number> {
    return this.sel.all('errorToast').filter({ visible: true }).count();
  }

  // ------------------------------------------------------------------ snapshot

  async snapshot(): Promise<ReportSnapshot> {
    const rows = this.sel.all('userRows');
    const labels = (await rows.evaluateAll((els) =>
      els.map((e) => {
        const firstCell = e.querySelector('[role="gridcell"], [role="cell"], td, [class*="name" i]') ?? e;
        return (firstCell.textContent ?? '').replace(/\s+/g, ' ').trim();
      }),
    )) as string[];
    const dateLabel = this.sel.get('dateRangeLabel');
    return {
      url: this.page.url(),
      viewName: await this.currentViewName(),
      viewId: await this.currentViewId(),
      dateRange: (await dateLabel.isVisible().catch(() => false)) ? squash(await dateLabel.innerText()) : '',
      userRowCount: labels.length,
      userLabels: labels,
    };
  }
}
