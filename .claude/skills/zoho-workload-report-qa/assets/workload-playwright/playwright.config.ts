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
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
    ['junit', { outputFile: 'reports/junit.xml' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: env.baseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1366, height: 860 },
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
      name: 'permissions',
      testMatch: /tests\/permissions\/.*\.spec\.ts/,
      use: { storageState: stateExists(env.adminState) ? env.adminState : undefined },
    },
  ],
});
