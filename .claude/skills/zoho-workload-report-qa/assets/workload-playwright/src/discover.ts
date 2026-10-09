import { expect, type Page, type Request, type Response } from '@playwright/test';

export interface UserView {
  id: string; name: string; custom_view_id?: string;
  is_favorite: boolean; is_anchored: boolean; is_default_view: boolean;
  is_editable: boolean; is_deletable: boolean;
}
export interface WorkloadMeta {
  custom_view_id: string; project_id: string; user_range: number; report_based_on: string;
  default_business_hours_details: { working_day_availability: Record<string, number>; holidays: unknown[] };
  chart_details: Record<string, string>;
  user_premission_details?: Record<string, boolean>;
  [k: string]: unknown;
}

/**
 * Predefined views come back from /user-views under i18n keys; the dropdown shows these labels
 * (mapping from the Java suite's WorkloadReportApi, confirmed on plautomation 06-10-2026).
 */
export const PREDEFINED_VIEW_LABELS: Record<string, string> = {
  'zp.workload.customview.allusers': 'All Users',
  'zp.workload.customview.taskassociatedtoteams': 'Associated Teams',
  'zp.workload.customview.myteammembers': 'My Team Members',
  'zp.workload.customview.mydirectreports': 'My Direct Reports',
  'zp.workload.customview.mysubordinates': 'My Subordinates',
  'zp.workload.customview.usersbyprofile': 'Users by Profile',
  'zp.workload.customview.usersbyrole': 'Users by Role',
  'zp.workload.customview.unallocatedusers': 'Unallocated Users',
  'zp.workload.customview.underallocatedusers': 'Under-Allocated Users',
  'zp.workload.customview.optimalallocatedusers': 'Optimally-Allocated Users',
  'zp.workload.customview.overallocatedusers': 'Over-Allocated Users',
};
/** The name a view has in the dropdown. */
export const viewLabel = (name: string) => PREDEFINED_VIEW_LABELS[name] ?? name;

/**
 * Reads what the app itself fetched. The suite never builds API calls from its own tokens for discovery:
 * the app's normal requests already carry the right session, headers and portal ID.
 */
export class Discovery {
  portalId = '';
  views = new Map<string, UserView>();
  meta?: WorkloadMeta;
  lastAppRequest?: Request;
  private owners = new Set<string>();
  private unassigned = 0;
  private lastPageSeen = false;

  constructor(private page: Page) {
    page.on('request', r => {
      const m = r.url().match(/\/api\/v3\/portal\/(\d+)\//);
      if (m) { this.portalId ||= m[1]; this.lastAppRequest = r; }
    });
    page.on('response', r => this.onResponse(r).catch(() => {}));
  }

  private async onResponse(r: Response) {
    const url = r.url();
    if (!r.ok()) return;
    if (/\/user-views\?module=workload/.test(url)) {
      for (const v of ((await r.json()).user_views ?? []) as UserView[]) { this.views.set(v.name, v); this.views.set(viewLabel(v.name), v); }
    } else if (/\/reports\/workload\/meta/.test(url)) {
      this.meta = await r.json();
    } else if (/\/reports\/workload\?/.test(url)) {
      const j = await r.json();
      if (url.includes('fetch_unassignee=true')) { this.unassigned = j.owners?.length ? 1 : 0; return; }
      (j.owners ?? []).forEach((o: { id: string }) => this.owners.add(o.id));
      if (j.page_info?.has_next === false) this.lastPageSeen = true;
    }
  }

  /** Start counting owners for a fresh view load. */
  resetOwners() { this.owners.clear(); this.unassigned = 0; this.lastPageSeen = false; }
  expectedRows() { return this.owners.size + this.unassigned; }
  allPagesLoaded() { return this.lastPageSeen; }

  view(name: string): UserView {
    const v = this.views.get(name);
    if (!v) throw new Error(`View "${name}" not present in this portal. Known: ${[...this.views.keys()].join(', ')}`);
    return v;
  }

  async ready() {
    await expect.poll(() => this.portalId, { message: 'portal ID from app requests' }).not.toBe('');
    await expect.poll(() => this.views.size, { message: 'user-views loaded' }).toBeGreaterThan(0);
    await expect.poll(() => !!this.meta, { message: 'workload meta loaded' }).toBe(true);
  }
}

/** Query params of the workload data request (first page) — the API layer of every range check. */
export function dataRequestParams(r: Request | Response) {
  const u = new URL(r.url());
  return {
    from: u.searchParams.get('from_date') ?? '',
    to: u.searchParams.get('to_date') ?? '',
    timePeriod: u.searchParams.get('time_period') ?? '',
    viewId: u.searchParams.get('view_id') ?? '',
    projectId: u.searchParams.get('project_id') ?? '',
  };
}
export const isFirstDataPage = (r: Response) =>
  /\/reports\/workload\?/.test(r.url()) && /[?&]index=1&/.test(r.url()) && !r.url().includes('fetch_unassignee=true');

/**
 * Replays a call with the headers of the last app request, i.e. as the logged-in user of this context.
 * Used by permission tests to prove the API enforces what the UI hides.
 */
export async function callAsUser(page: Page, d: Discovery, method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, data?: unknown) {
  const base = new URL(page.url()).origin;
  const src = d.lastAppRequest ? await d.lastAppRequest.allHeaders() : {};
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) if (!/^(cookie|content-length|host|:)/i.test(k)) headers[k] = v;
  return page.request.fetch(`${base}/api/v3/portal/${d.portalId}${path}`, { method, headers, data });
}
