/**
 * Global Workload Report - "All Users" view
 *   - Add to favourite
 *   - Remove from favourite
 *   - Refresh icon
 *
 * Portal agnostic: runs once per portal project defined in config/portals.json.
 * No users, view ids, dates or counts are hard-coded; every assertion compares
 * values captured from the live portal before and after the action.
 *
 * Favourite state is per user and shared across runs, so tests in this file
 * run in order inside one worker per portal (never fullyParallel), and the
 * `allUsers` fixture restores the view's original favourite state afterwards.
 * 'default' mode (not 'serial') so one failure does not skip the rest.
 */
import { test, expect } from '../../src/fixtures/workload.fixture';

test.describe.configure({ mode: 'default' });

test.describe('Global workload report - All Users view', () => {
  test.describe('Add to favourite', () => {
    test('marks All Users as favourite without changing the view', async ({ allUsers, portal }) => {
      await allUsers.ensureFavourite(false);
      const before = await allUsers.snapshot();

      await allUsers.addToFavourite();

      expect(await allUsers.isFavourite()).toBe(true);
      expect(await allUsers.isListedInFavourites(portal.allUsersViewName), 'listed under Favourites').toBe(true);

      const after = await allUsers.snapshot();
      expect(after.viewName).toBe(before.viewName);
      expect(after.viewId).toBe(before.viewId);
      expect(after.dateRange).toBe(before.dateRange);
      expect(await allUsers.visibleErrorCount()).toBe(0);
    });

    test('favourite state persists after reload', async ({ allUsers, portal }) => {
      await allUsers.ensureFavourite(false);
      await allUsers.addToFavourite();
      const viewId = await allUsers.currentViewId();

      await allUsers.reload();
      await allUsers.selectView(portal.allUsersViewName);

      expect(await allUsers.currentViewId()).toBe(viewId);
      expect(await allUsers.isFavourite()).toBe(true);
      expect(await allUsers.isListedInFavourites(portal.allUsersViewName)).toBe(true);
    });
  });

  test.describe('Remove from favourite', () => {
    test('unmarks All Users as favourite without changing the view', async ({ allUsers, portal }) => {
      await allUsers.ensureFavourite(true);
      const before = await allUsers.snapshot();

      await allUsers.removeFromFavourite();

      expect(await allUsers.isFavourite()).toBe(false);
      expect(await allUsers.isListedInFavourites(portal.allUsersViewName), 'not listed under Favourites').toBe(false);

      const after = await allUsers.snapshot();
      expect(after.viewName).toBe(before.viewName);
      expect(after.viewId).toBe(before.viewId);
      expect(after.dateRange).toBe(before.dateRange);
      expect(await allUsers.visibleErrorCount()).toBe(0);
    });

    test('removal persists after reload', async ({ allUsers, portal }) => {
      await allUsers.ensureFavourite(true);
      await allUsers.removeFromFavourite();

      await allUsers.reload();
      await allUsers.selectView(portal.allUsersViewName);

      expect(await allUsers.isFavourite()).toBe(false);
      expect(await allUsers.isListedInFavourites(portal.allUsersViewName)).toBe(false);
    });

    test('add then remove returns the view to non-favourite (round trip)', async ({ allUsers }) => {
      await allUsers.ensureFavourite(false);
      await allUsers.addToFavourite();
      await allUsers.removeFromFavourite();
      expect(await allUsers.isFavourite()).toBe(false);
    });
  });

  test.describe('Refresh icon', () => {
    test('is visible and enabled on All Users', async ({ allUsers }) => {
      await expect(allUsers.refreshButton()).toBeVisible();
      await expect(allUsers.refreshButton()).toBeEnabled();
    });

    test('re-fetches workload data successfully', async ({ allUsers }) => {
      const res = await allUsers.refresh();

      expect(res.ok(), `refresh request failed: ${res.status()} ${res.url()}`).toBe(true);
      expect(await allUsers.visibleErrorCount()).toBe(0);
      await expect(allUsers.sel.get('reportRoot')).toBeVisible();
    });

    test('keeps the All Users view, view id, date range and user rows', async ({ allUsers }) => {
      const before = await allUsers.snapshot();

      await allUsers.refresh();
      const after = await allUsers.snapshot();

      expect(after.viewName).toBe(before.viewName);
      expect(after.viewId).toBe(before.viewId);
      expect(after.dateRange, 'selected period must survive refresh').toBe(before.dateRange);
      // Data may legitimately change between calls on shared portals, so rows are soft-checked.
      expect.soft(after.userRowCount, 'user row count changed after refresh').toBe(before.userRowCount);
      expect.soft(after.userLabels, 'user list changed after refresh').toEqual(before.userLabels);
    });

    test('does not change the favourite state', async ({ allUsers }) => {
      const fav = await allUsers.isFavourite();
      await allUsers.refresh();
      expect(await allUsers.isFavourite()).toBe(fav);
    });

    test('consecutive refreshes each fetch data and leave the report usable', async ({ allUsers }) => {
      const before = await allUsers.snapshot();
      for (let i = 0; i < 2; i++) {
        const res = await allUsers.refresh();
        expect(res.ok(), `refresh #${i + 1} failed: ${res.status()}`).toBe(true);
      }
      const after = await allUsers.snapshot();
      expect(after.viewId).toBe(before.viewId);
      expect(after.dateRange).toBe(before.dateRange);
      expect(await allUsers.visibleErrorCount()).toBe(0);
    });
  });
});
