import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { env, reportsUrl, requireEnv } from '../src/env';

/**
 * Manual login capture, once per portal/environment: a person signs in in the headed browser and only the
 * resulting session is saved (never a password). Use a different ZP_ADMIN_STATE file per portal.
 */
test('capture Admin login', async ({ browser }) => {
  requireEnv();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(reportsUrl());
  console.log(`\n>>> Sign in to ${env.portal} in the opened browser. Waiting for the Reports page...\n`);
  await expect(page.locator('[data-zpqa="tab_resourceutilpage"]')).toBeVisible({ timeout: 540_000 });
  fs.mkdirSync(path.dirname(env.adminState), { recursive: true });
  await context.storageState({ path: env.adminState });
  await context.close();
});
