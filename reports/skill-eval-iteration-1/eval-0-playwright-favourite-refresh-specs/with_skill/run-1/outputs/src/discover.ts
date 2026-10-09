import { expect, type Page, type Request, type Response } from '@playwright/test';

export interface UserView {
  id: string; name: string;
  is_favorite: boolean; is_anchored: boolean; is_default_view: boolean;
  is_editable: boolean; is_deletable: boolean;
}
export interface WorkloadMeta {
  custom_view_id: string; project_id: string; user_range: number;
  [k: string]: unknown;
}
export interface Owner { id: string; name?: string; [k: string]: unknown }

/** The four lists the app asks for when the dropdown/refresh loads views. */
export const VIEW_LISTS = ['predefined_views', 'created_views', 'shared_views', 'favourite_views'] as const;
export type ViewList = typeof VIEW_LISTS[number];

// ---------- URL classifiers (parse params; never rely on param order) ----------
const params = (r: Request | Response) => new URL(r.url()).searchParams;
export const isUserViews = (r: Request | Response) => /\/user-views(\?|$)/.test(r.url()) && params(r).get('module') === 'workload';
export const isMeta = (r: Request | Response) => /\/reports\/workload\/meta(\?|$)/.test(r.url());
export const isDataPage = (r: Request | Response) =>
  /\/reports\/workload(\?|$)/.test(r.url()) && params(r).get('fetch_unassignee') !== 'true';
export const isFirstDataPage = (r: Request | Response) => isDataPage(r) && params(r).get('index') === '1';
export const isUnassigned = (r: Request | Response) =>
  /\/reports\/workload(\?|$)/.test(r.url()) && params(r).get('fetch_unassignee') === 'true';

/** Which of the four view lists a user-views call asked for (filter={"view_type":"…"}). */
export function viewListOf(r: Request | Response): string {
  try { return JSON.parse(params(r).get('filter') ?? '{}').view_type ?? ''; } catch { return ''; }
}

/** Query params of a workload data request: the API layer of every check. Only parsed values, never the URL. */
export function dataRequestParams(r: Request | Response) {
  const p = params(r);
  return {
    from: p.get('from_date') ?? '', to: p.get('to_date') ?? '', timePeriod: p.get('time_period') ?? '',
    viewId: p.get('view_id') ?? '', projectId: p.get('project_id') ?? '', basedOn: p.get('report_based_on') ?? '',
  };
}

/**
 * Reads what the app itself fetched. Discovery never builds its own URLs or tokens: the app's normal
 * requests already carry the right session, headers and numeric portal ID for whichever portal we are on.
 */
export class Discovery {
  portalId = '';
  views = new Map<string, UserView>();        // by name
  viewsById = new Map<string, UserView>();
  meta?: WorkloadMeta;
  /** Owners of the most recent first data page (index=1), in order. */
  firstPageOwners: Owner[] = [];
  lastFirstPage?: ReturnType<typeof dataRequestParams>;
  lastAppRequest?: Request;
  private owners = new Set<string>();
  private unassigned = 0;
  private lastPageSeen = false;

  constructor(private page: Page) {
    page.on('request', r => {
      const m = r.url().match(/\/api\/v3\/portal\/(\d+)\//);
      if (m) { this.portalId ||= m[1]; this.lastAppRequest = r; }
    });
    page.on('response', r => this.onResponse(r).catch(() => { /* body already consumed / navigated away */ }));
  }

  private async onResponse(r: Response) {
    if (!r.ok()) return;
    if (isUserViews(r)) {
      for (const v of ((await r.json()).user_views ?? []) as UserView[]) this.remember(v);
    } else if (isMeta(r)) {
      this.meta = await r.json();
    } else if (isUnassigned(r)) {
      this.unassigned = (await r.json()).owners?.length ? 1 : 0;
    } else if (isDataPage(r)) {
      const j = await r.json();
      const owners = (j.owners ?? []) as Owner[];
      if (isFirstDataPage(r)) { this.firstPageOwners = owners; this.lastFirstPage = dataRequestParams(r); }
      owners.forEach(o => this.owners.add(String(o.id)));
      if (j.page_info?.has_next === false) this.lastPageSeen = true;
    }
  }

  private remember(v: UserView) {
    const id = String(v.id);
    const merged = { ...this.viewsById.get(id), ...v, id };
    this.views.set(v.name, merged); this.viewsById.set(id, merged);
  }

  reset() { this.views.clear(); this.viewsById.clear(); this.meta = undefined; this.lastFirstPage = undefined; this.resetOwners(); }
  resetOwners() { this.owners.clear(); this.unassigned = 0; this.lastPageSeen = false; this.firstPageOwners = []; }
  expectedRows() { return this.owners.size + this.unassigned; }
  allPagesLoaded() { return this.lastPageSeen; }

  view(name: string): UserView {
    const v = this.views.get(name);
    if (!v) throw new Error(`View "${name}" is not in this portal's user-views. Known: ${[...this.views.keys()].join(', ') || '(none)'}`
      + ' — set ZP_ALL_USERS_VIEW if the portal labels it differently.');
    return v;
  }

  async ready() {
    await expect.poll(() => this.portalId, { message: 'numeric portal ID from the app\'s own API calls' }).not.toBe('');
    await expect.poll(() => this.views.size, { message: 'user-views loaded' }).toBeGreaterThan(0);
    await expect.poll(() => !!this.meta, { message: 'workload meta loaded' }).toBe(true);
  }

  /** API layer for favourites: IDs in the favourite_views list, read fresh as the logged-in user. */
  async favouriteIds(): Promise<string[]> {
    const filter = encodeURIComponent(JSON.stringify({ view_type: 'favourite_views' }));
    const res = await callAsUser(this.page, this, 'GET', `/user-views?module=workload&page=1&per_page=200&filter=${filter}`);
    expect(res.ok(), `GET favourite_views → ${res.status()}`).toBe(true);
    const body = res.status() === 204 ? {} : await res.json();
    return ((body.user_views ?? []) as UserView[]).map(v => String(v.id));
  }
}

/**
 * Replays a call with the headers of the last app request, i.e. as the user of this browser context
 * (cookies come from the context; CSRF/portal headers from the app's own request).
 */
export async function callAsUser(page: Page, d: Discovery, method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, data?: unknown) {
  const base = new URL(page.url()).origin;
  const src = d.lastAppRequest ? await d.lastAppRequest.allHeaders() : {};
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) if (!/^(cookie|content-length|content-type|host|:)/i.test(k)) headers[k] = v;
  return page.request.fetch(`${base}/api/v3/portal/${d.portalId}${path}`, { method, headers, data });
}
