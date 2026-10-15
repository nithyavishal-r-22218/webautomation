// Restore the default business hours from reports/<portal>/business-hours-snapshot.json (effective today), retrying while the
// portal answers 403 BUSINESS_HOUR_STATUS_RESTRICTION. Removes the snapshot once the live hours equal it. Dumps this month's work.
import fs from 'fs';
import { test } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { env } from '../../src/env';

const P = (label: string, v: unknown) => console.log(`PROBE ${label}: ${typeof v === 'string' ? v : JSON.stringify(v)}`.slice(0, 1200));
const table = (b: any) => b.working_hours.map((w: any) => `${w.day}:${w.start_time}-${w.end_time}`).sort().join(' ');

test('restore business hours from snapshot', async ({ wl }) => {
  test.setTimeout(1_800_000);
  const api = new ZpApi(wl.page, wl.d);
  const snapFile = `${env.reportsDir}/business-hours-snapshot.json`;
  if (!fs.existsSync(snapFile)) { P('snapshot', 'none — nothing to restore'); return; }
  const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8')).bh;
  const live = (await api.getJson<any>('/business-hours')).business_hours.find((b: any) => b.is_default);
  P('snapshot', table(snap)); P('live', `${table(live)} eff=${live.effective_from} v=${live.version}`);
  if (table(live) !== table(snap)) {
    const today = new Date().toISOString().slice(0, 10);
    const body = { id: live.id, name: snap.name, working_hours_type: snap.working_hours_type, working_hours: snap.working_hours.map((w: any) => ({ day: w.day, start_time: w.start_time, end_time: w.end_time, break_hours: w.break_hours ?? [] })), effective_from: today };
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      const r = await api.call('PUT', '/business-hours', body); const t = await r.text();
      if (r.ok()) { P('PUT', `${r.status()} after ${Math.round((Date.now() - t0) / 1000)} s (try ${i + 1})`); break; }
      if (!/STATUS_RESTRICTION/.test(t)) { P('PUT', `${r.status()} ${t.slice(0, 300)}`); break; }
      if (i % 6 === 0) P('PUT', `try ${i + 1}: still restricted after ${Math.round((Date.now() - t0) / 1000)} s`);
      await new Promise(res => setTimeout(res, 20_000));
    }
  }
  const now = (await api.getJson<any>('/business-hours')).business_hours.find((b: any) => b.is_default);
  P('after', `${table(now)} eff=${now.effective_from} v=${now.version}`);
  if (table(now) === table(snap)) { fs.rmSync(snapFile, { force: true }); P('snapshot', 'live equals the snapshot: removed'); } else P('snapshot', 'KEPT: live still differs');
  const v = wl.d.view('zp.workload.customview.allusers');
  const owners = await api.workload({ from: '2026-10-01', to: '2026-10-31', timePeriod: 'days', viewId: String(v.custom_view_id || v.id) });
  const dump: Record<string, any> = {}; for (const o of owners) dump[o.name] = { total: o.work?.total_work, availability: o.work?.total_availability, days: Object.fromEntries((o.work?.total_date_work ?? []).map((d: any) => [d.date.slice(0, 10), d.work])) };
  fs.writeFileSync(`${env.reportsDir}/work-oct-2026.json`, JSON.stringify(dump, null, 1));
  P('work', Object.entries(dump).map(([n, d]: any) => `${n}=${d.total}/${d.availability}`).join(', '));
});
