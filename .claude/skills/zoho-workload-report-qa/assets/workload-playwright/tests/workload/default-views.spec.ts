import { test, expect } from '../../src/fixtures';
import type { Page, Response } from '@playwright/test';
import { K, qa } from '../../src/locators';
import { ZpApi } from '../../src/api';
import { trackContext, waitForApiBudget } from '../../src/rate';
import { WorkloadPage } from '../../src/pages/WorkloadPage';
import { FilterPanel, criteriaOf } from '../../src/pages/FilterPanel';
import { PREDEFINED_VIEW_LABELS } from '../../src/discover';
import { exportPdf, parsePdf, uiRows, uiTotals } from '../../src/pdfExport';

/**
 * DV — every predefined (default) Workload view, end to end, against an independent oracle:
 *   All Users                 every user and resource, plus Unassigned
 *   Associated Teams          one row per team (/teams)
 *   My Team Members           members of the teams the signed-in user leads (/teams lead + /users/{id}/teams)
 *   My Direct Reports         users whose reporting_to is the signed-in user (/users)
 *   My Subordinates           everyone below the signed-in user, transitively (/users)
 *   Users by Profile / Role   each user under the group of its profile / role (/users + /reports/workload/groups)
 *   Unallocated … Over-Allocated   owners whose overall_allocation in All Users is free / under / optimal / over
 * Per view: it loads with its own name, no unsaved marker and no chips; UI rows = the view's API owners = the oracle;
 * user-level views keep every owner's All Users work; an empty view says "No data found"; a toolbar filter on top
 * re-queries the same view and narrows it, and Clear filter returns to the view's own rows (not All Users);
 * Export to PDF prints the view's data label, range and rows in UI order (totals = UI when the view prints numbers).
 */
test.describe.configure({ mode: 'default', timeout: 900_000 });

interface Owner { id: string; name: string; work: number; alloc: string; unassigned: boolean }
interface Oracle {
  me: string; all: Map<string, Owner>; unassigned?: Owner;
  users: { id: string; name: string; role: string; profile: string; reportsTo: string; teams: string[] }[];
  teams: string[];
  /** team name → lead's id */
  leads: Map<string, string>;
}
let O: Oracle;

const views = Object.entries(PREDEFINED_VIEW_LABELS).map(([key, label]) => ({ key, label }));

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(400_000);
  const ctx = await browser.newContext({ storageState: info.project.use.storageState as string | undefined });
  await trackContext(ctx); await waitForApiBudget(60);
  const page = await ctx.newPage();
  const wl = new WorkloadPage(page); await wl.goto();
  const api = new ZpApi(page, wl.d);
  const ch = wl.d.meta!.chart_details; const iso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const span = { from: iso(ch.start_date!), to: iso(ch.end_date!), timePeriod: (ch.range as 'days') || 'days', viewId: wl.d.meta!.custom_view_id };
  const all = new Map<string, Owner>();
  for (const o of await api.workload(span) as any[]) all.set(String(o.id), { id: String(o.id), name: o.name, work: Number(o.work?.total_work ?? 0), alloc: String(o.work?.overall_allocation ?? ''), unassigned: false });
  const un = (await api.workload({ ...span, unassigned: true }) as any[])[0];
  const me = String((await api.me() as any).zpuid ?? (await api.me()).id);
  const users = [];
  for (const u of await api.users()) {
    const teams = ((await api.getJson<any>(`/users/${u.id}/teams`).catch(() => ({ teams: [] }))).teams ?? []).map((t: any) => String(t.name));
    users.push({ id: String(u.id), name: String(u.full_name ?? u.display_name ?? ''), role: String(u.role?.name ?? ''), profile: String(u.profile?.name ?? ''), reportsTo: String(u.reporting_to?.zpuid ?? u.reporting_to?.id ?? ''), teams });
  }
  const teamList = await api.teams();
  const teams = teamList.map(t => t.name);
  const leads = new Map(teamList.map(t => [t.name, t.lead]));
  O = { me, all, users, teams, leads, unassigned: un ? { id: String(un.id), name: un.name, work: Number(un.work?.total_work ?? 0), alloc: String(un.work?.overall_allocation ?? ''), unassigned: true } : undefined };
  test.info().annotations.push({ type: 'oracle', description: `me ${me}; ${all.size} owners; ${users.length} users; teams ${teams.join(', ')}; Unassigned ${O.unassigned ? O.unassigned.alloc : 'none'}` });
  await ctx.close();
});

/** Owners (and groups) of every data response for one view from now on: /reports/workload?… and /groups/owners. */
function captureView(page: Page, viewIds: string[]) {
  const owners = new Map<string, Owner>(); const groups = new Map<string, { name: string; owners: string[] }>(); const filters: string[] = [];
  const mine = (u: URL) => viewIds.includes(u.searchParams.get('view_id') ?? '');
  const on = async (r: Response) => {
    const u = new URL(r.url()); if (!r.ok() || !mine(u)) return;
    if (/\/reports\/workload\/groups\/owners/.test(u.pathname) || /\/reports\/workload\/groups$/.test(u.pathname) || /\/reports\/workload$/.test(u.pathname)) filters.push(u.searchParams.get('filter') ?? '');
    const j = await r.json().catch(() => ({}));
    if (/\/reports\/workload$/.test(u.pathname)) {
      const un = u.searchParams.get('fetch_unassignee') === 'true';
      for (const o of (j.owners ?? []) as any[]) owners.set(String(o.id), { id: String(o.id), name: o.name, work: Number(o.work?.total_work ?? 0), alloc: String(o.work?.overall_allocation ?? ''), unassigned: un });
    }
    if (/\/groups$/.test(u.pathname)) for (const p of (j.parents ?? []) as any[]) if (!groups.has(String(p.id))) groups.set(String(p.id), { name: String(p.name), owners: [] });
    if (/\/groups\/owners$/.test(u.pathname)) for (const p of (j.parents_with_owners ?? []) as any[]) {
      const gid = String(p.parent_id ?? p.id); // groups/owners names the group parent_id (13-10-2026)
      const g = groups.get(gid) ?? { name: String(p.name ?? gid), owners: [] }; groups.set(gid, g);
      for (const o of (p.owners ?? []) as any[]) { g.owners.push(String(o.id)); owners.set(String(o.id), { id: String(o.id), name: o.name, work: Number(o.work?.total_work ?? 0), alloc: String(o.work?.overall_allocation ?? ''), unassigned: false }); }
    }
  };
  page.on('response', on);
  return { owners, groups, filters, stop: () => page.off('response', on) };
}
/** Scroll until the rendered row count stops changing (grouped and paged views alike). */
async function settle(wl: WorkloadPage) {
  let last = -1, same = 0;
  for (let i = 0; i < 30 && same < 3; i++) {
    await wl.scroller().evaluate(el => { el.scrollTop = el.scrollHeight; }).catch(() => {});
    await wl.page.waitForTimeout(800);
    const n = await wl.rows().count(); same = n === last ? same + 1 : 0; last = n;
  }
}
const viewData = (page: Page, ids: string[]) => page.waitForResponse(r => {
  const u = new URL(r.url()); return /\/reports\/workload(\/groups\/owners)?$/.test(u.pathname) && ids.includes(u.searchParams.get('view_id') ?? '') && u.searchParams.get('fetch_unassignee') !== 'true';
}, { timeout: 150_000 });

/** The ids the view must show, from the oracle (undefined: names are compared instead — Associated Teams). */
function expected(key: string): { ids?: string[]; names?: string[]; userLevel: boolean; note?: string } {
  const users = O.users; const allIds = [...O.all.keys()];
  const withUn = (ids: string[], alloc?: string) => (O.unassigned && (!alloc || O.unassigned.alloc === alloc) ? [...ids, O.unassigned.id] : ids);
  const byAlloc = (a: string) => withUn([...O.all.values()].filter(o => o.alloc === a).map(o => o.id), a);
  switch (key) {
    case 'zp.workload.customview.allusers': return { ids: withUn(allIds), userLevel: true };
    case 'zp.workload.customview.taskassociatedtoteams': return { names: O.teams, userLevel: false };
    case 'zp.workload.customview.myteammembers': {
      // members of the teams the signed-in user LEADS (confirmed 13-10-2026: joining a team as a member changes nothing)
      const led = new Set([...O.leads.entries()].filter(([, lead]) => lead === O.me).map(([name]) => name));
      return { ids: users.filter(u => u.teams.some(t => led.has(t))).map(u => u.id).filter(id => O.all.has(id)), userLevel: true };
    }
    case 'zp.workload.customview.mydirectreports': return { ids: users.filter(u => u.reportsTo === O.me).map(u => u.id), userLevel: true };
    case 'zp.workload.customview.mysubordinates': {
      const out = new Set<string>(); let frontier = [O.me];
      while (frontier.length) { const next = users.filter(u => frontier.includes(u.reportsTo) && !out.has(u.id)).map(u => u.id); next.forEach(id => out.add(id)); frontier = next; }
      return { ids: [...out], userLevel: true };
    }
    case 'zp.workload.customview.usersbyprofile': return { ids: users.map(u => u.id), userLevel: true, note: 'profile' };
    case 'zp.workload.customview.usersbyrole': return { ids: users.map(u => u.id), userLevel: true, note: 'role' };
    case 'zp.workload.customview.unallocatedusers': return { ids: [...byAlloc('free'), ...byAlloc('none'), ...byAlloc('unallocated')].filter((v, i, a) => a.indexOf(v) === i), userLevel: true };
    case 'zp.workload.customview.underallocatedusers': return { ids: byAlloc('under'), userLevel: true };
    case 'zp.workload.customview.optimalallocatedusers': return { ids: byAlloc('optimal'), userLevel: true };
    case 'zp.workload.customview.overallocatedusers': return { ids: byAlloc('over'), userLevel: true };
    default: return { userLevel: true };
  }
}

for (const v of views) {
  test(`DV ${v.label}: loads, rows = API = its rule, filter on top and Clear back to the view, PDF export`, async ({ wl }) => {
    const page = wl.page; const api = new ZpApi(page, wl.d);
    const listed = (await api.views('predefined_views')).find(x => x.name === v.key);
    test.skip(!listed, `portal has no ${v.label} view`);
    const ids = [listed!.id, listed!.custom_view_id].filter(Boolean) as string[];
    const exp = expected(v.key);
    const fails: string[] = [];
    const soft = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); expect.soft(ok, `${v.label}: ${msg}`).toBe(true); };

    // 1 load
    const cap = captureView(page, ids);
    const first = viewData(page, ids);
    await wl.openViews();
    await page.locator('.customview-name').filter({ hasText: new RegExp(`^\\s*${v.label.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`) }).first().click();
    await first; await settle(wl); cap.stop();
    soft((await qa(page, K.viewDropdown).innerText()).trim().startsWith(v.label), `dropdown shows "${v.label}"`);
    soft(!(await qa(page, K.saveAs).isVisible()), 'no unsaved marker on a predefined view');
    const rows = await uiRows(wl); const rowIds = rows.map(r => r.id).sort();
    const apiIds = [...cap.owners.keys()].sort();
    const empty = apiIds.length === 0;
    test.info().annotations.push({ type: 'view', description: `${v.label}: ${rows.length} rows [${rows.map(r => r.text).join(' · ')}]; API ${apiIds.length} owners${cap.groups.size ? `; groups ${[...cap.groups.values()].map(g => `${g.name}(${g.owners.length})`).join(', ')}` : ''}` });

    // 2 rows = API
    if (empty) {
      soft(rows.length === 0, 'no rows when the API has no owners');
      soft(await page.getByText('No data found').filter({ visible: true }).first().isVisible().catch(() => false), '"No data found" shown');
    } else soft(JSON.stringify(rowIds) === JSON.stringify(apiIds), `UI rows (${rowIds.length}) = API owners (${apiIds.length})`);

    // 3 the view's rule
    if (exp.names) {
      const names = [...cap.owners.values()].map(o => o.name).sort();
      soft(JSON.stringify(names) === JSON.stringify([...exp.names].sort()), `teams ${JSON.stringify(names)} = /teams ${JSON.stringify([...exp.names].sort())}`);
    } else if (exp.note === 'profile' || exp.note === 'role') {
      const groupNames = new Set([...cap.groups.values()].map(g => g.name));
      const shown = new Set(apiIds);
      for (const u of O.users) {
        const want = exp.note === 'profile' ? u.profile : u.role;
        const g = [...cap.groups.values()].find(x => x.owners.includes(u.id));
        if (!groupNames.has(want)) { test.info().annotations.push({ type: 'check spec', description: `${v.label}: ${u.name} (${exp.note} "${want}") is in no group — the ${exp.note} has no group in this view` }); soft(!shown.has(u.id), `${u.name} not shown outside a group`); continue; }
        soft(!!g, `${u.name} listed`);
        if (g) soft(g.name === want, `${u.name} under "${g.name}" = ${exp.note} "${want}"`);
      }
      for (const id of apiIds) soft(O.users.some(u => u.id === id), `${cap.owners.get(id)?.name ?? id} is a user (no resources or Unassigned in a ${exp.note} view)`);
    } else if (exp.ids) {
      soft(JSON.stringify(apiIds) === JSON.stringify([...exp.ids].sort()), `owners ${JSON.stringify([...cap.owners.values()].map(o => o.name).sort())} = rule ${JSON.stringify(exp.ids.map(id => O.all.get(id)?.name ?? (O.unassigned?.id === id ? 'Unassigned' : O.users.find(u => u.id === id)?.name ?? id)).sort())}`);
    }
    // 4 user-level views keep each owner's work
    if (exp.userLevel) for (const o of cap.owners.values()) {
      const base = o.unassigned ? O.unassigned : O.all.get(o.id);
      if (base) soft(o.work === base.work, `${o.name}: work ${o.work} = All Users ${base.work}`);
    }

    // 5 a toolbar filter on top, then Clear filter back to the view's rows
    if (!empty) {
      const fp = new FilterPanel(page);
      await fp.open(); await fp.expand('4'); await fp.setConditionOf('4', 'all_open');
      const cap2 = captureView(page, ids);
      const again = viewData(page, ids);
      await qa(page, K.filterFind).click();
      const resp = await again; await settle(wl); cap2.stop();
      const u = new URL(resp.url());
      soft(criteriaOf(u.searchParams.get('filter') ?? '').some(c => c.field_name === 'status'), 'filtered request carries the Status criterion');
      soft(ids.includes(u.searchParams.get('view_id') ?? ''), 'filtered request stays on the view');
      const filteredIds = (await uiRows(wl)).map(r => r.id);
      for (const id of filteredIds) soft(rowIds.includes(id), `filtered row ${id} belongs to the view`);
      for (const o of cap2.owners.values()) { const b = cap.owners.get(o.id); if (b && exp.userLevel) soft(o.work <= b.work, `${o.name}: open-task work ${o.work} ≤ view work ${b.work}`); }
      const chips = await fp.chips();
      test.info().annotations.push({ type: 'evidence', description: `${v.label} + Status All Open: ${filteredIds.length} rows; chips "${chips}"` });
      if (!chips) test.info().annotations.push({ type: 'check spec', description: `${v.label}: no chip bar for a toolbar filter on this view${cap.groups.size ? ' (grouped view — see WL-D-24)' : ''}` });
      // clear
      const back = viewData(page, ids);
      if (await qa(page, K.filterClear).isVisible()) await qa(page, K.filterClear).click();
      else { await fp.open(); await fp.reset(); await qa(page, K.filterFind).click(); }
      await back.catch(() => null); await settle(wl);
      const afterIds = (await uiRows(wl)).map(r => r.id).sort();
      soft(JSON.stringify(afterIds) === JSON.stringify(rowIds), `after clearing, rows (${afterIds.length}) = the view's own rows (${rowIds.length}), not All Users`);
      soft((await qa(page, K.viewDropdown).innerText()).trim().startsWith(v.label), 'still on the view after clearing');
      if (await qa(page, K.saveAs).isVisible()) await wl.discard().catch(() => {});
    }

    // 6 PDF export
    if (await qa(page, K.exportPdf).isVisible()) {
      const pdf = await exportPdf(page, `DV-${v.label}`);
      const p = parsePdf(pdf.text);
      soft(p.viewBy === await wl.dataLabel(), `PDF view by "${p.viewBy}" = data label "${await wl.dataLabel()}"`);
      soft(p.dateRange === (await qa(page, K.calendar).innerText()).replace(/\s+/g, ' ').trim(), `PDF Date "${p.dateRange}" = toolbar range`);
      soft(p.project === 'All Projects', `PDF Project "${p.project}"`);
      const ui = await uiRows(wl); let at = -1;
      for (const r of ui) { const key = r.key.replace(/\(\d+\)$/, ''); const i = p.flat.indexOf(key, at + 1); soft(i > at, `PDF lists "${r.text}" in UI order`); if (i > at) at = i; }
      if (p.dataLines.length) {
        soft(p.dataLines.length === ui.length, `PDF ${p.dataLines.length} data lines = ${ui.length} rows`);
        const totals = await uiTotals(wl);
        if (totals.length === ui.length) p.dataLines.forEach((l, i) => soft(l[0] === totals[i], `PDF total "${l[0]}" = UI "${totals[i]}" (${ui[i]?.text})`));
      }
      test.info().annotations.push({ type: 'pdf', description: `${v.label}: ${pdf.file} — view by "${p.viewBy}", ${p.dataLines.length} data line(s), ${ui.length} rows` });
    }
    expect(fails, `failed layers:\n${fails.join('\n')}`).toEqual([]);
  });
}
