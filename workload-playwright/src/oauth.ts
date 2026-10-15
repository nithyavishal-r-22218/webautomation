import fs from 'fs';
import { expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';
import { env } from './env';
import { account } from './accountDb';
import { pace, isThrottled, assertSafePrefix, viewId } from './api';
import { noteApiCall, waitForApiBudget } from './rate';
import { viewLabel, type UserView } from './discover';

/**
 * Portal API with an OAuth token — the TypeScript twin of the Java suite's ApiTokenGenerator + Api
 * (~/UIautomation core/ApiTokenGenerator, api/Api, api/WorkloadReportApi). Used for test setup and cleanup that must
 * not depend on a browser session: create a view by API → edit it in the UI → delete it by API.
 *
 * The client id/secret and refresh token come from the credentials DB row (src/accountDb.ts). The access token is
 * cached in auth/oauth.<target>.json (git-ignored, mode 600) until it expires, because Zoho limits how many access
 * tokens a refresh token may mint in a short time. Nothing here logs a secret or a token.
 *
 * Permission checks still use ZpApi (src/api.ts), which acts with the signed-in user's own session.
 */
interface CachedToken { token: string; portalId: string; expires: number }

const tokenFile = (target: string) => `${env.authDir}/oauth.${target}.json`;

async function accessToken(ctx: APIRequestContext, target: string, force = false): Promise<CachedToken> {
  if (!force) {
    try {
      const c = JSON.parse(fs.readFileSync(tokenFile(target), 'utf8')) as CachedToken;
      if (c.token && c.portalId && c.expires > Date.now() + 60_000) return process.env.ZP_PORTAL_ID ? { ...c, portalId: process.env.ZP_PORTAL_ID } : c;
    } catch { /* no usable cache */ }
  }
  const acc = await account(target);
  if (!acc.clientId || !acc.clientSecret || !acc.refreshToken) throw new Error(`DB row for "${target}" (role ${acc.role}) has no OAuth client/refresh token`);
  const accounts = env.baseUrl.replace('://projects.', '://accounts.');
  // Credentials go in the POST body, never the query string, so they stay out of proxy and access logs.
  const r = await ctx.post(`${accounts}/oauth/v2/token`, {
    form: { refresh_token: acc.refreshToken, client_id: acc.clientId, client_secret: acc.clientSecret, grant_type: 'refresh_token' },
  });
  const j = await r.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
  if (!r.ok() || !j.access_token) throw new Error(`OAuth token refresh failed for "${target}": HTTP ${r.status()} ${j.error ?? ''}`.trim());
  // ZP_PORTAL_ID overrides the DB row's portalID (a row copied from another portal carries the wrong id; seen for auto2 on 14-10-2026)
  const c: CachedToken = { token: j.access_token, portalId: process.env.ZP_PORTAL_ID || acc.portalId, expires: Date.now() + (j.expires_in ?? 3600) * 1000 };
  fs.mkdirSync(env.authDir, { recursive: true });
  fs.writeFileSync(tokenFile(target), JSON.stringify(c), { mode: 0o600 });
  return c;
}

export interface CreateViewOptions {
  description?: string;
  /** public to every user and project (true) or only to the creator (false, default) */
  shared?: boolean;
  viewType?: 'bar' | 'heatmap' | 'timeline';
  timePeriod?: 'days' | 'weeks' | 'months';
  relative?: string; // relative_time_period, e.g. current_month
  determiner?: { pattern: string; criteria: { field_name: string; condition: string; value: string[] }[] };
}

export class OAuthApi {
  private constructor(private ctx: APIRequestContext, readonly target: string, private tok: CachedToken) {}

  /** Client for a DB account ("admin" by default; other targets map to roles like npm run auth:db). */
  static async create(target = 'admin'): Promise<OAuthApi> {
    const ctx = await request.newContext({ ignoreHTTPSErrors: true });
    return new OAuthApi(ctx, target, await accessToken(ctx, target));
  }
  get portalId() { return this.tok.portalId; }
  async dispose() { await this.ctx.dispose(); }

  private url(path: string) { return `${env.baseUrl}/api/v3/portal/${this.tok.portalId}${path}`; }

  /** Paced per API; a rejected token is refreshed once; THROTTLES_LIMIT_EXCEEDED is retried after 30 s, up to 3 times. */
  async call(method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown): Promise<APIResponse> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      await pace(method, path); await waitForApiBudget(); noteApiCall();
      const headers: Record<string, string> = { Authorization: `Bearer ${this.tok.token}` };
      if (data !== undefined) headers['content-type'] = 'application/json';
      const r = await this.ctx.fetch(this.url(path), { method, headers, data: data === undefined ? undefined : JSON.stringify(data) });
      if (r.status() === 401 && !refreshed) { this.tok = await accessToken(this.ctx, this.target, true); refreshed = true; continue; }
      if (attempt >= 3 || !(await isThrottled(r))) return r;
      await new Promise(res => setTimeout(res, 30_000));
    }
  }
  async getJson<T = any>(path: string): Promise<T> {
    const r = await this.call('GET', path);
    expect(r.status(), `GET ${path.split('?')[0]} (OAuth)`).toBe(200);
    return r.json() as Promise<T>;
  }

  // ---------- workload views ----------
  async views(type: 'predefined_views' | 'created_views' | 'shared_views' | 'favourite_views'): Promise<UserView[]> {
    const f = encodeURIComponent(JSON.stringify({ view_type: type }));
    return (await this.getJson<{ user_views?: UserView[] }>(`/user-views?module=workload&page=1&per_page=200&filter=${f}`)).user_views ?? [];
  }
  /** Saved definition of a view: description, view_period, report_preference, determiner, group_by. */
  view(id: string) { return this.getJson<Record<string, any>>(`/views/${id}?module=workload`); }

  /**
   * Create a custom Workload view (body as the Java suite's WorkloadReportApi.createView, confirmed live there).
   * Returns the new view's id. Pair every create with deleteView in afterAll.
   */
  async createView(name: string, o: CreateViewOptions = {}): Promise<string> {
    const body = {
      name, description: o.description ?? '',
      view_access_type: o.shared ? 'public' : 'only_to_me', shared_users: [],
      project_access_type: o.shared ? 'all_projects' : 'specific_project', shared_projects: [],
      report_preference: { report_based_on: 'users', bar_type: 'gantt', legend: 'nolegend', view_type: o.viewType ?? 'heatmap' },
      view_period: { time_period: o.timePeriod ?? 'days', time_period_type: 'relative', relative_time_period: o.relative ?? 'current_month' },
      ...(o.determiner ? { determiner: o.determiner } : {}),
      module: 'workload', is_globally_accessible: true,
      group_by: [{ field_name: 'users', sort_by: 'asc', module: 'workload' }],
    };
    const r = await this.call('PUT', '/reports/custom-workload', body);
    expect(r.status(), `create view "${name}" (OAuth): ${(await r.text()).slice(0, 200)}`).toBe(201);
    return String((await r.json()).id);
  }
  /** DELETE /views/{id}?module=workload → 204. */
  async deleteView(id: string): Promise<number> { return (await this.call('DELETE', `/views/${id}?module=workload`)).status(); }
  /** Delete every created or shared view whose name starts with prefix (cleanup); refuses too-broad prefixes. */
  async deleteViewsByPrefix(prefix: string): Promise<string[]> {
    assertSafePrefix(prefix);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of ['created_views', 'shared_views'] as const)
      for (const v of await this.views(t))
        if (v.name.startsWith(prefix) && !seen.has(viewId(v))) { seen.add(viewId(v)); out.push(`${viewLabel(v.name)}: ${await this.deleteView(viewId(v))}`); }
    return out;
  }
}
