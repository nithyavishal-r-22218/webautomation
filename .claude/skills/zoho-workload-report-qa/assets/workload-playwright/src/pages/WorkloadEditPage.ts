import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { CSS, K, qa } from '../locators';
import { parseShown, shown, type Unit } from '../dates';
import { toolbarIcon } from './WorkloadPage';

export type ViewType = 'bar' | 'heatmap' | 'timeline';
export type ViewStyle = 'gantt' | 'timeline';
export type Mode = 'Relative' | 'Custom';

/** Custom-period picker, as confirmed live by the Java suite (WorkloadReportLocators). */
const PICKER = {
  ok: "[data-zpqa='footer-cur-ok']",
  days: 'lyte-daterangepicker',                         // has no box of its own: never wait for it to be visible
  rangePanels: '.range-calendar-container ruc-calendar', // Weeks / Months: start and end panels
};

export interface FormState {
  viewType?: ViewType; unit?: Unit; mode?: string; option?: string; customRange?: string;
  viewStyle?: ViewStyle; dataLabel?: string; showOptions?: Record<string, boolean>; description: string;
}

/**
 * The Edit / Create Workload Report form. Uses real pointer events throughout: the app's ruc-* controls
 * ignore synthetic `.click()` on the inner <input>.
 */
export class WorkloadEditPage {
  constructor(readonly page: Page) {}

  private tabEl = (name: 'Time Period' | 'Report Preference' | 'Criteria' | 'Grouping') =>
    this.page.getByText(name, { exact: true }).filter({ visible: true }).first();
  /** A radio group is identified by a value only it contains (avoids the shared value "timeline"). */
  private group = (anchorValue: string) =>
    this.page.locator('ruc-radio-group', { has: this.page.locator(`input[value="${anchorValue}"]`) }).filter({ visible: true }).first();
  private radio = (anchorValue: string, value: string) =>
    this.group(anchorValue).locator(CSS.radio, { has: this.page.locator(`input[value="${value}"]`) });
  private selects = () => this.page.locator(CSS.select).filter({ visible: true });

  async openEdit() {
    await (await toolbarIcon(this.page, K.moreActions)).click();
    // The "More Actions" tooltip covers this item when the menu opens: click by locator, never by position.
    await qa(this.page, K.edit).click();
    await expect(qa(this.page, K.save)).toBeVisible();
  }
  async tab(name: Parameters<WorkloadEditPage['tabEl']>[0]) { await this.tabEl(name).click(); }

  async setDescription(text: string) { await qa(this.page, K.description).fill(text); }
  async setViewType(v: ViewType) { await this.radio('heatmap', v).click(); }
  async setUnit(u: Unit) { await this.tab('Time Period'); await this.radio('days', u).click(); }
  async setViewStyle(s: ViewStyle) { await this.tab('Report Preference'); await this.radio('gantt', s).click(); }

  private async pick(select: Locator, text: string) {
    await select.locator(CSS.selectOpener).click();
    await this.page.locator(CSS.option).filter({ visible: true }).getByText(text, { exact: true }).click();
    await expect(select.locator(CSS.selectText)).toHaveText(text);
  }
  private async options(select: Locator) {
    await select.locator(CSS.selectOpener).click();
    const opts = await this.page.locator(CSS.option).filter({ visible: true }).allInnerTexts();
    await select.locator(CSS.selectOpener).click(); // close
    return opts.map(s => s.trim()).filter(Boolean);
  }

  async setMode(mode: Mode) { await this.tab('Time Period'); await this.pick(this.selects().nth(0), mode); }
  async relativeOptions() { await this.setMode('Relative'); return this.options(this.selects().nth(1)); }
  async setRelative(option: string) { await this.setMode('Relative'); await this.pick(this.selects().nth(1), option); }
  async dataLabelOptions() { await this.tab('Report Preference'); return this.options(this.selects().nth(0)); }
  async setDataLabel(label: string) { await this.tab('Report Preference'); await this.pick(this.selects().nth(0), label); }
  async setShowOption(name: 'Task Title' | 'Project Title', on: boolean) {
    await this.tab('Report Preference');
    const cb = this.page.locator(CSS.checkbox).filter({ hasText: name }).filter({ visible: true });
    if ((await cb.getAttribute('rc-checked')) !== String(on)) await cb.click();
  }

  /** The custom range input (value "<date> to <date>" in the UI's date order). */
  async rangeInput(): Promise<Locator> {
    const inputs = this.page.locator('input').filter({ visible: true });
    const n = await inputs.count();
    for (let i = 0; i < n; i++) if (/\d{2}-\d{2}-\d{4} to /.test(await inputs.nth(i).inputValue())) return inputs.nth(i);
    throw new Error('Custom range input not found — is the mode set to Custom?');
  }

  /**
   * Custom range via the picker. Days: day cells in two month panels ("Oct 2026" headers);
   * Weeks: click any day of the start week and of the end week; Months: month cells in two year panels.
   * The picker can reposition after the first click, so every click re-locates its target.
   */
  async setCustom(unit: Unit, start: Date, end: Date) {
    await this.setMode('Custom');
    await (await this.rangeInput()).click();
    if (await this.setCustomByDataDate(unit, start, end)) return;
    const picker = this.page.locator('div', { has: this.page.getByText('OK', { exact: true }) })
      .filter({ has: this.page.getByText('Cancel', { exact: true }) }).filter({ visible: true }).last();
    const mon = (d: Date) => d.toLocaleString('en-US', { month: 'short' });
    for (const d of [start, end]) {
      if (unit === 'months') {
        const panel = picker.locator('xpath=.//*[normalize-space(text())="' + d.getFullYear() + '"]/ancestor::*[.//*[normalize-space(text())="Jan"]][1]');
        await this.navigateTo(picker, panel, `${d.getFullYear()}`);
        await panel.getByText(mon(d), { exact: true }).click();
      } else {
        const title = `${mon(d)} ${d.getFullYear()}`;
        const panel = picker.locator(`xpath=.//*[normalize-space(text())="${title}"]/ancestor::*[.//*[normalize-space(text())="SUN"]][1]`);
        await this.navigateTo(picker, panel, title);
        const cells = panel.getByText(String(d.getDate()), { exact: true });
        // Leading cells belong to the previous month and trailing cells to the next one.
        await (d.getDate() < 15 ? cells.first() : cells.last()).click();
      }
    }
    await picker.getByText('OK', { exact: true }).click();
  }
  /**
   * Fast path with the locators the Java suite (~/UIautomation) confirmed live: Days uses lyte-daterangepicker cells
   * keyed by data-date (the UI's date order); Weeks/Months use two ruc-calendar panels (start, end) whose cells are
   * keyed by the date (weeks) or the full month name (months). Returns false when a target is not rendered (date
   * outside the two visible months, or months of another year), so the caller falls back to navigating.
   */
  private async setCustomByDataDate(unit: Unit, start: Date, end: Date): Promise<boolean> {
    const ok = this.page.locator(PICKER.ok).filter({ visible: true }).first();
    if (unit === 'days') {
      const cell = (d: Date) => this.page.locator(`${PICKER.days} [role='gridcell'][data-date='${shown(d)}']`).first();
      if (!(await cell(start).count()) || !(await cell(end).count())) return false;
      await cell(start).click();
      await this.page.waitForFunction(a => [...document.querySelectorAll('lyte-daterangepicker')]
        .some(p => p.getAttribute('selected-date1') === a && !p.getAttribute('selected-date2')), shown(start), { timeout: 10_000 });
      // The picker sets selected-date1 before it accepts the second click; an immediate end click restarts the range.
      await this.page.waitForTimeout(700);
      await cell(end).click();
      await this.page.waitForFunction(([a, b]) => [...document.querySelectorAll('lyte-daterangepicker')]
        .some(p => p.getAttribute('selected-date1') === a && p.getAttribute('selected-date2') === b), [shown(start), shown(end)], { timeout: 10_000 });
    } else {
      const panels = this.page.locator(PICKER.rangePanels);
      if ((await panels.count()) < 2) return false;
      const key = (d: Date) => unit === 'months' ? d.toLocaleString('en-US', { month: 'long' }) : shown(d);
      const pairs: [Locator, Date][] = [[panels.nth(0), start], [panels.nth(1), end]];
      for (const [panel, d] of pairs) {
        if (!(await panel.locator(`[role='gridcell'][data-date='${key(d)}']`).count())) return false;
        if (unit === 'months' && !(await panel.innerText()).includes(String(d.getFullYear()))) return false;
      }
      for (const [panel, d] of pairs) await panel.locator(`[role='gridcell'][data-date='${key(d)}']`).first().click();
    }
    await ok.click();
    return true;
  }
  private async navigateTo(picker: Locator, panel: Locator, title: string) {
    // the right-most ">" arrow advances the right panel; the left-most "<" goes back (past ranges, e.g. on restore)
    for (let i = 0; i < 24 && !(await panel.count()); i++)
      await picker.getByText('›').or(picker.locator('[class*=next]')).last().click();
    for (let i = 0; i < 48 && !(await panel.count()); i++)
      await picker.getByText('‹').or(picker.locator('[class*=prev]')).first().click();
    if (!(await panel.count())) throw new Error(`Picker panel "${title}" not reachable — re-confirm picker locators`);
  }

  async formState(): Promise<FormState> {
    const read = async () => this.page.evaluate(() => {
      const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
      const radios = [...document.querySelectorAll('ruc-radio-button')].filter(r => vis(r) && /ruc-checked/.test(r.className))
        .map(r => (r.querySelector('input') as HTMLInputElement | null)?.value ?? '');
      const selects = [...document.querySelectorAll('ruc-select')].filter(vis)
        .map(s => (s.querySelector('.zselectbox__text') as HTMLElement | null)?.innerText.trim() ?? '');
      const range = [...document.querySelectorAll('input')].filter(i => vis(i) && /\d{2}-\d{2}-\d{4}/.test(i.value)).map(i => i.value)[0];
      const checks = Object.fromEntries([...document.querySelectorAll('ruc-checkbox')].filter(vis)
        .map(c => [(c as HTMLElement).innerText.trim(), c.getAttribute('rc-checked') === 'true']));
      return { radios, selects, range, checks };
    });
    await this.tab('Time Period');
    const tp = await read();
    await this.tab('Report Preference');
    const rp = await read();
    const viewType = tp.radios.find(r => ['bar', 'heatmap', 'timeline'].includes(r)) as ViewType | undefined;
    return {
      viewType,
      unit: tp.radios.find(r => ['days', 'weeks', 'months'].includes(r)) as Unit | undefined,
      mode: tp.selects[0], option: tp.selects[0] === 'Relative' ? tp.selects[1] : undefined, customRange: tp.range,
      viewStyle: viewType === 'timeline' ? undefined : (rp.radios.find(r => ['gantt', 'timeline'].includes(r) && r !== viewType) as ViewStyle | undefined),
      dataLabel: rp.selects[0], showOptions: rp.checks,
      description: await qa(this.page, K.description).inputValue(),
    };
  }

  /** The open date picker (the panel that holds OK and Cancel). */
  picker(): Locator {
    return this.page.locator('div', { has: this.page.getByText('OK', { exact: true }) })
      .filter({ has: this.page.getByText('Cancel', { exact: true }) }).filter({ visible: true }).last();
  }
  async openPicker() { await (await this.rangeInput()).click(); await expect(this.picker()).toBeVisible(); }
  async setName(text: string) { await qa(this.page, K.name).fill(text); }

  /** Click Save `times` times quickly and count the PUTs the app sends (WL-D-12). */
  async saveClicks(times: number): Promise<number> {
    let puts = 0;
    const onReq = (r: { url(): string; method(): string }) => { if (r.url().includes('/reports/custom-workload') && r.method() === 'PUT') puts++; };
    this.page.on('request', onReq);
    const btn = qa(this.page, K.save);
    if (times === 2) await btn.dblclick(); else for (let i = 0; i < times; i++) await btn.click({ noWaitAfter: true }).catch(() => {});
    await this.page.waitForLoadState('networkidle').catch(() => {});
    await this.page.waitForTimeout(1500);
    this.page.off('request', onReq);
    return puts;
  }

  /** Save and wait for the PUT plus the first reloaded data page. */
  async save(): Promise<{ put: Response; data: Response }> {
    const put = this.page.waitForResponse(r => r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT');
    const data = this.page.waitForResponse(r => /\/reports\/workload\?/.test(r.url()) && /[?&]index=1&/.test(r.url()) && !r.url().includes('fetch_unassignee=true'));
    await qa(this.page, K.save).click();
    const [p, d] = await Promise.all([put, data]);
    expect([200, 201], 'PUT /reports/custom-workload (200 update, 201 create)').toContain(p.status());
    return { put: p, data: d };
  }
  async cancel() { await qa(this.page, K.cancel).click(); await expect(qa(this.page, K.save)).toBeHidden(); }

  /**
   * Show Options exist only on the Timeline type, so for other types they are read by switching the
   * (unsaved) form to Timeline. Call while the edit form is open; leaves the form on Timeline.
   */
  async timelineShowOptions(): Promise<Record<string, boolean>> {
    await this.setViewType('timeline');
    return (await this.formState()).showOptions ?? {};
  }

  /**
   * Re-apply a snapshot taken with formState() — used to leave the portal as it was. `timelineOptions`
   * (from timelineShowOptions()) puts the hidden Show Options back on views that are not Timeline.
   */
  async restore(s: FormState, timelineOptions?: Record<string, boolean>) {
    await this.openEdit();
    if (s.viewType !== 'timeline' && timelineOptions) {
      await this.setViewType('timeline');
      for (const [k, v] of Object.entries(timelineOptions)) await this.setShowOption(k as 'Task Title', v);
    }
    if (s.viewType) await this.setViewType(s.viewType);
    if (s.unit) await this.setUnit(s.unit);
    if (s.mode === 'Relative' && s.option) await this.setRelative(s.option);
    if (s.mode === 'Custom' && s.customRange && s.unit) {
      const [a, b] = s.customRange.split(' to ').map(parseShown);
      await this.setCustom(s.unit, a, b);
    }
    if (s.viewStyle) await this.setViewStyle(s.viewStyle);
    if (s.dataLabel) await this.setDataLabel(s.dataLabel);
    if (s.viewType === 'timeline' && s.showOptions) for (const [k, v] of Object.entries(s.showOptions)) await this.setShowOption(k as 'Task Title', v);
    await this.setDescription(s.description);
    await this.save();
  }
}
