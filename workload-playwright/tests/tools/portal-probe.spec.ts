import fs from 'fs';
import { test } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { env } from '../../src/env';

/**
 * Read-only inventory of the portal the run points at (ZP_PORTAL): everything the suite's cases depend on, saved to
 * <reports>/inventory.json. The seed tool copies the source portal's inventory into another portal.
 */
test('portal inventory (read only)', async ({ wl }) => {
  test.setTimeout(900_000);
  const api = new ZpApi(wl.page, wl.d);
  const get = async (p: string) => api.getJson<any>(p).catch(e => ({ error: String(e).split('\n')[0] }));
  const users = await api.users();
  const teams = (await get('/teams?page=1&per_page=200')).teams ?? [];
  const memberships: Record<string, { id: string; name: string }[]> = {};
  for (const u of users) memberships[u.id] = await api.userTeams(String(u.id)).catch(() => []);
  const projects = await get('/projects?page=1&per_page=100');
  const perProject: Record<string, unknown> = {};
  for (const p of Array.isArray(projects) ? projects : []) {
    if (/^QA-WL|^WL_API/.test(p.name)) continue;
    perProject[p.id] = {
      tasklists: (await get(`/projects/${p.id}/tasklists?page=1&per_page=200`)).tasklists ?? [],
      users: await api.projectUsers(String(p.id)).catch(() => []),
      tasks: await api.tasks(String(p.id)).catch(() => []),
    };
  }
  const inv = {
    portal: env.portal, portalId: wl.d.portalId, at: new Date().toISOString(), me: await api.me(),
    users, memberships, teams,
    tags: (await get('/tags?page=1&per_page=100')).tags ?? [],
    projectGroups: (await get('/project-groups'))['project-groups'] ?? [],
    profiles: await get('/profiles'),
    taskFields: await get('/settings/fields?module=tasks'),
    taskLayouts: await get('/settings/layouts?module=tasks'),
    // reporting hierarchy: on when /user/hierarchy returns a tree (empty when the portal has it off)
    hierarchyEnabled: await get('/user/hierarchy').then(h => Array.isArray(h) && h.length > 0),
    // what the report shows: every owner's total work per month, Oct 2026 – Mar 2027 (the seeded data's range)
    workload: Object.fromEntries(await Promise.all(['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'].map(async m => {
      const [y, mo] = m.split('-').map(Number) as [number, number];
      const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const q = new URLSearchParams({ project_id: '0', from_date: `${m}-01T00:00:00.000Z`, to_date: `${m}-${last}T23:59:59.999Z`, time_period: 'days', index: '1', range: '100' });
      const j = await get(`/reports/workload?${q}`);
      const un = await get(`/reports/workload?${q}&fetch_unassignee=true`);
      const rows = [...(j.owners ?? []), ...(un.owners ?? [])].map((o: any) => [o.is_resource ? `resource:${o.name}` : (users.find((u: any) => String(u.id) === String(o.id))?.email ?? o.name), Number(o.work?.total_work ?? 0)]);
      return [m, Object.fromEntries(rows)];
    }))),
    meta: wl.d.meta ?? null,
    projects, perProject,
  };
  fs.mkdirSync(env.reportsDir, { recursive: true });
  fs.writeFileSync(`${env.reportsDir}/inventory.json`, JSON.stringify(inv, null, 1));
  const n = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  console.log(`${env.portal}: users ${n(users)}, teams ${n(teams)}, tags ${n(inv.tags)}, groups ${n(inv.projectGroups)}, projects ${n(projects)}, ` +
    `custom task fields ${n(inv.taskFields) ? (inv.taskFields as any[]).filter(f => !f.is_default).length : 0}; ` +
    Object.entries(perProject).map(([id, v]: [string, any]) => `${id}: ${v.tasks.length} tasks / ${v.tasklists.length} lists / ${v.users.length} users`).join('; '));
});
