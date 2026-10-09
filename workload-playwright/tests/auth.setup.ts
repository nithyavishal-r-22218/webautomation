import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { env, reportsUrl } from '../src/env';

/**
 * Manual login capture. A person signs in in the headed browser; the suite only stores the resulting
 * session (never a password). Run: ZP_AUTH_TARGETS=admin,view npm run auth
 */
for (const target of env.authTargets) {
  test(`capture login: ${target}`, async ({ browser }) => {
    const file = target === 'admin' ? env.adminState : env.userStates[target];
    test.skip(!file, `No storage-state path configured for "${target}"`);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(reportsUrl());
    console.log(`\n>>> Sign in as the "${target}" test user in the opened browser. Waiting for the Reports page...\n`);
    // Signed in = the portal shell (left-menu Home); profiles without report rights have no Reports menu or Workload tab
    await expect(page.locator('[data-zpqa="global_Home"]')).toBeVisible({ timeout: 540_000 });
    fs.mkdirSync(path.dirname(file!), { recursive: true });
    await context.storageState({ path: file! });
    await context.close();
  });
}
