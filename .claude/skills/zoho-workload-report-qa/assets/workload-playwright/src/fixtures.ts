import { test as base, expect } from '@playwright/test';
import { WorkloadPage } from './pages/WorkloadPage';
import { WorkloadEditPage, type FormState } from './pages/WorkloadEditPage';
import fs from 'fs';
import { env } from './env';
import { OAuthApi } from './oauth';

/** Last view snapshot, kept on disk until the restore is read back (a killed run still says what to put back). */
const VIEW_SNAPSHOT_FILE = 'reports/view-snapshot.json';

type Fixtures = { wl: WorkloadPage; edit: WorkloadEditPage };
/** adminApi: OAuth client for the Admin DB account — create test data before the UI step, delete it after. */
type WorkerFixtures = { adminApi: OAuthApi };

export const test = base.extend<Fixtures, WorkerFixtures>({
  wl: async ({ page }, use) => {
    const wl = new WorkloadPage(page); await openEditView(wl);
    await use(wl);
  },
  edit: async ({ page }, use) => use(new WorkloadEditPage(page)),
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
 */
export function preserveViewSettings() {
  let snapshot: FormState | undefined;
  let timelineOptions: Record<string, boolean> | undefined;
  test.beforeAll(async ({ browser }, info) => {
    const page = await (await browser.newContext({ storageState: info.project.use.storageState })).newPage();
    const wl = new WorkloadPage(page); await openEditView(wl);
    const edit = new WorkloadEditPage(page); await edit.openEdit();
    snapshot = await edit.formState();
    if (snapshot.viewType !== 'timeline') timelineOptions = await edit.timelineShowOptions();
    await edit.cancel();
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(VIEW_SNAPSHOT_FILE, JSON.stringify({ view: env.editView || '(view open on load)', snapshot, timelineOptions, at: new Date().toISOString() }, null, 2));
    await page.close();
  });
  test.afterAll(async ({ browser }, info) => {
    if (!snapshot) return;
    const page = await (await browser.newContext({ storageState: info.project.use.storageState })).newPage();
    const wl = new WorkloadPage(page); await openEditView(wl);
    const edit = new WorkloadEditPage(page);
    await edit.restore(snapshot, timelineOptions);
    await edit.openEdit();
    expect(await edit.formState(), 'view restored to its original settings').toMatchObject(snapshot as unknown as Record<string, unknown>);
    fs.rmSync(VIEW_SNAPSHOT_FILE, { force: true });
    await edit.cancel(); await page.close();
  });
}
