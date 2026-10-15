import { expect, type Locator, type Page } from '@playwright/test';
import { CSS, K, qa, qaStarts } from '../locators';
import { Discovery } from '../discover';
import { env, reportsUrl } from '../env';
import { parseShown, setDateOrder, detectDateOrder, type Range } from '../dates';
import { waitForApiBudget } from '../rate';

export type ViewGroup = 'Favorite Views' | 'Predefined Views' | 'My Custom Views' | 'Shared Views' | string;

/**
 * Toolbar icons next to the view name (favourite, refresh, ••• more actions) stay visibility:hidden / opacity 0 until
 * the toolbar is hovered (seen 09-10-2026). Returns the icon after hovering, ready to click.
 */
export async function toolbarIcon(page: Page, key: string): Promise<Locator> {
  const icon = qa(page, key);
  await qa(page, K.viewDropdown).hover();
  if (!(await icon.isVisible())) await icon.locator('..').hover();
  return icon;
}

const promoHandled = new WeakSet<Page>();
/**
 * The mobile-apps promo (#zpsHandheldsPromo) covers the page and swallows every click (seen 09-10-2026). Close it
 * with its first (×) control whenever it appears; if it stays, remove the overlay — it only advertises the apps.
 */
export async function dismissPromos(page: Page) {
  if (promoHandled.has(page)) return;
  promoHandled.add(page);
  await page.addLocatorHandler(page.locator('#zpsHandheldsPromo'), async promo => {
    await promo.locator(':scope > *').first().click({ timeout: 3_000 }).catch(() => {});
    if (await promo.isVisible()) await promo.evaluate(el => el.remove());
  });
}

/**
 * Open Reports. A cold deep link to #zp/reports can land on the Projects list (seen 09-10-2026 on customworkload),
 * so when the Workload tab does not appear the left-menu Reports item is clicked instead.
 */
export async function openReports(page: Page) {
  await dismissPromos(page);
  await waitForApiBudget(12); // a Reports load sends ~10 portal API calls
  // Already inside Reports: a same-URL goto in this single-page app sends no requests, so a fresh Discovery would
  // never see the portal ID, views or meta — reload instead.
  if (page.url().startsWith(reportsUrl())) await page.reload();
  else await page.goto(reportsUrl());
  const tab = qa(page, K.workloadTab);
  if (!(await tab.waitFor({ timeout: 15_000 }).then(() => true, () => false)))
    await page.getByRole('menuitem', { name: /Reports/ }).first().click({ timeout: 10_000 });
  // 150 s: the page's requests may be held up to a full 2-minute window by the API budget (src/rate.ts)
  await expect(tab, 'Reports page with the Workload tab').toBeVisible({ timeout: 150_000 });
}

export class WorkloadPage {
  readonly d: Discovery;
  constructor(readonly page: Page) { this.d = new Discovery(page); }

  async goto() {
    await openReports(this.page);
    await qa(this.page, K.workloadTab).click();
    await this.d.ready();
    // 150 s: after a heavy step the page's own requests can be held by the API budget (src/rate.ts) for a full window
    await expect(qa(this.page, K.calendar)).toBeVisible({ timeout: 150_000 });
    setDateOrder(env.dateOrder || detectDateOrder(await qa(this.page, K.calendar).innerText()));
  }

  // ---------- toolbar ----------
  selection = () => Promise.all([K.viewDropdown, K.calendar, K.chartType, K.dataLabel]
    .map(k => qa(this.page, k).innerText().then(t => t.replace(/\s+/g, ' ').trim())));
  headerRange = async (): Promise<Range> => {
    const [a, b] = (await qa(this.page, K.calendar).innerText()).trim().split(/\s+to\s+/);
    return [parseShown(a), parseShown(b)];
  };
  chartType = () => qa(this.page, K.chartType).innerText().then(t => t.trim());
  dataLabel = () => qa(this.page, K.dataLabel).innerText().then(t => t.trim());
  starIcon = () => qa(this.page, K.favourite).locator('i');

  // ---------- view dropdown ----------
  async openViews() { await qa(this.page, K.viewDropdown).click(); }
  async closeViews() { await this.page.keyboard.press('Escape'); }
  viewGroupTitle = (group: ViewGroup) => qaStarts(this.page, K.viewGroupTitlePrefix).filter({ hasText: group });
  viewItem = (group: ViewGroup, name: string) =>
    this.page.locator(CSS.viewGroup, { has: this.viewGroupTitle(group) }).locator(CSS.viewName(name));
  async selectView(name: string, group: ViewGroup = 'Predefined Views') {
    const id = this.d.view(name).id;
    this.d.resetOwners();
    // Picking the view that is already open sends no data request: reload it with the toolbar refresh instead
    if (this.d.meta?.custom_view_id === id) { await this.refresh(); return; }
    const loaded = this.page.waitForResponse(r => /\/reports\/workload\?/.test(r.url()) && r.url().includes(`view_id=${id}`), { timeout: 150_000 });
    await this.openViews();
    await this.viewItem(group, name).click();
    await loaded;
  }

  // ---------- grid ----------
  rows = () => qaStarts(this.page, K.userRowPrefix);
  scroller = () => this.page.locator(CSS.userListScroller);
  async loadAllRows(timeout = 180_000) {
    await expect.poll(async () => {
      await this.scroller().evaluate(el => { el.scrollTop = el.scrollHeight; });
      return this.d.allPagesLoaded();
    }, { timeout, intervals: [800] }).toBe(true);
  }
  /** Dates of every grid column, read from each column's tooltip text `Date: <date in the UI's order>`. */
  gridDates = () => this.page.evaluate(() => {
    const re = /^\s*\S{1,12}( - \S{1,8})?\s*Date: (\d{2}-\d{2}-\d{4})Day: \w+Type: [\w ]+\s*$/;
    const els = [...document.querySelectorAll('*')].filter(e => e.children.length <= 3 && re.test(e.textContent ?? ''));
    return [...new Set(els.map(e => (e.textContent ?? '').match(re)![2]))];
  });
  /** Week bucket labels in Weeks unit, e.g. "Oct 1 - Oct 7". */
  weekBuckets = () => this.page.locator(CSS.weekColumn).evaluateAll(els =>
    els.map(e => (e.textContent ?? '').replace(/Date:.*$/s, '').trim()));
  /** Header summary cell, e.g. "Oct 1-Oct 31 198 hours" → { text, value, unit }. */
  summary = () => this.page.evaluate(() => {
    const re = /^\s*[A-Z][a-z]{2} \d{1,2}\s*-\s*[A-Z][a-z]{2} \d{1,2}\s*[\d.,]+\s*(hours|Man Days|Man Weeks|%|minutes|mins?)\s*$/i;
    const e = [...document.querySelectorAll<HTMLElement>('*')].filter(x => x.children.length <= 3 && re.test(x.textContent ?? ''))
      .sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length)[0];
    const text = e ? (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim() : '';
    const m = text.match(/([\d.,]+)\s*(hours|Man Days|Man Weeks|%|minutes|mins?)$/i);
    return { text, value: m ? Number(m[1].replace(/,/g, '')) : NaN, unit: m ? m[2] : '' };
  });
  /** First user row's visible values (row total first, then period cells). */
  async firstRowValues(row: Locator = this.rows().first()): Promise<string[]> {
    const top = await row.evaluate(el => { const b = el.getBoundingClientRect(); return b.top + b.height / 2; });
    return this.page.evaluate((y) => [...document.querySelectorAll<HTMLElement>('*')]
      .filter(e => { const b = e.getBoundingClientRect(); return e.children.length === 0 && (e.innerText || '').trim() && Math.abs(b.top + b.height / 2 - y) < 20 && b.left > 400; })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
      .map(e => e.innerText.trim()), top);
  }

  // ---------- actions ----------
  async toggleFavourite(expectMethod: 'POST' | 'DELETE') {
    const id = this.d.meta?.custom_view_id;
    const resp = this.page.waitForResponse(r => /\/user-views\/\d+\/favorite/.test(r.url()) && r.request().method() === expectMethod
      && (!id || r.url().includes(id)));
    await (await toolbarIcon(this.page, K.favourite)).click();
    return resp;
  }
  async refresh() {
    const data = this.page.waitForResponse(r => /\/reports\/workload\?/.test(r.url()) && /[?&]index=1&/.test(r.url()), { timeout: 150_000 });
    const meta = this.page.waitForResponse(r => r.url().includes('/reports/workload/meta'), { timeout: 150_000 });
    const views = this.page.waitForResponse(r => r.url().includes('/user-views?module=workload'), { timeout: 150_000 });
    await (await toolbarIcon(this.page, K.refresh)).click();
    return Promise.all([data, meta, views]);
  }
  async openMoreActions() { await (await toolbarIcon(this.page, K.moreActions)).click(); }

  /** Project-level Workload Report (Project › Reports). Same toolbar keys as the global report. */
  async gotoProject(projectId: string) {
    await this.page.goto(`${env.baseUrl}/portal/${env.portal}#zp/projects/${projectId}/reports`);
    await expect(qa(this.page, K.calendar)).toBeVisible();
  }

  /** data-zpqa keys of the items in the open ••• menu, e.g. ['edit_customview','copylink_customview',…]. */
  async moreActionItems(): Promise<string[]> {
    await this.openMoreActions();
    const keys = await this.page.locator('[data-zpqa$="_customview"]').filter({ visible: true }).evaluateAll(els => els.map(e => e.getAttribute('data-zpqa')!));
    await this.page.keyboard.press('Escape');
    return keys;
  }
  /** Whether the view dropdown offers "+ Create Workload Report". */
  async canCreateFromDropdown(): Promise<boolean> {
    await this.openViews();
    const n = await qa(this.page, K.createView).filter({ visible: true }).count();
    await this.closeViews();
    return n > 0;
  }

  /** Toolbar period arrows. Each makes the view "dirty" (red dot + Save as) until saved or discarded. */
  async step(dir: 'next' | 'prev') {
    const data = this.page.waitForResponse(r => /\/reports\/workload\?/.test(r.url()) && /[?&]index=1&/.test(r.url()) && !r.url().includes('fetch_unassignee=true'), { timeout: 150_000 });
    await qa(this.page, dir === 'next' ? K.calNext : K.calPrev).click();
    return data;
  }
  /** Items of the toolbar Save as menu with their disabled state. Opens and closes the menu. */
  async saveAsItems(): Promise<Record<string, { disabled: boolean }>> {
    await qa(this.page, K.saveAs).click();
    const items = await this.page.locator(`[data-zpqa="${K.saveAsExisting}"],[data-zpqa="${K.saveAsNew}"],[data-zpqa="${K.discard}"]`).filter({ visible: true })
      .evaluateAll(els => Object.fromEntries(els.map(e => [e.getAttribute('data-zpqa')!, { disabled: e.hasAttribute('disabled') }])));
    await this.page.keyboard.press('Escape');
    return items;
  }
  /** Save as › Discard: drops the unsaved toolbar change and reloads the saved view. */
  async discard() {
    await qa(this.page, K.saveAs).click();
    await qa(this.page, K.discard).click();
    // the unsaved marker (* on the view name) is the ground truth: for some profiles the Save as element stays in the
    // DOM after Discard although the change is gone (seen 13-10-2026 with the CP profile)
    // only VISIBLE toolbar elements count: some profiles' pages keep a hidden toolbar skeleton with stale state (13-10-2026)
    await expect.poll(async () => {
      const saveAsShown = await qa(this.page, K.saveAs).filter({ visible: true }).count();
      const names = await qa(this.page, K.viewDropdown).filter({ visible: true }).allInnerTexts();
      return saveAsShown === 0 || names.every(n => !n.includes('*'));
    }, { message: 'toolbar change discarded', timeout: 60_000 }).toBe(true);
  }
}
