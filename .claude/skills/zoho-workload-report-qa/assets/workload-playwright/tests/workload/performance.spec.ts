import fs from 'fs';
import { test, expect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { K, qa } from '../../src/locators';
import { waitLoaded } from '../../src/createChecks';
import { env } from '../../src/env';
import { exportPdf } from '../../src/pdfExport';

/**
 * Load / performance of the Global Workload Report on this portal. Nothing is changed; the numbers go to
 * `reports/<portal>/perf.json` and the test annotations, and are judged against soft budgets (ZP_PERF_* override):
 *   PF-01 page: cold open → first user row → full load (all pages), warm reload, and the app's own request timings
 *         (meta, first data page, paging) from the Performance API; PF-02 API latency of GET /reports/workload (10 calls,
 *         min / median / p95) and of /meta and /user-views; PF-03 interactions: Expand All, data-label switch, Export to PDF.
 * The API budget (src/rate.ts) still applies, so the API sample is small.
 */
test.describe.configure({ mode: 'default', timeout: 900_000 });
const B = { firstRow: Number(process.env.ZP_PERF_FIRST_ROW ?? 15_000), fullLoad: Number(process.env.ZP_PERF_FULL_LOAD ?? 60_000), apiP95: Number(process.env.ZP_PERF_API_P95 ?? 5_000), expandAll: Number(process.env.ZP_PERF_EXPAND_ALL ?? 20_000), exportPdf: Number(process.env.ZP_PERF_EXPORT ?? 60_000) };
const PERF = `${env.reportsDir}/perf.json`;
const save = (k: string, v: unknown) => { let j: Record<string, unknown> = {}; try { j = JSON.parse(fs.readFileSync(PERF, 'utf8')); } catch {} j[k] = v; j.portal = env.portal; j.at = new Date().toISOString(); fs.mkdirSync(env.reportsDir, { recursive: true }); fs.writeFileSync(PERF, JSON.stringify(j, null, 1)); };
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!; return { n: s.length, min: s[0]!, median: q(0.5), p95: q(0.95), max: s[s.length - 1]! }; };
const ms = (n: number) => `${Math.round(n)} ms`;
/** The app's own XHR timings for the report, from the Performance API (name → duration). */
const resourceTimings = (page: import('@playwright/test').Page) => page.evaluate(() => (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter(e => /\/reports\/workload|\/user-views|\/reports\/workload\/meta/.test(e.name)).map(e => ({ what: /meta/.test(e.name) ? 'meta' : /user-views/.test(e.name) ? 'user-views' : `data index=${(e.name.match(/index=(\d+)/) || [])[1] ?? '0'}`, ms: Math.round(e.duration) })));

test('PF-01 page load: cold open, first row, full load, warm reload, and the report\'s own request timings', async ({ wl, browser }) => {
  const page = wl.page; await waitLoaded(wl);
  // cold: a fresh context with the same login
  const ctx = await browser.newContext({ storageState: env.adminState }); const p2 = ctx.newPage ? await ctx.newPage() : page;
  const t0 = Date.now();
  await p2.goto(`${env.baseUrl}/portal/${env.portal}#zp/reports`);
  await qa(p2, K.workloadTab).click({ timeout: 90_000 }).catch(() => {});
  await qa(p2, K.calendar).waitFor({ timeout: 150_000 }); const tHeader = Date.now() - t0;
  await p2.locator('[data-zpqa^="username-"]').first().waitFor({ timeout: 150_000 }); const tFirstRow = Date.now() - t0;
  // full load: scroll until the last page arrives (same as loadAllRows, on the fresh page)
  const scroller = p2.locator('.resourceutilTableholder').first(); let last = -1;
  for (let i = 0; i < 40; i++) { await scroller.evaluate(e => { e.scrollTop = e.scrollHeight; }); await p2.waitForTimeout(700); const n = await p2.locator('[data-zpqa^="username-"]').count(); if (n === last) break; last = n; }
  const tFull = Date.now() - t0; const rows = last;
  const cold = await resourceTimings(p2);
  await ctx.close();
  // warm: reload the fixture page
  const w0 = Date.now(); await page.reload(); await wl.goto(); const wHeader = Date.now() - w0; await wl.rows().first().waitFor({ timeout: 150_000 }); const wFirstRow = Date.now() - w0;
  const warm = await resourceTimings(page);
  const result = { cold: { header: tHeader, firstRow: tFirstRow, fullLoad: tFull, rows, requests: cold }, warm: { header: wHeader, firstRow: wFirstRow, requests: warm } };
  save('page', result);
  test.info().annotations.push({ type: 'perf', description: `cold: header ${ms(tHeader)}, first row ${ms(tFirstRow)}, all ${rows} rows ${ms(tFull)} · warm: header ${ms(wHeader)}, first row ${ms(wFirstRow)} · requests ${cold.map(r => `${r.what} ${r.ms}`).join(', ')}` });
  expect.soft(tFirstRow, `first row within ${B.firstRow} ms (cold)`).toBeLessThan(B.firstRow);
  expect.soft(tFull, `full load within ${B.fullLoad} ms (cold)`).toBeLessThan(B.fullLoad);
});

test('PF-02 API latency: /reports/workload (10 calls), /meta and /user-views', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d); await waitLoaded(wl);
  const v = wl.d.view('zp.workload.customview.allusers'); const viewId = String(v.custom_view_id || v.id);
  const d = new Date(); const f = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; const from = `${f}-01`, to = `${f}-${new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()}`;
  const timed = async (label: string, fn: () => Promise<unknown>, n: number) => { const xs: number[] = []; for (let i = 0; i < n; i++) { const t = Date.now(); await fn(); xs.push(Date.now() - t); } const s = stats(xs); test.info().annotations.push({ type: 'perf', description: `${label}: min ${ms(s.min)}, median ${ms(s.median)}, p95 ${ms(s.p95)}, max ${ms(s.max)} (n=${n})` }); return s; };
  const data = await timed('GET /reports/workload (first page)', () => api.workload({ from, to, timePeriod: 'days', viewId }), 10);
  const meta = await timed('GET /reports/workload/meta', () => api.call('GET', `/reports/workload/meta?project_id=0&view_id=${viewId}`), 5);
  const views = await timed('GET /user-views (4 types)', () => api.allViews(), 3);
  save('api', { data, meta, views });
  expect.soft(data.p95, `data p95 within ${B.apiP95} ms`).toBeLessThan(B.apiP95);
  expect.soft(meta.p95, `meta p95 within ${B.apiP95} ms`).toBeLessThan(B.apiP95);
});

test('PF-03 interactions: Expand All, a data-label switch and Export to PDF', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  const rows = wl.rows(); const n = await rows.count(); let sum = 0; for (let i = 0; i < n; i++) sum += Number(((await rows.nth(i).locator('[name="child-entity-count"]').innerText().catch(() => '(0)')).match(/\d+/) || [0])[0]);
  let t = Date.now(); await qa(page, 'expand-collapse-all-tasklist').click();
  await expect.poll(() => page.locator('[id^="tasknamerow_"]').filter({ visible: true }).count(), { timeout: 180_000 }).toBe(sum); const expandAll = Date.now() - t;
  t = Date.now(); await qa(page, 'expand-collapse-all-tasklist').click(); await expect.poll(() => page.locator('[id^="tasknamerow_"]').filter({ visible: true }).count(), { timeout: 60_000 }).toBe(0); const collapseAll = Date.now() - t;
  const label0 = await wl.dataLabel(); const other = label0.includes('Percentage') ? 'Allocated Hours' : 'Allocated Percentage';
  t = Date.now(); await qa(page, K.dataLabel).click(); await page.getByText(new RegExp(`^${other}$`)).filter({ visible: true }).first().click(); await expect.poll(() => wl.dataLabel()).toContain(other); await waitLoaded(wl); const labelSwitch = Date.now() - t;
  await wl.discard().catch(() => {});
  t = Date.now(); const pdf = await exportPdf(page, `PF-03-${env.portal}`); const exportMs = Date.now() - t;
  const result = { expandAll, collapseAll, tasks: sum, labelSwitch, exportPdf: exportMs, pdfBytes: (pdf as any).bytes ?? (pdf as any).size ?? undefined };
  save('interactions', result);
  test.info().annotations.push({ type: 'perf', description: `Expand All (${sum} tasks) ${ms(expandAll)}, Collapse All ${ms(collapseAll)}, data label switch ${ms(labelSwitch)}, Export to PDF ${ms(exportMs)}` });
  expect.soft(expandAll, `Expand All within ${B.expandAll} ms`).toBeLessThan(B.expandAll);
  expect.soft(exportMs, `Export within ${B.exportPdf} ms`).toBeLessThan(B.exportPdf);
});
