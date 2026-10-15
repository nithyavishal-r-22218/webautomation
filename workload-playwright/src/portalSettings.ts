import type { Page } from '@playwright/test';
import { env } from './env';
import type { ZpApi } from './api';

/**
 * Portal-level settings the Setup UI changes, replayed with the calls captured from the UI on 15-10-2026.
 *
 * Time zone — Setup › Portal Configuration › Configuration › Portal Settings › Edit (legacy form):
 *   read  POST /portal/<portal>/companyprofile.do  todisp=profile&showPage=portalset  → JSON with TIMEZONE, SELTZONE, COMPNAME,
 *         business_hours {id}, SELCHARSET, csrfParamName
 *   write POST /portal/<portal>/updatecompanyprofile.do  form companyname, timezone, business_hours_id, charset, webaddress,
 *         street, city, state, country, zipcode, <csrf name>=<csrf value>, toupdate=cprofile  → "PROFILE UPDATED"
 * Users — Users › row ••• (`entity-more-option`) › Deactivate (alert "Deactivate user?", `popup_success`):
 *   POST /users/{id}/deactivate  form notify=true|false  ·  POST /users/{id}/activate  form notify=true|false (notify is required)
 *   A deactivated user leaves GET /users; GET /users/{id} still answers (with deactivated_by).
 */
export async function readPortalProfile(page: Page): Promise<Record<string, any>> {
  return page.evaluate(async portal => {
    const w = window as any;
    const r = await fetch(`/portal/${portal}/companyprofile.do`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-ZCSRF-TOKEN': `${w.getZPCSRFName()}=${w.getZPCSRFValue()}` }, body: 'todisp=profile&showPage=portalset' });
    return r.json();
  }, env.portal);
}
export const portalTimeZone = async (page: Page) => String((await readPortalProfile(page)).TIMEZONE ?? '');
/** Set the portal time zone (IANA name, e.g. Pacific/Kiritimati). Returns "200 PROFILE UPDATED" on success. */
export async function setPortalTimeZone(page: Page, zone: string): Promise<string> {
  const prof = await readPortalProfile(page);
  return page.evaluate(async ({ portal, zone, prof }) => {
    const w = window as any; const f = new URLSearchParams();
    f.set('companyname', prof.COMPNAME ?? ''); f.set('timezone', zone); f.set('business_hours_id', String(prof.business_hours?.id ?? ''));
    f.set('charset', prof.SELCHARSET ?? 'UTF-8'); for (const k of ['webaddress', 'street', 'city', 'state', 'country', 'zipcode']) f.set(k, prof[k.toUpperCase()] ?? '');
    f.set(w.getZPCSRFName(), w.getZPCSRFValue()); f.set('toupdate', 'cprofile');
    const r = await fetch(`/portal/${portal}/updatecompanyprofile.do`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() });
    return `${r.status} ${(await r.text()).slice(0, 60)}`;
  }, { portal: env.portal, zone, prof });
}
export const deactivateUser = (api: ZpApi, id: string, notify = false) => api.callForm('POST', `/users/${id}/deactivate`, { notify: String(notify) });
export const activateUser = (api: ZpApi, id: string, notify = false) => api.callForm('POST', `/users/${id}/activate`, { notify: String(notify) });
/** Today's calendar date in a zone, as YYYY-MM-DD. */
export const todayIn = (zone: string, at = new Date()) => at.toLocaleDateString('en-CA', { timeZone: zone });
