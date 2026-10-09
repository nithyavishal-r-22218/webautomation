# Turning a live run into Playwright code

A ready project ships with this skill in `assets/workload-playwright/` (copy it, `npm install --include=dev` — plain `npm install` silently installs nothing when the shell has `NODE_ENV=production`, because every dependency is a devDependency): `src/env.ts` (only inputs), `src/discover.ts` (reads the app's own responses: portal ID, views, meta, owners; `callAsUser` replays a call with the app's headers), `src/dates.ts` (oracle: `expectedRange`, `availableHours`, `NoRuleError`), page objects `WorkloadPage`, `WorkloadEditPage`, `ProfilesPage`, fixtures `preserveViewSettings()` (snapshot + restore) and `knownDefect(id)` (`test.fail` when `ZP_EXPECT_KNOWN_DEFECTS=1`). When asked for code, extend that structure rather than writing one-off scripts.

Rules for generated tests:
- Inputs come only from env (`ZP_BASE_URL`, `ZP_PORTAL`, saved storage states, `RUN_ID`, `ZP_WEEK_START`). Logins are captured manually (`npm run auth`); never store or type passwords.
- Read option lists from the open dropdown; compute expected dates from today; compute expected hours from business hours.
- Check each save in four layers: header, grid column dates, API from/to, reopened form.
- Web-first assertions, no fixed sleeps; `expect.soft` inside loops over options so one failure doesn't hide the rest.
- Mutating suites run serially and restore the view's original settings in `afterAll`.
- An option the spec doesn't define throws `NoRuleError` → annotate `check-spec`, never pass on a guess.
- Test data for edit/delete cases: create it with the OAuth API (`adminApi` fixture, `src/oauth.ts`), act in the UI, delete it with the API in `afterAll`. Pattern: `tests/workload/api-create-ui-edit.spec.ts`. Permission checks use `ZpApi` (the signed-in user's session) instead.
