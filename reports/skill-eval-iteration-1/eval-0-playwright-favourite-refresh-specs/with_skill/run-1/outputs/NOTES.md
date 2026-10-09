# All Users: favourite and refresh Playwright tests

These tests cover the Zoho Projects **Global Workload Report › All Users** view: add to favourite, remove from favourite, and refresh. They run on dev, staging and every sandbox portal without code changes. Each portal only needs `ZP_BASE_URL`, `ZP_PORTAL` and a saved login (`ZP_ADMIN_STATE`). The tests find everything else while they run, from the app's own network responses:

- the numeric portal ID, taken from the app's `/api/v3/portal/<id>/` calls
- the All Users view ID, from `user-views` by name and from `meta.custom_view_id`
- the starting favourite state, read from the star class and the `favourite_views` list and then normalised
- the date range, users and toolbar selections, read before each action and compared after it

## Files

| File | Purpose |
| --- | --- |
| `tests/workload/all-users-favourite-refresh.spec.ts` | The 4 tests (see below) |
| `src/pages/WorkloadPage.ts` | Page object: select a view by name, read the star state, `clickStar`, `ensureStar`, `refresh()` (collects the 4 user-views lists, meta and the first data page), read the toolbar selections, scroll the list |
| `src/discover.ts` | `Discovery`: reads the app's responses (portal ID, views by name/ID, meta, first-page owners, data-request params). Also has URL classifiers, `favouriteIds()` (API check) and `callAsUser` |
| `src/fixtures.ts` | `allUsers` fixture (opens the report and selects All Users). `preserveFavouriteState()` saves the favourite state in beforeAll and restores and checks it in afterAll. `knownDefect()` |
| `src/locators.ts` | `data-zpqa` keys and CSS. There are no IDs in it |
| `src/env.ts` | The only inputs |
| `tests/auth.setup.ts` | Manual login capture (`npm run auth`). No password is stored or typed |
| `playwright.config.ts`, `package.json`, `tsconfig.json`, `.env.example`, `.gitignore` | Project setup. Use one `.env` / CI variable set per portal |

This is a cut-down version of the skill's `assets/workload-playwright` structure. It can be dropped into that project, where it would replace `views-favourite-refresh.spec.ts` and the matching parts of `WorkloadPage`/`discover`.

## Tests

- **WL-G-02 add to favourite**: first makes sure All Users is not a favourite. Click the star, then check:
  - the POST to `/user-views/<id>/favorite` returns 204
  - the star has class `fav`
  - All Users is listed under Favorite Views
  - the API `favourite_views` list contains the ID
  - after a full reload: the star is still `fav`, `is_favorite` is true, and the view is still listed
- **WL-G-03 remove from favourite**: first makes sure All Users is a favourite. Click the star, then check:
  - the DELETE (`module=workload`) returns 204
  - the star has class `unfav`
  - the API list no longer contains the ID
  - after a full reload: the star is `unfav`, `is_favorite` is false, and the view is not under Favorite Views
- **WL-G-03b @defect (WL-D-01)**: after removing the favourite, reopening the dropdown without a reload should no longer show All Users under Favorite Views. This test is marked with `knownDefect`. With `ZP_EXPECT_KNOWN_DEFECTS=1` it becomes `test.fail`.
- **WL-G-04 refresh**:
  - Before refreshing, it saves the selections (view, header range, chart type, data label, group-by), the star state, and the first-page request params and owners. Then it scrolls the list to the middle.
  - After refreshing, it checks:
    - all 4 user-views lists were reloaded (predefined, created, shared, favourite), plus meta for the same view ID and the first data page
    - the data request has the same view ID, from/to, time_period and report_based_on as before
    - the selections and star state are unchanged
    - the list is back at the top
    - the first refreshed owner is shown
    - the first-page owners are unchanged (soft check)

All waits are web-first or `expect.poll`. There are no fixed sleeps. Tests run in order on one worker, and each test sets up its own starting state, so a failure does not skip the others.

## Things to confirm on the first live run

- **Toast**: there is no `data-zpqa` key for the add/remove confirmation toast yet. `noteToast()` looks for it with a generic selector and records the result as an annotation (`toast` / `unconfirmed-locator`). It never passes or fails a test on that guess. Replace it with the real locator once you have confirmed it.
- **4 user-views lists on refresh**: this comes from the skill's run on 8 Oct 2026. If a portal with no shared or favourite views skips one of the calls, `refresh()` will time out. Adjust `VIEW_LISTS` if that turns out to be the intended behaviour.
- **Localised UI**: the view and group names are matched by text. Set `ZP_ALL_USERS_VIEW` / `ZP_FAVOURITE_GROUP` for a non-English portal.
- **Scroll-to-top**: this is only checked when the list actually scrolls. In small sandbox portals it is recorded as `not-exercised` instead.
- **Restore**: the original All Users favourite state is restored in afterAll and checked in both the UI and the API. Favourites are per user, so other users are not affected.

## Checked offline

- `tsc --noEmit` passes (strict).
- `playwright test --list` shows the 4 tests.
- A grep finds no hardcoded IDs or portal names.

The tests have not been run against a live portal.
