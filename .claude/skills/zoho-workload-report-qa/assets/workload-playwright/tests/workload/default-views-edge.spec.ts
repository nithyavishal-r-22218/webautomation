import { test, expect, knownDefect } from '../../src/fixtures';
import type { Page, Response } from '@playwright/test';
import fs from 'fs';
import { env, stateExists } from '../../src/env';
import { K, qa } from '../../src/locators';
import { ZpApi, type Scope, type WlAction } from '../../src/api';
import { trackContext, waitForApiBudget } from '../../src/rate';
import { WorkloadPage, toolbarIcon } from '../../src/pages/WorkloadPage';
import { PREDEFINED_VIEW_LABELS } from '../../src/discover';
import { uiRows } from '../../src/pdfExport';

/**
 * DVE — edge cases of the predefined (default) views, end to end:
 *   01 other periods: Week and Month ranges from the toolbar picker on Over- and Under-Allocated (rule recomputed for the range)
 *   02 non-empty Unallocated and Optimally-Allocated: a QA project with one task for the Admin covering a future month
 *      (Admin → optimal, everyone else → free); the project is trashed at the end
 *   03 toolbar Group By on a grouped view: Users by Profile regrouped by Roles = Users by Role; Reporting Manager; None
 *   04 Save as › New from My Direct Reports: does the new view keep the "current user" rule or save a fixed list?
 *   05 favourite, set as default and refresh on every default view (original default restored)
 *   06 the default views on the project-level report (rules within the project)
 *   07 live data change (ZP_ALLOW_DATA_CHANGES=1): joining a team as a member changes nothing; leading it adds its
 *      members to My Team Members (the view lists members of the teams the signed-in user LEADS); reverted
 *   08 signed-in user = CP with View (ZP_ALLOW_PROFILE_CHANGES=1 + ZP_ALLOW_DATA_CHANGES=1): CP's team members, empty
 *      direct reports / subordinates; then plemployee reports to CP → CP's reports and the Admin's subordinates follow;
 *      a custom view cannot hold the "current user" rule (recorded); everything reverted and read back
 * State changed by 05/07/08 is snapshotted to reports/dve-snapshot.json first and removed after a read-back restore.
 */
test.describe.configure({ mode: 'default', timeout: 1500_000 });
const SNAP = `${env.reportsDir}/dve-snapshot.json`;
const KEY = Object.fromEntries(Object.entries(PREDEFINED_VIEW_LABELS).map(([k, l]) => [l, k]));
const ALLOW_DATA = process.env.ZP_ALLOW_DATA_CHANGES === '1';
const ALLOW_PROFILE = process.env.ZP_ALLOW_PROFILE_CHANGES === '1';
const CP_STATE = process.env.ZP_PERM_USER_STATE || 'auth/wl.cp.json';
const CP_PROFILE = process.env.ZP_PERM_PROFILE || 'CP';

const snapshot = () => (fs.existsSync(SNAP) ? JSON.parse(fs.readFileSync(SNAP, 'utf8')) : {});
const remember = (k: string, v: unknown) => { const s = snapshot(); if (!(k in s)) { s[k] = v; fs.mkdirSync(env.reportsDir, { recursive: true }); fs.writeFileSync(SNAP, JSON.stringify(s, null, 2)); } };
const forget = (k: string) => { const s = snapshot(); delete s[k]; if (Object.keys(s).length) fs.writeFileSync(SNAP, JSON.stringify(s, null, 2)); else fs.rmSync(SNAP, { force: true }); };
const esc = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

// ---------------------------------------------------------------- helpers
interface Owner { id: string; name: string; work: number; alloc: string; unassigned: boolean }
async function viewIds(api: ZpApi, label: string): Promise<string[]> {
  const v = (await api.views('predefined_views')).find(x => x.name === KEY[label]);
  return v ? [v.id, v.custom_view_id].filter(Boolean) as string[] : [];
}
/** Owners of every data response (flat and grouped) for the given view ids from now on. */
function capture(page: Page, ids: string[]) {
  const owners = new Map<string, Owner>(); const urls: string[] = []; const groups = new Map<string, { name: string; owners: string[] }>();
  const on = async (r: Response) => {
    const u = new URL(r.url()); if (!r.ok() || !ids.includes(u.searchParams.get('view_id') ?? '')) return;
    const flat = /\/reports\/workload$/.test(u.pathname), go = /\/groups\/owners$/.test(u.pathname), gp = /\/reports\/workload\/groups$/.test(u.pathname);
    if (!flat && !go && !gp) return;
    if (!u.searchParams.get('fetch_unassignee') || u.searchParams.get('fetch_unassignee') === 'false') urls.push(r.url());
    const j = await r.json().catch(() => ({}));
    const put = (o: any, un: boolean) => owners.set(String(o.id), { id: String(o.id), name: o.name, work: Number(o.work?.total_work ?? 0), alloc: String(o.work?.overall_allocation ?? ''), unassigned: un });
    if (flat) for (const o of (j.owners ?? []) as any[]) put(o, u.searchParams.get('fetch_unassignee') === 'true');
    if (gp) for (const p of (j.parents ?? []) as any[]) if (!groups.has(String(p.id))) groups.set(String(p.id), { name: String(p.name), owners: [] });
    if (go) for (const p of (j.parents_with_owners ?? []) as any[]) { const gid = String(p.parent_id ?? p.id); const g = groups.get(gid) ?? { name: gid, owners: [] }; groups.set(gid, g); for (const o of (p.owners ?? []) as any[]) { g.owners.push(String(o.id)); put(o, false); } }
  };
  page.on('response', on);
  return { owners, urls, groups, stop: () => page.off('response', on) };
}
const dataFor = (page: Page, ids: string[]) => page.waitForResponse(r => {
  const u = new URL(r.url()); return /\/reports\/workload(\/groups\/owners)?$/.test(u.pathname) && ids.includes(u.searchParams.get('view_id') ?? '') && u.searchParams.get('fetch_unassignee') !== 'true';
}, { timeout: 150_000 });
async function settle(wl: WorkloadPage) {
  let last = -1, same = 0;
  for (let i = 0; i < 30 && same < 3; i++) { await wl.scroller().evaluate(el => { el.scrollTop = el.scrollHeight; }).catch(() => {}); await wl.page.waitForTimeout(800); const n = await wl.rows().count(); same = n === last ? same + 1 : 0; last = n; }
}
async function openView(wl: WorkloadPage, api: ZpApi, label: string) {
  const ids = await viewIds(api, label);
  expect(ids.length, `${label} exists`).toBeGreaterThan(0);
  const cap = capture(wl.page, ids); const first = dataFor(wl.page, ids);
  await wl.openViews();
  await wl.page.locator('.customview-name').filter({ hasText: new RegExp(`^\\s*${esc(label)}\\s*$`) }).first().click();
  await first; await settle(wl); cap.stop();
  return { ids, cap, rows: (await uiRows(wl)).map(r => r.id).sort() };
}
/**
 * Toolbar period picker (seen 13-10-2026): `topbar_calendar` → tabs data-zpqa day|week|month; Day/Week cells
 * [data-date=<DD-MM-YYYY in the portal's order>] (skip .lyteCalDiffMonth), Month cells [data-date=<Month name>] in two
 * year panels; OK. Returns the first data request the change triggers.
 */
async function setPeriod(wl: WorkloadPage, ids: string[], unit: 'day' | 'week' | 'month', start: Date, end: Date) {
  const page = wl.page;
  await qa(page, K.calendar).click();
  await qa(page, unit).click(); await page.waitForTimeout(700);
  const sample = await page.locator('[data-date]').filter({ visible: true }).first().getAttribute('data-date') ?? '';
  const dmy = /^(\d{2})-(\d{2})-\d{4}$/.test(sample) && Number(sample.slice(0, 2)) > 12 ? true : /^\d{2}-(\d{2})-\d{4}$/.test(sample) && Number(sample.slice(3, 5)) <= 12;
  const fmt = (d: Date) => { const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0'); return dmy ? `${dd}-${mm}-${d.getFullYear()}` : `${mm}-${dd}-${d.getFullYear()}`; };
  // Week / Month (and Day) pickers render two calendars: the LEFT one sets the start, the RIGHT one the end (13-10-2026)
  const pick = async (d: Date, panel: 0 | 1) => {
    const value = unit === 'month' ? d.toLocaleString('en-US', { month: 'long' }) : fmt(d);
    const idx = await page.locator('[data-date]').evaluateAll((els, a) => {
      const vis = els.filter(e => (e as HTMLElement).offsetParent);
      const half = Math.floor(vis.length / 2);
      const part = a.panel === 0 ? vis.slice(0, half) : vis.slice(half);
      const hit = part.find(e => e.getAttribute('data-date') === a.value && !/lyteCalDiffMonth/.test(e.className));
      return hit ? els.indexOf(hit) : -1;
    }, { value, panel });
    expect(idx, `${unit} ${value} in the ${panel ? 'right' : 'left'} calendar`).toBeGreaterThanOrEqual(0);
    await page.locator('[data-date]').nth(idx).click();
    await page.waitForTimeout(800);
  };
  await pick(start, 0); await pick(end, 1);
  const data = dataFor(page, ids);
  await page.locator('button, [role=button], span, div').filter({ hasText: /^\s*OK\s*$/ }).filter({ visible: true }).last().click();
  const r = await data; await settle(wl);
  return r;
}
/** Owners of the All Users view for exactly the request a view just made (same range and unit). */
async function allUsersFor(api: ZpApi, url: string, projectId = '0'): Promise<Map<string, Owner>> {
  const u = new URL(url); const iso = (s: string | null) => (s ?? '').slice(0, 10);
  const all = (await api.views('predefined_views')).find(x => x.name === 'zp.workload.customview.allusers')!;
  const span = { projectId, from: iso(u.searchParams.get('from_date')), to: iso(u.searchParams.get('to_date')), timePeriod: (u.searchParams.get('time_period') as 'days') || 'days', viewId: all.custom_view_id || all.id };
  const out = new Map<string, Owner>();
  for (const o of await api.workload(span) as any[]) out.set(String(o.id), { id: String(o.id), name: o.name, work: Number(o.work?.total_work ?? 0), alloc: String(o.work?.overall_allocation ?? ''), unassigned: false });
  for (const o of await api.workload({ ...span, unassigned: true }) as any[]) out.set(String(o.id), { id: String(o.id), name: o.name, work: Number(o.work?.total_work ?? 0), alloc: String(o.work?.overall_allocation ?? ''), unassigned: true });
  return out;
}
const ALLOC: Record<string, string[]> = { 'Unallocated Users': ['free', 'none', 'unallocated'], 'Under-Allocated Users': ['under'], 'Optimally-Allocated Users': ['optimal'], 'Over-Allocated Users': ['over'] };
/**
 * Under-Allocated also lists owners with no work at all ("free"), so a free owner is in both Unallocated and
 * Under-Allocated (seen 13-10-2026 for Week/Month ranges and for March 2027) — recorded as check spec by the callers.
 */
const UNDER_INCLUDES_FREE = true;
const byClass = (all: Map<string, Owner>, label: string) => [...all.values()].filter(o => ALLOC[label]!.includes(o.alloc) || (UNDER_INCLUDES_FREE && label === 'Under-Allocated Users' && o.alloc === 'free')).map(o => o.id).sort();
const freeNote = (all: Map<string, Owner>, label: string) => { if (label !== 'Under-Allocated Users') return; const f = [...all.values()].filter(o => o.alloc === 'free').map(o => o.name); if (f.length) test.info().annotations.push({ type: 'check spec', description: `Under-Allocated Users also lists ${f.length} owner(s) with no work (free): ${f.join(', ')} — they are in Unallocated Users too` }); };
const names = (m: Map<string, Owner>, ids: string[]) => ids.map(id => m.get(id)?.name ?? id);
/** My Team Members: members of the teams `who` leads. */
async function ledMembers(api: ZpApi, who: string): Promise<string[]> {
  const led = new Set((await api.teams()).filter(t => t.lead === who).map(t => t.id));
  const out: string[] = [];
  for (const u of await api.users()) if ((await api.userTeams(String(u.id))).some(t => led.has(t.id))) out.push(String(u.id));
  return out.sort();
}

// ---------------------------------------------------------------- 01 other periods
test('DVE-01 Week and Month ranges from the toolbar: allocation views follow the range (rule recomputed for it)', async ({ wl }) => {
  const api = new ZpApi(wl.page, wl.d);
  const cases: { unit: 'week' | 'month'; start: Date; end: Date }[] = [
    { unit: 'week', start: new Date(2026, 9, 5), end: new Date(2026, 10, 2) },   // left Oct · right Nov → weeks of 4 Oct … 7 Nov
    { unit: 'month', start: new Date(2026, 9, 1), end: new Date(2027, 0, 1) },   // left 2026 · right 2027 → Oct 2026 … Jan 2027
  ];
  for (const label of ['Over-Allocated Users', 'Under-Allocated Users']) for (const c of cases) {
    await test.step(`${label} · ${c.unit}`, async () => {
      await wl.goto();
      const v = await openView(wl, api, label);
      const cap = capture(wl.page, v.ids);
      const resp = await setPeriod(wl, v.ids, c.unit, c.start, c.end);
      cap.stop();
      const u = new URL(resp.url());
      expect.soft(u.searchParams.get('time_period'), `${label}: request unit for ${c.unit}`).toBe(c.unit === 'week' ? 'weeks' : 'months');
      const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      expect.soft(u.searchParams.get('from_date')?.slice(0, 7), `${label}: range starts in ${ymd(c.start)}`).toBe(ymd(c.unit === 'week' ? new Date(c.start.getTime() - c.start.getDay() * 864e5) : c.start));
      expect.soft(u.searchParams.get('to_date')?.slice(0, 7), `${label}: range ends in ${ymd(c.end)}`).toBe(ymd(c.unit === 'week' ? new Date(c.end.getTime() + (6 - c.end.getDay()) * 864e5) : c.end));
      const all = await allUsersFor(api, resp.url());
      const want = byClass(all, label); freeNote(all, label);
      const rows = (await uiRows(wl)).map(r => r.id).sort();
      test.info().annotations.push({ type: 'period', description: `${label} · ${c.unit} ${u.searchParams.get('from_date')?.slice(0, 10)}…${u.searchParams.get('to_date')?.slice(0, 10)}: rows ${JSON.stringify(names(all, rows))}; rule ${JSON.stringify(names(all, want))}` });
      expect.soft(rows, `${label} · ${c.unit}: UI rows = owners whose allocation for the range is ${ALLOC[label]}`).toEqual(want);
      expect.soft([...cap.owners.keys()].sort(), `${label} · ${c.unit}: API owners = UI rows`).toEqual(rows);
      if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard();
    });
  }
});

// ---------------------------------------------------------------- 02 non-empty Unallocated / Optimal
test('DVE-02 non-empty Unallocated and Optimally-Allocated views (QA project with one task in March 2027, trashed after)', async ({ wl }) => {
  const api = new ZpApi(wl.page, wl.d);
  const me = String(((await api.me()) as any).zpuid ?? (await api.me()).id);
  const project = await api.createProject(`${env.runId}-dve-alloc`, '2027-03-01', '2027-03-31');
  try {
    // full business days on the first and last date (a 14:30 start lost the first day in the trial)
    await api.createTask(project.id, { name: `${env.runId} full March for the Admin`, start: '2027-03-01T03:30:00.000Z', end: '2027-03-31T12:30:00.000Z', ownerId: me, perDay: '09:00' });
    const allView = (await api.views('predefined_views')).find(x => x.name === 'zp.workload.customview.allusers')!;
    const march = new Map((await api.workload({ from: '2027-03-01', to: '2027-03-31', timePeriod: 'months', viewId: allView.custom_view_id || allView.id }) as any[]).map(o => [String(o.id), String(o.work?.overall_allocation ?? '')]));
    test.info().annotations.push({ type: 'data', description: `March 2027 classes: ${JSON.stringify([...march.entries()])}` });
    expect.soft(march.get(me), 'the Admin is optimally allocated in March 2027').toBe('optimal');
    for (const label of ['Unallocated Users', 'Optimally-Allocated Users']) {
      await test.step(label, async () => {
        await wl.goto();
        await openView(wl, api, label);
        let resp = await wl.step('next');
        for (let i = 0; i < 12 && !/2027-03-01|2027-02-28/.test(new URL(resp.url()).searchParams.get('from_date') ?? ''); i++) resp = await wl.step('next');
        await settle(wl);
        expect(new URL(resp.url()).searchParams.get('from_date'), 'March 2027 reached with the toolbar arrow').toMatch(/2027-03-01|2027-02-28/);
        const all = await allUsersFor(api, resp.url()); freeNote(all, label);
        const want = byClass(all, label);
        const rows = (await uiRows(wl)).map(r => r.id).sort();
        test.info().annotations.push({ type: 'view', description: `${label} · Mar 2027: rows ${JSON.stringify(names(all, rows))}; rule ${JSON.stringify(names(all, want))}` });
        expect(want.length, `${label}: the data makes the view non-empty`).toBeGreaterThan(0);
        expect(rows, `${label}: rows = rule for March 2027`).toEqual(want);
        if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard();
      });
    }
  } finally {
    await api.trashProject(project.id);
  }
});

// ---------------------------------------------------------------- 03 Group By on a grouped view
test('DVE-03 Users by Profile regrouped from the toolbar: Roles = Users by Role; Reporting Manager; None', async ({ wl }) => {
  const api = new ZpApi(wl.page, wl.d);
  const role = await openView(wl, api, 'Users by Role');
  await wl.goto();
  const prof = await openView(wl, api, 'Users by Profile');
  const regroup = async (option: string) => {
    const cap = capture(wl.page, prof.ids);
    await qa(wl.page, K.groupBy).click();
    await wl.page.locator('[id$="-listbox"], .zdropdownlist').filter({ visible: true }).last().getByText(option, { exact: true }).first().click();
    await wl.page.waitForTimeout(3500); await settle(wl); cap.stop();
    await wl.page.keyboard.press('Escape');
    return { cap, rows: (await uiRows(wl)).map(r => r.id).sort(), text: (await qa(wl.page, K.groupBy).innerText()).replace(/\s+/g, ' ').trim() };
  };
  const byRoles = await regroup('Roles');
  expect.soft(byRoles.text, 'Group By shows Roles').toContain('Roles');
  expect.soft(byRoles.rows, 'Users by Profile regrouped by Roles = Users by Role rows').toEqual(role.rows);
  expect.soft(await qa(wl.page, K.saveAs).isVisible(), 'regrouping is an unsaved change').toBe(true);
  const byManager = await regroup('Reporting Manager');
  test.info().annotations.push({ type: 'check spec', description: `Users by Profile › Group By Reporting Manager: ${byManager.rows.length} rows; groups ${[...byManager.cap.groups.values()].map(g => `${g.name}(${g.owners.length})`).join(', ')}` });
  const none = await regroup('None');
  test.info().annotations.push({ type: 'check spec', description: `Users by Profile › Group By None: ${none.rows.length} rows (Profile view had ${prof.rows.length}, Lite User excluded there)` });
  expect.soft(none.rows.length, 'Group By None lists at least the grouped users').toBeGreaterThanOrEqual(prof.rows.length);
  if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard();
  await openView(wl, api, 'Users by Profile');
  expect((await qa(wl.page, K.groupBy).innerText()).replace(/\s+/g, ' '), 'saved grouping unchanged after Discard').toContain('Profiles');
});

// ---------------------------------------------------------------- 04 Save as from a default view
let savedRuleView = '';           // view id of the saved copy, reused by 08
let savedDeterminer: unknown = null;
test('DVE-04 Save as › New from My Direct Reports: the new view keeps the "current user" rule (determiner) and its rows', async ({ wl }) => {
  const api = new ZpApi(wl.page, wl.d);
  const name = `${env.runId}-dve-direct-reports`;
  const v = await openView(wl, api, 'My Direct Reports');
  await wl.step('next'); await settle(wl);
  await qa(wl.page, K.saveAs).click(); await qa(wl.page, K.saveAsNew).click();
  await qa(wl.page, K.name).fill(name);
  const put = wl.page.waitForResponse(r => r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT', { timeout: 150_000 });
  await qa(wl.page, K.save).click();
  const resp = await put;
  expect(resp.status(), 'Save as › New').toBe(201);
  const body = JSON.parse(resp.request().postData() ?? '{}');
  const listed = (await api.views('created_views')).find(x => x.name === name);
  savedRuleView = String((await resp.json().catch(() => ({}))).id ?? listed?.custom_view_id ?? listed?.id ?? '');
  const def = await api.view(savedRuleView);
  savedDeterminer = def.determiner;
  const dt = JSON.stringify(def.determiner ?? {});
  test.info().annotations.push({ type: 'evidence', description: `PUT determiner ${JSON.stringify(body.determiner ?? null)}; saved determiner ${dt}` });
  const keepsRule = /"30".*current_login_user|current_login_user.*"30"/.test(dt);
  if (!keepsRule) knownDefect('WL-D-28', 'Save as › New from a default view drops the view\'s built-in rule; the copy lists every user');
  expect.soft(keepsRule, 'saved view keeps the direct-reports rule (field 30, current_login_user)').toBe(true);
  // reopen the saved view: same rows as My Direct Reports
  await wl.goto();
  const ids = [savedRuleView, listed?.id, listed?.custom_view_id].filter(Boolean) as string[];
  const first = dataFor(wl.page, ids);
  await wl.openViews(); await wl.viewItem('My Custom Views', name).click(); await first; await settle(wl);
  expect((await uiRows(wl)).map(r => r.id).sort(), 'saved copy shows the same people as My Direct Reports').toEqual(v.rows);
});

// ---------------------------------------------------------------- 05 favourite, default, refresh on every view
test('DVE-05 favourite, set as default and refresh on every default view (original default restored)', async ({ wl }) => {
  test.setTimeout(3_000_000);
  const api = new ZpApi(wl.page, wl.d);
  const predefined = await api.views('predefined_views');
  // is_default_view is true for every predefined view; the user's chosen default is is_anchored (13-10-2026)
  const originalDefault = predefined.find(v => v.is_anchored) ?? predefined.find(v => v.name === 'zp.workload.customview.allusers')!;
  const favBefore = new Set(predefined.filter(v => v.is_favorite).map(v => v.name));
  remember('defaultView', { name: originalDefault.name, label: PREDEFINED_VIEW_LABELS[originalDefault.name] ?? originalDefault.name });
  const setDefault = async (label: string) => { await wl.openMoreActions(); await qa(wl.page, K.setDefault).click(); await wl.page.waitForTimeout(2500); void label; };
  try {
    for (const p of predefined) {
      const label = PREDEFINED_VIEW_LABELS[p.name] ?? p.name;
      await test.step(label, async () => {
        await wl.goto();
        const v = await openView(wl, api, label);
        // refresh keeps the view and its rows (grouped views reload through /groups/owners, so wait for the view's own data)
        const back = dataFor(wl.page, v.ids);
        await (await toolbarIcon(wl.page, K.refresh)).click();
        await back; await settle(wl);
        expect.soft((await qa(wl.page, K.viewDropdown).innerText()).trim().startsWith(label), `${label}: still selected after refresh`).toBe(true);
        expect.soft((await uiRows(wl)).map(r => r.id).sort(), `${label}: same rows after refresh`).toEqual(v.rows);
        // favourite on → listed → off (restore to the original state)
        if (!favBefore.has(p.name)) {
          expect.soft((await wl.toggleFavourite('POST')).ok(), `${label}: favourite added`).toBe(true);
          await wl.openViews(); await expect.soft(wl.viewItem('Favorite Views', label), `${label}: listed under Favorite Views`).toBeVisible(); await wl.closeViews();
          expect.soft((await api.views('favourite_views')).some(x => x.name === p.name), `${label}: API favourite`).toBe(true);
          expect.soft((await wl.toggleFavourite('DELETE')).ok(), `${label}: favourite removed`).toBe(true);
          expect.soft((await api.views('favourite_views')).some(x => x.name === p.name), `${label}: API favourite removed`).toBe(false);
        }
        // set as default → a fresh load opens it
        await setDefault(label);
        const now = await api.views('predefined_views');
        expect.soft(now.find(x => x.name === p.name)?.is_anchored, `${label}: is the default view (is_anchored)`).toBe(true);
        expect.soft(now.filter(x => x.is_anchored).length, `${label}: exactly one default`).toBe(1);
        await wl.goto();
        expect.soft((await qa(wl.page, K.viewDropdown).innerText()).trim().startsWith(label), `${label}: a fresh load opens the default`).toBe(true);
      });
    }
  } finally {
    const label = PREDEFINED_VIEW_LABELS[originalDefault.name] ?? originalDefault.name;
    await wl.goto(); await openView(wl, api, label).catch(() => {});
    await setDefault(label);
    expect((await api.views('predefined_views')).find(x => x.name === originalDefault.name)?.is_anchored, `original default ${label} restored (is_anchored)`).toBe(true);
    for (const v of await api.views('favourite_views')) if (!favBefore.has(v.name) && PREDEFINED_VIEW_LABELS[v.name]) { await openView(wl, api, PREDEFINED_VIEW_LABELS[v.name]!); await wl.toggleFavourite('DELETE'); }
    forget('defaultView');
  }
});

// ---------------------------------------------------------------- 06 project-level default views
test('DVE-06 the default views on the project-level report follow their rules within the project', async ({ wl }) => {
  test.setTimeout(3_000_000);
  const projectId = process.env.ZP_PERM_PROJECT_ID || '';
  test.skip(!projectId, 'set ZP_PERM_PROJECT_ID');
  const api = new ZpApi(wl.page, wl.d);
  const users = await api.users();
  const me = String(((await api.me()) as any).zpuid ?? (await api.me()).id);
  const teamsOf = new Map<string, string[]>(); for (const u of users) teamsOf.set(String(u.id), (await api.userTeams(String(u.id))).map(t => t.name));
  await wl.gotoProject(projectId); await wl.d.ready();
  const errors: string[] = [];
  for (const label of Object.values(PREDEFINED_VIEW_LABELS)) {
    await test.step(label, async () => {
      const v = await openView(wl, api, label);
      const url = v.cap.urls[0]; if (!url) { errors.push(`${label}: no data request`); return; }
      const all = await allUsersFor(api, url, projectId);
      const projectOwners = [...all.keys()];
      const apiIds = [...v.cap.owners.keys()].sort();
      if (JSON.stringify(v.rows) !== JSON.stringify(apiIds)) errors.push(`${label}: UI ${v.rows.length} rows ≠ API ${apiIds.length}`);
      let want: string[] | undefined;
      const inProject = (ids: string[]) => ids.filter(id => projectOwners.includes(id)).sort();
      const myTeams = new Set(teamsOf.get(me) ?? []);
      if (ALLOC[label]) want = byClass(all, label);
      else if (label === 'All Users') want = projectOwners.sort();
      else if (label === 'My Team Members') want = inProject(users.filter(u => (teamsOf.get(String(u.id)) ?? []).some(t => myTeams.has(t))).map(u => String(u.id)));
      else if (label === 'My Direct Reports') want = inProject(users.filter(u => String(u.reporting_to?.zpuid ?? u.reporting_to?.id ?? '') === me).map(u => String(u.id)));
      else if (label === 'My Subordinates') { const out = new Set<string>(); let f = [me]; while (f.length) { const n = users.filter(u => f.includes(String(u.reporting_to?.zpuid ?? u.reporting_to?.id ?? '')) && !out.has(String(u.id))).map(u => String(u.id)); n.forEach(x => out.add(x)); f = n; } want = inProject([...out]); }
      else if (label === 'Users by Profile' || label === 'Users by Role') { for (const id of apiIds) if (!users.some(u => String(u.id) === id)) errors.push(`${label}: ${v.cap.owners.get(id)?.name} is not a user`); }
      if (want && JSON.stringify(apiIds) !== JSON.stringify(want)) errors.push(`${label}: owners ${JSON.stringify(names(v.cap.owners, apiIds))} ≠ rule within the project ${JSON.stringify(names(all, want))}`);
      if (label !== 'Associated Teams') for (const id of apiIds) if (!projectOwners.includes(id) && !users.some(u => String(u.id) === id)) errors.push(`${label}: ${id} outside the project`);
      test.info().annotations.push({ type: 'project view', description: `${label}: ${v.rows.length} rows${want ? `, rule ${want.length}` : ''}` });
    });
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

// ---------------------------------------------------------------- 07 live team change
test('DVE-07 live data change: joining team C as a member changes nothing; becoming its lead adds its members; all reverted', async ({ wl }) => {
  test.skip(!ALLOW_DATA, 'needs ZP_ALLOW_DATA_CHANGES=1');
  const api = new ZpApi(wl.page, wl.d);
  const me = String(((await api.me()) as any).zpuid ?? (await api.me()).id);
  const teams = await api.teams();
  const target = teams.find(t => t.lead !== me);
  test.skip(!target, 'the Admin already leads every team');
  const mine = await api.userTeams(me);
  const wasMember = mine.some(t => t.id === target!.id);
  const before = await openView(wl, api, 'My Team Members');
  expect(before.rows, 'My Team Members = members of the teams I lead').toEqual(await ledMembers(api, me));
  remember('team', { id: target!.id, lead: target!.lead, member: wasMember, me });
  try {
    // a) join as a member
    if (!wasMember) await api.teamMembers(target!.id, 'add', [me]);
    await wl.goto();
    const asMember = await openView(wl, api, 'My Team Members');
    expect.soft(asMember.rows, `joining ${target!.name} as a member leaves My Team Members unchanged`).toEqual(before.rows);
    // b) become the lead
    await api.setTeamLead(target!.id, me);
    expect((await api.teams()).find(t => t.id === target!.id)?.lead, `the Admin leads ${target!.name}`).toBe(me);
    const want = await ledMembers(api, me);
    await wl.goto();
    const asLead = await openView(wl, api, 'My Team Members');
    test.info().annotations.push({ type: 'evidence', description: `My Team Members: ${before.rows.length} rows; as member of ${target!.name} ${asMember.rows.length}; as its lead ${asLead.rows.length} (rule ${want.length})` });
    expect(asLead.rows, `leading ${target!.name} adds its members`).toEqual(want);
  } finally {
    await api.setTeamLead(target!.id, target!.lead);
    if (!wasMember) await api.teamMembers(target!.id, 'remove', [me]);
    expect((await api.teams()).find(t => t.id === target!.id)?.lead, `${target!.name} lead restored`).toBe(target!.lead);
    expect((await api.userTeams(me)).map(t => t.id).sort(), 'Admin teams restored').toEqual(mine.map(t => t.id).sort());
    forget('team');
  }
  await wl.goto();
  expect((await openView(wl, api, 'My Team Members')).rows, 'My Team Members back to the original rows').toEqual(before.rows);
});

// ---------------------------------------------------------------- 08 signed-in user = CP, and a hierarchy change
test('DVE-08 signed in as CP (View): own team members, empty reports; plemployee reports to CP → both users\' views follow; all reverted', async ({ wl, browser }) => {
  test.skip(!(ALLOW_DATA && ALLOW_PROFILE && stateExists(CP_STATE)), 'needs ZP_ALLOW_DATA_CHANGES=1, ZP_ALLOW_PROFILE_CHANGES=1 and the CP login');
  const admin = new ZpApi(wl.page, wl.d);
  const users = await admin.users();
  const byName = (n: string) => users.find(u => String(u.full_name ?? u.display_name).toLowerCase() === n.toLowerCase());
  const cp = await (async () => { const { api, ctx } = await ZpApi.open(browser, CP_STATE); const meCp = String(((await api.me()) as any).zpuid ?? (await api.me()).id); await ctx.close(); return meCp; })();
  const plemployee = String(byName('Vishal plemployee')?.id ?? '');
  test.skip(!plemployee, 'no user "Vishal plemployee" to move');
  const originalManager = await admin.reportingTo(plemployee);
  const profileId = await admin.profileId(CP_PROFILE);
  const SCOPES: Scope[] = ['global', 'project'];
  const perms: Partial<Record<Scope, WlAction[]>> = {}; for (const s of SCOPES) perms[s] = await admin.perms(profileId, s);
  remember('cpPerms', { profileId, perms }); remember('plemployeeManager', { user: plemployee, manager: originalManager });
  const teamsOf = new Map<string, string[]>(); for (const u of users) teamsOf.set(String(u.id), (await admin.userTeams(String(u.id))).map(t => t.name));
  const ctx = await browser.newContext({ storageState: CP_STATE }); await trackContext(ctx); await waitForApiBudget(40);
  const page = await ctx.newPage();
  let shared = '';
  try {
    for (const s of SCOPES) await admin.setPerms(profileId, s, ['view']);
    const cwl = new WorkloadPage(page); await cwl.goto();
    const capi = new ZpApi(page, cwl.d);
    // CP's own team members
    const wantTeam = await ledMembers(admin, cp);
    const tm = await openView(cwl, capi, 'My Team Members');
    const ledNames = (await admin.teams()).filter(t => t.lead === cp).map(t => t.name);
    test.info().annotations.push({ type: 'evidence', description: `CP leads ${ledNames.join(', ') || 'no team'}; My Team Members for CP: ${tm.rows.length} rows (API ${tm.cap.owners.size}); rule ${wantTeam.length}` });
    expect.soft(tm.rows, `CP's My Team Members = members of the teams CP leads (${ledNames.join('/')})`).toEqual(wantTeam);
    for (const label of ['My Direct Reports', 'My Subordinates']) {
      await cwl.goto();
      const v = await openView(cwl, capi, label);
      test.info().annotations.push({ type: 'evidence', description: `CP ${label}: dropdown "${(await qa(page, K.viewDropdown).innerText()).trim()}", ${v.rows.length} rows, API ${v.cap.owners.size} owners [${[...v.cap.owners.values()].map(o => o.name).join(', ')}], requests ${v.cap.urls.length}` });
      if (label === 'My Subordinates' && v.rows.length) knownDefect('WL-D-29', 'My Subordinates lists every owner for a user who has no subordinates');
      expect.soft(v.rows, `CP has no ${label.toLowerCase()} yet`).toEqual([]);
      expect.soft(await page.getByText('No data found').filter({ visible: true }).first().isVisible().catch(() => false), `${label}: "No data found" for CP`).toBe(true);
    }
    // a custom view cannot hold the "current user" hierarchy rule: PUT /reports/custom-workload rejects My Direct
    // Reports' own determiner (field 30 current_login_user) with 400 INVALID_PARAMETER_VALUE (13-10-2026) — recorded
    const dr = (await admin.views('predefined_views')).find(x => x.name === 'zp.workload.customview.mydirectreports');
    const rule = dr ? (await admin.view(dr.custom_view_id || dr.id)).determiner : null;
    if (rule) {
      const r = await admin.saveView({ name: `${env.runId}-dve-rule-probe`, description: '', view_access_type: 'only_to_me', shared_users: [], project_access_type: 'all_projects', shared_projects: [],
        report_preference: { report_based_on: 'users', bar_type: 'gantt', legend: 'nolegend', view_type: 'heatmap' }, view_period: { time_period: 'days', time_period_type: 'relative', relative_time_period: 'current_month' },
        determiner: rule, is_globally_accessible: true, group_by: [{ field_name: 'users', sort_by: 'asc', module: 'workload' }] });
      test.info().annotations.push({ type: 'check spec', description: `custom view with My Direct Reports' rule ${JSON.stringify(rule)} → ${r.status()} ${(await r.text()).slice(0, 120)}` });
      if (r.status() === 201) shared = String((await r.json()).id);
    }
    // hierarchy change: plemployee → CP
    await admin.setReportingTo(plemployee, cp);
    expect(await admin.reportingTo(plemployee), 'plemployee now reports to CP').toBe(cp);
    await cwl.goto();
    expect.soft((await openView(cwl, capi, 'My Direct Reports')).rows, 'CP direct reports = plemployee').toEqual([plemployee]);
    await cwl.goto();
    expect.soft((await openView(cwl, capi, 'My Subordinates')).rows, 'CP subordinates = plemployee').toEqual([plemployee]);
    await wl.goto();
    const adminSubs = await openView(wl, admin, 'My Subordinates');
    expect.soft(adminSubs.rows.includes(plemployee), "plemployee left the Admin's subordinates").toBe(false);
  } finally {
    await admin.setReportingTo(plemployee, originalManager);
    expect(await admin.reportingTo(plemployee), 'plemployee manager restored').toBe(originalManager);
    forget('plemployeeManager');
    for (const s of SCOPES) await admin.setPerms(profileId, s, perms[s]!);
    for (const s of SCOPES) expect(await admin.perms(profileId, s), `CP ${s} permissions restored`).toEqual(perms[s]);
    forget('cpPerms');
    if (shared) await admin.deleteView(shared);
    if (savedRuleView) { await admin.deleteView(savedRuleView); savedRuleView = ''; }
    await ctx.close();
  }
});

test.afterAll(async ({ browser }, info) => {
  // the saved copy from DVE-04 when 08 did not run
  if (!savedRuleView) return;
  const { api, ctx } = await ZpApi.open(browser, info.project.use.storageState as string);
  await api.deleteView(savedRuleView).catch(() => {}); await ctx.close();
});
