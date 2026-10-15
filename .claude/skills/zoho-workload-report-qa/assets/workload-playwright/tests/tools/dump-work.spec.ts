// Dump every owner's October day work to reports/<portal>/work-oct-2026.now.json and compare with work-oct-2026.json (earlier dump).
import fs from 'fs';
import { test } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { env } from '../../src/env';
import { portalTimeZone } from '../../src/portalSettings';
test('dump + compare work', async ({ wl }) => {
  const api = new ZpApi(wl.page, wl.d);
  console.log('TIMEZONE', await portalTimeZone(wl.page));
  const v = wl.d.view('zp.workload.customview.allusers');
  const owners = await api.workload({ from: '2026-10-01', to: '2026-10-31', timePeriod: 'days', viewId: String(v.custom_view_id || v.id) });
  const dump: Record<string, any> = {}; for (const o of owners) dump[o.name] = { total: o.work?.total_work, availability: o.work?.total_availability, days: Object.fromEntries((o.work?.total_date_work ?? []).map((d: any) => [d.date.slice(0, 10), d.work])) };
  fs.writeFileSync(`${env.reportsDir}/work-oct-2026.now.json`, JSON.stringify(dump, null, 1));
  let old: Record<string, any> = {}; try { old = JSON.parse(fs.readFileSync(`${env.reportsDir}/work-oct-2026.json`, 'utf8')); } catch {}
  const diff: string[] = [];
  for (const n of Object.keys(dump)) { const a = old[n]; if (!a) { diff.push(`${n}: no earlier dump`); continue; } if (a.total !== dump[n].total) diff.push(`${n}: total ${a.total} → ${dump[n].total}`); for (const d of new Set([...Object.keys(a.days), ...Object.keys(dump[n].days)])) if (a.days[d] !== dump[n].days[d]) diff.push(`${n} ${d}: ${a.days[d]} → ${dump[n].days[d]}`); }
  console.log('DIFF vs earlier dump:', diff.length ? diff.join(' | ') : 'identical');
});
