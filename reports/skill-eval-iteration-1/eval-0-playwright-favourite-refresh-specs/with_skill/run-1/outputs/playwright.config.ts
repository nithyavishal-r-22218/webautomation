import { defineConfig, devices } from '@playwright/test';
import { env, stateExists } from './src/env';

/**
 * Projects
 *  - auth:     headed, manual login; saves the Admin storage state (no password is stored or typed)
 *  - workload: All Users favourite / refresh flows (mutates favourites, restored afterwards: runs serially)
 * Point the same config at dev, staging or any sandbox portal by changing ZP_BASE_URL / ZP_PORTAL / ZP_ADMIN_STATE.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'reports/html', open: 'never' }], ['junit', { outputFile: 'reports/junit.xml' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: env.baseUrl || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1366, height: 860 },
  },
  projects: [
    { name: 'auth', testMatch: /auth\.setup\.ts/, timeout: 600_000, use: { headless: false } },
    {
      name: 'workload',
      testMatch: /tests\/workload\/.*\.spec\.ts/,
      use: { storageState: stateExists(env.adminState) ? env.adminState : undefined },
    },
  ],
});
