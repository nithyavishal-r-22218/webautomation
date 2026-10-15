import { test, expect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { env } from '../../src/env';
import { K, qa } from '../../src/locators';
import { addDays, type Unit } from '../../src/dates';
import { CreateViewPage } from '../../src/pages/CreateViewPage';
import type { WorkloadPage } from '../../src/pages/WorkloadPage';
import {
  waitLoaded, leaveToAllUsers, checkData, checkDefinition, checkOpened, checkReopened, createCase, pairwise, removeView, type Built, type CaseSpec,
} from '../../src/createChecks';

/**
 * CV — Create Workload Report (view dropdown › "+ Create Workload Report"), every option and their combinations.
 * Each case is created in the UI and checked in five layers (src/createChecks.ts): request, stored definition, list,
 * the view the app opens (name, URL, period, type, data label, grouping), and its data (UI rows = API owners; work
 * against All Users for the same period). Every view is deleted afterwards.
 *
 *   CV-00      defaults: a name only
 *   CV-PW-nn   pairwise over view type × unit × style × data label × reports-for × grouping × order × share × projects:
 *              every pair of values appears in at least one case (constraints: Man Weeks needs Weeks/Months;
 *              order only with a grouping; Timeline has no expanded-view style and groups by None only)
 *   CV-TP-*    every Relative option of each unit, and a Custom range per unit
 *   CV-SP-*    Share (none / all / specific user) × Show in other projects (none / all / specific project), with the
 *              project-level report of the chosen project and of another one checked in the UI
 */
// one retry: a case that hits a report still loading after 150 s is created again from scratch (each attempt cleans up)
test.describe.configure({ mode: 'parallel', retries: 1, timeout: 900_000 }); // cases are independent (each creates and deletes its own view): shardable across portals

const LABELS = ['No Legend', 'Allocated Hours', 'Allocated Minutes', 'Allocated Man Days', 'Allocated Man Weeks', 'Allocated Percentage',
  'Available Hours', 'Available Minutes', 'Available Man Days', 'Available Man Weeks', 'Available Percentage'] as const;
const FACTORS = {
  viewType: ['bar', 'heatmap', 'timeline'], unit: ['days', 'weeks', 'months'], style: ['gantt', 'timeline'], dataLabel: LABELS,
  reportsFor: ['users', 'teams'], grouping: ['None', 'Profiles', 'Roles', 'Reporting Manager', 'User/Resource'], order: ['Asc', 'Desc'],
  share: ['none', 'all', 'users'], projects: ['none', 'all', 'projects'],
} as const;
const valid = (c: Record<string, unknown>) =>
  !(/Man Weeks/.test(String(c.dataLabel ?? '')) && c.unit === 'days') &&
  !(c.grouping === 'None' && c.order === 'Desc') &&
  !(c.viewType === 'timeline' && c.style === 'timeline') &&
  // the Timeline view type offers Grouping "None" only (seen 14-10-2026)
  !(c.viewType === 'timeline' && c.grouping !== undefined && c.grouping !== 'None') &&
  // nor Reports For (seen 14-10-2026): Timeline cases stay on Task Owner
  !(c.viewType === 'timeline' && c.reportsFor === 'teams');
const CASES = pairwise(FACTORS, valid);

interface Ctx { allUsersId: string; shareUser: string; project: { id: string; name: string }; other?: { id: string; name: string } }
let ctx: Ctx | undefined;
async function context(wl: WorkloadPage): Promise<Ctx> {
  if (ctx) return ctx;
  const api = new ZpApi(wl.page, wl.d);
  const all = (await api.views('predefined_views')).find(v => v.name === 'zp.workload.customview.allusers')!;
  const me = await api.me();
  const users = await api.users();
  const shareUser = String((users.find((u: any) => String(u.id) !== String(me.id) && /customprofile/i.test(u.email)) ?? users.find((u: any) => String(u.id) !== String(me.id)))?.full_name ?? '');
  const projects = await api.getJson<any[]>('/projects?page=1&per_page=100');
  const pid = env.portal && process.env.ZP_PERM_PROJECT_ID ? process.env.ZP_PERM_PROJECT_ID : String(projects[0]?.id ?? '');
  const p = projects.find(x => String(x.id) === pid) ?? projects[0];
  const other = projects.find(x => String(x.id) !== String(p.id) && !/^Bugs$/.test(x.name));
  ctx = { allUsersId: String(all.custom_view_id || all.id), shareUser, project: { id: String(p.id), name: p.name }, other: other ? { id: String(other.id), name: other.name } : undefined };
  test.info().annotations.push({ type: 'context', description: JSON.stringify(ctx) });
  return ctx;
}

/** Create → definition → opened → data → reopened, always deleting the view. */
async function runCase(wl: WorkloadPage, spec: CaseSpec, extra?: (b: Built) => Promise<void>) {
  const api = new ZpApi(wl.page, wl.d);
  const c = await context(wl);
  let b: Built | undefined;
  try {
    b = await createCase(wl, spec);
    await checkDefinition(api, b);
    const period = await checkOpened(wl, b);
    await checkData(wl, b, period, c.allUsersId);
    await checkReopened(wl, b);
    if (extra) await extra(b);
  } finally {
    await leaveToAllUsers(wl);
    await removeView(api, b?.id ?? '', spec.name);
  }
}
const nameOf = (tag: string) => `${env.runId}-${tag}`;

test('CV-00 defaults: a name only creates a Heatmap / Days / This Month / No Legend / Task Owner view for me alone', async ({ wl }) => {
  const spec: CaseSpec = { name: nameOf('CV-00') };
  await runCase(wl, spec, async b => {
    expect.soft(b.body.report_preference, 'default report preference').toMatchObject({ view_type: 'heatmap', legend: 'nolegend', bar_type: 'gantt', report_based_on: 'users' });
    expect.soft(b.body.view_period, 'default period').toMatchObject({ time_period: 'days', time_period_type: 'relative', relative_time_period: 'current_month' });
    expect.soft(b.body.determiner ?? {}, 'no criteria').toEqual({});
  });
});

CASES.forEach((f, i) => {
  const id = `CV-PW-${String(i + 1).padStart(2, '0')}`;
  test(`${id} ${f.viewType} · ${f.unit} · ${f.viewType === 'timeline' ? '-' : f.style} · ${f.dataLabel} · ${f.reportsFor} · group ${f.grouping} ${f.grouping === 'None' ? '' : f.order} · share ${f.share} · projects ${f.projects}`, async ({ wl }) => {
    const c = await context(wl);
    const spec: CaseSpec = {
      name: nameOf(id), description: `${id} pairwise case`,
      viewType: f.viewType as any, unit: f.unit as Unit, dataLabel: f.dataLabel, reportsFor: f.reportsFor as any,
      ...(f.viewType === 'timeline' ? {} : { style: f.style as any }),
      grouping: f.grouping, order: f.order as any,
      share: f.share === 'users' ? { mode: 'users', users: [c.shareUser] } : { mode: f.share as any },
      projects: f.projects === 'projects' ? { mode: 'projects', projects: [c.project.name] } : { mode: f.projects as any },
    };
    await runCase(wl, spec, async b => {
      if (f.share === 'users') expect.soft((b.def.shared_users ?? []).map((u: any) => u.full_name), `${id}: shared with ${c.shareUser}`).toContain(c.shareUser);
      if (f.projects === 'projects') expect.soft((b.def.shared_projects ?? []).map((p: any) => String(p.id)), `${id}: shown in ${c.project.name}`).toContain(c.project.id);
    });
  });
});

for (const unit of ['days', 'weeks', 'months'] as Unit[]) {
  test(`CV-TP-${unit} every Relative option and a Custom range`, async ({ wl }) => {
    test.setTimeout(3 * 3600_000);
    const cv = new CreateViewPage(wl.page);
    await cv.open(wl); await cv.setUnit(unit);
    const options = await cv.relativeOptions();
    await qa(wl.page, K.cancel).click();
    expect(options.length, `${unit}: options read live`).toBeGreaterThan(0);
    for (const option of options) await test.step(option, async () => {
      await wl.goto();
      await runCase(wl, { name: nameOf(`CV-TP-${unit}-${option.replace(/\W+/g, '')}`), unit, option, viewType: 'bar', dataLabel: 'Allocated Hours' });
    });
    await test.step('Custom range', async () => {
      const t = new Date();
      // Months: three months inside one year (the create form's month picker shows one year per panel)
      const y = t.getFullYear(), sm = t.getMonth() <= 9 ? t.getMonth() + 1 : t.getMonth() - 2;
      const range: [Date, Date] = unit === 'months' ? [new Date(y, sm, 1), new Date(y, sm + 2, 0)] : [addDays(t, 4), addDays(t, 29)];
      await wl.goto();
      await runCase(wl, { name: nameOf(`CV-TP-${unit}-custom`), unit, custom: range, viewType: 'bar', dataLabel: 'Allocated Hours' });
    });
  });
}

const SHARE = ['none', 'all', 'users'] as const, PROJ = ['none', 'all', 'projects'] as const;
for (const sh of SHARE) for (const pr of PROJ) {
  test(`CV-SP share ${sh} × projects ${pr}: definition, and the project-level reports list it only where they should`, async ({ wl }) => {
    const c = await context(wl);
    const spec: CaseSpec = {
      name: nameOf(`CV-SP-${sh}-${pr}`),
      share: sh === 'users' ? { mode: 'users', users: [c.shareUser] } : { mode: sh },
      projects: pr === 'projects' ? { mode: 'projects', projects: [c.project.name] } : { mode: pr },
    };
    await runCase(wl, spec, async b => {
      // a project-level report lists the view when it is shown in all projects, or in that project
      const listedIn = async (p: { id: string; name: string }) => {
        await wl.gotoProject(p.id); await waitLoaded(wl); await wl.openViews();
        const n = await wl.page.locator('.customview-name').filter({ hasText: spec.name }).filter({ visible: true }).count();
        await wl.closeViews(); return n > 0;
      };
      const inChosen = await listedIn(c.project);
      expect.soft(inChosen, `${spec.name}: listed in ${c.project.name}'s report`).toBe(pr !== 'none');
      if (c.other) expect.soft(await listedIn(c.other), `${spec.name}: listed in ${c.other.name}'s report`).toBe(pr === 'all');
      test.info().annotations.push({ type: 'access', description: `${spec.name}: ${b.def.view_access_type} / ${b.def.project_access_type}; shared users ${(b.def.shared_users ?? []).map((u: any) => u.full_name).join(', ') || '-'}` });
      await wl.goto();
    });
  });
}
