import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import { loadPortals } from './src/support/portal-config';
import type { WorkloadWorkerOptions } from './src/fixtures/workload.fixture';

const portals = loadPortals();
if (portals.length === 0) {
  throw new Error(
    'No portals configured. Copy config/portals.example.json to config/portals.json (or set PORTALS_FILE / WL_* env vars).',
  );
}
for (const p of portals) {
  if (!fs.existsSync(p.storageState)) {
    console.warn(`[${p.name}] storage state "${p.storageState}" not found - tests will hit the login page.`);
  }
}

export default defineConfig<WorkloadWorkerOptions>({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Favourite state is per user; never run two workers against the same portal user.
  fullyParallel: false,
  workers: Number(process.env.WORKERS || 1),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: portals.map((portal) => ({
    name: portal.name,
    use: {
      ...devices['Desktop Chrome'],
      baseURL: portal.baseURL,
      storageState: fs.existsSync(portal.storageState) ? portal.storageState : undefined,
      portal,
    },
  })),
});
