import { test, expect, knownDefect, preserveViewSettings } from '../../src/fixtures';
import { dataRequestParams } from '../../src/discover';
import { ZpApi } from '../../src/api';
import { env } from '../../src/env';
import { K, qa } from '../../src/locators';
import { expectedRange, headerText, addDays, parseShown, startOfWeek, type Range } from '../../src/dates';

/**
 * Edit › edge cases and the defects found by hand on 08-10-2026 (WL-D-07 … WL-D-12),
 * plus Cancel, field limits, toolbar Save as (Existing / New / Discard), network failure and keyboard use.
 * Runs on ZP_EDIT_VIEW (default All Users) and restores the view's settings at the end.
 */
// Not serial: every case sets what it checks, so one failure must not skip the rest. workers=1 keeps the
// order; preserveViewSettings() reuses the saved original snapshot if a new worker starts after a failure.
test.describe.configure({ mode: 'default' });
preserveViewSettings();

const today = new Date();
const monthRange = (y: number, m: number): Range => [new Date(y, m, 1), new Date(y, m + 1, 0)];
const header = (wl: { page: import('@playwright/test').Page }) => qa(wl.page, K.calendar).innerText().then(t => t.trim());

test('E-01 Cancel discards every change and sends no save', async ({ wl, edit }) => {
  await edit.openEdit();
  const before = await edit.formState();
  let puts = 0;
  wl.page.on('request', r => { if (r.url().includes('/reports/custom-workload') && r.method() === 'PUT') puts++; });
  await edit.setDescription(`${env.runId} cancel me`);
  await edit.setViewType(before.viewType === 'bar' ? 'heatmap' : 'bar');
  await edit.setUnit(before.unit === 'days' ? 'weeks' : 'days');
  await edit.cancel();
  expect(puts, 'no PUT on Cancel').toBe(0);
  await edit.openEdit();
  expect(await edit.formState(), 'form unchanged after Cancel').toEqual(before);
  await edit.cancel();
});

test('E-02 description longer than the 255-character limit is refused or truncated, never a server error', async ({ wl, edit }) => {
  const long = `${env.runId} `.padEnd(300, 'x');
  await edit.openEdit();
  await edit.setDescription(long);
  const typed = await qa(wl.page, K.description).inputValue();
  test.info().annotations.push({ type: 'maxlength', description: `field kept ${typed.length} chars` });
  const put = wl.page.waitForResponse(r => r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT', { timeout: 8000 }).catch(() => null);
  await qa(wl.page, K.save).click();
  const res = await put;
  if (res) {
    expect(res.status(), 'no 5xx for a long description').toBeLessThan(500);
    if (res.ok()) {
      await edit.openEdit();
      expect((await edit.formState()).description.length, 'saved description ≤ 255').toBeLessThanOrEqual(255);
      await edit.cancel();
    }
  } else {
    await expect(qa(wl.page, K.save), 'blocked in the form with a validation message').toBeVisible();
    await edit.cancel();
  }
});

test('WL-D-08 emoji and non-Latin text in the description round-trip @defect', async ({ edit }) => {
  knownDefect('WL-D-08', 'Emoji saved as "?"');
  const text = `${env.runId} 🚀 ✓ தமிழ் 日本`;
  await edit.openEdit(); await edit.setDescription(text); await edit.save();
  await edit.openEdit();
  expect((await edit.formState()).description).toBe(text);
  await edit.cancel();
});

test('WL-D-07 custom-range picker reopens after OK and after Cancel @defect', async ({ edit }) => {
  knownDefect('WL-D-07', 'Picker cannot be reopened after OK/Cancel');
  await edit.openEdit(); await edit.setUnit('days'); await edit.setMode('Custom');
  for (const button of ['OK', 'Cancel'] as const) {
    await edit.openPicker();
    await edit.picker().getByText(button, { exact: true }).click();
    await expect(edit.picker()).toBeHidden();
    await (await edit.rangeInput()).click();
    await expect(edit.picker(), `picker opens again after ${button}`).toBeVisible();
    await edit.picker().getByText('Cancel', { exact: true }).click();
  }
  await edit.cancel();
});

test('WL-D-11 dates beyond the 6-month custom-range limit are disabled in the picker @defect', async ({ wl, edit }) => {
  knownDefect('WL-D-11', 'Picker enables dates beyond 6 months, then OK rejects');
  await edit.openEdit(); await edit.setUnit('days');
  const start = today, tooFar = addDays(new Date(today.getFullYear(), today.getMonth() + 6, today.getDate()), 7);
  await edit.openPicker();
  const picker = edit.picker();
  const title = (d: Date) => `${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
  const panel = (d: Date) => picker.locator(`xpath=.//*[normalize-space(text())="${title(d)}"]/ancestor::*[.//*[normalize-space(text())="SUN"]][1]`);
  await panel(start).getByText(String(start.getDate()), { exact: true }).first().click();
  for (let i = 0; i < 12 && !(await panel(tooFar).count()); i++) await picker.getByText('›').or(picker.locator('[class*=next]')).last().click();
  const cell = panel(tooFar).getByText(String(tooFar.getDate()), { exact: true }).first();
  const state = await cell.evaluate(e => { const c = e.closest('[class]') as HTMLElement; return { cls: c?.className ?? '', aria: e.getAttribute('aria-disabled') ?? c?.getAttribute('aria-disabled') ?? '' }; });
  test.info().annotations.push({ type: 'cell', description: JSON.stringify(state) });
  expect(/disab|inactive|blocked/i.test(state.cls) || state.aria === 'true', `${tooFar.toDateString()} must be disabled (> 6 months)`).toBe(true);
  await picker.getByText('Cancel', { exact: true }).click();
  await edit.cancel();
  void wl;
});

test('WL-D-12 double-clicking Save sends exactly one save @defect', async ({ edit }) => {
  knownDefect('WL-D-12', 'Double-click on Save sends 2 PUTs');
  await edit.openEdit(); await edit.setDescription(`${env.runId} double click`);
  expect(await edit.saveClicks(2), 'PUT requests').toBe(1);
});

test('WL-D-10 Weeks custom range snaps to whole weeks when start and end fall in different months', async ({ edit }) => {
  test.info().annotations.push({ type: 'issue', description: 'WL-D-10 (improvement): end week must be picked on the right-hand calendar' });
  const s = new Date(today.getFullYear(), today.getMonth(), 20), e = new Date(today.getFullYear(), today.getMonth() + 1, 10);
  await edit.openEdit(); await edit.setUnit('weeks'); await edit.setCustom('weeks', s, e);
  const [a, b] = (await (await edit.rangeInput()).inputValue()).split(' to ').map(parseShown);
  expect(a.getDay(), 'starts on the week start').toBe(env.weekStart);
  expect(b.getDay(), 'ends on the last day of the week').toBe((env.weekStart + 6) % 7);
  expect(a.getTime(), 'covers the start date').toBe(startOfWeek(s, env.weekStart).getTime());
  expect(b.getTime(), 'covers the end date').toBe(addDays(startOfWeek(e, env.weekStart), 6).getTime());
  await edit.cancel();
});

test('WL-D-09 toolbar arrows move by exactly one period and Discard returns to the saved view @defect', async ({ wl, edit }) => {
  knownDefect('WL-D-09', 'Toolbar arrows step to the wrong period');
  await edit.openEdit(); await edit.setUnit('months'); await edit.setRelative('This Month'); await edit.save();
  const saved = await header(wl);
  const y = today.getFullYear(), m = today.getMonth();
  await test.step('next → next calendar month', async () => {
    const d = dataRequestParams(await wl.step('next'));
    expect.soft(await header(wl)).toBe(headerText(monthRange(y, m + 1)));
    expect.soft(d.from.slice(0, 7), 'API from').toBe(`${new Date(y, m + 1, 1).getFullYear()}-${String(new Date(y, m + 1, 1).getMonth() + 1).padStart(2, '0')}`);
  });
  await test.step('prev twice → previous calendar month', async () => {
    await wl.step('prev'); await wl.step('prev');
    expect.soft(await header(wl)).toBe(headerText(monthRange(y, m - 1)));
  });
  await wl.discard();
  expect(await header(wl), 'Discard restores the saved period').toBe(saved);

  await edit.openEdit(); await edit.setUnit('days'); await edit.setRelative('This Week'); await edit.save();
  const week = expectedRange('days', 'This Week', today, env.weekStart);
  await wl.step('next');
  expect.soft(await header(wl), 'Days › This Week + next = next week').toBe(headerText([addDays(week[0], 7), addDays(week[1], 7)]));
  await wl.discard();
});

test('E-03 Save as › Existing writes the toolbar change into the view', async ({ wl, edit }) => {
  await edit.openEdit(); await edit.setUnit('months'); await edit.setRelative('This Month'); await edit.save();
  await wl.step('next');
  const moved = await header(wl);
  const items = await wl.saveAsItems();
  expect(Object.keys(items), 'Admin sees Existing, New and Discard').toEqual(expect.arrayContaining([K.saveAsExisting, K.saveAsNew, K.discard]));
  const put = wl.page.waitForResponse(r => r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT');
  await qa(wl.page, K.saveAs).click(); await qa(wl.page, K.saveAsExisting).click();
  expect((await put).status(), 'PUT on Save as › Existing').toBe(200);
  await expect(qa(wl.page, K.saveAs), 'view no longer dirty').toBeHidden();
  await wl.goto();
  if (env.editView) await wl.selectView(env.editView);
  expect(await header(wl), 'period persisted after reload').toBe(moved);
  await edit.openEdit();
  test.info().annotations.push({ type: 'saved-form', description: JSON.stringify(await edit.formState()) });
  await edit.cancel();
});

test('E-04 Save as › New creates a separate view and leaves the current one unchanged', async ({ wl, edit }) => {
  const api = new ZpApi(wl.page, wl.d);
  const name = `${env.runId}-saveas-new`;
  try {
    const before = await header(wl);
    await wl.step('next');
    await qa(wl.page, K.saveAs).click(); await qa(wl.page, K.saveAsNew).click();
    await edit.setName(name);
    const put = wl.page.waitForResponse(r => r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT');
    await qa(wl.page, K.save).click();
    expect((await put).status(), 'create via Save as › New').toBe(201);
    expect((await api.allViews()).has(name), 'new view listed').toBe(true);
    await wl.goto();
    if (env.editView) await wl.selectView(env.editView);
    expect(await header(wl), 'original view kept its period').toBe(before);
  } finally {
    test.info().annotations.push({ type: 'cleanup', description: (await api.deleteViewsByPrefix(name)).join('; ') || 'nothing to delete' });
  }
});

test('E-05 a failed save (network error) keeps the form open and the saved view unchanged', async ({ wl, edit }) => {
  await edit.openEdit();
  const before = await edit.formState();
  await wl.page.route('**/reports/custom-workload', route => route.abort('failed'));
  await edit.setDescription(`${env.runId} offline`);
  await qa(wl.page, K.save).click();
  await wl.page.waitForTimeout(3000);
  const stillOpen = await qa(wl.page, K.save).isVisible();
  test.info().annotations.push({ type: 'ui', description: stillOpen ? 'form stayed open' : 'form closed although the save failed' });
  expect.soft(stillOpen, 'form stays open so the user can retry').toBe(true);
  await wl.page.unroute('**/reports/custom-workload');
  if (stillOpen) await edit.cancel();
  await wl.goto();
  if (env.editView) await wl.selectView(env.editView);
  await edit.openEdit();
  expect(await edit.formState(), 'nothing was saved').toEqual(before);
  await edit.cancel();
});

test('E-06 the form can be completed with the keyboard', async ({ wl, edit }) => {
  await edit.openEdit();
  await qa(wl.page, K.description).focus();
  await wl.page.keyboard.press('ControlOrMeta+A');
  await wl.page.keyboard.type(`${env.runId} keyboard`);
  let onSave = false;
  for (let i = 0; i < 80 && !onSave; i++) {
    await wl.page.keyboard.press('Tab');
    onSave = await wl.page.evaluate(k => document.activeElement?.closest(`[data-zpqa="${k}"]`) !== null, K.save);
  }
  expect(onSave, 'Save is reachable with Tab').toBe(true);
  const put = wl.page.waitForResponse(r => r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT');
  await wl.page.keyboard.press('Enter');
  expect((await put).status(), 'Enter on Save saves').toBe(200);
  await edit.openEdit();
  expect((await edit.formState()).description).toBe(`${env.runId} keyboard`);
  await wl.page.keyboard.press('Escape');
  const closed = await qa(wl.page, K.save).isHidden();
  test.info().annotations.push({ type: 'check spec', description: `Escape ${closed ? 'closes' : 'does not close'} the edit form` });
  if (!closed) await edit.cancel();
});
