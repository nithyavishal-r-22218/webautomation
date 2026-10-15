import { defineConfig, devices } from '@playwright/test';
import { env, stateExists } from './src/env';

/**
 * Projects
 *  - auth:        headed, manual login; saves storage states for the targets in ZP_AUTH_TARGETS
 *  - unit:        offline checks of the date oracle (no portal needed)
 *  - workload:    Admin flows on the Global Workload Report (mutating: runs serially)
 *  - data:        opt-in real-data run (project via API, import, day-by-day compare, trash) — ZP_RUN_DATA_SPEC=1
 *  - permissions: profile matrix (saved login per profile) and API-switched levels for one profile
 */
export default defineConfig({
  testDir: './tests',
  timeout: 300_000, // room for waits on the portal API budget (src/rate.ts)
  expect: { timeout: 60_000 }, // a portal request may be held by the API budget (src/rate.ts)
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // ZP_REPORTS_DIR / ZP_OUTPUT_DIR give each portal of a parallel run (scripts/parallel.mjs) its own folders
  outputDir: process.env.ZP_OUTPUT_DIR || 'test-results',
  // ZP_RESULTS_FILE: the queue runner (scripts/parallel.mjs) gives every single-test run its own JSON; ZP_HTML_REPORT=0 skips
  // the HTML and JUnit reports for those runs (the runner merges the JSON files instead)
  reporter: [
    ['list'],
    ...(process.env.ZP_HTML_REPORT === '0' ? [] : [
      ['html', { outputFolder: `${env.reportsDir}/html`, open: 'never' }] as const,
      ['junit', { outputFile: `${env.reportsDir}/junit.xml` }] as const,
    ]),
    ['json', { outputFile: process.env.ZP_RESULTS_FILE || `${env.reportsDir}/results.json` }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: env.baseUrl,
    // A click on a control hidden behind a pop-up (e.g. the filter calendar) must fail, not wait forever (seen 12-10-2026)
    actionTimeout: 45_000,
    // The dev portal sits behind a local proxy whose certificate changed mid-day on 12-10-2026 (CN mismatch): test env only
    ignoreHTTPSErrors: true,
    // ZP_BROWSER_CHANNEL=chrome launches the installed Google Chrome, which can present the machine's client certificate
    // to a zero-trust proxy (Playwright's bundled Chromium cannot; seen 12-10-2026 as ERR_BAD_SSL_CLIENT_AUTH_CERT)
    ...(process.env.ZP_BROWSER_CHANNEL ? { channel: process.env.ZP_BROWSER_CHANNEL } : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1366, height: 860 },
    // Spread UI actions out (ms per action); with the API budget in src/rate.ts this keeps runs under the portal's limit
    launchOptions: { slowMo: Number(process.env.ZP_SLOW_MO ?? 250) },
  },
  projects: [
    { name: 'auth', testMatch: /auth\.setup\.ts/, timeout: 600_000, use: { headless: false } },
    // Login from the credentials DB: artifacts off, because a trace or video would contain the typed password
    { name: 'auth-db', testMatch: /auth\.db\.setup\.ts/, timeout: 180_000, use: { trace: 'off', video: 'off', screenshot: 'off' } },
    { name: 'unit', testMatch: /tests\/unit\/.*\.spec\.ts/ },
    {
      name: 'workload',
      testMatch: /tests\/workload\/.*\.spec\.ts/,
      use: { storageState: stateExists(env.adminState) ? env.adminState : undefined },
    },
    {
      name: 'data',
      testMatch: /tests\/data\/.*\.spec\.ts/,
      timeout: 20 * 60_000,
      use: { storageState: stateExists(env.adminState) ? env.adminState : undefined },
    },
    {
      // tools: defect repro recordings and the Issues-API filer (tests/tools); never part of npm test
      name: 'tools',
      testMatch: /tests\/tools\/.*\.spec\.ts/,
      use: { storageState: stateExists(env.adminState) ? env.adminState : undefined },
    },
    {
      name: 'permissions',
      testMatch: /tests\/permissions\/.*\.spec\.ts/,
      use: { storageState: stateExists(env.adminState) ? env.adminState : undefined },
    },
  ],
});
