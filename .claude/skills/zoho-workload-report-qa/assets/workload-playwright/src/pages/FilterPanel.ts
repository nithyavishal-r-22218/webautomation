import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { K, qa } from '../locators';
import { env } from '../env';
import { toolbarIcon } from './WorkloadPage';

/** User/Resource filter values and the codes the app sends (resource_type: 1 = Users, 6 = Resources). */
export type UserResource = 'users' | 'resources';
export const USER_RESOURCE_CODE: Record<UserResource, string> = { users: '1', resources: '6' };
export type FilterCondition = 'Is' | 'Is Not';
export const CONDITION_CODE: Record<FilterCondition, string> = { 'Is': 'is', 'Is Not': 'is_not' };

export interface OwnerRow { id: string; name: string; isResource: boolean; totalWork: number; availability: number; allocation: string }
/** What the app's own data responses said after a Find (all pages, plus the Unassigned request). */
export interface DataCapture { owners: Map<string, OwnerRow>; unassignedIds: Set<string>; filters: string[] }

/**
 * Value control a section shows for a condition (seen live 12-10-2026, 36 sections):
 *  picklist / multipicklist  checkbox list  (label[data-zpqa=resourceutil_<field>_<id>], input#<field>_<id>)
 *  userpicklist              user list      ([data-zpqa=resourceutil_drpdwn_<field>_<id>], hidden input#<field>_<id>); Team Members tab = radio list
 *  singleline / Double       text input     ([data-zpqa=resourceutil_<field>_value0]; `between` adds _value1)
 *  multiline                 textarea       ([data-zpqa=resourceutil_<field>_value])
 *  Date                      relative codes need no value; between/less_than/greater_than = Range tab (number + day(s) before/after);
 *                            is / <= / >= / not_between = Date tab (read-only inputs #datavalue<n>_<field> with a calendar)
 *  is_empty / all_open / all_closed  show a disabled text box: no value
 */
export type FieldType = 'picklist' | 'multipicklist' | 'userpicklist' | 'singleline' | 'multiline' | 'Double' | 'Date' | string;
export interface ConditionOption { code: string; text: string }
export interface FilterSection { field: string; label: string; ftype: FieldType; group: string; conditions: ConditionOption[] }
export interface ValueOption { id: string; label: string; kind: 'checkbox' | 'radio' | 'user'; checked: boolean }
export interface Criterion { field_name: string; criteria_condition: string; value: string[]; module_name?: string }

/** Conditions that take no value (the value box is disabled). */
export const NO_VALUE_CONDITIONS = new Set(['is_empty', 'all_open', 'all_closed', 'select',
  'today', 'till_yesterday', 'unscheduled', 'yesterday', 'tomorrow', 'this_week', 'this_month', 'last_week', 'last_month',
  'next_7_days', 'next_week', 'next_month', 'next_30_days']);
/** Date conditions on the Range tab (N day(s) before/after a reference date, typed as numbers). */
export const DATE_RANGE_CONDITIONS = new Set(['between', 'less_than', 'greater_than']);
/** Date conditions on the Date tab (calendar pick). */
export const DATE_PICK_CONDITIONS = new Set(['is', 'less_than_or_equal', 'greater_than_or_equal', 'not_between']);
export const TWO_VALUE_CONDITIONS = new Set(['between', 'not_between']);

/**
 * Toolbar › Filter panel (the funnel icon). Applying a filter is a toolbar change: the view gets "*" and Save as;
 * nothing is saved until Save as, so callers Clear filter and Discard afterwards.
 *
 * Panel anatomy (ids are the app's; data-zpqa keys all start with `resourceutil_`):
 *   #filterdiv_<field>  section · #fltcatcheck_<field> expanded state · label[data-zpqa=resourceutil_fltcheck_<field>] header
 *   [data-zpqa=resourceutil_selcondiv_<field>] condition selector · [data-zpqa=resourceutil_condval_<field>_<code>] its options
 *   #subgroup_<field> tabs (.tab-item#subgrptit_<field>_<value>) · #filtval_<field> value area (ftype attribute)
 *   #selcount_<field> count badge · [data-zpqa=resourceutil_clearfilter_<field>] section × · resourceutil_reset_filter Reset
 */
export class FilterPanel {
  constructor(readonly page: Page) {}

  /** The panel never leaves the DOM: closed = its container has the class slide-hide (seen live 09-10-2026). */
  popup() { return this.page.locator('div.zps-filter-popup').first(); }
  async isOpen() { return (await this.popup().count()) > 0 && !/\bslide-hide\b/.test((await this.popup().getAttribute('class')) ?? ''); }

  async open() {
    for (let attempt = 0; attempt < 3 && !(await this.isOpen()); attempt++) {
      await (await toolbarIcon(this.page, K.filter)).click(); // a click right after a reload can be lost: retry
      await expect.poll(() => this.isOpen(), { timeout: 5_000 }).toBe(true).catch(() => {});
    }
    await expect.poll(() => this.isOpen(), { message: 'filter panel open' }).toBe(true);
    await expect(this.popup().locator('[data-zpqa^="resourceutil_fltcheck_"]').first(), 'panel sections shown').toBeVisible();
  }
  /** Cancel closes the panel; a stray pop-up (calendar, condition list) can swallow the click, so Escape and the funnel are fallbacks. */
  async cancel() {
    await this.page.keyboard.press('Escape').catch(() => {});
    await qa(this.page, K.filterCancel).click({ timeout: 10_000 }).catch(() => {});
    if (await this.isOpen()) await expect.poll(() => this.isOpen(), { timeout: 5_000 }).toBe(false).catch(() => {});
    if (await this.isOpen()) { await this.page.keyboard.press('Escape'); await qa(this.page, K.filterCancel).click({ timeout: 10_000 }).catch(() => {}); }
    if (await this.isOpen()) await (await toolbarIcon(this.page, K.filter)).click().catch(() => {});
    await expect.poll(() => this.isOpen(), { message: 'filter panel closed' }).toBe(false);
  }

  // ---------- sections ----------
  /** Every section with its field key, label, value type and condition options (all in the DOM, expanded or not). */
  async sections(): Promise<FilterSection[]> {
    return this.popup().evaluate(root => [...root.querySelectorAll<HTMLElement>('[data-zpqa^="resourceutil_fltcheck_"]')].map(h => {
      const field = h.getAttribute('data-zpqa')!.replace('resourceutil_fltcheck_', '');
      const group = h.closest('.filter-category-group')?.id.replace('filtergroup_body_', '') ?? '';
      const conditions = [...root.querySelectorAll<HTMLElement>(`[data-zpqa^="resourceutil_condval_${field}_"]`)]
        .map(o => ({ code: o.getAttribute('value') ?? '', text: (o.textContent ?? '').trim() }));
      return { field, label: (h.textContent ?? '').trim(), ftype: root.querySelector(`#filtval_${field}`)?.getAttribute('ftype') ?? '', group, conditions };
    }));
  }
  header(field: string) { return this.popup().locator(`[data-zpqa="resourceutil_fltcheck_${field}"]`); }
  isExpanded(field: string) { return this.page.locator(`#fltcatcheck_${field}`).isChecked(); }
  async expand(field: string) {
    if (!(await this.header(field).isVisible())) await this.open(); // a toggled-twice funnel click can leave the panel closed
    if (!(await this.isExpanded(field))) await this.header(field).click({ timeout: 10_000 });
    await expect(this.page.locator(`#fltcatcheck_${field}`), `${field} expanded`).toBeChecked();
    await this.page.locator(`#zpfilter_${field}`).scrollIntoViewIfNeeded().catch(() => {});
    // the value area loads lazily (some lists come from the API); a list section with no values in this portal
    // (e.g. Tags on a portal without tags, seen 12-10-2026) shows text instead of controls and is left empty
    const area = this.page.locator(`#filtval_${field}`);
    await expect.poll(async () => (await area.locator('input, textarea').count()) > 0 || ((await area.innerText().catch(() => '')).trim().length > 0),
      { timeout: 20_000, message: `${field}: value area loaded` }).toBe(true);
  }
  async collapse(field: string) {
    if (await this.isExpanded(field)) await this.header(field).click({ timeout: 10_000 });
    await expect(this.page.locator(`#fltcatcheck_${field}`), `${field} collapsed`).not.toBeChecked();
  }
  /** Number on the section's count badge (0 when hidden). */
  async selectionCount(field: string): Promise<number> {
    const b = this.page.locator(`#selcount_${field}`);
    if (!(await b.isVisible())) return 0;
    return Number((await b.innerText()).trim() || 0);
  }
  /** The section's own × (visible once it has a value). */
  async clearSection(field: string) {
    const x = this.popup().locator(`[data-zpqa="resourceutil_clearfilter_${field}"]`);
    if (await x.isVisible()) await x.click({ timeout: 10_000 });
  }
  /** Reset (panel header): clears every section's choice without a data request (checked in the panel spec). */
  async reset() { await qa(this.page, K.filterReset).click({ timeout: 10_000 }); }

  // ---------- condition ----------
  conditionSelector(field: string) { return this.popup().locator(`[data-zpqa="resourceutil_selcondiv_${field}"]`); }
  async conditionOf(field: string): Promise<string> { return (await this.conditionSelector(field).locator('span').first().getAttribute('value')) ?? ''; }
  async conditionTextOf(field: string): Promise<string> { return (await this.conditionSelector(field).innerText()).trim(); }
  /** Pick a condition by its code (e.g. is_not, greater_than_or_equal). Long lists scroll, so the option is centred first. */
  async setConditionOf(field: string, code: string) {
    if ((await this.conditionOf(field)) === code) return;
    if (!(await this.conditionSelector(field).isVisible())) await this.expand(field); // the selector shows only on an expanded section
    await this.conditionSelector(field).click({ timeout: 10_000 });
    const opt = this.popup().locator(`[data-zpqa="resourceutil_condval_${field}_${code}"]`);
    await expect(opt, `condition option ${code} offered for ${field}`).toBeAttached();
    // Long lists (Allocation, Date) scroll inside the pop-up and have a search box: narrow the list to the option
    const search = this.popup().locator(`[data-zpqa="resourceutil_condsearch_${field}"] input`);
    if (await search.isVisible()) { await search.fill(''); await search.pressSequentially((await opt.innerText()).trim(), { delay: 20 }); }
    await opt.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await opt.click({ timeout: 10_000 });
    await expect.poll(() => this.conditionOf(field), { message: `${field} condition ${code}` }).toBe(code);
  }

  // ---------- tabs (Allocation Hours/Percentage, Owner Users/Team Members, Date Range/Date) ----------
  async tabs(field: string): Promise<{ value: string; text: string; active: boolean }[]> {
    const sub = this.page.locator(`#subgroup_${field}`);
    if (!(await sub.isVisible())) return [];
    return sub.locator('.tab-item').evaluateAll(els => els.map(t => ({ value: t.getAttribute('value') ?? '', text: (t.textContent ?? '').trim(), active: t.classList.contains('active') })));
  }
  async selectTab(field: string, value: string) {
    const t = this.page.locator(`#subgrptit_${field}_${value}`);
    if (!/\bactive\b/.test((await t.getAttribute('class')) ?? '')) await t.click({ timeout: 10_000 });
    await expect(t, `${field} tab ${value}`).toHaveClass(/\bactive\b/);
  }

  // ---------- values ----------
  valueArea(field: string) { return this.page.locator(`#filtval_${field}`); }
  /** Options of a list section (after expand): id = the value the request sends, label = what the chip shows. */
  async valueOptions(field: string): Promise<ValueOption[]> {
    return this.valueArea(field).evaluate((el, field) => [...el.querySelectorAll<HTMLInputElement>('input[type=checkbox], input[type=radio]')].map(i => {
      const id = i.id.replace(`${field}_`, '');
      const user = el.querySelector<HTMLElement>(`[data-zpqa="resourceutil_drpdwn_${field}_${id}"]`);
      const label = el.querySelector<HTMLElement>(`label[for="${i.id}"]`);
      const text = user ? (user.querySelector<HTMLElement>('span.pt1-5rem, label span:last-child')?.textContent ?? user.textContent ?? '')
        : (label?.getAttribute('data-tooltip') ?? label?.textContent ?? i.title ?? '');
      return { id, label: text.replace(/\s+/g, ' ').trim(), kind: user ? 'user' as const : i.type as 'checkbox' | 'radio', checked: i.checked };
    }), field);
  }
  async tickedIds(field: string): Promise<string[]> { return (await this.valueOptions(field)).filter(o => o.checked).map(o => o.id).sort(); }
  private clickable(field: string, o: ValueOption): Locator {
    return o.kind === 'user' ? this.popup().locator(`[data-zpqa="resourceutil_drpdwn_${field}_${o.id}"]`)
      : this.popup().locator(`label[data-zpqa="resourceutil_${field}_${o.id}"]`);
  }
  /** Make the ticked values exactly `ids` (radio lists: click the one id). The list search box is used for long lists. */
  async tickIds(field: string, ids: string[]) {
    const options = await this.valueOptions(field);
    for (const o of options) {
      const want = ids.includes(o.id);
      if (o.kind === 'radio') { if (want && !o.checked) await this.clickable(field, o).click({ timeout: 10_000 }); continue; }
      if (o.checked !== want) {
        const c = this.clickable(field, o);
        await c.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await c.click({ timeout: 10_000 });
      }
    }
    await expect.poll(() => this.tickedIds(field), { message: `${field} ticked ${ids}` }).toEqual([...ids].sort());
  }
  /** Type into the section's search box (user and status lists have one). */
  async searchValues(field: string, text: string) {
    const s = this.popup().locator(`[data-zpqa="resourceutil_search_${field}"]`);
    await s.click({ timeout: 10_000 }); await s.fill(''); await s.pressSequentially(text, { delay: 30 });
  }
  valueInput(field: string, n = 0) {
    return this.popup().locator(`[data-zpqa="resourceutil_${field}_value${n}"], [data-zpqa="resourceutil_${field}_value"]`).first();
  }
  /** Key a value in (fill() is not seen by the app's handlers; keystrokes are). */
  async typeValue(field: string, text: string, n = 0) {
    const el = this.valueInput(field, n);
    const target = (await el.evaluate(e => e.tagName)) === 'INPUT' || (await el.evaluate(e => e.tagName)) === 'TEXTAREA' ? el : el.locator('input, textarea').first();
    await target.click({ timeout: 10_000 });
    await target.press('ControlOrMeta+a'); await target.press('Backspace');
    await target.pressSequentially(text, { delay: 30 });
    await target.press('Tab');
    await expect(target, `${field} value ${n}`).toHaveValue(text);
  }
  async typedValue(field: string, n = 0): Promise<string> {
    const el = this.valueInput(field, n);
    const tag = await el.evaluate(e => e.tagName);
    return tag === 'INPUT' || tag === 'TEXTAREA' ? el.inputValue() : el.locator('input, textarea').first().inputValue();
  }
  /** Whether the value box is disabled (no-value conditions such as Is Empty / All Open). */
  async valueDisabled(field: string): Promise<boolean> {
    const i = this.valueArea(field).locator('input, textarea').first();
    return (await i.count()) === 0 || (await i.isDisabled()) || (await i.getAttribute('readonly')) !== null && (await i.getAttribute('placeholder')) === 'Please select a criteria';
  }
  /**
   * Date tab: open the calendar of date box n and click a day. The calendar is the app-wide `#zppopupcal`
   * (`data-zpqa=zppopcal`, seen 12-10-2026): day cells `td.zdatetimepicker__date[data-time=<local midnight ms>]`,
   * month arrows `#zppopupcal-left-month-0` / `#zppopupcal-right-month-0`; picking a day fills the box and closes it.
   */
  async pickDate(field: string, n: number, day: Date) {
    const box = this.page.locator(`#datavalue${n}_${field}`);
    await box.click({ timeout: 10_000 });
    const cal = this.page.locator('#zppopupcal');
    await expect(cal, 'calendar shown').toBeVisible();
    await pickCalendarDay(cal, day);
    await expect(box, 'date box filled').not.toHaveValue('');
  }
  async dateValue(field: string, n = 0): Promise<string> { return this.page.locator(`#datavalue${n}_${field}`).inputValue(); }

  // ---------- Find / chips / Clear ----------
  /** Record every workload data response (all pages + Unassigned) from now on; call stop() when done. */
  capture(): { data: DataCapture; stop: () => void } {
    const data: DataCapture = { owners: new Map(), unassignedIds: new Set(), filters: [] };
    const on = async (r: Response) => {
      if (!/\/reports\/workload\?/.test(r.url()) || !r.ok()) return;
      const u = new URL(r.url());
      data.filters.push(u.searchParams.get('filter') ?? '');
      const j = await r.json().catch(() => ({}));
      for (const o of (j.owners ?? []) as { id: string; name: string; is_resource?: boolean; work?: { total_work?: number; total_availability?: number; overall_allocation?: string } }[]) {
        if (u.searchParams.get('fetch_unassignee') === 'true') { data.unassignedIds.add(String(o.id)); continue; }
        data.owners.set(String(o.id), toOwnerRow(o));
      }
    };
    this.page.on('response', on);
    return { data, stop: () => this.page.off('response', on) };
  }
  /** The first filtered data page. 150 s: the request may be held up to a 2-minute window by the API budget (src/rate.ts). */
  private firstPage() {
    return this.page.waitForResponse(r => /\/reports\/workload\?/.test(r.url()) && /[?&]index=1&/.test(r.url()) && !r.url().includes('fetch_unassignee=true'), { timeout: 150_000 });
  }
  /** Find, and wait for the filtered first data page. */
  async find() { const data = this.firstPage(); await qa(this.page, K.filterFind).click({ timeout: 10_000 }); return data; }
  /** Find when no data request is expected (returns after a short wait). */
  async findNoWait() { await qa(this.page, K.filterFind).click({ timeout: 10_000 }); await this.page.waitForTimeout(2_000); }
  /**
   * The chip bar under the toolbar (`#filt_cont_value`): "<Label>: <Condition>" (`resourceutil_filType_<field>`), one
   * `.filter-category-items[value=<id>]` per value with its own ×, a "+N" badge when values overflow the row, and
   * "Clear filter" (`resourceutil_filter_clear`) — which the overflow pushes out of view (seen 12-10-2026, 8 values).
   */
  chipBar() { return this.page.locator('#filt_cont_value'); }
  /** Text of the chip bar, e.g. "User/Resource: Is Not Resources Clear filter" ('' when no filter is applied). */
  async chips(): Promise<string> {
    const bar = this.chipBar();
    if (!(await bar.count()) || !(await bar.isVisible())) return '';
    return (await bar.innerText()).replace(/\s+/g, ' ').trim();
  }
  /** Values the chip bar holds per section (ids), including the ones folded into "+N". */
  async chipValues(field: string): Promise<string[]> {
    return this.chipBar().locator(`.filter-category-items[name="filType_${field}"]`).evaluateAll(es => es.map(e => e.getAttribute('value') ?? ''));
  }
  async chipOverflow(): Promise<number> {
    const m = (await this.chips()).match(/\+(\d+)\b/);
    return m ? Number(m[1]) : 0;
  }
  clearFilterVisible() { return qa(this.page, K.filterClear).isVisible(); }
  /** "Show More" (`resourceutil_more_filter`, a ⌄ / "+N" control): expands the chip bar to a second row that holds Clear filter. */
  showMore() { return qa(this.page, 'resourceutil_more_filter'); }
  async expandChips() { if (await this.showMore().isVisible()) await this.showMore().click({ timeout: 10_000 }); }
  /** Click the × of one value chip: the app re-queries with the remaining values. */
  async removeChipValue(field: string, id: string) {
    const data = this.firstPage();
    await this.chipBar().locator(`.filter-category-items[name="filType_${field}"][value="${id}"] i.zoho-close`).click({ timeout: 10_000 });
    return data;
  }
  async clear() { const data = this.firstPage(); await qa(this.page, K.filterClear).click({ timeout: 10_000 }); return data; }

  // ---------- User/Resource shorthand (kept for filter-user-resource.spec.ts) ----------
  private box(v: UserResource) { return this.page.locator(`#resourcetype_${USER_RESOURCE_CODE[v]}`); }
  async expandUserResource() { await this.expand('resourcetype'); }
  async condition(): Promise<string> { return this.conditionTextOf('resourcetype'); }
  async setCondition(c: FilterCondition) { await this.setConditionOf('resourcetype', CONDITION_CODE[c]); }
  async setValues(values: UserResource[]) { await this.tickIds('resourcetype', values.map(v => USER_RESOURCE_CODE[v])); }
  async ticked(): Promise<UserResource[]> {
    const out: UserResource[] = [];
    for (const v of ['users', 'resources'] as UserResource[]) if (await this.box(v).isChecked()) out.push(v);
    return out;
  }
}

export function toOwnerRow(o: { id: string; name: string; is_resource?: boolean; work?: { total_work?: number; total_availability?: number; overall_allocation?: string } }): OwnerRow {
  return { id: String(o.id), name: o.name, isResource: !!o.is_resource, totalWork: Number(o.work?.total_work ?? 0),
    availability: Number(o.work?.total_availability ?? 0), allocation: String(o.work?.overall_allocation ?? '') };
}

/**
 * Click `day` in the `#zppopupcal` calendar: cells carry `data-time` = that day's local midnight in ms (the browser
 * runs in the machine's zone, as the app does). Steps month by month with the arrows when the day is not shown.
 */
export async function pickCalendarDay(cal: Locator, day: Date) {
  const page = cal.page();
  const wantMonth = day.getFullYear() * 12 + day.getMonth();
  const shownMonth = async () => {
    const t = (await cal.locator('.zdatetimepicker__monthyearnav').innerText()).replace(/\s+/g, ' ').trim(); // "Oct 2026"
    const d = new Date(`${t.split(' ')[0]} 1, ${t.split(' ')[1]}`);
    return d.getFullYear() * 12 + d.getMonth();
  };
  for (let step = 0; step < 24 && (await shownMonth()) !== wantMonth; step++) {
    await cal.locator((await shownMonth()) > wantMonth ? '#zppopupcal-left-month-0' : '#zppopupcal-right-month-0').click({ timeout: 10_000 });
    await page.waitForTimeout(250);
  }
  // the day inside the shown month (adjacent-month cells carry zdatetimepicker__adjacentmonthdate); data-time as a fallback
  const byText = cal.locator('td.zdatetimepicker__date:not(.zdatetimepicker__adjacentmonthdate)').filter({ hasText: new RegExp(`^\\s*${day.getDate()}\\s*$`) }).first();
  const byTime = cal.locator(`td.zdatetimepicker__date[data-time="${new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()}"]`).first();
  const cell = (await byText.count()) ? byText : byTime;
  if (!(await cell.count())) {
    await page.screenshot({ path: `${env.reportsDir}/filter-calendar-${Date.now()}.png` }).catch(() => {});
    throw new Error(`calendar: day ${day.toDateString()} not found in the ${await cal.locator('.zdatetimepicker__monthyearnav').innerText()} grid`);
  }
  await cell.locator('span.zdatetimepicker__text').first().click({ timeout: 10_000 }).catch(() => cell.click({ timeout: 10_000 }));
  await expect(cal, 'calendar closes after the pick').toBeHidden({ timeout: 10_000 }).catch(() => page.keyboard.press('Escape'));
}

/** All criteria inside a request's filter parameter ([] when none / unparsable). */
export function criteriaOf(filterParam: string): Criterion[] {
  try {
    const f = JSON.parse(filterParam || '{}') as { criteria?: Criterion[] };
    return (f.criteria ?? []).map(c => ({ ...c, value: [...(c.value ?? [])].map(String) }));
  } catch { return []; }
}
/** The resource_type criterion inside a request's filter parameter, normalised for comparison (null = none). */
export function resourceTypeCriterion(filterParam: string): { condition: string; values: string[] } | null {
  const c = criteriaOf(filterParam).find(x => x.field_name === 'resource_type');
  return c ? { condition: c.criteria_condition, values: [...c.value].sort() } : null;
}
