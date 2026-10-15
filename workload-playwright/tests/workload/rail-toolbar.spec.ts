import { test, expect, knownDefect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { K, qa } from '../../src/locators';
import { CreateViewPage } from '../../src/pages/CreateViewPage';
import { waitLoaded, leaveToAllUsers, removeView, idOf } from '../../src/createChecks';
import { env } from '../../src/env';
import type { WorkloadPage } from '../../src/pages/WorkloadPage';

/**
 * Global Workload Report › right rail and toolbar switches (seen live 15-10-2026):
 *   rail (appears once the grid has loaded): `workload-report-fullscreen` ("Full Screen" ↔ "Exit Fullscreen", body gets
 *   `ganttmax`), `workload-report-options` (Show Options: Task Expanded View Style Gantt/Timeline; Timeline type adds Task
 *   Title / Project Title), `workload-report-legend-detail` (Legends: `.resource-new-legends` bands "(= 0%)", "(< 100%)" …),
 *   `reschart_pdfexport`.
 *   toolbar: `kanban_changecv` offers Bar / Heatmap / Timeline, `data-label-select` the data labels; an unsaved change
 *   puts "*" (`.cv-newfld-apply`) on the view name and shows Save as (`cview_save_as` › Existing / New / Discard).
 * RT-07/08 save through "Save as": they use their own QA view or create one, and delete it; nothing else is saved.
 */
test.describe.configure({ mode: 'default', timeout: 600_000 });

const marker = (wl: WorkloadPage) => qa(wl.page, K.viewDropdown).locator('.cv-newfld-apply').filter({ visible: true }).count();
const saveAsVisible = (wl: WorkloadPage) => qa(wl.page, K.saveAs).filter({ visible: true }).count();
async function switchChart(wl: WorkloadPage, to: 'Bar' | 'Heatmap' | 'Timeline') {
  await qa(wl.page, K.chartType).click();
  await wl.page.getByText(new RegExp(`^${to}$`)).filter({ visible: true }).first().click();
  await expect.poll(() => wl.chartType(), { message: `chart type ${to}` }).toContain(to);
  await waitLoaded(wl);
}
async function switchLabel(wl: WorkloadPage, to: string) {
  await qa(wl.page, K.dataLabel).click();
  await wl.page.getByText(new RegExp(`^${to.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}$`)).filter({ visible: true }).first().click();
  await expect.poll(() => wl.dataLabel(), { message: `data label ${to}` }).toContain(to);
  await waitLoaded(wl);
}
/** Texts of the grid's number cells (the summary row + the heat/bar cells). */
const gridTexts = (wl: WorkloadPage) => wl.page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.resworkdaycount, .res-rangecol-bar, .res-alloc-bar, .ruDaycolumn, [class*="allocvalue" i], [class*="workcount" i]')].filter(e => e.offsetWidth || e.offsetHeight).map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
async function pickView(wl: WorkloadPage, name: string) {
  const loaded = wl.page.waitForResponse(r => /\/reports\/workload\?/.test(r.url()), { timeout: 150_000 });
  await wl.openViews(); await wl.page.locator('.customview-name').filter({ hasText: name }).filter({ visible: true }).first().click();
  await loaded; await waitLoaded(wl);
}

test('RT-01 Full Screen expands the report and exits again', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  const fs = qa(page, K.fullscreen).filter({ visible: true }).first();
  await expect(fs, 'Full Screen icon').toBeVisible({ timeout: 30_000 });
  expect.soft(await fs.getAttribute('data-tooltip'), 'tooltip').toBe('Full Screen');
  const gridBefore = (await page.locator('.resource-list-content').first().boundingBox())!;
  await fs.click(); await page.waitForTimeout(800);
  expect.soft(await page.evaluate(() => document.body.className), 'body marks fullscreen').toMatch(/ganttmax/);
  expect.soft(await qa(page, K.fullscreen).getAttribute('data-tooltip'), 'tooltip toggles').toBe('Exit Fullscreen');
  const gridAfter = (await page.locator('.resource-list-content').first().boundingBox())!;
  expect.soft(gridAfter.width >= gridBefore.width && gridAfter.x <= gridBefore.x, `grid grows (${Math.round(gridBefore.width)} → ${Math.round(gridAfter.width)})`).toBe(true);
  await expect(qa(page, K.calendar), 'toolbar still usable').toBeVisible();
  await qa(page, K.fullscreen).click(); await page.waitForTimeout(800);
  expect.soft(await page.evaluate(() => document.body.className), 'fullscreen left').not.toMatch(/ganttmax/);
  expect.soft(await qa(page, K.fullscreen).getAttribute('data-tooltip'), 'tooltip back').toBe('Full Screen');
  expect.soft(await marker(wl), 'no unsaved marker: fullscreen is not a view change').toBe(0);
});

test('RT-02 Legends opens the allocation bands and closes again', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  const lg = qa(page, K.legend).filter({ visible: true }).first();
  await expect(lg, 'Legends icon').toBeVisible({ timeout: 30_000 });
  expect.soft(await lg.getAttribute('data-tooltip'), 'tooltip').toBe('Legends');
  await lg.click(); await page.waitForTimeout(1200);
  const items = page.locator('.resource-new-legends').filter({ visible: true });
  expect.soft(await items.count(), 'legend bands shown').toBeGreaterThanOrEqual(3);
  const texts = (await items.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  expect.soft(texts.some(t => /0\s*%/.test(t)) && texts.some(t => /100\s*%/.test(t)), `bands mention 0 % and 100 % (${texts.join(' | ')})`).toBe(true);
  const colours = await items.evaluateAll(els => els.map(e => { const sw = e.querySelector<HTMLElement>('span, i, div'); return sw ? getComputedStyle(sw).backgroundColor : ''; }));
  expect.soft(new Set(colours.filter(c => c && c !== 'rgba(0, 0, 0, 0)')).size, 'distinct colours').toBeGreaterThanOrEqual(2);
  test.info().annotations.push({ type: 'evidence', description: `legend: ${texts.join(' | ')}; colours ${[...new Set(colours)].join(', ')}` });
  // closing: the icon again, Escape, then a click on the toolbar background; record what it took
  const attempts: string[] = [];
  for (const [how, act] of [['icon', () => lg.click({ force: true })], ['Escape', () => page.keyboard.press('Escape')], ['click outside', () => page.mouse.click(600, 118)]] as const) {
    if (!(await items.count())) break; await act(); await page.waitForTimeout(700); attempts.push(`${how} → ${await items.count() ? 'still open' : 'closed'}`);
  }
  test.info().annotations.push({ type: 'evidence', description: `closing the legend: ${attempts.join(', ') || 'closed at once'}` });
  if (await items.count()) test.info().annotations.push({ type: 'check-spec', description: 'the legend panel stays open after the icon, Escape and a click outside: is it meant to be a persistent panel?' });
  expect.soft(await qa(page, K.calendar).isVisible(), 'the report stays usable with the legend shown').toBe(true);
});

test('RT-03 Show Options offers the expanded-view style for Bar/Heatmap and the title options for Timeline', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  const so = qa(page, K.showOptions).filter({ visible: true }).first();
  await expect(so, 'Show Options icon').toBeVisible({ timeout: 30_000 });
  await so.click(); await page.waitForTimeout(800);
  const panelText = async () => (await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('ruc-checkbox, ruc-radio-button, [class*="option" i]')].filter(e => (e.offsetWidth || e.offsetHeight) && e.getBoundingClientRect().x > 900).map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean))).join(' | ');
  const heat = await panelText();
  expect.soft(heat, 'Heatmap options').toMatch(/Task Expanded View Style/i);
  expect.soft(heat, 'Gantt / Timeline styles').toMatch(/Gantt/);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await switchChart(wl, 'Timeline');
  await qa(page, K.showOptions).filter({ visible: true }).first().click(); await page.waitForTimeout(800);
  const tl = await panelText();
  expect.soft(tl, 'Timeline options').toMatch(/Title|Project Name/i);
  test.info().annotations.push({ type: 'evidence', description: `Heatmap: ${heat.slice(0, 160)} · Timeline: ${tl.slice(0, 160)}` });
  await page.keyboard.press('Escape');
  await wl.discard();
  expect.soft(await marker(wl), 'marker gone after Discard').toBe(0);
});

test('RT-04 switching the chart type from the toolbar re-renders the grid, marks the view unsaved and Discard puts it back', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  const start = await wl.chartType();
  expect.soft(await marker(wl), 'no marker at start').toBe(0);
  const shape = () => page.evaluate(() => ({ bars: document.querySelectorAll('.resourceTaskBar, [data-zpqa="workload-chart-bar-day"]').length, heat: document.querySelectorAll('.res-alloc-bar').length, rows: document.querySelectorAll('[data-zpqa^="username-"]').length }));
  const s0 = await shape();
  for (const to of (['Bar', 'Timeline', 'Heatmap'] as const).filter(t => !start.includes(t))) {
    await switchChart(wl, to);
    const s = await shape();
    expect.soft(await marker(wl), `${to}: unsaved marker`).toBe(1);
    expect.soft(await saveAsVisible(wl), `${to}: Save as shown`).toBe(1);
    expect.soft(s.rows, `${to}: user rows kept`).toBe(s0.rows);
    test.info().annotations.push({ type: 'evidence', description: `${to}: ${JSON.stringify(s)} (was ${JSON.stringify(s0)})` });
  }
  await wl.discard(); await waitLoaded(wl);
  expect.soft(await wl.chartType(), 'chart type restored').toBe(start);
  expect.soft(await marker(wl), 'marker cleared').toBe(0);
  expect.soft(await saveAsVisible(wl), 'Save as hidden').toBe(0);
  await expect.poll(async () => JSON.stringify(await shape()), { message: 'grid shape restored', timeout: 60_000 }).toBe(JSON.stringify(s0));
});

test('RT-05 every data label from the toolbar changes the unit shown in the cells; Discard restores the saved label', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  const start = await wl.dataLabel();
  await qa(page, K.dataLabel).click(); await page.waitForTimeout(600);
  const options = (await page.getByText(/^(No Legend|Allocated (Hours|Minutes|Man Days|Man Weeks|Percentage)|Available (Hours|Minutes|Man Days|Man Weeks|Percentage))$/).filter({ visible: true }).allInnerTexts()).map(t => t.trim()).filter((v, i, a) => a.indexOf(v) === i && v !== start);
  await page.keyboard.press('Escape');
  expect(options.length, `data label options: ${options.join(', ')}`).toBeGreaterThanOrEqual(5);
  const unit: Record<string, RegExp> = { Hours: /\d\s*h\b|hour/i, Minutes: /\d\s*m\b|min/i, 'Man Days': /\d\s*d\b|day/i, 'Man Weeks': /\d\s*w\b|week/i, Percentage: /%/ };
  for (const o of options.filter(o => o !== start).slice(0, 8)) {
    await switchLabel(wl, o);
    const texts = await gridTexts(wl);
    const key = Object.keys(unit).find(k => o.includes(k));
    if (key) expect.soft(texts.some(t => unit[key]!.test(t)), `${o}: cells show the unit (${texts.slice(0, 4).join(' | ')})`).toBe(true);
    else expect.soft(texts.filter(t => /\d\s*(h|m|d|w|%)\b|\d%/i.test(t)).length, `${o}: No Legend shows no unit values (${texts.filter(t => /\d\s*(h|m|d|w|%)/i.test(t)).slice(0, 4).join(' | ')})`).toBe(0);
    expect.soft(await marker(wl), `${o}: unsaved marker`).toBe(1);
  }
  await wl.discard();
  expect.soft(await wl.dataLabel(), 'label restored').toBe(start);
  expect.soft(await marker(wl), 'marker cleared').toBe(0);
});

test('RT-06 Save as › Existing writes the toolbar change into the open custom view', async ({ wl }) => {
  const page = wl.page; const api = new ZpApi(page, wl.d); await waitLoaded(wl);
  const name = `${env.runId}-RT-06`; let id = '';
  try {
    id = await api.createView(name); await page.reload(); await wl.goto(); await pickView(wl, name);
    expect.soft((await api.view(id)).report_preference?.view_type, 'starts as heatmap').toBe('heatmap');
    await switchChart(wl, 'Bar');
    const items = await wl.saveAsItems();
    test.info().annotations.push({ type: 'evidence', description: `Save as items on the own view: ${Object.entries(items).map(([k, v]) => `${k}${v.disabled ? ' (disabled)' : ''}`).join(', ')}` });
    expect(items[K.saveAsExisting], 'Existing offered').toBeTruthy();
    const seen: string[] = []; page.on('request', r => { if (!/\.(js|css|png|svg|woff2?|gif)(\?|$)/.test(r.url()) && /\/api\/|\/portal\//.test(r.url())) seen.push(`${r.method()} ${new URL(r.url()).pathname.replace(/^.*\/portal\/[^/]+/, '')}`); });
    await qa(page, K.saveAs).click(); await qa(page, K.saveAsExisting).click();
    const confirm = page.locator('.zpcustomalert [data-zpqa="popup_success"], [data-zpqa="alert-Yes"]').filter({ visible: true }).first();
    if (await confirm.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) { test.info().annotations.push({ type: 'evidence', description: `confirmation: "${(await page.locator('.zpcustomalert').filter({ visible: true }).first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)}"` }); await confirm.click(); }
    await page.waitForTimeout(4000);
    await expect.poll(() => marker(wl), { message: 'marker cleared after Save as › Existing', timeout: 20_000 }).toBe(0);
    const def = (await api.view(id)).report_preference?.view_type;
    await leaveToAllUsers(wl); await pickView(wl, name); // reopen without a reload (a reload after Save as lands off the report on some portals)
    const shown = await wl.chartType();
    test.info().annotations.push({ type: 'evidence', description: `after Save as › Existing: requests ${seen.join('; ') || 'none'}; definition view_type ${def}; after reload the view shows ${shown}` });
    // WL-D-42 (candidate, 15-10-2026): Save as › Existing after a toolbar chart-type change clears the unsaved marker but sends nothing — the definition and the reopened view keep the old type
    if (def !== 'bar' && !/Bar/.test(shown)) knownDefect('WL-D-42', `Save as › Existing saved nothing for the chart type: no request, definition ${def}, reopened as ${shown}`);
    expect.soft(def, 'definition now bar').toBe('bar');
    expect.soft(shown, 'the view reopens as Bar').toContain('Bar');
    // the same with a data label, for the record
    const label0 = await wl.dataLabel(); await switchLabel(wl, label0.includes('Percentage') ? 'Allocated Hours' : 'Allocated Percentage');
    const seen2: string[] = []; const h2 = (r: import('@playwright/test').Request) => { if (r.method() !== 'GET' && /\/api\//.test(r.url())) seen2.push(`${r.method()} ${new URL(r.url()).pathname.replace(/^.*\/portal\/[^/]+/, '')}`); }; page.on('request', h2);
    await qa(page, K.saveAs).click(); await qa(page, K.saveAsExisting).click(); await page.waitForTimeout(4000); page.off('request', h2);
    const legend = (await api.view(id)).report_preference?.legend;
    test.info().annotations.push({ type: 'evidence', description: `data label via Save as › Existing: requests ${seen2.join('; ') || 'none'}; definition legend ${legend}; marker ${await marker(wl)}` });
    await leaveToAllUsers(wl); await pickView(wl, name);
    expect.soft(await wl.dataLabel(), 'data label persisted through Save as › Existing').not.toBe(label0);
  } finally { await wl.discard().catch(() => {}); await leaveToAllUsers(wl); await removeView(api, id, name); }
});

test('RT-07 Save as › New opens the create form prefilled with the toolbar change', async ({ wl }) => {
  const page = wl.page; const api = new ZpApi(page, wl.d); const cv = new CreateViewPage(page); await waitLoaded(wl);
  const name = `${env.runId}-RT-07`; let id = '';
  try {
    await switchChart(wl, 'Bar');
    await qa(page, K.saveAs).click(); await qa(page, K.saveAsNew).click();
    await expect(qa(page, K.name), 'create form open').toBeVisible({ timeout: 60_000 });
    const st = await cv.formState();
    expect.soft(st.viewType, 'prefilled view type').toBe('bar');
    await cv.setName(name);
    const r = await cv.create(); id = r.id || await idOf(api, name);
    expect(r.put.status(), 'created').toBe(201);
    expect.soft(r.body.report_preference?.view_type, 'request view type').toBe('bar');
    const v = await api.view(id); expect.soft(v.report_preference?.view_type, 'definition').toBe('bar');
    await waitLoaded(wl);
    expect.soft(await marker(wl), 'no unsaved marker on the new view').toBe(0);
    expect.soft((await wl.selection())[0], 'the new view is open').toContain(name);
  } finally { await wl.discard().catch(() => {}); await leaveToAllUsers(wl); await removeView(api, id, name); }
});

test('RT-08 Export to PDF is on the rail and asks about password protection (declined, no download)', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  const ex = qa(page, K.exportPdf).filter({ visible: true }).first();
  await expect(ex, 'Export to PDF icon').toBeVisible({ timeout: 30_000 });
  expect.soft(await ex.getAttribute('data-tooltip'), 'tooltip').toBe('Export to PDF');
  await ex.click();
  const prompt = page.getByText(/password-protect/i).filter({ visible: true }).first();
  await expect(prompt, 'password prompt').toBeVisible({ timeout: 15_000 });
  const cancel = page.locator('[data-zpqa="alert-cancel"], [data-zpqa="popup_cancel"]').filter({ visible: true }).first();
  if (await cancel.count()) await cancel.click(); else await page.keyboard.press('Escape');
  await expect(prompt, 'prompt closed').toBeHidden({ timeout: 10_000 });
});
