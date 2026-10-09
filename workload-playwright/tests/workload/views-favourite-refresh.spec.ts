import { test, expect, knownDefect } from '../../src/fixtures';

/** WL-G-01..04 — Global Workload: All Users view, favourite add/remove, refresh. */
test.describe('Global Workload — All Users view', () => {
  test('WL-G-01 All Users loads every user (UI rows == API owners + unassigned)', async ({ wl }) => {
    wl.d.view('All Users'); // skips with a clear error if the portal has no such view
    await wl.selectView('All Users');
    await wl.loadAllRows();
    await expect(wl.rows()).toHaveCount(wl.d.expectedRows());
  });

  test('WL-G-02/03 add and remove favourite', async ({ wl }) => {
    const wasFavourite = !!wl.d.view('All Users').is_favorite;
    let isFavourite = wasFavourite;
    try {
      if (isFavourite) { await wl.toggleFavourite('DELETE'); isFavourite = false; await expect(wl.starIcon()).toHaveClass(/\bunfav\b/); }

      expect((await wl.toggleFavourite('POST')).ok()).toBe(true); isFavourite = true;
      await expect(wl.starIcon()).toHaveClass(/\bfav\b/);
      await wl.openViews();
      await expect(wl.viewItem('Favorite Views', 'All Users')).toBeVisible();
      await wl.closeViews();

      expect((await wl.toggleFavourite('DELETE')).ok()).toBe(true); isFavourite = false;
      await expect(wl.starIcon()).toHaveClass(/\bunfav\b/);
      knownDefect('WL-D-01', 'Favorite Views group stays stale after removing a favourite until reload');
      await wl.openViews();
      await expect(wl.viewItem('Favorite Views', 'All Users')).toBeHidden();
    } finally {
      // Leave the favourite as it was found
      if (isFavourite !== wasFavourite) {
        await wl.closeViews();
        await wl.toggleFavourite(wasFavourite ? 'POST' : 'DELETE');
      }
    }
  });

  test('WL-G-04 refresh reloads data and keeps selections', async ({ wl }) => {
    const before = await wl.selection();
    await wl.scroller().evaluate(el => { el.scrollTop = el.scrollHeight / 2; });
    const [data, meta, views] = await wl.refresh();
    for (const r of [data, meta, views]) expect(r.ok(), r.url()).toBe(true);
    expect(await wl.selection()).toEqual(before);
    await expect.poll(() => wl.scroller().evaluate(el => el.scrollTop)).toBe(0);
    const first = (await data.json()).owners?.[0]?.name as string | undefined;
    if (first) await expect(wl.rows().filter({ hasText: first }).first()).toBeVisible();
  });
});
