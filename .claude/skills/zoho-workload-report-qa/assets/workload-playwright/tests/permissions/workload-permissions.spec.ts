import { test, expect, type Browser, type Page } from '@playwright/test';
import { env, stateExists, reportsUrl } from '../../src/env';
import { K, qa, qaStarts } from '../../src/locators';
import { Discovery, callAsUser } from '../../src/discover';
import { ProfilesPage, type Level } from '../../src/pages/ProfilesPage';
import { ZpApi } from '../../src/api';
import { toolbarIcon } from '../../src/pages/WorkloadPage';

/**
 * Permission matrix for Workload Reports (Global level shown; Project level runs the same checks inside a project).
 * Each profile key in ZP_USER_STATES must have a saved login. Expected behaviour per key:
 */
const MATRIX: Record<string, { open: boolean; create: boolean; edit: boolean; del: boolean }> = {
  none:     { open: false, create: false, edit: false, del: false },
  view:     { open: true,  create: false, edit: false, del: false },
  manage:   { open: true,  create: true,  edit: true,  del: false },
  delete:   { open: true,  create: false, edit: false, del: true  },
  full:     { open: true,  create: true,  edit: true,  del: true  },
  globonly: { open: true,  create: true,  edit: true,  del: true  },
  projonly: { open: false, create: false, edit: false, del: false }, // at Global level
};

async function asUser(browser: Browser, key: string): Promise<{ page: Page; d: Discovery }> {
  const ctx = await browser.newContext({ storageState: env.userStates[key] });
  const page = await ctx.newPage();
  const d = new Discovery(page);
  await page.goto(reportsUrl());
  return { page, d };
}

test.describe('SET — profile screen (Admin)', () => {
  test('SET-01 Workload rows exist for every profile at both levels; state read from rc-checked', async ({ page }) => {
    const pp = new ProfilesPage(page); await pp.goto();
    for (const level of ['projectreport', 'globalreport'] as Level[]) {
      await pp.openWorkload(level);
      const profiles = await pp.profiles();
      expect(profiles.length, `${level}: profiles discovered`).toBeGreaterThan(0);
      for (const p of profiles) for (const perm of ['view', 'manage', 'delete'] as const)
        test.info().annotations.push({ type: `${level}:${p.name}`, description: `${perm}=${await pp.isTicked(p.id, perm)}` });
    }
  });
});

for (const [key, exp] of Object.entries(MATRIX)) {
  test.describe(`G — profile "${key}"`, () => {
    test.skip(!stateExists(env.userStates[key]), `no saved login for "${key}" (run: ZP_AUTH_TARGETS=${key} npm run auth)`);

    test(`G-01/03 open Workload Report: ${exp.open ? 'allowed' : 'denied'}`, async ({ browser }) => {
      const { page } = await asUser(browser, key);
      if (exp.open) await expect(qa(page, K.workloadTab)).toBeVisible();
      else await expect(qa(page, K.workloadTab)).toHaveCount(0);
    });

    test.describe('when the report opens', () => {
      test.skip(!exp.open, 'profile cannot open the report');

      test(`G-04 Create option ${exp.create ? 'shown' : 'hidden'}`, async ({ browser }) => {
        const { page } = await asUser(browser, key);
        await qa(page, K.workloadTab).click();
        await qa(page, K.viewDropdown).click();
        if (exp.create) await expect(qa(page, K.createView)).toBeVisible();
        else await expect(qa(page, K.createView)).toBeHidden();
      });

      test(`G-05 seed view menu: edit ${exp.edit ? 'yes' : 'no'}, delete ${exp.del ? 'yes' : 'no'}`, async ({ browser }) => {
        const { page, d } = await asUser(browser, key);
        await qa(page, K.workloadTab).click(); await d.ready();
        const seed = seedView(d);
        // Open the menu on the SAME view whose flags we compare (not whatever view happens to be current).
        await openView(page, seed.name);
        expect(seed.is_editable, 'API is_editable').toBe(exp.edit);
        expect(seed.is_deletable, 'API is_deletable').toBe(exp.del);
        await (await toolbarIcon(page, K.moreActions)).click();
        if (exp.edit) await expect(qa(page, K.edit)).toBeVisible(); else await expect(qa(page, K.edit)).toHaveCount(0);
        const del = qa(page, K.deleteView).filter({ visible: true }); // confirmed live 08-10-2026
        if (exp.del) await expect(del).toBeVisible(); else await expect(del).toHaveCount(0);
      });

      test(`G-06 API edit of the seed view (replayed real save) ${exp.edit ? 'succeeds' : 'is denied'}`, async ({ browser }) => {
        const body = await captureAdminSaveBody(browser);
        const { page, d } = await asUser(browser, key);
        await qa(page, K.workloadTab).click(); await d.ready();
        const res = await callAsUser(page, d, 'PUT', '/reports/custom-workload', body);
        test.info().annotations.push({ type: 'api', description: `${res.status()} ${(await res.text()).slice(0, 200)}` });
        if (exp.edit) expect(res.ok()).toBe(true);
        else { expect(res.ok(), 'lower-privilege user must not edit via API').toBe(false); expect(res.status(), 'denied, not a server error').toBeLessThan(500); }
      });

      test(`G-07 API create (real body without id) ${exp.create ? 'succeeds' : 'is denied'}`, async ({ browser }) => {
        const body = { ...(await captureAdminSaveBody(browser)) } as Record<string, unknown>;
        delete body.id; body.name = `${env.runId}-${key}-api`;
        const { page, d } = await asUser(browser, key);
        await qa(page, K.workloadTab).click(); await d.ready();
        const res = await callAsUser(page, d, 'PUT', '/reports/custom-workload', body);
        test.info().annotations.push({ type: 'api', description: `${res.status()} ${(await res.text()).slice(0, 200)}` });
        if (exp.create) {
          expect(res.ok()).toBe(true);
          const id = String((await res.json().catch(() => ({}))).id ?? '');
          const del = id ? await callAsUser(page, d, 'DELETE', `/views/${id}?module=workload`) : undefined; // internal delete endpoint
          let cleanup = `view "${body.name}" delete as ${key} → ${del?.status() ?? 'id not returned'}`;
          if (!del?.ok()) {
            // Profiles without Delete (e.g. manage) cannot remove their own view: fall back to the Admin
            const admin = await ZpApi.open(browser, env.adminState);
            const out = id ? [`${(await admin.api.deleteView(id)).status()}`] : await admin.api.deleteViewsByPrefix(String(body.name));
            cleanup += `; as Admin → ${out.join(', ') || 'not found'}`;
            await admin.ctx.close();
            expect.soft(out.some(s => /\b20\d\b/.test(s)), `QA view "${body.name}" removed (else delete it in the UI)`).toBe(true);
          }
          test.info().annotations.push({ type: 'cleanup', description: cleanup });
        } else { expect(res.ok(), 'View-only user must not create via API').toBe(false); expect(res.status()).toBeLessThan(500); }
      });
    });
  });
}

/** The QA seed view (shared by Admin, name starts with QA-WL-SEED). Required for edit/delete checks. */
function seedView(d: Discovery) {
  const v = [...d.views.values()].find(x => x.name.startsWith(process.env.ZP_SEED_VIEW_PREFIX ?? 'QA-WL-SEED'));
  if (!v) throw new Error('Create and share a seed custom view named QA-WL-SEED… as Admin before running permission tests');
  return v;
}
async function openView(page: Page, name: string) {
  await qa(page, K.viewDropdown).click();
  await page.locator(`.customview-name[data-tooltip="${name}"]`).filter({ visible: true }).first().click();
}

let adminBody: unknown;
/**
 * The exact body the app sends when Admin saves the seed view unchanged. Replaying the app's own body means a
 * denial can only come from permissions, never from an invalid hand-built payload. Admin's replay must succeed first.
 */
async function captureAdminSaveBody(browser: Browser): Promise<Record<string, unknown>> {
  if (adminBody) return adminBody as Record<string, unknown>;
  const ctx = await browser.newContext({ storageState: env.adminState });
  const page = await ctx.newPage();
  const d = new Discovery(page);
  await page.goto(reportsUrl()); await qa(page, K.workloadTab).click(); await d.ready();
  await openView(page, seedView(d).name);
  await (await toolbarIcon(page, K.moreActions)).click(); await qa(page, K.edit).click();
  const req = page.waitForRequest(r => r.url().includes('/reports/custom-workload') && r.method() === 'PUT');
  await qa(page, K.save).click();
  const r = await req;
  adminBody = r.postDataJSON();
  const replay = await callAsUser(page, d, 'PUT', '/reports/custom-workload', adminBody);
  expect(replay.ok(), 'Admin replay of the captured body must succeed (proves the body is valid)').toBe(true);
  await ctx.close();
  return adminBody as Record<string, unknown>;
}

test('ISO user rows render for a user who can open the report', async ({ browser }) => {
  const key = Object.keys(env.userStates).find(k => MATRIX[k]?.open && stateExists(env.userStates[k]));
  test.skip(!key, 'no profile with access has a saved login');
  const { page } = await asUser(browser, key!);
  await qa(page, K.workloadTab).click();
  await expect(qaStarts(page, K.userRowPrefix).first()).toBeVisible();
});
