import { test as base, expect, type Browser, type TestInfo } from '@playwright/test';
import { WorkloadPage, type FavState } from './pages/WorkloadPage';
import { env, requireEnv } from './env';

type Fixtures = {
  /** Global Workload Report, opened and with the All Users view selected (whatever its ID is in this portal). */
  allUsers: WorkloadPage;
};

export const test = base.extend<Fixtures>({
  allUsers: async ({ page }, use) => {
    requireEnv();
    const wl = new WorkloadPage(page);
    await wl.goto();
    await wl.selectView(env.allUsersView);
    await expect(wl.rows().first(), 'All Users shows at least one row').toBeVisible();
    await use(wl);
  },
});
export { expect };

/** Marks the current test as an expected failure for a known open defect when ZP_EXPECT_KNOWN_DEFECTS=1. */
export function knownDefect(id: string, summary: string) {
  test.info().annotations.push({ type: 'issue', description: `${id}: ${summary}` });
  test.fail(env.expectKnownDefects, `${id} is open`);
}

async function withAllUsers<T>(browser: Browser, info: TestInfo, fn: (wl: WorkloadPage) => Promise<T>): Promise<T> {
  const { storageState, viewport, baseURL } = info.project.use;
  const context = await browser.newContext({ storageState, viewport, baseURL });
  try {
    const wl = new WorkloadPage(await context.newPage());
    await wl.goto();
    await wl.selectView(env.allUsersView);
    return await fn(wl);
  } finally {
    await context.close();
  }
}

/**
 * Favourites are per-user shared state the person running the suite relies on. Record the All Users
 * favourite state before the suite and put it back afterwards, proving it in UI (star) and API (favourite list).
 */
export function preserveFavouriteState() {
  let original: FavState | undefined;
  test.beforeAll(async ({ browser }, info) => {
    requireEnv();
    original = await withAllUsers(browser, info, wl => wl.starState());
    info.annotations.push({ type: 'original-favourite', description: `${env.allUsersView}: ${original}` });
  });
  test.afterAll(async ({ browser }, info) => {
    if (!original) return;
    await withAllUsers(browser, info, async wl => {
      await wl.ensureStar(original!);
      const ids = await wl.d.favouriteIds();
      expect(ids.includes(wl.currentViewId()), `${env.allUsersView} favourite state restored to "${original}"`)
        .toBe(original === 'fav');
    });
  });
}
