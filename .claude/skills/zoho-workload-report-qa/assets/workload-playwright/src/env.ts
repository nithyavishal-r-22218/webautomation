import 'dotenv/config';
import fs from 'fs';

/** Everything a run is allowed to know up front. All other values are discovered at runtime. */
export const env = {
  baseUrl: (process.env.ZP_BASE_URL ?? '').replace(/\/$/, ''),
  portal: process.env.ZP_PORTAL ?? '',
  adminState: process.env.ZP_ADMIN_STATE ?? 'auth/admin.json',
  /** Where specs write snapshots, exports, screenshots and the reporters write results. One folder per portal in a parallel run. */
  reportsDir: process.env.ZP_REPORTS_DIR || 'reports',
  /** Where cached OAuth tokens live (one Admin per portal, so one folder per portal in a parallel run). */
  authDir: process.env.ZP_AUTH_DIR || 'auth',
  userStates: parseJson<Record<string, string>>(process.env.ZP_USER_STATES, {}),
  authTargets: (process.env.ZP_AUTH_TARGETS ?? 'admin').split(',').map(s => s.trim()).filter(Boolean),
  runId: process.env.RUN_ID || `QA-WL-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}`,
  expectKnownDefects: process.env.ZP_EXPECT_KNOWN_DEFECTS === '1',
  weekStart: Number(process.env.ZP_WEEK_START ?? 0),
  editView: process.env.ZP_EDIT_VIEW ?? '',
  /** UI date order: mdy | dmy; empty = detect from the report header */
  dateOrder: (process.env.ZP_DATE_ORDER ?? '') as '' | 'mdy' | 'dmy',
};

// Real-data spec: also accept `npm run test:data` without exporting the flag
if (process.argv.some(a => a === '--project=data') && !process.env.ZP_RUN_DATA_SPEC) process.env.ZP_RUN_DATA_SPEC = '1';

export const reportsUrl = () => `${env.baseUrl}/portal/${env.portal}#zp/reports`;
export const setupProfilesUrl = () => `${env.baseUrl}/portal/${env.portal}#setup/profiles/user`;

export function stateExists(path: string | undefined): path is string {
  return !!path && fs.existsSync(path);
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { throw new Error(`Invalid JSON in env: ${raw}`); }
}
