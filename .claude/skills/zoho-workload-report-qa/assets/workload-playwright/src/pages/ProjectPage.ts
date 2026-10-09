import { expect, type Page } from '@playwright/test';
import { CSS, qa } from '../locators';
import { env } from '../env';

/**
 * A project: open it, add a resource, import tasks.
 * Keys confirmed live on 08-10-2026. Notes:
 *  - a cold deep link to #zp/projects/<id>/tasks lands on the Projects list, so we open projects from the list
 *    (the row's `open_detail` icon); clicking the name cell starts inline rename instead.
 *  - Import wizard: `import_filetype_xls`, `import_files_input`, `zpss-import-tasks`, then `zpss-it-continue`,
 *    alert `alert-OK`, `#updateStatusType`, radio `input[name=assignUser][value=mapusers]`, `#assignUserSubmit`,
 *    `#assignUsers` (Import Now); `taskimport_cancel_import` discards at any step.
 */
export class ProjectPage {
  constructor(readonly page: Page) {}

  async open(projectName: string) {
    await this.page.goto(`${env.baseUrl}/portal/${env.portal}#zp/projects`);
    const row = this.page.locator('tr, [role=row], .lyteTableRow').filter({ hasText: projectName }).first();
    await row.hover();
    await row.locator('[data-zpqa="open_detail"]').click();
    await expect(qa(this.page, 'upperTabs-Tasks')).toBeVisible();
  }
  async tab(name: 'Tasks' | 'Users' | 'Reports' | 'Dashboard') { await qa(this.page, `upperTabs-${name}`).click(); }

  /** Project › Users › (Users ▾ → Resources) › Add Resource › tick › Add. No data-zpqa keys here: text locators. */
  async addResource(resourceName: string) {
    await this.tab('Users');
    await this.page.getByText('Users', { exact: true }).filter({ visible: true }).first().click(); // the view switch
    await this.page.getByText('Resources', { exact: true }).filter({ visible: true }).last().click();
    if (await this.page.getByText(resourceName, { exact: true }).filter({ visible: true }).count()) return; // already there
    await this.page.getByText('Add Resource', { exact: true }).filter({ visible: true }).first().click();
    const row = this.page.locator('div,li,tr').filter({ hasText: resourceName }).filter({ has: this.page.locator(CSS.checkbox + ',input[type=checkbox]') }).last();
    await row.locator(`${CSS.checkbox},input[type=checkbox]`).first().click();
    await this.page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(this.page.getByText(resourceName, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  }

  /**
   * Tasks › ••• › Import Tasks with an .xlsx: date format, statuses 1:1, XLS users mapped to project users.
   * Returns when the import is scheduled (it then runs in the background — poll the tasks API).
   * `stopBefore` discards the wizard at that step instead (used to read the wizard without importing).
   */
  async importXlsx(file: string, dateFormat = 'dd/MM/yyyy', stopBefore?: 'importNow') {
    await this.tab('Tasks');
    await qa(this.page, 'other_actions').click();
    await qa(this.page, 'menu_task_import').click();
    await qa(this.page, 'import_filetype_xls').click();
    await qa(this.page, 'import_files_input').setInputFiles(file);
    await expect(qa(this.page, 'import_files_selectedfile')).toBeVisible({ timeout: 60_000 });
    await qa(this.page, 'zpss-import-tasks').click();
    await expect(qa(this.page, 'zpss-it-continue')).toBeVisible({ timeout: 60_000 });
    // "Select date format" — a zselectbox without its own key; its value shows the current format
    const fmt = this.page.locator('.zselectbox', { has: this.page.locator('.zselectbox__text', { hasText: /\b(MM|dd)[-/]/ }) }).last();
    await fmt.locator(CSS.selectOpener).click();
    await this.page.locator(CSS.option).filter({ visible: true }).filter({ hasText: new RegExp(`^${dateFormat.replace(/\//g, '\\/')}`) }).first().click();
    await expect(fmt.locator(CSS.selectText)).toContainText(dateFormat);
    await qa(this.page, 'zpss-it-continue').click();
    await qa(this.page, 'alert-OK').click();
    await this.page.locator('#updateStatusType').click();
    await this.page.locator('input[name="assignUser"][value="mapusers"]').locator('xpath=ancestor::*[self::label or self::ruc-radio-button][1]').click();
    await this.page.locator('#assignUserSubmit').click();
    if (stopBefore === 'importNow') { await qa(this.page, 'taskimport_cancel_import').click(); return; }
    await this.page.locator('#assignUsers').click();
    await expect(this.page.getByText('Import Scheduled').or(this.page.getByText('Task Import'))).toBeVisible({ timeout: 60_000 });
  }
}
