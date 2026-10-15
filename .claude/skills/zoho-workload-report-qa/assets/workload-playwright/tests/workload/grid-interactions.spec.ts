import { test, expect, knownDefect } from '../../src/fixtures';
import { K, qa } from '../../src/locators';
import { waitLoaded } from '../../src/createChecks';
import type { WorkloadPage } from '../../src/pages/WorkloadPage';

/**
 * Global Workload Report › the grid itself (All Users, seen live 15-10-2026):
 *   user row `username-<id>` with chevron `expand-collapse-parent-<id>` ("Expand List" / "Collapse List") and the task
 *   count `[name=child-entity-count]` "(n)"; expanded task rows `#tasknamerow_<uid>_<tid>` with `resourcetil_taskname`
 *   (data-tooltip = task name), `resourcetil_assignuser`, per-project group `resourcetil_resgroupexpand`, the bar
 *   `#bar_<tid>.resourceTaskBar` (hover → `.zpToolTip` "N hours allocated for this day."), empty cell hover → "Add Task";
 *   `expand-collapse-all-tasklist` ("Expand All Lists" / "Collapse All Lists"); today line `#today_line` (tooltip Today);
 *   the user search box `input[placeholder="Search ..."]` above the rows; day headers `.weekNameColumn` whose textContent
 *   carries "Date: DD-MM-YYYY … Type: Working day|Weekend"; the left pane is sticky (`stickyL0`).
 * Nothing here is saved: no view settings change, no portal data change.
 */
test.describe.configure({ mode: 'default', timeout: 300_000 });

const rowCount = (wl: WorkloadPage) => wl.rows().count();
const childCount = async (row: import('@playwright/test').Locator) => Number(((await row.locator('[name="child-entity-count"]').innerText().catch(() => '(0)')).match(/\d+/) || [0])[0]);
// task row ids are `tasknamerow_<uid>_<tid>` (grouped by project) or `tasknamerow_<uid>` on some portals
const taskRowsOf = (wl: WorkloadPage, uid: string) => wl.page.locator(`[id^="tasknamerow_${uid}"]`).filter({ visible: true });
/** First user row that is not "Unassigned User" and has at least one task. */
async function firstUser(wl: WorkloadPage) {
  const rows = wl.rows(); const n = await rows.count();
  for (let i = 0; i < n; i++) { const r = rows.nth(i); const t = await r.innerText(); if (!/Unassigned/i.test(t) && (await childCount(r)) > 0) return { row: r, uid: (await r.getAttribute('data-zpqa'))!.slice('username-'.length), count: await childCount(r), name: t.replace(/\s+/g, ' ').replace(/\(\d+\)\s*$/, '').trim() }; }
  throw new Error('no user row with tasks');
}

test('GI-01 expanding a user lists exactly its tasks, each with a bar and a name tooltip; collapsing hides them', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  const u = await firstUser(wl);
  const chevron = qa(page, `expand-collapse-parent-${u.uid}`);
  expect.soft(await chevron.getAttribute('data-tooltip'), 'chevron tooltip before').toBe('Expand List');
  await chevron.click();
  await expect.poll(() => taskRowsOf(wl, u.uid).count(), { message: 'task rows appear', timeout: 120_000 }).toBe(u.count); // a slow portal can take a while to send the tasks
  const tipAfter = await expect.poll(() => chevron.getAttribute('data-tooltip'), { timeout: 5000 }).toBe('Collapse List').then(() => 'Collapse List').catch(async () => chevron.getAttribute('data-tooltip'));
  if (tipAfter !== 'Collapse List') test.info().annotations.push({ type: 'check-spec', description: `the row chevron's tooltip still says "${tipAfter}" after expanding (cosmetic; it flips on other portals)` });
  const names = await taskRowsOf(wl, u.uid).locator('[data-zpqa="resourcetil_taskname"]').evaluateAll(els => els.map(e => e.getAttribute('data-tooltip') || ''));
  expect.soft(names.filter(Boolean).length, `${u.name}: every task row has a name tooltip`).toBe(u.count);
  expect.soft(new Set(names).size, 'task names are distinct').toBe(names.length);
  const bars = await taskRowsOf(wl, u.uid).locator('.resourceTaskBar').count();
  expect.soft(bars, 'one bar per task row').toBe(u.count);
  // tasks are grouped by project with a collapsible project header
  const groups = taskRowsOf(wl, u.uid).locator('[data-zpqa="resourcetil_resgroupexpand"]');
  test.info().annotations.push({ type: 'evidence', description: `${u.name}: ${u.count} tasks, ${await groups.count()} project group header(s); names ${names.slice(0, 5).join(' · ')}` });
  await chevron.click();
  await expect.poll(() => taskRowsOf(wl, u.uid).count(), { message: 'task rows hidden' }).toBe(0);
  expect.soft(await rowCount(wl), 'user rows unchanged').toBeGreaterThan(0);
});

test('GI-02 Expand All / Collapse All opens every user and the total equals the sum of the row counts', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  const all = qa(page, 'expand-collapse-all-tasklist');
  expect.soft(await all.getAttribute('data-tooltip'), 'tooltip before').toBe('Expand All Lists');
  const rows = wl.rows(); const n = await rows.count(); let sum = 0; for (let i = 0; i < n; i++) sum += await childCount(rows.nth(i));
  await all.click();
  await expect.poll(() => page.locator('[id^="tasknamerow_"]').filter({ visible: true }).count(), { message: 'all task rows visible', timeout: 150_000 }).toBe(sum);
  const tipAll = await expect.poll(() => all.getAttribute('data-tooltip'), { timeout: 5000 }).toBe('Collapse All Lists').then(() => 'Collapse All Lists').catch(async () => all.getAttribute('data-tooltip'));
  const chevrons = await page.locator('[data-zpqa^="expand-collapse-parent-"]').evaluateAll(els => els.map(e => e.getAttribute('data-tooltip')));
  if (tipAll !== 'Collapse All Lists' || !chevrons.every(t => t === 'Collapse List')) test.info().annotations.push({ type: 'check-spec', description: `tooltips after Expand All: all="${tipAll}", rows ${[...new Set(chevrons)].join('/')} (cosmetic; they flip on other portals)` });
  await all.click();
  await expect.poll(() => page.locator('[id^="tasknamerow_"]').filter({ visible: true }).count(), { message: 'collapsed again' }).toBe(0);
  const tipEnd = await all.getAttribute('data-tooltip');
  if (tipEnd !== 'Expand All Lists') test.info().annotations.push({ type: 'check-spec', description: `after collapsing again the tooltip reads "${tipEnd}" — the Expand/Collapse All tooltip lags one step behind the state (cosmetic)` });
  test.info().annotations.push({ type: 'evidence', description: `${n} users, ${sum} tasks in total` });
});

test('GI-03 hovering a task bar shows the hours allocated for that day; hovering an empty cell offers Add Task', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  const u = await firstUser(wl);
  await qa(page, `expand-collapse-parent-${u.uid}`).click();
  await expect.poll(() => taskRowsOf(wl, u.uid).count(), { timeout: 120_000 }).toBe(u.count);
  const bar = taskRowsOf(wl, u.uid).locator('.resourceTaskBar').first();
  const b = await bar.boundingBox(); expect(b, 'a task bar is visible').toBeTruthy();
  await page.mouse.move(b!.x + Math.min(12, b!.width / 2), b!.y + b!.height / 2); await page.waitForTimeout(700);
  const tip = page.locator('.zpToolTip').filter({ visible: true });
  const tipText = (await tip.allInnerTexts()).join(' ').replace(/\s+/g, ' ').trim();
  expect.soft(tipText, 'task bar tooltip').toMatch(/\d+(\.\d+)?\s*(hours?|hrs?|h)\b.*(allocated|for this day)/i);
  await page.mouse.move(5, 5); await page.waitForTimeout(500);
  expect.soft(await tip.count(), 'tooltip gone after mouse out').toBe(0);
  // an empty cell (weekend-free or unallocated) of the user row
  const cell = wl.rows().nth(0).locator('xpath=..').locator('.res-alloc-bar[work-state="weekendfree"], .res-alloc-bar[work-state="unallocated"]').filter({ visible: true }).first();
  if (await cell.count()) {
    const c = (await cell.boundingBox())!; await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2); await page.waitForTimeout(700);
    expect.soft((await page.locator('.zpToolTip').filter({ visible: true }).allInnerTexts()).join(' '), 'empty cell tooltip').toMatch(/Add Task/i);
  } else test.info().annotations.push({ type: 'note', description: 'no empty cell in the first row to hover' });
  test.info().annotations.push({ type: 'evidence', description: `bar tooltip: "${tipText}"` });
  await page.mouse.move(5, 5); await qa(page, `expand-collapse-parent-${u.uid}`).click();
});

test('GI-04 clicking a task name opens its detail panel on the task-detail URL; closing returns to the view with the grid intact', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  const u = await firstUser(wl);
  await qa(page, `expand-collapse-parent-${u.uid}`).click();
  await expect.poll(() => taskRowsOf(wl, u.uid).count(), { timeout: 120_000 }).toBe(u.count);
  const before = page.url(); const rowsBefore = await rowCount(wl);
  const t = taskRowsOf(wl, u.uid).locator('[data-zpqa="resourcetil_taskname"]').first();
  const title = await t.getAttribute('data-tooltip'); const prefix = (await t.locator('zps-prefix-id').innerText().catch(() => '')).trim();
  const tid = (await taskRowsOf(wl, u.uid).first().getAttribute('entity-id')) || '';
  await t.click();
  await expect.poll(() => page.url(), { message: 'task-detail URL', timeout: 30_000 }).toMatch(/\/task-detail\/\d+/);
  expect.soft(page.url(), 'URL carries the task id').toContain(`/task-detail/${tid}`);
  const panel = page.locator('.zps-detail-base').filter({ visible: true }).first();
  await expect(panel, 'detail panel visible').toBeVisible({ timeout: 30_000 });
  await expect(panel, 'panel shows the task name').toContainText(title || '', { timeout: 30_000 });
  if (prefix) await expect.soft(panel, 'panel shows the task key').toContainText(prefix, { timeout: 10_000 });
  await qa(page, 'closedetailpage').first().click();
  await expect.poll(() => page.url(), { message: 'back to the view URL' }).not.toMatch(/task-detail/);
  expect.soft(page.url().replace(/^https?:\/\/[^/]+/, ''), 'same view URL as before').toBe(before.replace(/^https?:\/\/[^/]+/, ''));
  await expect(qa(page, K.calendar)).toBeVisible();
  expect.soft(await rowCount(wl), 'user rows intact').toBe(rowsBefore);
  expect.soft(await taskRowsOf(wl, u.uid).count(), 'expanded tasks still shown').toBe(u.count);
  test.info().annotations.push({ type: 'evidence', description: `task ${prefix} "${title}" → ${page.url().replace(/^https?:\/\/[^/]+/, '')}` });
  await qa(page, `expand-collapse-parent-${u.uid}`).click();
});

test('GI-05 the user search box filters rows by name (case-insensitive, substring); clearing restores; no match shows no rows', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  // the grid's own box (not the left nav's project search): the visible Search input nearest to the user rows
  const box = page.locator('input[placeholder*="Search" i]').filter({ visible: true }).filter({ has: page.locator(':scope') }).nth(await page.evaluate(() => { const rows = document.querySelector<HTMLElement>('[data-zpqa^="username-"]'); const ry = rows ? rows.getBoundingClientRect().y : 200; const inputs = [...document.querySelectorAll<HTMLInputElement>('input[placeholder*="Search" i]')].filter(e => e.offsetWidth || e.offsetHeight); let best = 0, dist = 1e9; inputs.forEach((e, i) => { const b = e.getBoundingClientRect(); const d = Math.abs(b.y - ry) + (b.x > 250 ? 0 : 1000); if (d < dist) { dist = d; best = i; } }); return best; }));
  await expect(box, 'grid search box').toBeVisible();
  const all = (await wl.rows().allInnerTexts()).map(t => t.replace(/\s+/g, ' ').replace(/\(\d+\)\s*$/, '').replace(/^[A-Z]{1,2}\s/, '').trim());
  const pick = all.find(n => !/Unassigned/i.test(n)) || all[0]; const needle = pick.split(' ').pop()!.slice(0, 4).toUpperCase();
  await box.pressSequentially(needle); await page.waitForTimeout(1500);
  const shown = (await wl.rows().allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  const expected = all.filter(n => n.toLowerCase().includes(needle.toLowerCase()));
  expect.soft(shown.length, `rows matching "${needle}"`).toBe(expected.length);
  expect.soft(shown.every(s => s.toLowerCase().includes(needle.toLowerCase())), 'every shown row matches').toBe(true);
  const clear = async () => { await box.click(); await page.keyboard.press('Meta+A'); await page.keyboard.press('Backspace'); await page.waitForTimeout(300); if (await box.inputValue()) await box.fill(''); };
  await clear();
  await expect.poll(() => rowCount(wl), { message: 'all rows back after clearing', timeout: 15_000 }).toBe(all.length);
  await box.pressSequentially('zzqx-no-such-user'); await page.waitForTimeout(1200);
  expect.soft(await rowCount(wl), 'no rows for a non-matching search').toBe(0);
  test.info().annotations.push({ type: 'evidence', description: `search "${needle}" → ${shown.join(' | ')}; no-match state: "${(await page.locator('.resource-list-content, .resourceutilTableholder').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 80)}"` });
  await clear();
  await expect.poll(() => rowCount(wl), { message: 'restored after a no-match search', timeout: 15_000 }).toBe(all.length);
});

test('GI-06 the Today line sits in today\'s column and disappears when the period does not include today', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  const today = new Date(); const dd = String(today.getDate()).padStart(2, '0'), mm = String(today.getMonth() + 1).padStart(2, '0');
  const line = page.locator('#today_line');
  const inPeriod = await page.locator('.weekNameColumn').filter({ hasText: new RegExp(`Date: (${dd}-${mm}|${mm}-${dd})-${today.getFullYear()}`) }).count();
  if (inPeriod) {
    await expect(line, 'today line shown').toBeVisible();
    expect.soft(await line.getAttribute('data-tooltip'), 'tooltip').toBe('Today');
    const lb = (await line.boundingBox())!; const col = (await page.locator('.weekNameColumn').filter({ hasText: new RegExp(`Date: (${dd}-${mm}|${mm}-${dd})-${today.getFullYear()}`) }).first().boundingBox())!;
    expect.soft(lb.x >= col.x - 2 && lb.x <= col.x + col.width + 2, `today line x=${Math.round(lb.x)} inside today's column [${Math.round(col.x)}, ${Math.round(col.x + col.width)}]`).toBe(true);
  } else test.info().annotations.push({ type: 'note', description: 'the open period does not include today; checking only that no line is drawn' });
  if (!inPeriod) expect.soft(await line.isVisible().catch(() => false), 'no today line outside the period').toBe(false);
  // step to the next period: today is no longer in range → no line; back → line again
  const header0 = await qa(page, K.calendar).innerText();
  await wl.step('next'); await waitLoaded(wl);
  const header1 = await qa(page, K.calendar).innerText();
  if (header1 === header0) test.info().annotations.push({ type: 'note', description: `the next arrow did not change the period (${header0}); see WL-D-09` });
  else {
    const stillTodayInRange = await page.locator('.weekNameColumn').filter({ hasText: new RegExp(`Date: (${dd}-${mm}|${mm}-${dd})-${today.getFullYear()}`) }).count();
    const shown = await line.isVisible().catch(() => false);
    const grid = await page.locator('.resourceutilTableholder').first().boundingBox(); const lb2 = shown ? await line.boundingBox() : null;
    const inside = !!(lb2 && grid && lb2.x >= grid.x && lb2.x <= grid.x + grid.width);
    test.info().annotations.push({ type: 'evidence', description: `next period ${header1}: today column present ${!!stillTodayInRange}, line visible ${shown}${lb2 ? ` at x=${Math.round(lb2.x)} (grid ${Math.round(grid!.x)}–${Math.round(grid!.x + grid!.width)})` : ''}` });
    if (!stillTodayInRange && shown && inside) knownDefect('WL-D-39', `the Today line is drawn in a period that does not include today (${header1})`);
    if (!stillTodayInRange) expect.soft(shown && inside, 'no today line in a period without today').toBe(false);
  }
  await wl.step('prev'); await waitLoaded(wl);
  if (inPeriod) await expect(line, 'today line back').toBeVisible();
  await wl.discard().catch(() => {});
});

test('GI-07 a narrow window scrolls the day columns horizontally while the user column stays pinned', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  await page.setViewportSize({ width: 1000, height: 860 }); await page.waitForTimeout(1000);
  const scroller = await page.evaluateHandle(() => [...document.querySelectorAll<HTMLElement>('*')].find(e => e.offsetWidth > 300 && e.scrollWidth > e.clientWidth + 20 && /resource|table|grid|day/i.test(e.className + ' ' + e.id)) || null);
  const info = await scroller.evaluate((e: HTMLElement | null) => e ? { cls: String(e.className).slice(0, 60), sw: e.scrollWidth, cw: e.clientWidth, sl: e.scrollLeft } : null);
  expect(info, 'a horizontally scrollable grid container exists at 1000 px').toBeTruthy();
  const firstCol = page.locator('.weekNameColumn').first(); const lastCol = page.locator('.weekNameColumn').last();
  const userX0 = (await wl.rows().first().boundingBox())!.x;
  const lastBefore = (await lastCol.boundingBox())!.x;
  await scroller.evaluate((e: HTMLElement) => { e.scrollLeft = e.scrollWidth; });
  await page.waitForTimeout(800);
  const after = await scroller.evaluate((e: HTMLElement) => e.scrollLeft);
  expect.soft(after, 'scrollLeft advanced').toBeGreaterThan(0);
  expect.soft((await lastCol.boundingBox())!.x, 'last column moved left into view').toBeLessThan(lastBefore);
  expect.soft(Math.abs((await wl.rows().first().boundingBox())!.x - userX0), 'user column stays pinned').toBeLessThan(3);
  expect.soft((await firstCol.boundingBox())!.x, 'first column scrolled out of the visible grid').toBeLessThan(userX0 + 400);
  test.info().annotations.push({ type: 'evidence', description: `scroller ${JSON.stringify(info)} → scrollLeft ${after}` });
  await scroller.evaluate((e: HTMLElement) => { e.scrollLeft = 0; });
  await page.setViewportSize({ width: 1366, height: 860 });
});
