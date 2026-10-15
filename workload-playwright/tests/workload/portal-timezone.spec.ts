import { test, expect, knownDefect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { K, qa } from '../../src/locators';
import { waitLoaded } from '../../src/createChecks';
import { portalTimeZone, setPortalTimeZone, todayIn } from '../../src/portalSettings';
import type { WorkloadPage } from '../../src/pages/WorkloadPage';

/**
 * Portal time zone (Setup › Portal Configuration › Configuration › Portal Settings) and the Workload Report.
 * The zone is switched to the two extremes (UTC+14 Pacific/Kiritimati, UTC−11 Pacific/Pago_Pago), the report reloaded and:
 *   TZ-01 the Today column / line and the "This Month" range follow the portal zone's calendar date; the from/to the app
 *         sends match the header; TZ-02 task bars keep their calendar dates (bar offsets by task id are identical in every
 *         zone) and the report data for the same dates is unchanged; TZ-03 the zone is restored and read back.
 * The portal-wide zone changes for everyone for a few minutes: needs ZP_ALLOW_SETTINGS_CHANGES=1 (approved 15-10-2026).
 * Calls: see src/portalSettings.ts (captured from the Setup UI).
 */
test.describe.configure({ mode: 'default', timeout: 600_000 });
test.skip(process.env.ZP_ALLOW_SETTINGS_CHANGES !== '1', 'the portal time zone is changed and restored: set ZP_ALLOW_SETTINGS_CHANGES=1');

const ZONES = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'];
const pad = (n: number) => String(n).padStart(2, '0');
/** The grid's day header for a YYYY-MM-DD date (the portal shows DD-MM-YYYY or MM-DD-YYYY). */
const dayColumn = (wl: WorkloadPage, ymd: string) => { const [y, m, d] = ymd.split('-'); return wl.page.locator('.weekNameColumn').filter({ hasText: new RegExp(`Date: (${d}-${m}|${m}-${d})-${y}`) }).first(); };
/** Reload the report and capture the first data request's from/to dates. */
async function reloadCapturing(wl: WorkloadPage) {
  const req = wl.page.waitForRequest(r => /\/reports\/workload\?/.test(r.url()), { timeout: 150_000 });
  await wl.page.reload(); await wl.goto(); await waitLoaded(wl);
  const u = new URL((await req).url());
  return { from: (u.searchParams.get('from_date') || '').slice(0, 10), to: (u.searchParams.get('to_date') || '').slice(0, 10), raw: `${u.searchParams.get('from_date')} → ${u.searchParams.get('to_date')}` };
}
async function barOffsets(wl: WorkloadPage) {
  // expand the first user with tasks and read each bar's day offset/length (CSS variables set by the app)
  const rows = wl.rows(); const n = await rows.count();
  for (let i = 0; i < n; i++) { const r = rows.nth(i); const cnt = Number(((await r.locator('[name="child-entity-count"]').innerText().catch(() => '(0)')).match(/\d+/) || [0])[0]); if (!cnt || /Unassigned/.test(await r.innerText())) continue; const uid = (await r.getAttribute('data-zpqa'))!.slice('username-'.length); await qa(wl.page, `expand-collapse-parent-${uid}`).click(); const bars = wl.page.locator(`[id^="tasknamerow_${uid}"] .resourceTaskBar`); await expect.poll(() => bars.count(), { timeout: 120_000 }).toBe(cnt); const out = await bars.evaluateAll(els => Object.fromEntries(els.map(e => [e.id, `${e.style.getPropertyValue('--dayStartLeft').trim()}+${e.style.getPropertyValue('--daysAllocate').trim()}`]))); await qa(wl.page, `expand-collapse-parent-${uid}`).click(); return { uid, bars: out }; }
  return { uid: '', bars: {} as Record<string, string> };
}

let original = '';
test.beforeEach(async ({ wl }) => { if (!original) original = await portalTimeZone(wl.page); expect(original, 'portal time zone readable').toBeTruthy(); });

test('TZ-01 Today and "This Month" follow the portal time zone (UTC+14 and UTC−11)', async ({ wl }) => {
  const page = wl.page; await waitLoaded(wl);
  const base = await reloadCapturing(wl);
  test.info().annotations.push({ type: 'snapshot', description: `portal zone ${original}; today there ${todayIn(original)}; request ${base.raw}` });
  try {
    for (const zone of ZONES) {
      expect((await setPortalTimeZone(page, zone)), `set ${zone}`).toMatch(/^200/);
      expect(await portalTimeZone(page), 'zone read back').toBe(zone);
      const r = await reloadCapturing(wl);
      const today = todayIn(zone); const [y, m] = today.split('-'); const last = new Date(Number(y), Number(m), 0).getDate();
      const header = (await qa(page, K.calendar).innerText()).trim();
      test.info().annotations.push({ type: 'evidence', description: `${zone}: today ${today} (local ${todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone)}), header "${header}", request ${r.raw}` });
      // This Month = the zone's current month
      expect.soft(r.from, `${zone}: from_date is the 1st of the zone's month`).toBe(`${y}-${m}-01`);
      expect.soft(r.to, `${zone}: to_date is the last day of the zone's month`).toBe(`${y}-${m}-${pad(last)}`);
      expect.soft(header.includes(y) && (header.includes(`-${m}-`) || header.startsWith(`${m}-`)), `${zone}: header shows the zone's month`).toBe(true);
      // Today line sits in the zone's today column
      const col = dayColumn(wl, today); expect.soft(await col.count(), `${zone}: today's column (${today}) exists`).toBe(1);
      const line = page.locator('#today_line'); await expect(line, `${zone}: today line`).toBeVisible();
      const lb = (await line.boundingBox())!, cb = await col.boundingBox();
      const local = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);
      if (cb) {
        const inZoneCol = lb.x >= cb.x - 2 && lb.x <= cb.x + cb.width + 2;
        const lc = local !== today ? await dayColumn(wl, local).boundingBox() : null; const inLocalCol = !!(lc && lb.x >= lc.x - 2 && lb.x <= lc.x + lc.width + 2);
        // WL-D-44 (candidate, 15-10-2026): the Today line marks the browser's calendar day, not the portal time zone's
        if (!inZoneCol && inLocalCol) knownDefect('WL-D-44', `${zone}: the Today line sits on the browser's date ${local}, not the portal zone's ${today}`);
        expect.soft(inZoneCol, `${zone}: today line at x=${Math.round(lb.x)} inside ${today}'s column [${Math.round(cb.x)}, ${Math.round(cb.x + cb.width)}]${inLocalCol ? ` (it is in the browser-local ${local} column)` : ''}`).toBe(true);
      }
    }
  } finally { expect((await setPortalTimeZone(page, original)), 'restore').toMatch(/^200/); expect(await portalTimeZone(page), 'zone restored').toBe(original); await reloadCapturing(wl); }
});

test('TZ-02 task bars keep their calendar dates and the data for the same dates is unchanged in every zone', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d); await waitLoaded(wl);
  const v = wl.d.view('zp.workload.customview.allusers'); const viewId = String(v.custom_view_id || v.id);
  const base = await reloadCapturing(wl); const bars0 = await barOffsets(wl);
  const data0 = await api.workload({ from: base.from, to: base.to, timePeriod: 'days', viewId });
  const sig = (o: Awaited<ReturnType<typeof api.workload>>) => o.map(x => `${x.name}:${x.work?.total_work}:${(x.work?.total_date_work ?? []).map(d => `${d.date.slice(0, 10)}=${d.work}`).join(',')}`).sort().join('|');
  try {
    for (const zone of ZONES) {
      expect((await setPortalTimeZone(page, zone)), `set ${zone}`).toMatch(/^200/);
      const r = await reloadCapturing(wl);
      // compare bars only when the zone shows the same month (otherwise offsets are relative to another month)
      if (r.from === base.from) { const bars = await barOffsets(wl); expect.soft(bars.bars, `${zone}: task bars (offset+length by task) unchanged`).toEqual(bars0.bars); }
      else test.info().annotations.push({ type: 'note', description: `${zone}: the report shows ${r.from}…${r.to} (another month than ${base.from}); bar offsets not compared` });
      const data = await api.workload({ from: base.from, to: base.to, timePeriod: 'days', viewId });
      const moved = data.flatMap(o => { const b = data0.find(x => x.name === o.name); const days = new Map((b?.work?.total_date_work ?? []).map(d => [d.date.slice(0, 10), d.work])); return (o.work?.total_date_work ?? []).filter(d => days.get(d.date.slice(0, 10)) !== d.work).map(d => `${o.name} ${d.date.slice(0, 10)}: ${days.get(d.date.slice(0, 10))} → ${d.work}`); });
      // WL-D-43 (candidate, 15-10-2026): the per-day work of date-only tasks moves between days when the portal zone changes
      if (moved.length) knownDefect('WL-D-43', `${zone}: day work moved for ${moved.length} owner-days, e.g. ${moved.slice(0, 3).join('; ')}`);
      expect.soft(sig(data), `${zone}: API work for ${base.from}…${base.to} unchanged`).toBe(sig(data0));
    }
  } finally {
    expect((await setPortalTimeZone(page, original)), 'restore').toMatch(/^200/); expect(await portalTimeZone(page), 'zone restored').toBe(original); await reloadCapturing(wl);
    // the data must be back once the zone is: anything else would be real drift
    await expect.poll(async () => sig(await api.workload({ from: base.from, to: base.to, timePeriod: 'days', viewId })), { message: 'API work back to the original after restoring the zone', timeout: 120_000, intervals: [5000] }).toBe(sig(data0));
  }
});
