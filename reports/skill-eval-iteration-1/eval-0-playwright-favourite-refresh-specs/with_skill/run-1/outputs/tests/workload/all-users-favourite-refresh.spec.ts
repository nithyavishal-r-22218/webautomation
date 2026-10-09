import { test, expect, knownDefect, preserveFavouriteState } from '../../src/fixtures';
import { dataRequestParams, type WorkloadMeta } from '../../src/discover';
import { env } from '../../src/env';
import type { WorkloadPage } from '../../src/pages/WorkloadPage';

/**
 * Global Workload Report — All Users view: add to favourite, remove from favourite, refresh.
 *
 * Portal-agnostic: the view is found by name in the app's own user-views response, its ID comes from
 * there and from meta.custom_view_id, the favourite state is normalised from what the portal shows,
 * and every "expected" value (range, owners, selections) is read from the page before the action and
 * compared after it. No portal ID, view ID, user name, user count or date is written in this file.
 *
 * Each result is proven in more than one layer: UI (star class, Favorite Views group, rows),
 * network (status of the app's own call) and API (favourite_views list read back as the same user).
 */
// Favourites are shared per-user state: run in order on one worker (config: workers 1, fullyParallel false).
// 'default' rather than 'serial' so one failure (e.g. open defect WL-D-01) does not skip the refresh test;
// each test normalises its own starting state, so none depends on another.
test.describe.configure({ mode: 'default' });
preserveFavouriteState();                     // leave All Users favourite/unfavourite exactly as found

const VIEW = env.allUsersView;
const FAV_GROUP = env.favouriteGroup;

/** The confirmation toast has no data-zpqa key yet: record what we saw instead of passing/failing on a guess. */
async function noteToast(wl: WorkloadPage, action: string) {
  const toast = wl.page.locator('[role="alert"], [role="status"], [class*="toast" i], [class*="notif" i]')
    .filter({ hasText: /favou?rite/i }).first();
  const seen = await toast.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
  test.info().annotations.push({
    type: seen ? 'toast' : 'unconfirmed-locator',
    description: seen ? `${action}: "${(await toast.innerText()).trim()}"` : `${action}: no toast matched the generic selector — confirm the toast locator live`,
  });
}

async function reloadAllUsers(wl: WorkloadPage) {
  await wl.goto();
  await wl.selectView(VIEW);
}

test.describe(`Global Workload — ${VIEW} view`, () => {
  test('WL-G-02 add to favourite', async ({ allUsers: wl }) => {
    const id = wl.currentViewId();
    await test.step('normalise: start from not-favourite', async () => {
      await wl.ensureStar('unfav');
      expect(await wl.d.favouriteIds(), 'API: not in favourite_views before add').not.toContain(id);
    });

    await test.step('click star → POST /user-views/<id>/favorite 204', async () => {
      const r = await wl.clickStar('POST');
      expect(r.status(), 'favourite POST status').toBe(204);
      await noteToast(wl, 'add');
    });

    await test.step('UI: star is fav and view is listed under Favorite Views', async () => {
      await wl.expectStar('fav');
      await wl.openViews();
      await expect(wl.viewGroupTitle(FAV_GROUP), `"${FAV_GROUP}" group shown`).toBeVisible();
      await expect(wl.viewItem(FAV_GROUP, VIEW)).toBeVisible();
      await wl.closeViews();
    });

    await test.step('API: view id is in favourite_views', async () => {
      expect(await wl.d.favouriteIds()).toContain(id);
    });

    await test.step('persisted: still favourite after a full reload', async () => {
      await reloadAllUsers(wl);
      await wl.expectStar('fav');
      expect(wl.d.view(VIEW).is_favorite, 'user-views is_favorite after reload').toBe(true);
      await wl.openViews();
      await expect(wl.viewItem(FAV_GROUP, VIEW)).toBeVisible();
      await wl.closeViews();
    });
  });

  test('WL-G-03 remove from favourite', async ({ allUsers: wl }) => {
    const id = wl.currentViewId();
    await test.step('normalise: start from favourite', async () => {
      await wl.ensureStar('fav');
      expect(await wl.d.favouriteIds(), 'API: in favourite_views before remove').toContain(id);
    });

    await test.step('click star → DELETE /user-views/<id>/favorite 204', async () => {
      const r = await wl.clickStar('DELETE');
      expect(r.status(), 'favourite DELETE status').toBe(204);
      expect(new URL(r.url()).searchParams.get('module'), 'DELETE carries module=workload').toBe('workload');
      await noteToast(wl, 'remove');
    });

    await test.step('UI: star is unfav', async () => { await wl.expectStar('unfav'); });

    await test.step('API: view id is no longer in favourite_views', async () => {
      expect(await wl.d.favouriteIds()).not.toContain(id);
    });

    await test.step('persisted: after a full reload the view is not under Favorite Views', async () => {
      await reloadAllUsers(wl);
      await wl.expectStar('unfav');
      expect(wl.d.view(VIEW).is_favorite, 'user-views is_favorite after reload').toBe(false);
      await wl.openViews();
      await expect(wl.viewItem(FAV_GROUP, VIEW)).toBeHidden();
      await wl.closeViews();
    });
  });

  test('WL-G-03b Favorite Views updates after remove without reload @defect', async ({ allUsers: wl }) => {
    await wl.ensureStar('fav');
    // Open the dropdown once so the Favorite Views group is rendered, as a user would have seen it.
    await wl.openViews();
    await expect(wl.viewItem(FAV_GROUP, VIEW)).toBeVisible();
    await wl.closeViews();

    expect((await wl.clickStar('DELETE')).status()).toBe(204);
    await wl.expectStar('unfav');

    knownDefect('WL-D-01', 'Favorite Views group stays stale after removing a favourite until the page is reloaded');
    await wl.openViews(); // reopen: the group must reflect the removal now, not after a reload
    await expect(wl.viewItem(FAV_GROUP, VIEW)).toBeHidden();
    await wl.closeViews();
  });

  test('WL-G-04 refresh reloads views, meta and data and keeps selections', async ({ allUsers: wl }) => {
    const id = wl.currentViewId();
    const before = await wl.selection();
    const starBefore = await wl.starState();
    await expect.poll(() => !!wl.d.lastFirstPage, { message: 'first data page seen before refresh' }).toBe(true);
    const apiBefore = wl.d.lastFirstPage!;
    const ownersBefore = wl.d.firstPageOwners.map(o => String(o.id));
    expect(ownersBefore.length, 'All Users returned owners on its first page').toBeGreaterThan(0);

    const scrolled = await test.step('scroll the user list to the middle', async () => {
      if (!(await wl.isScrollable())) {
        test.info().annotations.push({ type: 'not-exercised', description: 'user list fits without scrolling in this portal; scroll-to-top not checked' });
        return false;
      }
      await wl.scrollToMiddle();
      await expect.poll(() => wl.scrollTop()).toBeGreaterThan(0);
      return true;
    });

    const { data, meta, lists } = await test.step('click refresh', () => wl.refresh());

    await test.step('network: user-views ×4, meta and first data page reloaded, all OK', async () => {
      for (const [list, r] of lists) expect.soft(r.ok(), `user-views ${list} → ${r.status()}`).toBe(true);
      expect(meta.ok(), `meta → ${meta.status()}`).toBe(true);
      expect(data.ok(), `first data page → ${data.status()}`).toBe(true);
      expect(new URL(meta.url()).searchParams.get('view_id'), 'meta requested for the same view').toBe(id);
      expect(((await meta.json()) as WorkloadMeta).custom_view_id?.toString(), 'meta.custom_view_id').toBe(id);
    });

    await test.step('API: data request keeps view, range and period', async () => {
      const after = dataRequestParams(data);
      expect(after.viewId).toBe(id);
      expect({ from: after.from, to: after.to, timePeriod: after.timePeriod, basedOn: after.basedOn })
        .toEqual({ from: apiBefore.from, to: apiBefore.to, timePeriod: apiBefore.timePeriod, basedOn: apiBefore.basedOn });
    });

    await test.step('UI: toolbar selections and favourite star unchanged', async () => {
      await expect.poll(() => wl.selection(), { message: 'view, header range, chart type, data label, group-by' }).toEqual(before);
      expect(await wl.starState()).toBe(starBefore);
    });

    await test.step('UI: list back at the top and showing the refreshed first page', async () => {
      if (scrolled) await expect.poll(() => wl.scrollTop(), { message: 'user list scrolled back to top' }).toBe(0);
      const owners = ((await data.json()).owners ?? []) as { id: string; name?: string }[];
      expect(owners.length, 'refreshed first page has owners').toBeGreaterThan(0);
      // Same data before and after (nothing changed in between); soft because a concurrent edit could reorder.
      expect.soft(owners.map(o => String(o.id)), 'first-page owners unchanged by refresh').toEqual(ownersBefore);
      await expect(wl.rows().first(), 'rows rendered after refresh').toBeVisible();
      if (owners[0]?.name) await expect(wl.rows().filter({ hasText: owners[0].name }).first(), 'first refreshed owner shown').toBeVisible();
    });
  });
});
