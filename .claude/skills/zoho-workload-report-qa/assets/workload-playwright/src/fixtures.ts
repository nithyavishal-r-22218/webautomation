import { test as base, expect } from '@playwright/test';
import { WorkloadPage } from './pages/WorkloadPage';
import { WorkloadEditPage, type FormState } from './pages/WorkloadEditPage';
import fs from 'fs';
import { env } from './env';
import { OAuthApi } from './oauth';
import { trackContext, waitForApiBudget } from './rate';

/** Last view snapshot, kept on disk until the restore is read back (a killed run still says what to put back). */
const VIEW_SNAPSHOT_FILE = `${env.reportsDir}/view-snapshot.json`;

type Fixtures = { wl: WorkloadPage; edit: WorkloadEditPage };
/** adminApi: OAuth client for the Admin DB account — create test data before the UI step, delete it after. */
type WorkerFixtures = { adminApi: OAuthApi };

export const test = base.extend<Fixtures, WorkerFixtures>({
  // Every browser context's portal API calls count toward the portal-wide budget (src/rate.ts)
  context: async ({ context }, use) => { await trackContext(context); await use(context); },
  wl: async ({ page }, use) => {
    // Start a case only with room for its load and first saves (~60 calls), so requests are rarely held mid-case
    await waitForApiBudget(60);
    const wl = new WorkloadPage(page); await openEditView(wl);
    await use(wl);
  },
  // Depends on wl so the report is open: a case asking only for `edit` would otherwise start on a blank page
  edit: async ({ page, wl }, use) => { void wl; await use(new WorkloadEditPage(page)); },
  adminApi: [async ({}, use) => {
    const api = await OAuthApi.create('admin');
    await use(api);
    await api.dispose();
  }, { scope: 'worker' }],
});
export { expect };

/** Open the report on the view the suite edits: ZP_EDIT_VIEW, else the view open on load. */
async function openEditView(wl: WorkloadPage) {
  await wl.goto();
  if (env.editView) await wl.selectView(env.editView, wl.d.views.get(env.editView)?.is_favorite ? 'Favorite Views' : 'Predefined Views');
}

/** Marks a test as an expected failure for a known open defect when ZP_EXPECT_KNOWN_DEFECTS=1. */
export function knownDefect(id: string, summary: string) {
  test.info().annotations.push({ type: 'issue', description: `${id}: ${summary}` });
  test.fail(env.expectKnownDefects, `${id} is open`);
}

/**
 * Snapshot the view's saved settings before a mutating suite and put them back afterwards,
 * so the shared portal is left exactly as found.
 *
 * The specs run in default (not serial) mode, so after a failure Playwright starts a new worker and runs beforeAll
 * again. A snapshot file still on disk means a restore has not been read back yet: it holds the ORIGINAL settings,
 * so it is reused rather than re-reading a view that a test may have changed.
 */
export function preserveViewSettings() {
  let snapshot: FormState | undefined;
  let timelineOptions: Record<string, boolean> | undefined;
  const viewKey = env.editView || '(view open on load)';
  test.beforeAll(async ({ browser }, info) => {
    const saved = fs.existsSync(VIEW_SNAPSHOT_FILE) ? JSON.parse(fs.readFileSync(VIEW_SNAPSHOT_FILE, 'utf8')) : undefined;
    if (saved && saved.view === viewKey) {
      ({ snapshot, timelineOptions } = saved);
      info.annotations.push({ type: 'snapshot', description: `reused from ${VIEW_SNAPSHOT_FILE} (${saved.at})` });
      return;
    }
    const ctx = await browser.newContext({ storageState: info.project.use.storageState });
    await trackContext(ctx); await waitForApiBudget(20);
    const page = await ctx.newPage();
    const wl = new WorkloadPage(page); await openEditView(wl);
    const edit = new WorkloadEditPage(page); await edit.openEdit();
    snapshot = await edit.formState();
    if (snapshot.viewType !== 'timeline') timelineOptions = await edit.timelineShowOptions();
    await edit.cancel();
    fs.mkdirSync(env.reportsDir, { recursive: true });
    fs.writeFileSync(VIEW_SNAPSHOT_FILE, JSON.stringify({ view: viewKey, snapshot, timelineOptions, at: new Date().toISOString() }, null, 2));
    await ctx.close();
  });
  test.afterAll(async ({ browser }, info) => {
    if (!snapshot) return;
    const ctx = await browser.newContext({ storageState: info.project.use.storageState });
    await trackContext(ctx); await waitForApiBudget(20);
    const page = await ctx.newPage();
    const wl = new WorkloadPage(page); await openEditView(wl);
    const edit = new WorkloadEditPage(page);
    await edit.restore(snapshot, timelineOptions);
    await edit.openEdit();
    expect(await edit.formState(), 'view restored to its original settings').toMatchObject(snapshot as unknown as Record<string, unknown>);
    fs.rmSync(VIEW_SNAPSHOT_FILE, { force: true });
    await edit.cancel(); await ctx.close();
  });
}
