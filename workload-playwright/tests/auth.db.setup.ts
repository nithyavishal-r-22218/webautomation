import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { env, reportsUrl } from '../src/env';
import { account, credsTable } from '../src/accountDb';

/**
 * Automatic login capture from the credentials DB — the TypeScript twin of the Java suite's SessionLogin
 * (~/UIautomation core/AccountDB + SessionLogin). Opt-in: `npm run auth:db` (ZP_AUTH_TARGETS picks the logins).
 *
 * DB settings and role selection: see src/accountDb.ts.
 *
 * The password is read from the DB and typed into the accounts page; it is never logged, and this project runs
 * with trace, video and screenshots off so it cannot end up in an artifact. Only the session is saved.
 */
for (const target of env.authTargets) {
  test(`capture login from DB: ${target}`, async ({ browser }) => {
    const file = target === 'admin' ? env.adminState : env.userStates[target];
    test.skip(!file, `No storage-state path configured for "${target}"`);
    const acc = await account(target);
    console.log(`>>> ${target}: signing in as ${acc.userName} (role ${acc.role} in ${credsTable()})`);

    const context = await browser.newContext();
    const page = await context.newPage();
    const accounts = env.baseUrl.replace('://projects.', '://accounts.');
    await page.goto(`${accounts}/signin?servicename=ZohoProjects&serviceurl=${encodeURIComponent(env.baseUrl)}`);
    await page.locator('#login_id').fill(acc.userName);
    await page.locator('#nextbtn').click();
    await page.locator('#password').fill(acc.password);
    await page.locator('#nextbtn').click();
    // An accounts interstitial (e.g. /announcement) may follow; the session already exists, so go straight on.
    await page.waitForURL(u => !u.host.startsWith('accounts.') || u.pathname.includes('/announcement'), { timeout: 30_000 });
    // Signed in = the portal shell (left-menu Home). Not Reports or the Workload tab: a profile without report rights has neither.
    await page.goto(reportsUrl());
    await expect(page.locator('[data-zpqa="global_Home"]'), 'portal shell after DB login').toBeVisible({ timeout: 60_000 });

    fs.mkdirSync(path.dirname(file!), { recursive: true });
    await context.storageState({ path: file! });
    await context.close();
  });
}
