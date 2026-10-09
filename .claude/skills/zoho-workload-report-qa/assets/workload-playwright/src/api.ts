import { expect, type APIResponse, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { Discovery, type UserView } from './discover';
import { K, qa } from './locators';
import { reportsUrl } from './env';

/**
 * API client that acts as the user of a browser context.
 * It replays the headers of the app's own last request (incl. the CSRF header), so every call is made with
 * exactly the rights of the signed-in user — never with a separate token. Endpoints marked "internal" are the
 * ones the web app itself calls; they are not in the public API docs (confirmed live on 08-10-2026).
 */
export type Scope = 'global' | 'project';
export type WlAction = 'view' | 'manage' | 'delete';
export const PERM_MODULE: Record<Scope, { path: string; module: string }> = {
  global: { path: 'globalreport', module: 'workloadreport' },          // internal
  project: { path: 'projectreport', module: 'projectworkloadreport' },  // internal
};
const ALL: WlAction[] = ['view', 'manage', 'delete'];
const VIEW_TYPES = ['predefined_views', 'created_views', 'shared_views', 'favourite_views'] as const;

export interface DayWork { date: string; allocation: 'over' | 'optimal' | 'under' | string; work: number }
export interface Owner { id: string; name: string; is_resource?: boolean; work: { total_work: number; total_availability?: number; overall_allocation?: string; total_date_work: DayWork[] } }

/** The id DELETE /views/{id} expects: custom_view_id when the listing has one (as the Java suite deletes). */
export const viewId = (v: UserView) => v.custom_view_id || v.id;

/**
 * The portal allows ~100 calls per API (method + path shape) per 2 minutes, then blocks that API for about half an
 * hour (Java suite, Api.pace). Calls are paced to RATE_LIMIT per window per API; override with ZP_API_RATE_LIMIT.
 */
const RATE_LIMIT = Number(process.env.ZP_API_RATE_LIMIT ?? 80);
const RATE_WINDOW_MS = 120_000;
const callTimes = new Map<string, number[]>();
export async function pace(method: string, path: string) {
  const key = `${method} ${path.replace(/\?.*$/, '').replace(/\/\d{6,}/g, '/{id}')}`;
  for (;;) {
    const now = Date.now();
    const times = (callTimes.get(key) ?? []).filter(t => now - t < RATE_WINDOW_MS);
    if (times.length < RATE_LIMIT) { times.push(now); callTimes.set(key, times); return; }
    callTimes.set(key, times);
    await new Promise(r => setTimeout(r, RATE_WINDOW_MS - (now - times[0]!) + 100));
  }
}
export const isThrottled = async (r: APIResponse) => r.status() >= 400 && /THROTTLES_LIMIT_EXCEEDED/.test(await r.text().catch(() => ''));

/** Deletes are permanent: refuse a prefix that is too short or would also match the shared seed views (e.g. RUN_ID=QA-WL). */
export function assertSafePrefix(prefix: string) {
  const seed = process.env.ZP_SEED_VIEW_PREFIX || 'QA-WL-SEED';
  if (prefix.length < 8 || seed.startsWith(prefix)) throw new Error(`Refusing to delete views by prefix "${prefix}": too broad (would match "${seed}*")`);
}

export class ZpApi {
  constructor(readonly page: Page, readonly d: Discovery) {}

  /** New context for a saved login, opened on the Workload Report so the app has made authenticated calls. */
  static async open(browser: Browser, storageState: string): Promise<{ api: ZpApi; ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({ storageState });
    const page = await ctx.newPage();
    const d = new Discovery(page);
    // Only the portal ID and an app request are needed, so no waiting for Reports: a profile without report rights
    // has no Reports menu at all (seen 09-10-2026), and openReports() would spend ~85 s finding that out.
    await page.goto(reportsUrl());
    await qa(page, K.workloadTab).click({ timeout: 8_000 }).catch(() => { /* user may not have the report: API still works */ });
    await expect.poll(() => d.portalId, { message: 'portal ID from app requests' }).not.toBe('');
    return { api: new ZpApi(page, d), ctx, page };
  }

  private async headers(): Promise<Record<string, string>> {
    const src = this.d.lastAppRequest ? await this.d.lastAppRequest.allHeaders() : {};
    const h: Record<string, string> = {};
    for (const [k, v] of Object.entries(src)) if (!/^(cookie|content-length|content-type|host|:)/i.test(k)) h[k] = v;
    return h;
  }
  private url(path: string) { return `${new URL(this.page.url()).origin}/api/v3/portal/${this.d.portalId}${path}`; }

  /** Paced per API; a THROTTLES_LIMIT_EXCEEDED answer is retried after 30 s, up to 3 times (Java suite's withThrottleRetry). */
  async call(method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown): Promise<APIResponse> {
    const headers = await this.headers();
    if (data !== undefined) headers['content-type'] = 'application/json';
    for (let attempt = 0; ; attempt++) {
      await pace(method, path);
      const r = await this.page.request.fetch(this.url(path), { method, headers, data: data === undefined ? undefined : JSON.stringify(data) });
      if (attempt >= 3 || !(await isThrottled(r))) return r;
      await new Promise(res => setTimeout(res, 30_000));
    }
  }
  /** Form-encoded body (e.g. /projectusers rejects JSON). */
  async callForm(method: 'POST' | 'PUT' | 'PATCH', path: string, form: Record<string, string>): Promise<APIResponse> {
    return this.page.request.fetch(this.url(path), { method, headers: await this.headers(), form });
  }
  async json<T = any>(r: APIResponse): Promise<T> { try { return await r.json(); } catch { return {} as T; } }
  async getJson<T = any>(path: string): Promise<T> {
    const r = await this.call('GET', path);
    expect(r.status(), `GET ${path.split('?')[0]}`).toBe(200);
    return this.json<T>(r);
  }

  // ---------- users / profiles ----------
  me() { return this.getJson<{ id: string; full_name: string; email: string; profile: { id: string; name: string } }>('/users/me'); }
  async users() { return (await this.getJson<{ users: any[] }>('/users?page=1&per_page=200')).users ?? []; }
  async profileId(name: string): Promise<string> {
    const j = await this.getJson<{ profiles?: { id: string; name: string }[]; portal_profiles?: { id: string; name: string }[] }>('/profiles');
    const list = j.profiles ?? j.portal_profiles ?? [];
    const p = list.find(x => x.name === name);
    if (!p) throw new Error(`Profile "${name}" not found. Known: ${list.map(x => x.name).join(', ')}`);
    return p.id;
  }
  /** Current Workload actions of a profile at one scope. Internal endpoint. */
  async perms(profileId: string, scope: Scope): Promise<WlAction[]> {
    const { path, module } = PERM_MODULE[scope];
    const j = await this.getJson<Record<string, { module: string; actions: WlAction[] }[]>>(`/profiles/${path}/permissions?profile_ids=${profileId}`);
    return ((j[profileId] ?? []).find(x => x.module === module)?.actions ?? []).slice().sort();
  }
  /**
   * Set exactly `actions`: grant only the missing ones, then revoke only the extra ones (as the Java suite's
   * ProfilePermissionsApi.set does), so the profile is never left with no rights in between.
   * Body must be a JSON ARRAY — other shapes return 400 JSON_PARSE_ERROR.
   * Guarded: profile changes affect real users, so they need ZP_ALLOW_PROFILE_CHANGES=1.
   */
  async setPerms(profileId: string, scope: Scope, actions: WlAction[]): Promise<WlAction[]> {
    if (process.env.ZP_ALLOW_PROFILE_CHANGES !== '1') throw new Error('Profile changes need ZP_ALLOW_PROFILE_CHANGES=1 (explicit approval)');
    const { path, module } = PERM_MODULE[scope];
    const current = await this.perms(profileId, scope);
    const toGrant = ALL.filter(a => actions.includes(a) && !current.includes(a));
    const toRevoke = ALL.filter(a => !actions.includes(a) && current.includes(a));
    if (toGrant.length) {
      const gr = await this.call('PATCH', `/profiles/${profileId}/${path}/permissions/grant`, [{ module, actions: toGrant }]);
      expect([200, 204], `grant ${scope} ${toGrant}`).toContain(gr.status()); // 204 or 200 (seen live 09-10-2026)
    }
    if (toRevoke.length) {
      const rv = await this.call('PATCH', `/profiles/${profileId}/${path}/permissions/revoke`, [{ module, actions: toRevoke }]);
      expect([200, 204], `revoke ${scope} ${toRevoke}`).toContain(rv.status());
    }
    const now = await this.perms(profileId, scope);
    expect(now, `${scope} readback`).toEqual(actions.slice().sort());
    return now;
  }

  // ---------- workload views ----------
  async views(type: typeof VIEW_TYPES[number]): Promise<UserView[]> {
    const f = encodeURIComponent(JSON.stringify({ view_type: type }));
    return (await this.getJson<{ user_views?: UserView[] }>(`/user-views?module=workload&page=1&per_page=200&filter=${f}`)).user_views ?? [];
  }
  async allViews(): Promise<Map<string, UserView & { group: string }>> {
    const m = new Map<string, UserView & { group: string }>();
    for (const t of VIEW_TYPES) for (const v of await this.views(t)) if (!m.has(v.name)) m.set(v.name, { ...v, group: t });
    return m;
  }
  /** PUT /reports/custom-workload — create when no id, update with id. 201 create, 200 update, 403 when not allowed. */
  saveView(body: Record<string, unknown>) { return this.call('PUT', '/reports/custom-workload', { module: 'workload', ...body }); }
  /** Delete a custom workload view (pass viewId(v)). Internal endpoint: DELETE /views/{id}?module=workload → 204; 401 when not allowed. */
  deleteView(id: string) { return this.call('DELETE', `/views/${id}?module=workload`); }
  /**
   * Remove every view this user can see whose name starts with prefix (cleanup). Deletes are permanent, so a
   * prefix that is too short or would also match the shared seed views (e.g. RUN_ID=QA-WL) is refused.
   */
  async deleteViewsByPrefix(prefix: string) {
    assertSafePrefix(prefix);
    const out: string[] = [];
    for (const [name, v] of await this.allViews()) if (name.startsWith(prefix)) out.push(`${name}: ${(await this.deleteView(viewId(v))).status()}`);
    return out;
  }

  // ---------- workload data ----------
  /** All owners for a range (pages of 15), plus the Unassigned row when unassigned=true. Dates: ISO day strings. */
  async workload(o: { projectId?: string; from: string; to: string; timePeriod?: 'days' | 'weeks' | 'months'; viewId?: string; unassigned?: boolean }): Promise<Owner[]> {
    const owners: Owner[] = [];
    for (let index = 1, more = true; more; index += 15) {
      const q = new URLSearchParams({
        project_id: o.projectId ?? '0', from_date: `${o.from}T00:00:00.000Z`, to_date: `${o.to}T23:59:59.999Z`,
        time_period: o.timePeriod ?? 'days', report_based_on: 'users', index: String(index), range: '15',
        ...(o.viewId ? { view_id: o.viewId } : {}), ...(o.unassigned ? { fetch_unassignee: 'true' } : {}),
      });
      const j = await this.getJson<{ owners?: Owner[]; page_info?: { has_next?: boolean } }>(`/reports/workload?${q}`);
      owners.push(...(j.owners ?? []));
      more = !o.unassigned && !!j.page_info?.has_next;
    }
    return owners;
  }

  // ---------- projects / tasks ----------
  async createProject(name: string, start: string, end: string) {
    const r = await this.call('POST', '/projects', { name, added_via: 'api', start_date: start, end_date: end, is_public_project: false,
      description: 'Created by the workload automation suite; trashed at the end of the run.' });
    expect(r.status(), 'POST /projects').toBe(201);
    return this.json<{ id: string; key: string; name: string }>(r);
  }
  /** POST /projects/{id}/projectusers — form-encoded; a JSON body is rejected. */
  async addProjectUsers(projectId: string, users: { email: string; profile_id: string; role_id: string }[]) {
    const r = await this.callForm('POST', `/projects/${projectId}/projectusers`, {
      userdetails: JSON.stringify(users.map(u => ({ email_id: u.email, profile_id: u.profile_id, role_id: u.role_id }))), notify: 'false',
    });
    expect(r.status(), 'POST /projectusers').toBe(201);
    return r;
  }
  async projectUsers(projectId: string) { return (await this.getJson<{ users?: any[] }>(`/projects/${projectId}/users`)).users ?? []; }
  async tasks(projectId: string): Promise<any[]> {
    let all: any[] = [];
    for (let p = 1; p < 50; p++) {
      const j = await this.getJson<{ tasks?: any[]; page_info?: { has_next_page?: boolean } }>(`/projects/${projectId}/tasks?page=${p}&per_page=100`);
      all = all.concat(j.tasks ?? []);
      if (!j.page_info?.has_next_page) break;
    }
    return all;
  }
  /** Reversible removal: POST /projects/{id}/trash (204); GET then returns 410 RESOURCE_TRASHED. Never permanent DELETE. */
  async trashProject(projectId: string) {
    const r = await this.call('POST', `/projects/${projectId}/trash`);
    expect(r.status(), 'POST /projects/{id}/trash').toBe(204);
    expect((await this.call('GET', `/projects/${projectId}`)).status(), 'project is trashed').toBe(410);
  }
}
