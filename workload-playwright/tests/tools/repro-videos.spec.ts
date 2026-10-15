import { test, expect } from '../../src/fixtures';
import fs from 'fs';
import path from 'path';
import { env, reportsUrl } from '../../src/env';
import { K, qa } from '../../src/locators';
import { ZpApi } from '../../src/api';
import { trackContext, waitForApiBudget } from '../../src/rate';
import { WorkloadPage } from '../../src/pages/WorkloadPage';
import { FilterPanel } from '../../src/pages/FilterPanel';

/**
 * Reproduction recordings for the open filter defects (one video each). Run with
 *   ZP_ALLOW_PROFILE_CHANGES=1 npx playwright test tests/tools/repro-videos.spec.ts --project=tools
 * then copy test-results/<test>/video.webm per defect to reports/repro/<ID>.webm and convert with ffmpeg (see README › Filing defects).
 * Videos land in test-results/<test>/video.webm and are copied to reports/repro/<id>.webm.
 */
test.use({ video: { mode: 'on', size: { width: 1366, height: 860 } } });
test.describe.configure({ mode: 'default', timeout: 600_000 });
const OUT = `${env.reportsDir}/repro`;
const pause = (page: import('@playwright/test').Page, ms = 1500) => page.waitForTimeout(ms);

async function keepVideo(page: import('@playwright/test').Page, id: string) {
  fs.mkdirSync(OUT, { recursive: true });
  const v = page.video(); if (!v) return;
  const p = await v.path();
  // the file is final only after the context closes: remember where it is, copy later
  fs.writeFileSync(path.join(OUT, `${id}.src`), p);
}

test('WL-D-24 Group By hides the chip bar while the filter stays applied', async ({ wl }) => {
  const fp = new FilterPanel(wl.page);
  await fp.open(); await fp.expand('resourcetype'); await fp.setConditionOf('resourcetype', 'is'); await fp.tickIds('resourcetype', ['1']);
  await pause(wl.page);
  await fp.find(); await wl.loadAllRows(); await pause(wl.page, 2500);        // chips: User/Resource: Is Users, 7 rows
  await qa(wl.page, K.groupBy).click(); await pause(wl.page);
  await wl.page.locator('[id$="-listbox"], .zdropdownlist').filter({ visible: true }).last().getByText('Roles', { exact: true }).click();
  await pause(wl.page, 4000);                                                  // grouped, rows still users only, chip bar gone
  await wl.page.mouse.move(600, 130); await pause(wl.page, 2000);
  await keepVideo(wl.page, 'WL-D-24');
  await qa(wl.page, K.groupBy).click(); await wl.page.locator('[id$="-listbox"], .zdropdownlist').filter({ visible: true }).last().getByText('None', { exact: true }).first().click().catch(() => {});
  await pause(wl.page, 2000);
  if (await qa(wl.page, K.filterClear).isVisible()) await fp.clear();
  if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard();
});

test('WL-D-25 Clear filter does nothing after the period arrows', async ({ wl }) => {
  const fp = new FilterPanel(wl.page);
  await fp.open(); await fp.expand('resourcetype'); await fp.setConditionOf('resourcetype', 'is'); await fp.tickIds('resourcetype', ['1']);
  await pause(wl.page);
  await fp.find(); await wl.loadAllRows(); await pause(wl.page, 2000);
  await wl.step('next'); await wl.loadAllRows(); await pause(wl.page, 2500);  // next period, chips kept
  await qa(wl.page, K.filterClear).hover(); await pause(wl.page, 800);
  await qa(wl.page, K.filterClear).click(); await pause(wl.page, 5000);       // nothing happens: chips stay, no request
  await qa(wl.page, K.filterClear).click(); await pause(wl.page, 4000);       // second try
  expect.soft(await fp.chips(), 'chips still shown after Clear filter').toContain('User/Resource');
  await keepVideo(wl.page, 'WL-D-25');
  await fp.open(); await fp.reset(); await fp.find().catch(() => {}); await pause(wl.page, 2000);
  if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard();
});

test('WL-D-26 a filter saved with a view is applied but invisible', async ({ wl }) => {
  const fp = new FilterPanel(wl.page);
  const api = new ZpApi(wl.page, wl.d);
  const name = `${env.runId}-D26-saved-filter`;
  const id = await api.createView(name, { determiner: { pattern: '1', criteria: [{ field_name: 'resource_type', condition: 'is', value: ['1'] }] } });
  try {
    await wl.goto(); await pause(wl.page, 1500);                               // All Users: 9 rows incl. resource + Unassigned
    await wl.openViews(); await pause(wl.page);
    await wl.viewItem('My Custom Views', name).click(); await pause(wl.page, 3500); // 7 rows (users only), no chip bar
    await wl.page.mouse.move(600, 130); await pause(wl.page, 1500);
    await fp.open(); await pause(wl.page); await fp.expand('resourcetype'); await pause(wl.page, 3000); // nothing ticked, badge 0
    await fp.cancel();
    await keepVideo(wl.page, 'WL-D-26');
  } finally { await api.deleteView(id); }
});

test('WL-D-27 View-only profile: Save as › Discard does nothing', async ({ browser }) => {
  test.skip(process.env.ZP_ALLOW_PROFILE_CHANGES !== '1', 'needs ZP_ALLOW_PROFILE_CHANGES=1');
  const PROFILE = process.env.ZP_PERM_PROFILE || 'CP', USER_STATE = process.env.ZP_PERM_USER_STATE || 'auth/wl.cp.json';
  const admin = await ZpApi.open(browser, env.adminState);
  const profileId = await admin.api.profileId(PROFILE);
  const before = { global: await admin.api.perms(profileId, 'global'), project: await admin.api.perms(profileId, 'project') };
  const ctx = await browser.newContext({ storageState: USER_STATE, recordVideo: { dir: 'test-results/repro-d27', size: { width: 1366, height: 860 } }, viewport: { width: 1366, height: 860 } });
  await trackContext(ctx); await waitForApiBudget(40);
  const page = await ctx.newPage();
  try {
    await admin.api.setPerms(profileId, 'global', ['view']); await admin.api.setPerms(profileId, 'project', ['view']);
    await page.goto(reportsUrl());
    const wl = new WorkloadPage(page); await wl.goto();
    const fp = new FilterPanel(page);
    await fp.open(); await fp.expand('resourcetype'); await fp.setConditionOf('resourcetype', 'is'); await fp.tickIds('resourcetype', ['1']);
    await pause(page);
    await fp.find(); await wl.loadAllRows(); await pause(page, 2500);         // filtered, * and Save as shown
    await qa(page, K.saveAs).click(); await pause(page, 1500);                 // menu: New (disabled), Discard
    await qa(page, K.discard).click(); await pause(page, 5000);                // nothing happens
    await page.mouse.move(600, 130); await pause(page, 2000);
    expect.soft(await qa(page, K.saveAs).filter({ visible: true }).count(), 'Save as still shown after Discard').toBeGreaterThan(0);
    if (await qa(page, K.filterClear).isVisible()) await fp.clear();
    const v = page.video(); if (v) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'WL-D-27.src'), await v.path()); }
  } finally {
    await ctx.close();
    await admin.api.setPerms(profileId, 'global', before.global); await admin.api.setPerms(profileId, 'project', before.project);
    expect(await admin.api.perms(profileId, 'global'), 'global restored').toEqual(before.global);
    expect(await admin.api.perms(profileId, 'project'), 'project restored').toEqual(before.project);
    await admin.ctx.close();
  }
});
