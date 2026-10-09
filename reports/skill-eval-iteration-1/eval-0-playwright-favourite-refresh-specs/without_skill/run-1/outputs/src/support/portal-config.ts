/**
 * Portal configuration loader.
 *
 * Nothing portal specific lives in the tests. Every environment (dev, staging,
 * customer sandboxes, ...) is described by one entry in a JSON file (see
 * config/portals.example.json) or, for a single ad-hoc run, by WL_* env vars.
 *
 * Values in the JSON file may reference environment variables with ${VAR_NAME}
 * so that URLs / portal names / storage-state paths can be injected by CI.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { SelectorKey } from './selectors';

export interface PortalConfig {
  /** Logical name used as the Playwright project name, e.g. "dev", "staging", "sandbox-acme". */
  name: string;
  /** Origin of the Zoho Projects deployment, e.g. https://projects.<dc>.<domain> */
  baseURL: string;
  /** Portal identifier as it appears in the URL (portal name or id). */
  portal: string;
  /**
   * Path (relative to baseURL) of the global workload report.
   * `{portal}` is substituted with `portal`. Example: "/portal/{portal}#workloadreport"
   */
  workloadPath: string;
  /** Display name of the "All Users" view (localised portals may differ). */
  allUsersViewName: string;
  /** Playwright storage-state file holding an authenticated session for this portal. */
  storageState: string;
  /** Regex source matching the XHR(s) that load workload data. Used to verify refresh. */
  dataRequestPattern: string;
  /**
   * Optional regex source matching the XHR fired when a view is (un)favourited.
   * When empty, favourite actions are verified through the UI only.
   */
  favouriteRequestPattern: string;
  /** Regex source with ONE capture group extracting the view id from the page URL. */
  viewIdUrlPattern: string;
  /** Per-portal selector overrides (CSS / XPath / Playwright selector strings). */
  selectors: Partial<Record<SelectorKey, string>>;
  /** Default timeout (ms) to wait for the report to finish loading. */
  readyTimeoutMs: number;
}

const DEFAULTS: Omit<PortalConfig, 'name' | 'baseURL' | 'portal' | 'workloadPath' | 'storageState'> = {
  allUsersViewName: 'All Users',
  dataRequestPattern: 'workload',
  favouriteRequestPattern: 'favou?rite',
  viewIdUrlPattern: '(?:view[_-]?id|viewid)[=/:]([\\w-]+)',
  selectors: {},
  readyTimeoutMs: 30_000,
};

/** Replace ${VAR} placeholders with process.env values (throws if a referenced var is missing). */
function expandEnv<T>(value: T, where: string): T {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_m, key: string) => {
      const v = process.env[key];
      if (v === undefined || v === '') {
        throw new Error(`Portal config ${where}: environment variable ${key} is not set`);
      }
      return v;
    }) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v, i) => expandEnv(v, `${where}[${i}]`)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = expandEnv(v, `${where}.${k}`);
    return out as T;
  }
  return value;
}

function normalise(raw: Partial<PortalConfig>, where: string): PortalConfig {
  const missing = (['name', 'baseURL', 'portal', 'workloadPath'] as const).filter((k) => !raw[k]);
  if (missing.length) throw new Error(`Portal config ${where} is missing: ${missing.join(', ')}`);
  const name = raw.name!;
  return {
    ...DEFAULTS,
    ...raw,
    name,
    baseURL: raw.baseURL!.replace(/\/+$/, ''),
    storageState: raw.storageState || path.join('.auth', `${name}.json`),
    selectors: { ...DEFAULTS.selectors, ...(raw.selectors ?? {}) },
  } as PortalConfig;
}

/** Single-portal mode built purely from env vars (handy for local runs). */
function fromEnv(): PortalConfig | undefined {
  if (!process.env.WL_BASE_URL) return undefined;
  const raw: Partial<PortalConfig> = {
    name: process.env.WL_PORTAL_NAME || 'env',
    baseURL: process.env.WL_BASE_URL,
    portal: process.env.WL_PORTAL,
    workloadPath: process.env.WL_WORKLOAD_PATH,
    storageState: process.env.WL_STORAGE_STATE,
  };
  if (process.env.WL_ALL_USERS_VIEW_NAME) raw.allUsersViewName = process.env.WL_ALL_USERS_VIEW_NAME;
  if (process.env.WL_DATA_REQUEST_PATTERN) raw.dataRequestPattern = process.env.WL_DATA_REQUEST_PATTERN;
  if (process.env.WL_FAVOURITE_REQUEST_PATTERN !== undefined) {
    raw.favouriteRequestPattern = process.env.WL_FAVOURITE_REQUEST_PATTERN;
  }
  if (process.env.WL_VIEW_ID_URL_PATTERN) raw.viewIdUrlPattern = process.env.WL_VIEW_ID_URL_PATTERN;
  if (process.env.WL_SELECTORS_JSON) raw.selectors = JSON.parse(process.env.WL_SELECTORS_JSON);
  return normalise(raw, 'from WL_* env vars');
}

/**
 * Loads all portals to run against.
 *  - PORTALS_FILE (default ./config/portals.json) – JSON array of PortalConfig-like objects
 *  - WL_* env vars – single portal, used when no file exists
 *  - TARGET_PORTALS – optional comma separated list of portal `name`s to keep
 */
export function loadPortals(): PortalConfig[] {
  const file = path.resolve(process.env.PORTALS_FILE || path.join(__dirname, '..', '..', 'config', 'portals.json'));
  let portals: PortalConfig[] = [];

  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error(`${file} must contain a JSON array of portals`);
    portals = parsed.map((p, i) => normalise(expandEnv(p, `${path.basename(file)}[${i}]`), `${path.basename(file)}[${i}]`));
  } else {
    const env = fromEnv();
    if (env) portals = [env];
  }

  const wanted = (process.env.TARGET_PORTALS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (wanted.length) {
    const unknown = wanted.filter((w) => !portals.some((p) => p.name === w));
    if (unknown.length) throw new Error(`TARGET_PORTALS references unknown portal(s): ${unknown.join(', ')}`);
    portals = portals.filter((p) => wanted.includes(p.name));
  }

  const names = new Set<string>();
  for (const p of portals) {
    if (names.has(p.name)) throw new Error(`Duplicate portal name "${p.name}"`);
    names.add(p.name);
  }
  return portals;
}

export function workloadUrl(cfg: PortalConfig): string {
  const p = cfg.workloadPath.replace(/\{portal\}/g, encodeURIComponent(cfg.portal));
  return p.startsWith('http') ? p : `${cfg.baseURL}${p.startsWith('/') ? '' : '/'}${p}`;
}
