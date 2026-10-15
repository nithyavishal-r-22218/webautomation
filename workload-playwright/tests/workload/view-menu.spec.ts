import { test, expect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { K, qa } from '../../src/locators';
import { waitLoaded, leaveToAllUsers, removeView } from '../../src/createChecks';
import { env } from '../../src/env';
import type { WorkloadPage } from '../../src/pages/WorkloadPage';

/**
 * Global Workload Report › view dropdown search, ••• Delete and Set as default — as UI flows (seen live 15-10-2026):
 *   dropdown `topbar_cview` › `search_input` filters every group by substring; ••• `delete_customview` opens the alert
 *   `.zpcustomalert` "Delete Workload Report?" / "This cannot be undone." with checkbox `popup_confirm` ("I understand…"),
 *   `popup_success` Delete (disabled until ticked) and `popup_cancel`; ••• `my_anchor_customview` "Set as default view".
 * Every QA view is created by API and deleted; the user's default view is snapshotted and restored.
 */
test.describe.configure({ mode: 'default', timeout: 300_000 });

async function pickView(wl: WorkloadPage, name: string) {
  const loaded = wl.page.waitForResponse(r => /\/reports\/workload\?/.test(r.url()), { timeout: 150_000 });
  await wl.openViews(); await wl.page.locator('.customview-name').filter({ hasText: name }).filter({ visible: true }).first().click();
  await loaded; await waitLoaded(wl);
}
const visibleNames = (wl: WorkloadPage) => wl.page.locator('.customview-name').filter({ visible: true }).allInnerTexts().then(a => a.map(s => s.trim()));
const currentView = async (wl: WorkloadPage) => (await wl.selection())[0];
/** user-views names predefined views by i18n key (zp.workload.customview.allusers = All Users) */
/** the label shown in the dropdown for a user-views name */
const labelOf = (n: string) => n === 'zp.workload.customview.allusers' ? 'All Users' : n;
const same = (a: string, b: string) => a === b || a.replace(/^zp\.workload\.customview\./, '') === b.toLowerCase().replace(/[^a-z]/g, '') || b.replace(/^zp\.workload\.customview\./, '') === a.toLowerCase().replace(/[^a-z]/g, '');

test('VM-01 ••• Delete on an own view: confirm dialog, Delete disabled until acknowledged, Cancel keeps it, confirm removes it', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d); await waitLoaded(wl);
  const name = `${env.runId}-VM-01`; let id = '';
  try {
    id = await api.createView(name); await page.reload(); await wl.goto(); await pickView(wl, name);
    await wl.openMoreActions(); await qa(page, K.deleteView).click();
    const dlg = page.locator('.zpcustomalert').filter({ visible: true }).first();
    await expect(dlg, 'confirm dialog').toBeVisible({ timeout: 10_000 });
    const text = (await dlg.innerText()).replace(/\s+/g, ' ');
    expect.soft(text, 'dialog title').toMatch(/Delete Workload Report\?/);
    expect.soft(text, 'dialog warning').toMatch(/cannot be undone/i);
    expect.soft(text, 'acknowledgement text').toMatch(/I understand/i);
    const del = dlg.locator('[data-zpqa="popup_success"]'), cancel = dlg.locator('[data-zpqa="popup_cancel"]');
    expect.soft(await del.isDisabled(), 'Delete disabled before acknowledging').toBe(true);
    await cancel.click(); await expect(dlg, 'closed by Cancel').toBeHidden();
    expect.soft((await api.allViews()).has(name), 'view still exists after Cancel').toBe(true);
    expect.soft(await currentView(wl), 'view still open').toContain(name);
    // again, acknowledge and delete
    await wl.openMoreActions(); await qa(page, K.deleteView).click(); await expect(dlg).toBeVisible();
    await dlg.locator('label[for^="zpcustomalert-checkbox"]').click();
    await expect.poll(() => del.isDisabled(), { message: 'Delete enabled after acknowledging' }).toBe(false);
    const call = page.waitForResponse(r => r.request().method() === 'DELETE' && /\/(views|user-views)\//.test(r.url()), { timeout: 60_000 });
    await del.click();
    const r = await call;
    expect.soft(r.status(), `the UI's own ${r.request().method()} ${new URL(r.url()).pathname.replace(/^.*\/portal\/\d+/, '')}`).toBe(204);
    await expect(dlg, 'dialog closed').toBeHidden({ timeout: 10_000 });
    await expect.poll(async () => (await api.allViews()).has(name), { message: 'gone from the API list', timeout: 20_000 }).toBe(false);
    await waitLoaded(wl);
    const now = await currentView(wl);
    expect.soft(now, 'the report moved off the deleted view').not.toContain(name);
    await wl.openViews(); expect.soft((await visibleNames(wl)).includes(name), 'gone from the dropdown').toBe(false); await wl.closeViews();
    test.info().annotations.push({ type: 'evidence', description: `after delete the report shows "${now}"; DELETE → ${r.status()}` });
    id = '';
  } finally { await leaveToAllUsers(wl).catch(() => {}); if (id) await removeView(api, id, name); }
});

test('VM-02 predefined views offer no Delete in •••', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  const items = await wl.moreActionItems();
  expect.soft(items.includes(K.deleteView), `All Users ••• has no Delete (${items.join(', ')})`).toBe(false);
  expect.soft(items.length, 'menu not empty').toBeGreaterThan(0);
  void page;
});

test('VM-03 the dropdown search filters every group by substring, shows nothing for no match, and the result can be opened', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d); await waitLoaded(wl);
  const name = `${env.runId}-VM-03-Zebra`; let id = '';
  try {
    id = await api.createView(name); await page.reload(); await wl.goto();
    await wl.openViews();
    const all = await visibleNames(wl);
    const box = qa(page, 'search_input').filter({ visible: true }).first();
    await expect(box, 'search box in the dropdown').toBeVisible();
    await box.pressSequentially('OVER'); await page.waitForTimeout(700);
    const over = await visibleNames(wl);
    expect.soft(over.length, 'matches for "OVER"').toBe(all.filter(n => /over/i.test(n)).length);
    expect.soft(over.every(n => /over/i.test(n)), `every shown name contains "over" (${over.join(', ')})`).toBe(true);
    expect.soft(over, 'Over-Allocated Users found').toContain('Over-Allocated Users');
    await box.fill(''); await box.pressSequentially('zebra'); await page.waitForTimeout(700);
    const zebra = await visibleNames(wl);
    expect.soft(zebra, 'the custom view is found across groups').toEqual([name]);
    await box.fill(''); await box.pressSequentially('no-such-view-xyz'); await page.waitForTimeout(700);
    expect.soft((await visibleNames(wl)).length, 'no names for no match').toBe(0);
    const empty = (await page.locator('.cvdrop-group, [class*="cvdrop"], [class*="nodata" i], [class*="empty" i]').filter({ visible: true }).allInnerTexts()).join(' ').replace(/\s+/g, ' ').trim();
    test.info().annotations.push({ type: 'evidence', description: `no-match state: "${empty.slice(0, 120)}"` });
    await box.fill(''); await page.waitForTimeout(500);
    expect.soft((await visibleNames(wl)).length, 'all names back after clearing').toBe(all.length);
    await box.pressSequentially('zebra'); await page.waitForTimeout(500);
    const loaded = page.waitForResponse(r => /\/reports\/workload\?/.test(r.url()), { timeout: 150_000 });
    await page.locator('.customview-name').filter({ hasText: name }).filter({ visible: true }).first().click(); await loaded; await waitLoaded(wl);
    expect.soft(await currentView(wl), 'the searched view opens').toContain(name);
  } finally { await leaveToAllUsers(wl); await removeView(api, id, name); }
});

test('VM-04 Set as default view: the report opens on it after reload; setting another view as default moves it', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d); await waitLoaded(wl);
  const name = `${env.runId}-VM-04`; let id = '';
  const before = [...(await api.allViews()).values()].find(v => v.is_anchored);
  const original = before ? { id: String(before.custom_view_id || before.id), name: before.name } : null;
  test.info().annotations.push({ type: 'snapshot', description: `default view before: ${original ? original.name : 'none'}` });
  const anchored = async () => [...(await api.allViews()).values()].filter(v => v.is_anchored).map(v => v.name);
  const setDefault = async (expectLabel: RegExp) => { await wl.openMoreActions(); const item = qa(page, K.setDefault); expect.soft((await item.innerText()).trim(), 'menu label').toMatch(expectLabel); await item.click(); await page.waitForTimeout(2500); };
  try {
    id = await api.createView(name); await page.reload(); await wl.goto(); await pickView(wl, name);
    await setDefault(/Set as default/i);
    expect.soft(await anchored(), 'only the QA view is anchored').toEqual([name]);
    await wl.openMoreActions(); const label = (await qa(page, K.setDefault).innerText()).trim(); await page.keyboard.press('Escape');
    // seen 15-10-2026: the item keeps saying "Set as default view" on the current default and clicking it again is a no-op —
    // the only way back is to make another view the default (there is no "remove default"). Recorded as check-spec.
    test.info().annotations.push({ type: 'check-spec', description: `••• item on the current default view reads "${label}" (no "Remove as default"); the default moves only by choosing another view` });
    await page.reload(); await wl.goto();
    expect.soft(await currentView(wl), 'reload opens the default view').toContain(name);
    // make the previous default (or All Users) the default again
    const target = original ? labelOf(original.name) : 'All Users';
    await pickView(wl, target); await setDefault(/Set as default/i);
    const after = await anchored();
    expect.soft(after.includes(name), 'QA view no longer anchored').toBe(false);
    expect.soft(after.length === 1 && same(after[0]!, target), `${target} is the default again (${after.join(', ')})`).toBe(true);
    await page.reload(); await wl.goto();
    const landed = await currentView(wl);
    expect.soft(landed, `reload opens ${target}`).toContain(target);
    test.info().annotations.push({ type: 'evidence', description: `after moving the default: anchored ${JSON.stringify(after)}, reload lands on "${landed}"` });
  } finally {
    // restore the user's default view
    try {
      const now = [...(await api.allViews()).values()].filter(v => v.is_anchored).map(v => v.name);
      if (original && !now.some(n => same(n, original.name))) { await wl.goto(); await pickView(wl, labelOf(original.name)); await wl.openMoreActions(); await qa(page, K.setDefault).click(); await page.waitForTimeout(2000); }
      const final = [...(await api.allViews()).values()].filter(v => v.is_anchored).map(v => v.name);
      expect.soft(final.length === 1 && same(final[0]!, original ? original.name : 'All Users'), `default view restored (${final.join(', ')})`).toBe(true);
    } finally { await leaveToAllUsers(wl); await removeView(api, id, name); }
  }
});
