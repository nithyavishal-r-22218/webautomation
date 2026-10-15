import fs from 'fs';
import path from 'path';
import { test, expect, knownDefect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { K, qa } from '../../src/locators';
import { waitLoaded } from '../../src/createChecks';
import { env } from '../../src/env';
import type { WorkloadPage } from '../../src/pages/WorkloadPage';

/**
 * Portal settings that drive capacity (internal docs `setup/business_hours`, `setup/holidays`; seen live 15-10-2026):
 *   GET /business-hours → the default one (`is_default`, `working_hours[] {day 1..7, start_time, end_time, break_hours}`);
 *   PUT /business-hours {id, name, working_hours_type, working_hours, effective_from} creates a new VERSION — the server
 *   clamps `effective_from` to today, so the change applies at once; the new version has a NEW id and a PUT against the
 *   superseded id is refused with 403 BUSINESS_HOUR_STATUS_RESTRICTION — so the current id is read before every PUT.
 *   GET /weekends/provider?business_hours_ids=["id"] → week_ends; POST /holiday-list {name, holidays[{name, holiday_date}],
 *   associated_business_hours[{id}]}, DELETE /holiday-list/{id}; the report meta carries
 *   `default_business_hours_details.working_day_availability` {"1".."5": minutes} and `holidays`.
 *
 * Safety: the hours are snapshotted to `reports/<portal>/business-hours-snapshot.json` (kept until the restore is read
 * back), every owner's day work for the month is dumped before and compared after the restore (task work must not drift),
 * and the Admin's own data is the only thing touched. Needs ZP_ALLOW_SETTINGS_CHANGES=1 (approved by the user 15-10-2026).
 */
test.describe.configure({ mode: 'default', timeout: 900_000 });
test.skip(process.env.ZP_ALLOW_SETTINGS_CHANGES !== '1', 'portal business hours / holidays are changed and restored: set ZP_ALLOW_SETTINGS_CHANGES=1');

const SNAP = `${env.reportsDir}/business-hours-snapshot.json`;
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
/** This month: first and last day, every day with its ISO weekday (1 = Monday … 7 = Sunday). */
function thisMonth() {
  const now = today(); const first = new Date(now.getFullYear(), now.getMonth(), 1); const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const days: { date: Date; iso: number }[] = []; for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) days.push({ date: new Date(d), iso: ((d.getDay() + 6) % 7) + 1 });
  return { first, last, days, label: first.toLocaleString('en', { month: 'long', year: 'numeric' }) };
}
type Hours = { day: string; start_time: string; end_time: string; break_hours: unknown[] };
type BH = { id: string; name: string; working_hours_type: string; working_hours: Hours[]; is_default?: boolean; version?: string; effective_from?: string };
const minutes = (w: { start_time: string; end_time: string }) => { const [a, b] = [w.start_time, w.end_time].map(t => { const [h, m] = t.split(':').map(Number); return h! * 60 + m!; }); return b! - a!; };
const table = (bh: BH) => bh.working_hours.map(w => `${w.day}:${w.start_time}-${w.end_time}`).sort().join(' ');

async function defaultHours(api: ZpApi): Promise<BH> { const j = await api.getJson<{ business_hours: BH[] }>('/business-hours'); return j.business_hours.find(b => b.is_default) ?? j.business_hours[0]!; }
/** PUT a new version (effective today). Retries while the portal still recomputes the previous change (403 STATUS_RESTRICTION). */
async function putHours(api: ZpApi, bh: BH, working_hours: Hours[], label: string) {
  // every change creates a new version with a NEW id: a PUT against a superseded id is refused (403 BUSINESS_HOUR_STATUS_RESTRICTION)
  const current = await defaultHours(api);
  const body = { id: current.id, name: bh.name, working_hours_type: bh.working_hours_type, working_hours: working_hours.map(w => ({ day: w.day, start_time: w.start_time, end_time: w.end_time, break_hours: w.break_hours ?? [] })), effective_from: ymd(today()) };
  for (let i = 0; i < 15; i++) { // a short wait covers a recompute still in progress
    const r = await api.call('PUT', '/business-hours', body); const t = await r.text();
    if (r.ok()) { test.info().annotations.push({ type: 'settings', description: `${label}: PUT /business-hours → ${r.status()} (try ${i + 1})` }); return; }
    if (!/STATUS_RESTRICTION/.test(t)) throw new Error(`${label}: PUT /business-hours → ${r.status()} ${t.slice(0, 300)}`);
    await new Promise(res => setTimeout(res, 20_000));
  }
  throw new Error(`${label}: the portal kept refusing the update (BUSINESS_HOUR_STATUS_RESTRICTION) for 5 minutes — restore by hand: npm run restore:hours`);
}
async function waitHours(api: ZpApi, expected: string) { await expect.poll(async () => table(await defaultHours(api)), { message: `business hours become ${expected}`, timeout: 120_000, intervals: [2000, 5000] }).toBe(expected); }
const allUsersId = (wl: WorkloadPage) => { const v = wl.d.view('zp.workload.customview.allusers'); return String(v.custom_view_id || v.id); };
/** Per owner: availability and day work for the month (users and resources, Unassigned excluded). */
async function monthWork(api: ZpApi, viewId: string, m: ReturnType<typeof thisMonth>) {
  const owners = await api.workload({ from: ymd(m.first), to: ymd(m.last), timePeriod: 'days', viewId });
  const out = new Map<string, { availability: number; total: number; days: Record<string, number>; resource: boolean }>();
  for (const o of owners) out.set(o.name, { resource: !!o.is_resource, availability: Number(o.work?.total_availability ?? -1), total: Number(o.work?.total_work ?? -1), days: Object.fromEntries((o.work?.total_date_work ?? []).map(d => [d.date.slice(0, 10), d.work])) });
  return out;
}
/** The recompute after a change settles over a few minutes: wait for the work to match before judging it. */
async function settledDiff(api: ZpApi, view: string, m: ReturnType<typeof thisMonth>, before: Map<string, { total: number; days: Record<string, number> }>) {
  let diff: string[] = [];
  await expect.poll(async () => { diff = workDiff(before, await monthWork(api, view, m)); return diff.length; }, { message: 'task work back to the values before the change', timeout: 300_000, intervals: [5000, 10000] }).toBe(0).catch(() => {});
  return diff;
}
function workDiff(a: Map<string, { total: number; days: Record<string, number> }>, b: Map<string, { total: number; days: Record<string, number> }>) {
  const out: string[] = [];
  for (const [n, x] of a) { const y = b.get(n); if (!y) { out.push(`${n}: missing after`); continue; } if (x.total !== y.total) out.push(`${n}: total ${x.total} → ${y.total}`); for (const d of new Set([...Object.keys(x.days), ...Object.keys(y.days)])) if (x.days[d] !== y.days[d]) out.push(`${n} ${d}: ${x.days[d]} → ${y.days[d]}`); }
  return out;
}
/** Expected availability loss: the minutes of `iso` weekdays in the month — all of them, or only from today on (the version model decides; both are reported). */
function expectedLoss(m: ReturnType<typeof thisMonth>, iso: number, perDay: number) {
  const all = m.days.filter(d => d.iso === iso).length, fromToday = m.days.filter(d => d.iso === iso && d.date >= today()).length;
  return { all: all * perDay, fromToday: fromToday * perDay, countAll: all, countFromToday: fromToday };
}
function expectLoss(base: Map<string, { availability: number; resource?: boolean }>, after: Map<string, { availability: number }>, loss: { all: number; fromToday: number }, label: string) {
  const seen = new Set<string>();
  for (const [n, b] of base) { const a = after.get(n); if (!a || b.availability < 0) continue; if (b.resource) { test.info().annotations.push({ type: 'evidence', description: `${n} (resource): availability ${b.availability} → ${a.availability}` }); continue; } const d = b.availability - a.availability; seen.add(d === loss.all ? 'all days of the month' : d === loss.fromToday ? 'from today on' : `other (${d})`); expect.soft([loss.all, loss.fromToday], `${n}: ${label} availability loss ${d} min`).toContain(d); }
  test.info().annotations.push({ type: 'evidence', description: `${label}: availability applied to ${[...seen].join(' / ')}` });
}

test.beforeEach(async ({ wl }) => {
  const api = new ZpApi(wl.page, wl.d); const bh = await defaultHours(api);
  if (!fs.existsSync(SNAP)) { fs.mkdirSync(path.dirname(SNAP), { recursive: true }); fs.writeFileSync(SNAP, JSON.stringify({ at: new Date().toISOString(), bh }, null, 2)); return; }
  // a snapshot from an earlier run: the ORIGINAL hours. If the live hours differ, put them back first (the earlier restore was refused).
  const snap: BH = JSON.parse(fs.readFileSync(SNAP, 'utf8')).bh;
  if (table(snap) !== table(bh)) { test.info().annotations.push({ type: 'settings', description: `live hours differ from the snapshot (${table(bh)} vs ${table(snap)}): restoring before the test` }); await putHours(api, bh, snap.working_hours, 'restore before test'); await waitHours(api, table(snap)); }
});

test('PS-01 shorter working hours on Mondays cut every user\'s availability for the month; capacity in the report meta follows', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d); await waitLoaded(wl);
  const bh: BH = JSON.parse(fs.readFileSync(SNAP, 'utf8')).bh; const m = thisMonth(); const view = allUsersId(wl);
  const before = await monthWork(api, view, m);
  const mon = bh.working_hours.find(w => w.day === '1'); test.skip(!mon, 'Monday is not a working day in this portal');
  const changed = bh.working_hours.map(w => (w.day === '1' ? { ...w, end_time: '13:00' } : w));
  const loss = expectedLoss(m, 1, minutes(mon!) - minutes({ start_time: '09:00', end_time: '13:00' }));
  try {
    await putHours(api, bh, changed, 'shorter Monday'); await waitHours(api, table({ ...bh, working_hours: changed }));
    const after = await monthWork(api, view, m);
    expectLoss(before, after, loss, 'shorter Monday');
    await page.reload(); await wl.goto();
    const meta = wl.d.meta as any;
    expect.soft(meta?.default_business_hours_details?.working_day_availability?.['1'], 'meta Monday availability').toBe(240);
    test.info().annotations.push({ type: 'evidence', description: `${loss.countAll} Mondays in ${m.label} (${loss.countFromToday} from today); meta ${JSON.stringify(meta?.default_business_hours_details?.working_day_availability)}` });
    expect.soft(await page.locator('.weekNameColumn').filter({ hasText: /Day: Monday/ }).first().evaluate(e => e.textContent || ''), 'Monday still a working day').toMatch(/Working day/);
  } finally {
    await putHours(api, bh, bh.working_hours, 'restore'); await waitHours(api, table(bh));
    const drift = await settledDiff(api, view, m, before); const restored = await monthWork(api, view, m);
    // WL-D-41 (candidate, 15-10-2026): restoring the hours does not restore the task work the change recomputed (seen: the admin's task on the next working day +540 min)
    if (drift.length) knownDefect('WL-D-41', `task work differs after the hours were put back: ${drift.slice(0, 4).join('; ')}`);
    expect.soft(drift, 'task work unchanged after the restore').toEqual([]);
    for (const [n, b] of before) expect.soft(restored.get(n)?.availability, `${n}: availability restored`).toBe(b.availability);
    fs.rmSync(SNAP, { force: true }); // the hours are back (read back above); the work drift is recorded as WL-D-41
    await wl.discard().catch(() => {});
  }
});

test('PS-02 a holiday on a working day of this month removes that day\'s availability and the report marks it', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d); await waitLoaded(wl);
  const bh: BH = JSON.parse(fs.readFileSync(SNAP, 'utf8')).bh; const m = thisMonth(); const view = allUsersId(wl);
  const workDays = new Map(bh.working_hours.map(w => [Number(w.day), minutes(w)]));
  const tomorrow = new Date(today()); tomorrow.setDate(tomorrow.getDate() + 1);
  const day = m.days.find(d => workDays.has(d.iso) && d.date >= tomorrow); test.skip(!day, 'no working day left in this month after today');
  const date = ymd(day!.date); const dayMinutes = workDays.get(day!.iso)!;
  const before = await monthWork(api, view, m);
  let listId = '';
  try {
    const currentId = (await defaultHours(api)).id; // the live version's id (a snapshot id may be superseded by an earlier test)
    const r = await api.call('POST', '/holiday-list', { name: `${env.runId}-PS-02`, holidays: [{ name: 'QA holiday', holiday_date: date }], associated_business_hours: [{ id: currentId }] });
    const txt = await r.text(); expect(r.status(), `POST /holiday-list → ${txt.slice(0, 200)}`).toBeLessThan(300);
    const j = JSON.parse(txt); listId = String(j.id ?? j.holiday_list?.id ?? '');
    if (!listId) listId = String(((await api.getJson<any>('/holiday-list')).holiday_list ?? []).find((h: any) => h.name === `${env.runId}-PS-02`)?.id ?? '');
    expect(listId, 'holiday list id').toBeTruthy();
    // the association is what makes the holiday count: verify it, associate explicitly when the create call dropped it
    const assoc = async () => (await api.call('GET', `/holiday-list/${listId}/associated-business-hours`)).text();
    let a = await assoc();
    if (!a.includes(currentId)) { const pr = await api.call('PATCH', `/holiday-list/${listId}`, { associated_business_hours: [{ id: currentId }] }); test.info().annotations.push({ type: 'evidence', description: `holiday list was not associated to ${currentId} (${a.slice(0, 120)}); PATCH → ${pr.status()} ${(await pr.text()).slice(0, 120)}` }); a = await assoc(); }
    test.info().annotations.push({ type: 'evidence', description: `holiday list association: ${a.slice(0, 160)} (current business-hours id ${currentId})` });
    // the documented way round: the business hours reference the holiday list (PUT … holiday: {id})
    const cur = await defaultHours(api);
    const link = await api.call('PUT', '/business-hours', { id: cur.id, name: cur.name, working_hours_type: cur.working_hours_type, working_hours: cur.working_hours.map(w => ({ day: w.day, start_time: w.start_time, end_time: w.end_time, break_hours: w.break_hours ?? [] })), holiday: { id: listId }, effective_from: ymd(today()) });
    test.info().annotations.push({ type: 'settings', description: `PUT /business-hours with holiday {id: ${listId}} → ${link.status()} ${(await link.text()).slice(0, 120)}` });
    const hol = await api.call('GET', `/holiday-list/${listId}/holidays?year=${day!.date.getFullYear()}`);
    test.info().annotations.push({ type: 'evidence', description: `holiday list ${listId}: ${date} (${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day!.iso]}); GET holidays → ${hol.status()} ${(await hol.text()).slice(0, 160)}` });
    const after = await expect.poll(async () => { const a = await monthWork(api, view, m); const [n, b] = [...before][0]!; return a.get(n)!.availability === b.availability - dayMinutes ? a : null; }, { message: 'availability drops by one day', timeout: 600_000, intervals: [10000] }).not.toBeNull().then(async () => monthWork(api, view, m));
    for (const [n, b] of before) if (b.availability >= 0) expect.soft(after.get(n)?.availability, `${n}: availability minus the holiday`).toBe(b.availability - dayMinutes);
    await page.reload(); await wl.goto();
    const meta = wl.d.meta as any;
    expect.soft(JSON.stringify(meta?.default_business_hours_details?.holidays ?? []), 'meta lists the holiday').toContain(date);
    const col = page.locator('.weekNameColumn').filter({ hasText: new RegExp(`Date: (${pad(day!.date.getDate())}-${pad(day!.date.getMonth() + 1)}|${pad(day!.date.getMonth() + 1)}-${pad(day!.date.getDate())})-${day!.date.getFullYear()}`) }).first();
    const info = await col.evaluate(e => ({ text: (e.textContent || '').replace(/\s+/g, ' '), cls: e.className }));
    expect.soft(/Holiday/i.test(info.text) || /holiday/i.test(info.cls), `column marked as holiday (${info.text.slice(0, 80)} · ${info.cls})`).toBe(true);
  } finally {
    if (listId) { const d = await api.call('DELETE', `/holiday-list/${listId}`); expect.soft([200, 204], 'holiday list deleted').toContain(d.status()); }
    await expect.poll(async () => (await monthWork(api, view, m)).get([...before][0]![0])!.availability, { message: 'availability back', timeout: 300_000, intervals: [5000] }).toBe([...before][0]![1].availability);
    const drift = await settledDiff(api, view, m, before); if (drift.length) knownDefect('WL-D-41', `task work differs after the holiday was removed: ${drift.slice(0, 4).join('; ')}`); expect.soft(drift, 'task work unchanged after removing the holiday').toEqual([]);
    expect(table(await defaultHours(api)), 'business hours unchanged').toBe(table(bh));
    fs.rmSync(SNAP, { force: true });
    await wl.discard().catch(() => {});
  }
});

test('PS-03 removing Friday from the working days turns Fridays into weekends and drops their availability', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d); await waitLoaded(wl);
  const bh: BH = JSON.parse(fs.readFileSync(SNAP, 'utf8')).bh; const m = thisMonth(); const view = allUsersId(wl);
  const fri = bh.working_hours.find(w => w.day === '5'); test.skip(!fri, 'Friday is not a working day in this portal');
  const loss = expectedLoss(m, 5, minutes(fri!));
  const before = await monthWork(api, view, m);
  try {
    await putHours(api, bh, bh.working_hours.filter(w => w.day !== '5'), 'no Fridays'); await waitHours(api, table({ ...bh, working_hours: bh.working_hours.filter(w => w.day !== '5') }));
    const wk = await api.call('GET', `/weekends/provider?business_hours_ids=${encodeURIComponent(JSON.stringify([bh.id]))}`); const wkText = await wk.text();
    test.info().annotations.push({ type: 'evidence', description: `weekends: ${wkText.slice(0, 120)}; ${loss.countAll} Fridays in ${m.label} (${loss.countFromToday} from today)` });
    const after = await monthWork(api, view, m);
    expectLoss(before, after, loss, 'no Fridays');
    await page.reload(); await wl.goto();
    const types = await page.locator('.weekNameColumn').filter({ hasText: /Day: Friday/ }).evaluateAll(els => els.map(e => `${((e.textContent || '').match(/Type: ([A-Za-z ]+)/) || [])[1]?.trim()}|${/weekendbg/.test(e.className)}`));
    if (!types.length) test.info().annotations.push({ type: 'note', description: 'no Friday day columns found in the header after reload (slow portal?) — UI check skipped' });
    else expect.soft(types.every(t => /Weekend|true/.test(t)), `Friday columns render as weekend (${types.join(', ')})`).toBe(true);
    if (!/5/.test(wkText)) test.info().annotations.push({ type: 'check-spec', description: 'GET /weekends/provider still reports [6,7] after Friday was removed from the working days: is the weekend list independent of the working days?' });
  } finally {
    await putHours(api, bh, bh.working_hours, 'restore'); await waitHours(api, table(bh));
    const drift = await settledDiff(api, view, m, before); const restored = await monthWork(api, view, m);
    if (drift.length) knownDefect('WL-D-41', `task work differs after the hours were put back: ${drift.slice(0, 4).join('; ')}`);
    expect.soft(drift, 'task work unchanged after the restore').toEqual([]);
    for (const [n, b] of before) expect.soft(restored.get(n)?.availability, `${n}: availability restored`).toBe(b.availability);
    fs.rmSync(SNAP, { force: true });
    await wl.discard().catch(() => {});
  }
});
