import 'dotenv/config';
import fs from 'fs';

/**
 * The only inputs a run is allowed to know up front. Everything else — numeric portal ID, view IDs,
 * favourite state, user list, dates, page size — is discovered at runtime from the app's own responses,
 * so the same spec runs unchanged on dev, staging and every customer sandbox portal.
 */
export const env = {
  /** Environment / data centre, e.g. https://projects.zoho.com (no trailing slash needed). */
  baseUrl: (process.env.ZP_BASE_URL ?? '').replace(/\/$/, ''),
  /** Portal URL name (the part after /portal/). */
  portal: process.env.ZP_PORTAL ?? '',
  /** Saved Admin session from `npm run auth` (never a password). */
  adminState: process.env.ZP_ADMIN_STATE ?? 'auth/admin.json',
  /** Name of the predefined "All Users" view; override only if a portal shows it under another label. */
  allUsersView: process.env.ZP_ALL_USERS_VIEW || 'All Users',
  /** Label of the favourites group in the view dropdown (override for a non-English portal UI). */
  favouriteGroup: process.env.ZP_FAVOURITE_GROUP || 'Favorite Views',
  /** `1` turns tests for known open defects into expected failures (test.fail) so CI stays green. */
  expectKnownDefects: process.env.ZP_EXPECT_KNOWN_DEFECTS === '1',
};

export function requireEnv() {
  const missing = (['baseUrl', 'portal'] as const).filter(k => !env[k]);
  if (missing.length) throw new Error(`Set ${missing.map(k => (k === 'baseUrl' ? 'ZP_BASE_URL' : 'ZP_PORTAL')).join(' and ')} (see .env.example)`);
}

export const reportsUrl = () => `${env.baseUrl}/portal/${env.portal}#zp/reports`;

export function stateExists(path: string | undefined): path is string {
  return !!path && fs.existsSync(path);
}
