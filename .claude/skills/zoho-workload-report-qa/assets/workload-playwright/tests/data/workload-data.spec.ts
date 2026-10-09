import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import { env, stateExists } from '../../src/env';
import { ZpApi } from '../../src/api';
import { ProjectPage } from '../../src/pages/ProjectPage';
import { loadFixture, expectedDaily, caseKeys, label, isWorkingKey, type Fixture } from '../../src/expected';

/**
 * Real allocated data, end to end:
 *   project via API → users via API (form-encoded /projectusers) → resource via UI → tasks via the Import wizard →
 *   every task field via GET /tasks → every owner-day via GET /reports/workload?project_id → monthly totals →
 *   project moved to trash via API (reversible; never a permanent DELETE).
 *
 * The fixture is Q4 2026 data (tests/data/fixtures). Opt-in because it creates a project: ZP_RUN_DATA_SPEC=1.
 * Known product defects (reported 08-10-2026) are listed, not hidden:
 *   WL-D-16 %/day above 100 is capped to 100 on import · WL-D-17 a weekend-only task is allocated on Sat/Sun ·
 *   WL-D-18 Cancelled tasks are stored as 100 % complete · WL-D-19 Associated Team and Tags do not import.
 * With ZP_EXPECT_KNOWN_DEFECTS=1 they are annotated only; otherwise they fail until fixed.
 */
const XLSX = path.join(__dirname, 'fixtures/workload_full_coverage_import.xlsx');
const fx: Fixture = loadFixture();
const NAME = `${env.runId}-data`;

test.describe.configure({ mode: 'serial' });
test.skip(process.env.ZP_RUN_DATA_SPEC !== '1' || !stateExists(env.adminState), 'opt-in: ZP_RUN_DATA_SPEC=1 and an Admin login');
test.setTimeout(15 * 60_000);

let api: ZpApi, ctx: BrowserContext, page: Page, projectId = '';
const W = new Map<string, number>(), A = new Map<string, string>(), monthTotal = new Map<string, number>();

test.beforeAll(async ({ browser }) => {
  ({ api, ctx, page } = await ZpApi.open(browser, env.adminState));
  const me = await api.me();
  const p = await api.createProject(NAME, fx.quarter.from, fx.quarter.to);
  projectId = p.id;
  test.info().annotations.push({ type: 'project', description: `${p.key} ${p.name} (${p.id})` });

  const owners = [...new Set(fx.tasks.flatMap(t => t.owners.map(o => o.name)))].filter(n => n !== 'Unassigned');
  const users = await api.users();
  const byName = new Map(users.map(u => [u.full_name as string, u]));
  const toAdd = owners.filter(n => byName.has(n) && byName.get(n).id !== me.id)
    .map(n => { const u = byName.get(n); return { email: u.email, profile_id: u.profile.id, role_id: u.role.id }; });
  if (toAdd.length) await api.addProjectUsers(projectId, toAdd);
  const members = (await api.projectUsers(projectId)).map(u => u.full_name ?? u.name);
  for (const n of owners.filter(n => byName.has(n))) expect.soft(members, `${n} is a project member`).toContain(n);

  const pp = new ProjectPage(page);
  await pp.open(NAME);
  for (const r of owners.filter(n => !byName.has(n))) await pp.addResource(r); // owners that are not portal users = resources
  await pp.importXlsx(XLSX);
  await expect.poll(async () => (await api.tasks(projectId)).length, { timeout: 10 * 60_000, intervals: [15_000], message: 'imported task count' })
    .toBe(fx.tasks.length);

  for (const [mon, from, to] of [['Oct', '2026-10-01', '2026-10-31'], ['Nov', '2026-11-01', '2026-11-30'], ['Dec', '2026-12-01', '2026-12-31']]) {
    for (const unassigned of [false, true]) {
      for (const o of await api.workload({ projectId, from, to, unassigned })) {
        const name = unassigned ? 'Unassigned' : o.name;
        monthTotal.set(`${name}|${mon}`, o.work?.total_work ?? 0);
        for (const d of o.work?.total_date_work ?? []) { W.set(`${name}|${d.date}`, (W.get(`${name}|${d.date}`) ?? 0) + d.work); A.set(`${name}|${d.date}`, d.allocation); }
      }
    }
  }
});

test.afterAll(async () => {
  if (projectId && process.env.ZP_KEEP_DATA_PROJECT !== '1') await api.trashProject(projectId);
  await ctx?.close();
});

/** Split mismatches into new problems (always fail) and known defects (fail unless ZP_EXPECT_KNOWN_DEFECTS=1). */
function verdict(rows: { id: string; known: string[]; problems: string[] }[]) {
  const bad = rows.filter(r => r.problems.length);
  const fresh = bad.filter(r => !r.known.length).map(r => `${r.id}: ${r.problems.slice(0, 2).join('; ')}`);
  const known = bad.filter(r => r.known.length).map(r => `${r.id} [${r.known.join(',')}]: ${r.problems[0]}`);
  test.info().annotations.push({ type: 'result', description: `${rows.length - bad.length}/${rows.length} pass, ${known.length} known-defect, ${fresh.length} new` });
  for (const k of known) test.info().annotations.push({ type: 'known', description: k });
  expect(fresh, 'new mismatches').toEqual([]);
  if (!env.expectKnownDefects) expect(known, 'known defects still present').toEqual([]);
}

test('DATA-01 every imported task matches the file (owners, work, dates, status, list, priority, %, billing, team, tags)', async () => {
  const unit: Record<string, string> = { 'hrs/day': 'hours_per_day', hrs: 'hours', '%/day': '%_per_day' };
  const tm = (s: unknown) => { const m = String(s ?? '').match(/^(\d+):(\d+)$/); return m ? +m[1] * 60 + +m[2] : Number(s); };
  const nm = (o: any) => o.name === 'Unassigned User' ? 'Unassigned' : `${o.first_name ?? ''}${o.last_name ? ' ' + o.last_name : ''}`.trim();
  const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9%]/g, '');
  const byName = new Map((await api.tasks(projectId)).map(t => [t.name, t]));
  verdict(fx.tasks.map(e => {
    const t = byName.get(e.name), p: string[] = [], known = [...e.known];
    if (!t) return { id: e.name, known, problems: ['missing'] };
    const ow = t.owners_and_work ?? {}, os: any[] = ow.owners ?? [];
    if (os.map(nm).sort().join('|') !== e.owners.map(o => o.name).sort().join('|')) p.push(`owners ${os.map(nm)}`);
    if (ow.unit !== unit[e.unit]) p.push(`unit ${ow.unit}`);
    for (const o of e.owners) { const a = os.find(x => nm(x) === o.name); if (a && Math.abs(tm(a.work_values) - o.value) > 0.01) p.push(`work ${o.name} ${a.work_values}≠${o.value}`); }
    if (Math.abs(tm(ow.total_work) - e.totalMinutes) > 1) p.push(`total ${ow.total_work}`);
    if ((t.start_date ? String(t.start_date).slice(0, 10) : null) !== e.start) p.push(`start ${t.start_date}`);
    if ((t.end_date ? String(t.end_date).slice(0, 10) : null) !== e.end) p.push(`end ${t.end_date}`);
    if (t.status?.name !== e.status) p.push(`status ${t.status?.name}`);
    if (t.tasklist?.name !== e.taskList) p.push(`tasklist ${t.tasklist?.name}`);
    if (norm(t.priority) !== norm(e.priority)) p.push(`priority ${t.priority}`);
    if (+t.completion_percentage !== e.percent) p.push(`percent ${t.completion_percentage}`);
    if (norm(t.billing_type) !== norm(e.billing)) p.push(`billing ${t.billing_type}`);
    // Associated Team / Tags are not returned by GET /tasks; WL-D-19 (they do not import) was confirmed in the UI.
    return { id: e.name, known, problems: p };
  }));
});

test('DATA-02 every owner-day of every scenario: hours and over/optimal/under label', async () => {
  const E = expectedDaily(fx);
  verdict(fx.cases.map(c => {
    const known = [...new Set(c.tasks.flatMap(n => fx.tasks.find(t => t.name === n)!.known.filter(k => k !== 'WL-D-18')))];
    const problems: string[] = [];
    for (const k of caseKeys(fx, c)) {
      const exp = isWorkingKey(k) ? (E.get(k) ?? 0) : 0, act = W.get(k) ?? 0;
      if (act !== exp) problems.push(`${k} ${act}≠${exp} min`);
      else if (exp && !k.startsWith('Unassigned') && A.get(k) !== label(exp, fx.availabilityMinutes)) problems.push(`${k} label ${A.get(k)}`);
    }
    return { id: c.id, known, problems };
  }));
});

test('DATA-03 monthly totals per owner and no allocation outside the planned days', async () => {
  const E = expectedDaily(fx);
  const owners = [...new Set(fx.tasks.flatMap(t => t.owners.map(o => o.name)))];
  const rows = owners.flatMap(o => (['Oct', 'Nov', 'Dec'] as const).map((mon, i) => {
    const prefix = `2026${String(10 + i)}`;
    const exp = [...E].filter(([k]) => k.startsWith(`${o}|${prefix}`)).reduce((s, [, v]) => s + v, 0);
    const act = monthTotal.get(`${o}|${mon}`) ?? 0;
    const known = [...new Set(fx.tasks.filter(t => t.owners.some(x => x.name === o) && t.start && t.start.slice(5, 7) <= String(10 + i) && t.end!.slice(5, 7) >= String(10 + i)).flatMap(t => t.known.filter(k => k !== 'WL-D-18')))];
    return { id: `${o} ${mon}`, known, problems: act === exp ? [] : [`${act}≠${exp} min (${(act - exp) / 60} h)`] };
  }));
  const planned = new Set(fx.cases.flatMap(c => caseKeys(fx, c)));
  const extra = [...W].filter(([k, v]) => v > 0 && !planned.has(k)).map(([k, v]) => `${k}=${v}`);
  rows.push({ id: 'unplanned allocation', known: [], problems: extra });
  verdict(rows);
});
