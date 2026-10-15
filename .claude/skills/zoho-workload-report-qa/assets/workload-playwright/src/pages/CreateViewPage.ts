import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { CSS, K, qa } from '../locators';
import { WorkloadEditPage } from './WorkloadEditPage';
import type { WorkloadPage } from './WorkloadPage';

/**
 * View dropdown › "+ Create Workload Report" (URL #zp/reports/workload/custom-view/create), seen 14-10-2026.
 *
 *   name `input_customviewname`, description `cviewdescription`, view type radios (bar / heatmap / timeline)
 *   tabs `tab_determiner` (Criteria) · `tab_view_period` · `tab_grouping` · `tab_report_preference`
 *   Criteria: <zp-criteria> › <criteria-group>: match `input_criteria-all-radio` (AND) / `input_criteria-any-radio` (OR),
 *     `clear_all_criteria`; each <criteria-row>: `.field-select-class ruc-select` (value = field code),
 *     `.comparator-select-class ruc-select` (value = condition code), a value control (token field for lists, input
 *     otherwise), `add_cri_row` (+) adds a row
 *   Grouping: two ruc-selects — field (None · Profiles · Roles · Reporting Manager · User/Resource) and order (Asc · Desc)
 *   Report Preference: Reports For (users = Task Owner / teams = Associated Teams), view style (gantt / timeline),
 *     Data Label (No Legend + allocated/available hours, minutes, man days, percentage …)
 *   Share `input_share_cview` › `input_alluser_cview` (public) / `input_specificusr_cview` (shared) + "Select User"
 *   Accessibility `input_cview_otherproj` › `input_cview_allproj` (all_projects) / `input_cview_specificproj` (selected_projects)
 *   Save `bt_save_customview` → PUT /reports/custom-workload (201); Cancel `bt_cancel_customview`
 */
export class CreateViewPage extends WorkloadEditPage {
  constructor(page: Page) { super(page); }

  async open(wl: WorkloadPage) {
    await wl.openViews();
    await qa(this.page, K.createView).filter({ visible: true }).first().click();
    await expect(qa(this.page, K.name), 'create form open').toBeVisible({ timeout: 90_000 });
    await expect(this.page.getByText('Create Workload Report', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  }
  async openTab(t: 'determiner' | 'view_period' | 'grouping' | 'report_preference') { await qa(this.page, `tab_${t}`).click(); }

  // ---------- selects (ruc-select: real clicks on the opener, then the list item) ----------
  async selectOptions(sel: Locator): Promise<string[]> {
    await sel.locator(CSS.selectOpener).click();
    const items = this.page.locator(CSS.option).filter({ visible: true });
    await items.first().waitFor({ timeout: 10_000 }).catch(() => {});
    const opts = (await items.allInnerTexts()).map(s => s.trim()).filter(Boolean);
    await this.page.keyboard.press('Escape');
    return opts;
  }
  async choose(sel: Locator, text: string) {
    await sel.locator(CSS.selectOpener).click();
    await this.page.locator(CSS.option).filter({ visible: true }).getByText(text, { exact: true }).first().click();
    await expect(sel, `"${text}" selected`).toContainText(text);
  }
  /** The internal code of a select (field or condition): its hidden <select>'s value, else the component's attribute. */
  value = (sel: Locator) => sel.evaluate(e => (e.querySelector('select') as HTMLSelectElement | null)?.value || e.getAttribute('value') || ((e as any).ltProp ? String((e as any).ltProp('selected') ?? '') : ''));

  // ---------- criteria ----------
  rows = () => this.page.locator('zp-criteria criteria-row').filter({ visible: true });
  fieldSel = (i: number) => this.rows().nth(i).locator('.field-select-class ruc-select').first();
  condSel = (i: number) => this.rows().nth(i).locator('.comparator-select-class ruc-select').first();
  /** The value control: a token field (list values), a select, a date or a plain input. */
  valueBox = (i: number) => this.rows().nth(i).locator('.condition-select-class').first();
  async match(mode: 'AND' | 'OR') {
    await this.openTab('determiner');
    await this.page.locator(CSS.radio, { has: qa(this.page, mode === 'AND' ? 'input_criteria-all-radio' : 'input_criteria-any-radio') }).click();
  }
  async addRow() {
    const n = await this.rows().count();
    await this.rows().nth(n - 1).locator('[data-zpqa="add_cri_row"]').click();
    await expect(this.rows()).toHaveCount(n + 1);
  }
  async removeRow(i: number) {
    const n = await this.rows().count();
    await this.rows().nth(i).locator('[class*=delete], [class*=remove], [data-zpqa*=del]').first().click();
    await expect(this.rows()).toHaveCount(n - 1);
  }
  async clearAll() { await this.openTab('determiner'); await qa(this.page, 'clear_all_criteria').click(); }

  /** What the value control of row i is, and its options when it is a list. */
  async describeValue(i: number): Promise<{ kind: string; options: string[]; tabs: string[] }> {
    const box = this.valueBox(i);
    if (!(await box.count())) {
      const anyInput = this.rows().nth(i).locator('input:not([type=radio]):not(.zdropdownlist__searchfield)').filter({ visible: true });
      return { kind: (await anyInput.count()) ? 'input' : 'none', options: [], tabs: [] };
    }
    const tag = await box.evaluate(e => e.tagName.toLowerCase() + (e.querySelector('.ztokenfield') ? ':token' : '') + (e.querySelector('input[type=number]') ? ':number' : ''));
    const tabs = (await box.locator('.ruc-tab, [role=tab]').allInnerTexts().catch(() => [])).map(s => s.trim()).filter(Boolean);
    let options: string[] = [];
    if (/token/.test(tag)) {
      await box.locator('.ztokenfield__textbox').click();
      const items = this.page.locator(CSS.option).filter({ visible: true });
      await items.first().waitFor({ timeout: 8_000 }).catch(() => {});
      options = (await items.allInnerTexts()).map(s => s.trim()).filter(Boolean);
      await this.page.keyboard.press('Escape');
    } else if (/ruc-select/.test(tag)) options = await this.selectOptions(box);
    return { kind: tag, options, tabs };
  }

  /** Field + condition + value(s) on row i. Values: list labels (token field), or text typed into the input. */
  async criterion(i: number, field: string, condition: string, values: string[] = []) {
    await this.openTab('determiner');
    while ((await this.rows().count()) <= i) await this.addRow();
    await this.choose(this.fieldSel(i), field);
    await this.choose(this.condSel(i), condition);
    if (!values.length) return;
    const box = this.valueBox(i);
    if (await box.locator('.ztokenfield').count()) {
      for (const v of values) {
        const tb = box.locator('.ztokenfield__textbox');
        await tb.click(); await tb.pressSequentially(v.slice(0, 12));
        await this.page.locator(CSS.option).filter({ visible: true }).getByText(v, { exact: true }).first().click();
      }
      await this.page.keyboard.press('Escape');
    } else {
      const inp = this.rows().nth(i).locator('input:not([type=radio]):not(.zdropdownlist__searchfield):not(.ztokenfield__textbox)').filter({ visible: true });
      for (let k = 0; k < values.length; k++) { await inp.nth(k).click(); await inp.nth(k).pressSequentially(values[k]!); }
    }
  }

  // ---------- grouping ----------
  groupSelects = () => this.page.locator('.custvw-tempstyle-container ruc-select').filter({ visible: true });
  /** Choose a grouping. Returns the options offered when `field` is not one of them (e.g. Timeline offers only None). */
  async grouping(field: string, order: 'Asc' | 'Desc' = 'Asc'): Promise<string[] | null> {
    await this.openTab('grouping');
    const offered = await this.selectOptions(this.groupSelects().nth(0));
    if (!offered.includes(field)) return offered;
    await this.choose(this.groupSelects().nth(0), field);
    if (field !== 'None') await this.choose(this.groupSelects().nth(1), order);
    return null;
  }

  // ---------- report preference ----------
  async reportsFor(v: 'users' | 'teams') {
    await this.openTab('report_preference');
    await this.page.locator(CSS.radio, { has: this.page.locator(`input[value="${v}"]`) }).filter({ visible: true }).first().click();
  }

  // ---------- share / accessibility ----------
  private async tick(label: string, on: boolean) {
    // located by its label text and clicked like the edit form's Show Options (a click on the bare input is ignored)
    const cb = this.page.locator(CSS.checkbox).filter({ hasText: label }).filter({ visible: true }).first();
    await cb.scrollIntoViewIfNeeded();
    const state = () => cb.evaluate(e => /\bruc-checked\b/.test(e.className) || !!(e.querySelector('input') as HTMLInputElement | null)?.checked);
    if ((await state()) !== on) await cb.getByText(label, { exact: true }).click();
    await expect.poll(state, { message: `${label} ${on ? 'ticked' : 'cleared'}` }).toBe(on);
  }
  private async radioKey(key: string) {
    // the share / project choices are ruc-radio-buttons on some builds and plain labelled inputs on others
    const input = qa(this.page, key).first();
    await input.waitFor({ state: 'attached', timeout: 30_000 });
    const holder = input.locator('xpath=ancestor::*[self::ruc-radio-button or self::label or contains(@class,"radio")][1]');
    if (await holder.count()) { await holder.scrollIntoViewIfNeeded(); await holder.click(); } else await input.click({ force: true });
    await expect.poll(() => input.isChecked(), { message: `${key} selected`, timeout: 10_000 }).toBe(true);
  }
  /** none = not shared; all = every user; users = the named users only. */
  async share(mode: 'none' | 'all' | 'users', users: string[] = []) {
    await this.tick('Share Workload Report with other Users', mode !== 'none');
    if (mode === 'none') return;
    await this.radioKey(mode === 'all' ? 'input_alluser_cview' : 'input_specificusr_cview');
    for (const u of users) await this.pickFromTokenField('Select User', u);
  }
  /** none = this report only; all = every project; projects = the named projects only. */
  async otherProjects(mode: 'none' | 'all' | 'projects', projects: string[] = []) {
    await this.tick('Show Workload Report in other Projects', mode !== 'none');
    if (mode === 'none') return;
    await this.radioKey(mode === 'all' ? 'input_cview_allproj' : 'input_cview_specificproj');
    for (const p of projects) await this.pickFromTokenField('Select Project', p);
  }
  private async pickFromTokenField(placeholder: string, text: string) {
    const tb = this.page.locator(`input[placeholder^="${placeholder}"]`).filter({ visible: true }).first()
      .or(this.page.getByText(placeholder, { exact: false }).filter({ visible: true }).first());
    await tb.click(); await this.page.keyboard.type(text.slice(0, 10));
    await this.page.locator(CSS.option).filter({ visible: true }).getByText(text, { exact: false }).first().click();
    await this.page.keyboard.press('Escape');
  }

  /** Save and wait for the create (PUT 201) and the new view's first data page. */
  async create(): Promise<{ put: Response; body: Record<string, any>; id: string }> {
    const put = this.page.waitForResponse(r => r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT', { timeout: 150_000 });
    await qa(this.page, K.save).click();
    const p = await put;
    const body = JSON.parse(p.request().postData() ?? '{}');
    const json = await p.json().catch(() => ({}));
    return { put: p, body, id: String(json.id ?? json.custom_view_id ?? '') };
  }
}
