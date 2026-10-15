import fs from 'fs';
import type { APIResponse, Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { env } from '../../src/env';
import { ProjectPage } from '../../src/pages/ProjectPage';

/**
 * Seed a portal with the source portal's test data, so every portal of a parallel run carries the same cases.
 *
 *   1. capture the source:  ZP_PORTAL=<source> npx playwright test --project=tools tests/tools/portal-probe.spec.ts
 *                           (writes <reports>/inventory.json)
 *   2. seed the target:     npm run seed -- <target>      (scripts/parallel.mjs sets ZP_PORTAL, session and folders)
 *
 * Copied (matched by name, so a re-run only adds what is missing): tags, project groups, projects with their users,
 * the resource, task lists (in order, duplicates included) and tasks (owners and work, dates, status, priority,
 * completion, billing type), then teams with lead, members and projects. Users are matched by email; the source
 * Portal Owner maps to the target Portal Owner. Users themselves are not invited: they must already be in the target.
 * Not copied: custom-field values (none are set in the source), the "Bugs" project and the sample project.
 * Everything created is listed in <reports>/seed-manifest.json.
 */
const SOURCE = process.env.ZP_SEED_SOURCE || 'reports/inventory.json';
const SKIP_PROJECTS = new RegExp(process.env.ZP_SEED_SKIP_PROJECTS || '^(Bugs|Explore Zoho Projects)$');
const MANIFEST = `${env.reportsDir}/seed-manifest.json`;
const RESOURCE_CATEGORY = process.env.ZP_SEED_RESOURCE_CATEGORY || 'UIAutomation_Workload_Category';

test.describe.configure({ timeout: 3 * 3600_000 });

test('seed the portal from the source inventory', async ({ wl }) => {
  test.skip(!fs.existsSync(SOURCE), `no source inventory at ${SOURCE}`);
  const src = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  expect(src.portal, 'source and target differ').not.toBe(env.portal);
  const api = new ZpApi(wl.page, wl.d);
  const manifest: Record<string, unknown[]> = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
  const note = (kind: string, v: unknown) => { (manifest[kind] ??= []).push(v); fs.mkdirSync(env.reportsDir, { recursive: true }); fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2)); };
  const log = (s: string) => { console.log(`[seed ${env.portal}] ${s}`); test.info().annotations.push({ type: 'seed', description: s }); };
  const ok = async (r: APIResponse, what: string) => {
    expect([200, 201, 204], `${what}: ${(await r.text().catch(() => '')).slice(0, 300)}`).toContain(r.status()); return r;
  };

  // ---- users: by email; the source owner becomes the target owner
  const tUsers = await api.users();
  const byEmail = new Map(tUsers.map((u: any) => [String(u.email).toLowerCase(), u]));
  const tOwner = tUsers.find((u: any) => u.profile?.name === 'Portal Owner');
  const sOwner = (src.users as any[]).find(u => u.profile?.name === 'Portal Owner');
  const userFor = (email?: string) => {
    const e = String(email ?? '').toLowerCase();
    if (sOwner && e === String(sOwner.email).toLowerCase()) return tOwner;
    return byEmail.get(e);
  };
  const missing = (src.users as any[]).filter(u => !userFor(u.email)).map(u => u.email);
  expect(missing, 'every source user is in the target portal').toEqual([]);
  const sIdToEmail = new Map<string, string>((src.users as any[]).map(u => [String(u.id), String(u.email)]));

  // ---- tags
  const tTags = (await api.getJson<any>('/tags?page=1&per_page=100')).tags ?? [];
  for (const t of src.tags as any[]) {
    if (tTags.some((x: any) => x.name === t.name)) continue;
    const r = await ok(await api.callForm('POST', '/tags', { tags: JSON.stringify([{ name: t.name, color_class: t.color_hexcode ?? t.color_class ?? '#33c5f2' }]) }), `create tag ${t.name}`);
    note('tags', { name: t.name, response: (await r.text()).slice(0, 200) }); log(`tag ${t.name} created`);
  }

  // ---- project groups
  let tGroups: any[] = (await api.getJson<any>('/project-groups'))['project-groups'] ?? [];
  for (const g of src.projectGroups as any[]) {
    if (tGroups.some(x => x.name === g.name)) continue;
    const r = await ok(await api.call('POST', '/project-groups', { name: g.name, type: g.type === 'private' ? 'private' : 'public' }), `create group ${g.name}`);
    note('projectGroups', { name: g.name, id: (await api.json<any>(r)).id ?? null }); log(`project group ${g.name} created`);
  }
  tGroups = (await api.getJson<any>('/project-groups'))['project-groups'] ?? [];

  // ---- statuses by name
  const tStatuses: any[] = await api.getJson<any[]>('/tasks/statuses');
  const statusId = (name: string) => tStatuses.find(s => s.name === name)?.id;

  // ---- the target's "Unassigned User" (its id differs per portal): read from the report's unassigned row
  const uq = new URLSearchParams({ project_id: '0', from_date: '2026-10-01T00:00:00.000Z', to_date: '2026-10-31T23:59:59.999Z', time_period: 'days', index: '1', range: '10', fetch_unassignee: 'true' });
  const unassignedId: string = String(((await api.getJson<any>(`/reports/workload?${uq}`).catch(() => ({}))).owners ?? [])[0]?.id ?? '');
  log(`Unassigned User id ${unassignedId || 'not found'}`);

  // ---- projects
  let tProjects: any[] = await api.getJson<any[]>('/projects?page=1&per_page=100');
  const projectMap = new Map<string, string>();
  for (const sp of src.projects as any[]) {
    const data = src.perProject[sp.id];
    if (!data || SKIP_PROJECTS.test(sp.name)) continue;
    let tp = tProjects.find(p => p.name === sp.name);
    if (!tp) {
      const group = tGroups.find(g => g.name === sp.project_group?.name && g.name !== 'Ungrouped Projects');
      const r = await ok(await api.call('POST', '/projects', {
        name: sp.name, added_via: 'api', is_public_project: !!sp.is_public_project,
        description: sp.description || `Seeded from ${src.portal} by the workload automation suite`,
        ...(group ? { project_group: { id: String(group.id) } } : {}),
      }), `create project ${sp.name}`);
      tp = await api.json<any>(r); note('projects', { name: sp.name, id: tp.id }); log(`project ${sp.name} created (${tp.id})`);
      tProjects = await api.getJson<any[]>('/projects?page=1&per_page=100');
    }
    projectMap.set(sp.id, String(tp.id));
    const pid = String(tp.id);

    // project users (the owner is already in)
    const have = new Set((await api.projectUsers(pid)).map((u: any) => String(u.email).toLowerCase()));
    const add = (data.users as any[]).map(u => userFor(u.email)).filter((u: any) => u && !have.has(String(u.email).toLowerCase()))
      .map((u: any) => ({ email: u.email, profile_id: String(u.profile.id), role_id: String(u.role.id) }));
    if (add.length) { await api.addProjectUsers(pid, add); note('projectUsers', { project: sp.name, users: add.map(a => a.email) }); log(`${sp.name}: ${add.length} users added`); }

    // resources owning tasks in the source project
    const resources = new Map<string, string>(); // source zpuid -> name
    for (const t of data.tasks as any[]) for (const o of t.owners_and_work?.owners ?? [])
      if (!sIdToEmail.has(String(o.zpuid)) && !/^Unassigned/.test(o.name) && !/@zohotest\.com$/i.test(o.email ?? '')) resources.set(String(o.zpuid), o.name);
    const tResource = new Map<string, string>(); // source zpuid -> target id
    if (resources.size) {
      for (const [sid, name] of resources) {
        const id = await resourceId(api, pid, name);
        if (id) { tResource.set(sid, id); continue; }
        log(`${sp.name}: resource ${name} is not in the project — adding it in the UI`);
        const made = await addPortalResource(wl.page, name, pid, sp.name, RESOURCE_CATEGORY);
        if (made) note('resources', { name, category: RESOURCE_CATEGORY, createdIn: sp.name });
        else { const pp = new ProjectPage(wl.page); await pp.open(sp.name); await pp.addResource(name); }
        await wl.goto();
        const id2 = await resourceId(api, pid, name);
        expect(id2, `resource ${name} in ${sp.name}`).toBeTruthy();
        tResource.set(sid, id2!); note('projectResources', { project: sp.name, name, id: id2 });
      }
    }

    // task lists: in source order; duplicates kept; reuse same-named lists already there (by occurrence)
    const tLists: any[] = (await api.getJson<any>(`/projects/${pid}/tasklists?page=1&per_page=200`)).tasklists ?? [];
    const listMap = new Map<string, string>();
    const used = new Set<string>();
    const sLists = [...(data.tasklists as any[])].sort((a, b) => (a.sequence?.project_sequence ?? 0) - (b.sequence?.project_sequence ?? 0));
    for (const l of sLists) {
      let t = tLists.find(x => x.name === l.name && !used.has(String(x.id)));
      if (!t) {
        const r = await ok(await api.call('POST', `/projects/${pid}/tasklists`, { name: l.name }), `create task list ${l.name}`);
        t = await api.json<any>(r); note('tasklists', { project: sp.name, name: l.name, id: t.id }); tLists.push(t);
      }
      used.add(String(t.id)); listMap.set(String(l.id), String(t.id));
    }
    log(`${sp.name}: ${listMap.size} task lists mapped`);

    // tasks: matched by name; parents before subtasks
    const tTasks = new Map((await api.tasks(pid)).map((t: any) => [t.name, String(t.id)]));
    const sTasks = [...(data.tasks as any[])].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
    const taskMap = new Map<string, string>();
    let created = 0;
    const ownersFor = (ow: any) => (ow.owners ?? []).map((o: any) => {
      // work booked on "Unassigned User" is kept: it is the target portal's own unassigned owner
      if (/^Unassigned/.test(o.name)) return unassignedId ? { zpuid: unassignedId, work_values: o.work_values } : null;
      const r = tResource.get(String(o.zpuid));
      if (r) return { zpuid: r, work_values: o.work_values };
      const u = userFor(o.email); return u ? { zpuid: String(u.id), work_values: o.work_values } : null;
    }).filter(Boolean) as { zpuid: string; work_values: string }[];
    const workKey = (ow: any, owners: { zpuid: string; work_values: string }[]) =>
      `${ow.work_type}|${ow.unit}|${!!ow.copy_task_duration}|${owners.map(o => `${o.zpuid}=${o.work_values}`).sort().join(',')}`;
    const existing = new Map((await api.tasks(pid)).map((t: any) => [t.name, t]));
    let repaired = 0;
    for (const st of sTasks) {
      const ow = st.owners_and_work ?? {};
      const owners = ownersFor(ow);
      if (tTasks.has(st.name)) {
        taskMap.set(String(st.id), tTasks.get(st.name)!);
        // repair: an earlier seed may have created the task with a full business day per owner
        const tt: any = existing.get(st.name);
        const have = (tt?.owners_and_work?.owners ?? []).map((o: any) => ({ zpuid: String(o.zpuid), work_values: o.work_values }));
        if (owners.length && workKey(ow, owners) !== workKey(tt?.owners_and_work ?? {}, have)) {
          const r = await api.call('PATCH', `/projects/${pid}/tasks/${tt.id}`, { owners_and_work: { work_type: ow.work_type ?? 'standard', unit: ow.unit ?? 'hours_per_day', copy_task_duration: !!ow.copy_task_duration, owners } });
          if (r.status() === 200) repaired++; else log(`task "${st.name}" work not repaired: ${r.status()} ${(await r.text()).slice(0, 160)}`);
        }
        continue;
      }
      const body: Record<string, unknown> = {
        name: st.name, priority: st.priority ?? 'none', billing_type: st.billing_type ?? 'none',
        ...(st.start_date ? { start_date: st.start_date.replace(/\.\d{3}Z$/, 'Z') } : {}),
        ...(st.end_date ? { end_date: st.end_date.replace(/\.\d{3}Z$/, 'Z') } : {}),
        ...(st.tasklist?.id && listMap.get(String(st.tasklist.id)) ? { tasklist: { id: listMap.get(String(st.tasklist.id)) } } : {}),
        ...(st.status?.name && statusId(st.status.name) ? { status: { id: statusId(st.status.name) } } : {}),
        ...(typeof st.completion_percentage === 'number' ? { completion_percentage: st.completion_percentage } : {}),
        ...(st.parental_info?.parent_task_id && taskMap.get(String(st.parental_info.parent_task_id)) ? { parental_info: { parent_task_id: taskMap.get(String(st.parental_info.parent_task_id)) } } : {}),
        // copy_task_duration defaults to true on create, which gives every owner a full business day instead of work_values
        ...(owners.length ? { owners_and_work: { work_type: ow.work_type ?? 'standard', unit: ow.unit ?? 'hours_per_day', copy_task_duration: !!ow.copy_task_duration, owners } } : {}),
      };
      const r = await api.call('POST', `/projects/${pid}/tasks`, body);
      if (r.status() !== 201) { log(`task "${st.name}" not created: ${r.status()} ${(await r.text()).slice(0, 200)}`); expect.soft(r.status(), `create task ${st.name}`).toBe(201); continue; }
      const id = String((await api.json<any>(r)).id ?? ''); taskMap.set(String(st.id), id); created++;
      note('tasks', { project: sp.name, name: st.name, id });
    }
    log(`${sp.name}: ${created} tasks created, ${repaired} repaired, ${sTasks.length - created} already there or failed`);
  }

  // ---- teams: lead, members (from the users' memberships), projects (none in the source)
  const tTeams: any[] = (await api.getJson<any>('/teams?page=1&per_page=200')).teams ?? [];
  for (const team of src.teams as any[]) {
    const members = Object.entries(src.memberships as Record<string, { name: string }[]>)
      .filter(([, ts]) => ts.some(t => t.name === team.name)).map(([uid]) => userFor(sIdToEmail.get(uid))).filter(Boolean).map((u: any) => String(u.id));
    const leadSrc = (src.users as any[]).find(u => String(u.id) === String(team.lead?.id ?? team.lead));
    const lead = userFor(leadSrc?.email);
    const existing = tTeams.find(t => t.name === team.name);
    if (existing) {
      const have = new Set((await Promise.all(members.map(async m => ((await api.userTeams(m)).some(t => t.name === team.name) ? m : null)))).filter(Boolean));
      const add = members.filter(m => !have.has(m));
      if (add.length) await ok(await api.call('PATCH', `/teams/${existing.id}`, { user_ids: { add } }), `team ${team.name} members`);
      continue;
    }
    const r = await ok(await api.call('POST', '/teams', { name: team.name, lead: String(lead?.id ?? tOwner.id), user_ids: { add: members }, project_ids: { add: [] }, notify: false }), `create team ${team.name}`);
    note('teams', { name: team.name, id: (await api.json<any>(r)).id ?? null, members: members.length }); log(`team ${team.name} created (lead ${lead?.full_name ?? 'owner'}, ${members.length} members)`);
  }

  // ---- reporting hierarchy: switch it on when the source has it on (the users list then carries reporting_to)
  if (src.hierarchyEnabled) {
    const tree = await api.getJson<unknown[]>('/user/hierarchy').catch(() => []);
    if (!Array.isArray(tree) || !tree.length) {
      await ok(await api.call('POST', '/hierarchy/settings?is_hierarchy_enable=true'), 'enable reporting hierarchy');
      note('settings', { reportingHierarchy: 'enabled (was off)' }); log('reporting hierarchy enabled');
    }
  }
  const tUsers2 = await api.users(); for (const u of tUsers2) byEmail.set(String(u.email).toLowerCase(), u);

  // ---- reporting lines (users list: reporting_to.zpuid)
  const rt = (u: any) => String(u?.reporting_to?.zpuid ?? u?.reporting_to?.id ?? '');
  for (const su of src.users as any[]) {
    if (!rt(su)) continue;
    const u = userFor(su.email), m = userFor(sIdToEmail.get(rt(su)));
    if (u && m && rt(u) !== String(m.id)) { await api.setReportingTo(String(u.id), String(m.id)); note('reporting', { user: u.email, to: m.email, before: rt(u) }); log(`${u.full_name} reports to ${m.full_name}`); }
  }
  // ---- settings the specs need for this portal (scripts/parallel.mjs merges them into the portal's environment)
  const srcProject = process.env.ZP_SEED_SOURCE_PROJECT_ID || '';
  if (srcProject && projectMap.get(srcProject)) {
    fs.writeFileSync(`${env.reportsDir}/portal-settings.json`, JSON.stringify({ ZP_PERM_PROJECT_ID: projectMap.get(srcProject) }, null, 2));
    log(`ZP_PERM_PROJECT_ID for ${env.portal} = ${projectMap.get(srcProject)}`);
  }
  log(`done; manifest ${MANIFEST}`);
});

/** Target id of a resource in a project, read from the workload report owners (resources are not portal users). */
async function resourceId(api: ZpApi, projectId: string, name: string): Promise<string | undefined> {
  const now = new Date(), y = now.getUTCFullYear(), m = now.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const q = new URLSearchParams({ project_id: projectId, from_date: `${iso(new Date(Date.UTC(y, m, 1)))}T00:00:00.000Z`,
    to_date: `${iso(new Date(Date.UTC(y, m + 1, 0)))}T23:59:59.999Z`, time_period: 'days', index: '1', range: '100' });
  const j = await api.getJson<any>(`/reports/workload?${q}`).catch(() => ({}));
  return (j.owners ?? []).find((o: any) => o.is_resource && o.name === name)?.id;
}

/**
 * Users › Resources › Add Resource (portal level) with the project ticked, so one save creates the resource and adds it
 * to the project. The category is created with Add New Category when the portal has none of that name. Keys seen live
 * on 13-10-2026: userheader_rightbutton_addresource, addResource_displayName, addResource_addCategory,
 * resources-option_<projectId>, add_resource_submit; the category popover has no keys (text locators).
 */
async function addPortalResource(page: Page, name: string, projectId: string, projectName: string, category: string) {
  const q = (k: string) => page.locator(`[data-zpqa="${k}"]`).filter({ visible: true }).first();
  // the toolbar button, or the empty-state button when the portal has no resource yet; one reload if the list stalls
  const addBtn = q('userheader_rightbutton_addresource').or(page.getByText('Add Resource', { exact: true }).filter({ visible: true })).first();
  let ready = false;
  for (let i = 0; i < 2 && !ready; i++) {
    await page.goto(`${env.baseUrl}/portal/${env.portal}#zp/resources/custom-view/1`);
    if (i) await page.reload();
    ready = await addBtn.waitFor({ timeout: 90_000 }).then(() => true, () => false);
  }
  if (!ready) await page.screenshot({ path: `${env.reportsDir}/seed-resources-page.png` });
  expect(ready, `Users › Resources › Add Resource (see ${env.reportsDir}/seed-resources-page.png)`).toBe(true);
  await page.waitForTimeout(2000);
  if (await page.getByText(name, { exact: true }).filter({ visible: true }).count()) return false;
  await addBtn.click();
  await expect(q('addResource_displayName'), 'Add Resource form').toBeVisible({ timeout: 30_000 });
  await q('addResource_displayName').click(); await q('addResource_displayName').pressSequentially(name);
  // the drawer: the smallest block holding both the name field and the Add button
  const form = page.locator('div').filter({ has: q('addResource_displayName') }).filter({ has: q('add_resource_submit') }).last();
  const shows = async () => (await form.innerText()).includes(category);
  await page.waitForTimeout(1500);
  if (!(await shows())) {
    await q('addResource_addCategory').click();
    const box = page.getByText('Category Name', { exact: true }).filter({ visible: true }).first().locator('xpath=following::input[1]');
    await box.click(); await box.pressSequentially(category);
    await page.getByRole('button', { name: 'Add', exact: true }).filter({ visible: true }).first().click();
    await expect.poll(shows, { message: 'new category selected', timeout: 30_000 }).toBe(true);
  }
  // each project row is a checkbox named "<key> <project name>" (its input resources-option_<id> is hidden)
  // the checkbox input is hidden: click the project's name in its row
  const label = form.getByText(projectName).filter({ visible: true }).last();
  await label.scrollIntoViewIfNeeded(); await label.click();
  await expect(page.locator(`[data-zpqa="resources-option_${projectId}"]`), 'project ticked').toBeChecked();
  await q('add_resource_submit').click();
  const listed = await page.getByText(name, { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 60_000 }).then(() => true, () => false);
  await page.screenshot({ path: `${env.reportsDir}/seed-resource-after-add.png` });
  expect(listed, 'resource listed after Add').toBe(true);
  await page.screenshot({ path: `${env.reportsDir}/seed-resource-${name.replace(/\W+/g, '_')}.png` });
  return true;
}
