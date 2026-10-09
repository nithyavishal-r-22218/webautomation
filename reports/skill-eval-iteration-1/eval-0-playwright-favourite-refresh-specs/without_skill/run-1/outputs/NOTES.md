# Global Workload Report: All Users favourite and refresh specs

Playwright (TypeScript) tests for the Zoho Projects global workload report, **All Users** view:
add to favourite, remove from favourite, and the refresh icon. The same spec runs against any number of portals (dev, staging, customer sandboxes) with nothing portal specific in code.

## Files

| Path | Purpose |
|---|---|
| `tests/workload/all-users-favourite-refresh.spec.ts` | The spec, with 10 tests per portal |
| `src/pages/workload-report.page.ts` | Page object: navigation, view switching, favourite state and actions, refresh, before/after `snapshot()` |
| `src/fixtures/workload.fixture.ts` | `portal` worker option, `workload` and `allUsers` fixtures. `allUsers` restores the original favourite state on teardown |
| `src/support/portal-config.ts` | Loads portals from `config/portals.json` (with `${ENV}` expansion) or `WL_*` env vars, and filters them with `TARGET_PORTALS` |
| `src/support/selectors.ts` | Default locators (role, text and attribute fragments) that can be overridden per portal |
| `playwright.config.ts` | One Playwright project per portal (baseURL, storageState, portal config) |
| `config/portals.example.json`, `.env.example` | Templates for configuring portals |
| `package.json`, `tsconfig.json` | Minimal project setup |

## How portal differences are handled
- **URLs, portal name, auth:** These are set per portal entry. Values can come from env vars through `${VAR}`. Auth comes from a Playwright `storageState` file per portal, and the suite does not log in automatically. Create the file once, for example with `npx playwright codegen --save-storage=.auth/dev.json <url>`.
- **View id:** It is never configured. It is read at runtime from the URL (`viewIdUrlPattern`) or from data attributes. Tests only check that it stays the same across actions and reloads.
- **Dates and users:** These are never asserted as literal values. `snapshot()` captures the date range label and the user rows before an action, and the tests compare them with the values after it. After a refresh, row count and labels are checked with `expect.soft`, because shared portals can change between calls.
- **View name:** Defaults to `All Users`. It can be overridden per portal (`allUsersViewName`) for localised portals.
- **Network:** Refresh is verified by waiting for a response that matches `dataRequestPattern` (default `workload`). Favourite calls are matched with `favouriteRequestPattern`. Set it to `""` to check favourites through the UI only.
- **DOM differences:** Any locator key (`refreshButton`, `favouriteToggle`, `viewSwitcher`, ...) can be overridden per portal under `selectors`.
- **Shared state:** Favourites are per user. Each test sets its own precondition with `ensureFavourite(true|false)`, and the fixture puts the original state back afterwards. Tests run in order in one worker per portal.

## Test coverage
- **Add:** The view becomes a favourite and is listed under Favourites. View name, view id and date range don't change, and no error toast appears. The state persists after a reload.
- **Remove:** The mirror of Add. There is also an add-then-remove round trip.
- **Refresh:** The icon is visible and enabled. A click re-fetches data with a 2xx response and no error. View, view id and date range are kept, and user rows are soft-checked. The favourite state doesn't change. Two refreshes in a row both work.

## Running
```bash
cp config/portals.example.json config/portals.json   # edit entries, export the ZP_* vars
npm i && npx playwright install chromium
npx playwright test                    # all portals
TARGET_PORTALS=staging npx playwright test
```

## Caveats
- The default selectors are best guesses written without access to the live DOM. Check them against each build and override any that don't match in `selectors`, preferably with `data-testid` or stable title attributes.
- The favourite state is read from `aria-pressed`/`aria-checked`, then from the title or aria-label wording, then from CSS class hints. If none of these work, the code checks whether the view is listed in the Favourites group.
- What I verified: the code typechecks with `tsc --strict`, and `playwright test --list` finds 10 tests per configured portal. Nothing has been run against a real portal.
