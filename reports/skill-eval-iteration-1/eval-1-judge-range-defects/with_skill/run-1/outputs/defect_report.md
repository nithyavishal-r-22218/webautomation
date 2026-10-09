# Workload Report: date-range defect report

**Run date:** Thu 8 Oct 2026 · **Portal settings:** weeks start Sunday · business hours Mon–Fri, 9 h/day (540 min)
**Source:** QA observations (a)–(c), checked against the skill's date oracle (`src/dates.ts` → `expectedRange`, `availableHours`).
All numbers below are an example from this portal on this day. Expected values come from today's date and the portal settings, so they change on any other day.

## Verdict

**All three observations are real defects. None of them is expected behaviour.** They come down to 2 defects (one ID per root cause, continuing the WL-D series):

| ID | Severity | Observations | Summary | Status |
| --- | --- | --- | --- | --- |
| WL-D-02 | **Major** (functional) | (a), (b) | Days-unit relative windows are one day too long. "Last 7 Days" covers 8 days, and the week options run Sunday to Sunday, so Last Week and This Week overlap. | Confirmed from QA observations (2 layers for (a), header only for (b)) |
| WL-D-03 | **Major** (functional) | (c) | Weeks-unit buckets start at the range start rather than the week start and run past the range end. The header total (225 h) is larger than the user total (198 h). | Confirmed from QA observations (header, grid and row layers) |

Parts that behaved correctly (no defect): the (a) API `to_date` date part (2026-10-08), the (c) header range 10-01-2026 to 10-31-2026, and the (c) first-user row total of 198 h.

---

## WL-D-02: Days-unit relative windows are one day too long

**Severity: Major (functional).** The data, the grid and the totals all cover the wrong period. For "Last 7 Days" this also adds a working day, so availability is 9 h too high per user (54 h instead of 45 h).

### Steps
1. Workload Report → ••• More Actions → Edit → Time Period.
2. Time period unit = **Days**, mode = **Relative**, option = **Last 7 Days** → Save.
3. Read the header (`topbar_calendar`), the first and last grid day columns, and the `GET /reports/workload?…index=1` params `from_date` / `to_date`.
4. Repeat with **This Week**, then **Last Week**.

### Expected vs actual

| Option | Expected header | Expected length | Actual header / grid | Actual length | Result |
| --- | --- | --- | --- | --- | --- |
| Last 7 Days | `10-02-2026 to 10-08-2026` (today minus 6 days through today) | 7 days, 5 working days = **45 h** | `10-01-2026 to 10-08-2026`, columns Oct 1 … Oct 8 | 8 days, 6 working days = 54 h | **FAIL**: start is one day early |
| Last 7 Days, API `to_date` | date part `2026-10-08` | n/a | `2026-10-08T23:59:59.999Z` | n/a | Pass (end date correct) |
| This Week | `10-04-2026 to 10-10-2026` (Sun–Sat) | 7 days | `10-04-2026 to 10-11-2026` | 8 days (Sun–Sun) | **FAIL**: end is one day late |
| Last Week | `09-27-2026 to 10-03-2026` (Sun–Sat) | 7 days | `09-27-2026 to 10-04-2026` | 8 days (Sun–Sun) | **FAIL**: end is one day late, and it overlaps This Week on Sun 10-04 |

### Why this is not expected
- An "N Days" window has N days, ending today (Last) or starting today (Next). An 8-day "Last 7 Days" is off by one.
- With a Sunday week start, a week is Sunday to Saturday. Consecutive weeks must not share a day. Here Sun 10-04 belongs to both Last Week and This Week, so any allocation logged on that day is counted in both reports.
- The two errors go in different directions: Last 7 Days moves the start back, and the week options move the end forward. The likely cause is an inclusive end being added to an "N-day" span (start + N instead of start + N − 1).

### Evidence layers
- (a): header, grid columns (Oct 1..Oct 8, 8 columns), and API `to_date`. The header and grid agree with each other, and both disagree with the oracle.
- (b): header only. Re-verification must add the grid first/last column and API `from_date`/`to_date` (see below).

### Impact
- Last 7 Days: one extra working day (Thu 10-01) is included, so available hours are 54 instead of 45 per user and utilisation % is understated.
- This Week / Last Week: the extra day is a Sunday, so business-hour availability does not change (0 h). Weekend allocations and the grid still show an extra column, and Sunday 10-04 is double-counted across Last Week and This Week.

### Related cases to re-check (same root cause; do not assume)
Next 7 Days (expected `10-08-2026 to 10-14-2026`), Next Week (`10-11-2026 to 10-17-2026`), Last 180 Days (`04-12-2026 to 10-08-2026`, 180 days; previously seen as 181), and Next 180 Days (`10-08-2026 to 04-05-2027`). Days › Last/Next 3 Months: **check spec**. No rule is defined (rolling from today vs calendar months), so do not mark it pass or fail.

### Open question (check spec, not a defect yet)
`to_date` is sent as `…T23:59:59.999Z`, which is end of day in **UTC**, not end of day in the portal or user time zone. If the portal time zone is not UTC (for example IST, UTC+5:30), the server may cut off or include part of a neighbouring day. Capture `from_date` as well, and confirm with dev how the server interprets the `Z` suffix.

---

## WL-D-03: Weeks unit buckets from the range start and overruns the range end; header total ≠ user total

**Severity: Major (functional).** The headline number (225 h) is 27 h (13.6 %) too high and does not match the per-user total (198 h). The last week column reports hours from November in an October report.

### Steps
1. Edit → Time Period → unit **Weeks**, mode **Relative**, option **This Month**. Report Preference → Data Label **Available Hours** → Save.
2. Read the header range, the header summary total, the `.weekNameColumn` labels, the first user row (total and cells), and API `from_date`/`to_date`.

### Expected vs actual

| Layer | Expected | Actual | Result |
| --- | --- | --- | --- |
| Header range | `10-01-2026 to 10-31-2026` (calendar month) | `10-01-2026 to 10-31-2026` | Pass |
| Header total | **198 hours** (22 working days × 9 h) | 225 hours (Oct 1 – Nov 4 = 25 working days × 9 h) | **FAIL** (+27 h) |
| First user row total | 198 h | 198 h | Pass |
| Header total = Σ user totals (1 user shown) | equal | 225 ≠ 198 | **FAIL** |
| Last week bucket end | ≤ Oct 31 | `Oct 29 - Nov 4` | **FAIL**: overruns the range by 4 days (Nov 1–4; Nov 2–4 are working days, 27 h) |
| Last bucket value | 18 h if clipped to Oct 29–31 (Thu, Fri) | 45 h | **FAIL** |
| Bucket alignment | Weeks follow the portal week start (Sunday). Expected buckets: `Oct 1 - Oct 3` 18 h · `Oct 4 - Oct 10` 45 h · `Oct 11 - Oct 17` 45 h · `Oct 18 - Oct 24` 45 h · `Oct 25 - Oct 31` 45 h = 198 h | Buckets start on the range start (Thursday): `Oct 1 - Oct 7` … `Oct 29 - Nov 4`, each 45 h, Σ = 225 h | **FAIL** for the overrun. The Thursday alignment is a **check spec** item, because the spec does not say whether week buckets must start on the portal week start. Either way, buckets must stay inside the range and add up to 198 h. |
| Row internal consistency | Σ week cells = row total | 5 × 45 = 225 ≠ 198 (if the "each 45 h" cells are the first user's row) | **FAIL**: confirm in re-verification that the cells read are the user's row and not only the header. |

### Why this is not expected
The skill's invariant is header total = sum of working days in range × business hours = sum of user rows. 225 h is exactly the availability for Oct 1 – Nov 4. The header is therefore summing the bucket columns (which overrun into November), while the user total is computed on the real Oct 1 – 31 range. The range itself is correct, so the bucketing is the fault.

### Impact
Capacity planning for the month is overstated by one partial week. With more users the gap scales (27 h × users). Week-level cells near the month edges are not comparable with the Days-unit view of the same month.

---

## How to re-verify (live, then automated)

**Before you start:** open Edit on the view under test and record the original settings (view type, unit, mode, option or custom range, view style, data label, show options, description). Restore them at the end and prove the restore by reopening the form. If the toolbar shows "Save as" or a red dot on the view name, saving through Edit will clear those unsaved toolbar changes, so warn the user first.

### Live (Claude in Chrome, shared tab)
1. Reload the report and install `scripts/wl-helper.js` (it defines `window.__wl`).
2. For each case, run `await __wl.run('Relative', '<option>')` after setting the unit (radios need real clicks; get coordinates from `__wl.pos('days'|'weeks')`). Use at most 2–3 saves per javascript call.
3. Record all layers from the result: `header` (period text), `cols` (`n`, `first`, `last`), `req` (`from`, `to`, `tp` from `__wl.lastReq()`; print only these parsed params, never full URLs), `summary`. For Weeks, also record `__wl.weekBuckets()` and `__wl.row1()`. The `before` field of the next run confirms what the reopened form saved.
4. Pass criteria:
   - **WL-D-02:** Last 7 Days → `cols.n = 7`, `first = 10-02-2026`, `req.from` starts `2026-10-02`. This Week → `10-04-2026 … 10-10-2026`. Last Week → `09-27-2026 … 10-03-2026`, and its grid does not contain `10-04-2026`. Also run Next 7 Days, Next Week, Last/Next 180 Days (expected lengths 7 / 7 / 180 / 180).
   - **WL-D-03:** the last item of `weekBuckets()` ends on or before Oct 31. Header summary = 198 hours = first-row total = Σ first-row week cells.
5. To decide functional vs cosmetic: compare the header with the grid and the API. If the API `from_date`/`to_date` also carry the extra day, the defect is functional, not just a label problem. Then reopen Edit and click OK without changes, and check that the saved option and range are unchanged.
6. Report each case as **Confirmed / Not reproduced / Refined**, with the updated severity and evidence from at least 2 layers. Note that the expected dates must be recomputed if the re-check happens on a day other than 8 Oct 2026.

### Automated (Playwright project in `assets/workload-playwright/`)
- Oracle unit tests (no portal needed): `npm run test:unit`. `tests/unit/dates.spec.ts` already pins today = 2026-10-08 and asserts `Last 7 Days = 10-02-2026 to 10-08-2026`, `This Week = 10-04 … 10-10`, `Last Week = 09-27 … 10-03`, weeks do not overlap, October = 198 h, and Oct 1 – Nov 4 = 225 h (the D-03 overrun value).
- Live regression: `ZP_WEEK_START=0 npm run test:defects` runs `WL-D-02 Days-unit relative windows have the right length` and `WL-D-03 Weeks unit buckets stay inside the range and totals agree` (from `tests/workload/defects.spec.ts`). It checks header, API `to_date` and grid length, and it restores the view settings automatically (`preserveViewSettings()`).
- While the defects are open, run with `ZP_EXPECT_KNOWN_DEFECTS=1` so they show as expected failures. Once a fix ships, run without the flag. An "unexpected pass" with the flag set means the defect is fixed.
- Suggested addition: WL-D-02 currently asserts only `to_date`. Add a `from_date` assertion (`p.from.slice(0,10) === ymd(exp[0])`), because the Last 7 Days error is on the **start** side.

### Cleanup
Restore the original view settings and confirm them by reopening Edit. Close the form. Report any side effects (cleared toolbar state, collapsed left nav).
