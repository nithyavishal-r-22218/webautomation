import { expect, type Page, type Response } from '@playwright/test';
import { CSS, K, qa, qaStarts } from '../locators';
import { Discovery, VIEW_LISTS, isFirstDataPage, isMeta, isUserViews, viewListOf } from '../discover';
import { env, reportsUrl } from '../env';

export type FavState = 'fav' | 'unfav';

/** Global Workload Report page object. Holds no portal data of its own: it asks `Discovery`. */
export class WorkloadPage {
  readonly d: Discovery;
  constructor(readonly page: Page) { this.d = new Discovery(page); }

  async goto() {
    this.d.reset(); // a reload must re-learn views/meta, never reuse what the previous load saw
    await this.page.goto(reportsUrl());
    await qa(this.page, K.workloadTab).click();
    await this.d.ready();
    await expect(qa(this.page, K.calendar)).toBeVisible();
  }

  // ---------- toolbar ----------
  /** View name, header range, chart type, data label and group-by as shown — the "selections" refresh must keep. */
  async selection() {
    const read = async (key: string) => {
      const el = qa(this.page, key);
      return (await el.count()) ? (await el.first().innerText()).replace(/\s+/g, ' ').trim() : '';
    };
    return {
      view: await read(K.viewDropdown), range: await read(K.calendar), chartType: await read(K.chartType),
      dataLabel: await read(K.dataLabel), groupBy: await read(K.groupBy),
    };
  }
  starIcon = () => qa(this.page, K.favourite).locator('i');
  async starState(): Promise<FavState> {
    const cls = (await this.starIcon().getAttribute('class')) ?? '';
    if (/\bunfav\b/.test(cls)) return 'unfav';
    if (/\bfav\b/.test(cls)) return 'fav';
    throw new Error(`Favourite star has neither fav nor unfav class: "${cls}"`);
  }
  async expectStar(state: FavState) {
    const other: FavState = state === 'fav' ? 'unfav' : 'fav';
    await expect(this.starIcon()).toHaveClass(new RegExp(`\\b${state}\\b`));
    await expect(this.starIcon()).not.toHaveClass(new RegExp(`\\b${other}\\b`));
  }

  // ---------- view dropdown ----------
  async openViews() {
    await qa(this.page, K.viewDropdown).click();
    await expect(this.page.locator(CSS.viewGroup).first()).toBeVisible();
  }
  async closeViews() {
    await this.page.keyboard.press('Escape');
    await expect(this.page.locator(CSS.viewGroup).first()).toBeHidden();
  }
  viewGroupTitle = (group: string) => qaStarts(this.page, K.viewGroupTitlePrefix).filter({ hasText: group });
  viewGroup = (group: string) => this.page.locator(CSS.viewGroup, { has: this.viewGroupTitle(group) });
  viewItem = (group: string, name: string) => this.viewGroup(group).locator(CSS.viewName(name));
  /** The view's row in any group other than favourites (a favourite view is listed twice). */
  private viewItemNonFavourite = (name: string) =>
    this.page.locator(CSS.viewGroup).filter({ hasNot: this.viewGroupTitle(env.favouriteGroup) }).locator(CSS.viewName(name)).first();

  currentViewId = () => String(this.d.meta?.custom_view_id ?? '');

  /** Selects a view by name (ID looked up at runtime) and waits for its first data page and meta. */
  async selectView(name: string) {
    const id = String(this.d.view(name).id);
    if (this.currentViewId() === id) {
      // Already the open view (often the default on load): selecting it again fires no request, so wait for its data.
      await expect.poll(() => this.d.lastFirstPage?.viewId, { message: `first data page of "${name}"` }).toBe(id);
      await expect(qa(this.page, K.viewDropdown)).toContainText(name);
      return;
    }
    this.d.resetOwners();
    const data = this.page.waitForResponse(r => isFirstDataPage(r) && new URL(r.url()).searchParams.get('view_id') === id);
    const meta = this.page.waitForResponse(r => isMeta(r) && new URL(r.url()).searchParams.get('view_id') === id);
    await this.openViews();
    await this.viewItemNonFavourite(name).click();
    const [dr] = await Promise.all([data, meta]);
    expect(dr.ok(), `first data page for "${name}" → ${dr.status()}`).toBe(true);
    await expect.poll(() => this.currentViewId(), { message: 'meta switched to the selected view' }).toBe(id);
    await expect(qa(this.page, K.viewDropdown)).toContainText(name);
  }

  // ---------- grid ----------
  rows = () => qaStarts(this.page, K.userRowPrefix);
  scroller = () => this.page.locator(CSS.userListScroller);
  scrollTop = () => this.scroller().evaluate(el => el.scrollTop);
  isScrollable = () => this.scroller().evaluate(el => el.scrollHeight > el.clientHeight + 4);
  async scrollToMiddle() {
    await this.scroller().evaluate(el => { el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2); });
  }

  // ---------- actions ----------
  /** Clicks the star and returns the favourite API response for the current view (POST = add, DELETE = remove). */
  async clickStar(expectMethod: 'POST' | 'DELETE'): Promise<Response> {
    const id = this.currentViewId();
    expect(id, 'current view id known from meta').not.toBe('');
    const resp = this.page.waitForResponse(r =>
      new RegExp(`/user-views/${id}/favorite(\\?|$)`).test(r.url()) && r.request().method() === expectMethod);
    await qa(this.page, K.favourite).click();
    return resp;
  }

  /** Bring the current view to `state` through the UI (used to normalise before a test and to restore after). */
  async ensureStar(state: FavState) {
    if ((await this.starState()) === state) return;
    const r = await this.clickStar(state === 'fav' ? 'POST' : 'DELETE');
    expect(r.status(), `normalise favourite → ${state}`).toBe(204);
    await this.expectStar(state);
  }

  /**
   * Clicks refresh and collects what the app reloads: the four user-views lists, meta and the first data page.
   * Listeners are attached before the click so no response is missed.
   */
  async refresh() {
    const lists = new Map<string, Response>();
    const onResp = (r: Response) => { if (isUserViews(r)) lists.set(viewListOf(r), r); };
    this.page.on('response', onResp);
    const id = this.currentViewId();
    this.d.resetOwners();
    const data = this.page.waitForResponse(r => isFirstDataPage(r));
    const meta = this.page.waitForResponse(r => isMeta(r));
    try {
      await qa(this.page, K.refresh).click();
      const [dataResp, metaResp] = await Promise.all([data, meta]);
      await expect.poll(() => VIEW_LISTS.filter(v => lists.has(v)).length,
        { message: `user-views reloaded for all of ${VIEW_LISTS.join(', ')}` }).toBe(VIEW_LISTS.length);
      return { data: dataResp, meta: metaResp, lists, viewIdBefore: id };
    } finally {
      this.page.off('response', onResp);
    }
  }
}
