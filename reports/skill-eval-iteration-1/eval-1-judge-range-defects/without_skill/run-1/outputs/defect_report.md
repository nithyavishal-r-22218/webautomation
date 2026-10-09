# Defect Report: Zoho Projects Workload Report, Date Range and Capacity Totals

| Field | Value |
|---|---|
| Module | Zoho Projects > Reports > Workload |
| Test date ("today") | Thursday, 08 Oct 2026 |
| Portal settings | Week starts **Sunday**; business hours **Mon-Fri, 9 h/day** (45 h per full week) |
| Date format in header | MM-DD-YYYY |
| Reported by | QA (triage written from QA observations) |

## Summary verdict

| # | Observation | Verdict | Severity |
|---|---|---|---|
| D1 | Days > Last 7 Days shows 10-01 to 10-08 (8 day columns) | **Bug**: off-by-one, 8 days instead of 7 | High |
| D2 | Days > This Week = 10-04 to 10-11, Last Week = 09-27 to 10-04 | **Bug**: week end is the next Sunday, so each "week" is 8 days and the two weeks overlap on Oct 4 | High |
| D3 | Weeks > This Month: week columns "Oct 1 - Oct 7" ... "Oct 29 - Nov 4" | **Bug**: buckets are 7-day blocks from the 1st, not Sunday-start weeks, and the last bucket runs past the end of the range into November | Medium |
| D4 | Weeks > This Month: header total "225 hours" but user row total 198 h | **Bug**: header total includes Nov 2-4 (27 h) that are outside the range. **198 h is correct.** | High |
| Q1 | `to_date=2026-10-08T23:59:59.999Z` (UTC suffix) | **Needs confirmation**: correct only if the portal or user time zone is UTC | Low (pending) |

Correct as observed: the This Month header range **10-01-2026 to 10-31-2026** and the first user's row total **198 h**.

---

## Reference calendar (Oct 2026, week starts Sunday)

```
 Sun  Mon  Tue  Wed  Thu  Fri  Sat
                       1    2    3      <- partial week (Sep 27 - Oct 3)
   4    5    6    7   [8]   9   10      <- This Week (today = Thu 8)
  11   12   13   14   15   16   17
  18   19   20   21   22   23   24
  25   26   27   28   29   30   31
```

- October 2026 working days: 22 (Mon 4, Tue 4, Wed 4, Thu 5, Fri 5), so capacity is 22 x 9 = **198 h**
- Nov 1-4 2026 (Sun-Wed) has 3 working days (Nov 2, 3, 4), which is **27 h**. 198 + 27 = **225**, the wrong header total.

---

## D1: "Last 7 Days" covers 8 days

**Severity:** High. Every day-based metric (logged hours, allocation, utilisation) for this preset includes one extra day of data, about 14% more than it should.

**Steps to reproduce**
1. On Thu 08 Oct 2026, open Reports > Workload.
2. View: **Days**. Range: **Relative > Last 7 Days**.
3. Read the header, count the day columns, and look at the data request in DevTools > Network.

**Actual**
- Header: `10-01-2026 to 10-08-2026`
- Grid: 8 day columns (Oct 1, 2, 3, 4, 5, 6, 7, 8)
- Request: `to_date=2026-10-08T23:59:59.999Z` (from_date is presumably Oct 1)

**Expected** (rolling 7 days including today, which matches the observed `to_date` of today 23:59:59.999)
- Header: `10-02-2026 to 10-08-2026`
- Grid: exactly **7** day columns, Oct 2 to Oct 8
- Request: `from_date=2026-10-02T00:00:00.000`, `to_date=2026-10-08T23:59:59.999` (both in the portal time zone, see Q1)
- Working-day capacity for the range: Oct 2 (Fri), 5, 6, 7, 8 = 5 days = **45 h** per user. The buggy range has 6 working days (54 h) because it adds Thu Oct 1.

> If the product spec defines "Last 7 Days" as excluding today, the expected range is `10-01-2026 to 10-07-2026` instead, and `to_date` would also be wrong. Under either definition, an 8-day range is a defect. Check the spec or other Zoho reports (for example Timesheet > Last 7 Days) to pick the right definition.

**Likely cause:** from_date is calculated as `today - 7` instead of `today - 6`, while the end is still inclusive of today.

---

## D2: "This Week" and "Last Week" end on the following Sunday (8-day weeks that overlap)

**Severity:** High. Oct 4 belongs to both Last Week and This Week, so week-over-week comparisons double-count it, and each week shows 8 days of capacity and logged hours.

**Steps to reproduce**
1. Reports > Workload, View: **Days**.
2. Choose **This Week**, then **Last Week**. For each, read the header, count the day columns, and check the request's from_date and to_date.

**Actual**
- This Week: `10-04-2026 to 10-11-2026`
- Last Week: `09-27-2026 to 10-04-2026`

**Expected** (Sunday-start weeks, Sun to Sat inclusive)

| Preset | Header | Day columns | Request (portal TZ) | Capacity / user |
|---|---|---|---|---|
| This Week | `10-04-2026 to 10-10-2026` | 7 (Sun Oct 4 to Sat Oct 10) | `2026-10-04T00:00:00.000` to `2026-10-10T23:59:59.999` | 45 h |
| Last Week | `09-27-2026 to 10-03-2026` | 7 (Sun Sep 27 to Sat Oct 3) | `2026-09-27T00:00:00.000` to `2026-10-03T23:59:59.999` | 45 h |

The two ranges must not share any date.

**Notes for triage**
- If the grid shows 7 columns and the request's to_date is `...-10T23:59:59.999` (or an exclusive `< 10-11T00:00`), the defect is only in the header label: an exclusive end bound is being shown as if it were inclusive. Severity drops to **Medium**.
- If the grid shows 8 columns or the request's to_date is `10-11T23:59:59.999`, the data is wrong too. Keep severity at **High**.
- The extra day is a Sunday (non-working), so capacity may still look like 45 h. Logged or allocated hours on that Sunday will still be counted in both weeks, so do not rely on capacity alone to verify this.

---

## D3: "Weeks" view buckets are not Sunday-start weeks, and the last bucket goes past the range end

**Severity:** Medium (wrong bucketing and labels). It also causes D4, which is High.

**Steps to reproduce**
1. Reports > Workload, View: **Weeks**, Range: **Relative > This Month**.
2. Read the week column headers and each column's capacity.

**Actual**

| Column | Working days | Capacity |
|---|---|---|
| Oct 1 - Oct 7 | 5 | 45 h |
| Oct 8 - Oct 14 | 5 | 45 h |
| Oct 15 - Oct 21 | 5 | 45 h |
| Oct 22 - Oct 28 | 5 | 45 h |
| Oct 29 - **Nov 4** | 5 (incl. Nov 2-4) | 45 h |
| **Sum** | 25 | **225 h** |

**Expected** (weeks aligned to the portal's Sunday start, clipped to the selected range Oct 1-31)

| Column | Working days | Capacity / user |
|---|---|---|
| Oct 1 - Oct 3 (week of Sep 27, partial) | 2 (Thu, Fri) | **18 h** |
| Oct 4 - Oct 10 | 5 | 45 h |
| Oct 11 - Oct 17 | 5 | 45 h |
| Oct 18 - Oct 24 | 5 | 45 h |
| Oct 25 - Oct 31 | 5 | 45 h |
| **Sum** | 22 | **198 h** |

- No column may include a date outside 10-01-2026 to 10-31-2026.
- Each user row's week cells must add up to that row's total.

> Even if the product deliberately buckets in 7-day blocks from the range start (not the portal week start), the last bucket must still be clipped to Oct 29 - Oct 31 (2 working days = 18 h). A bucket that reaches into November is a defect whichever bucketing rule is intended.

---

## D4: Header total "225 hours" disagrees with the row total (198 h) and with the month's capacity

**Severity:** High. The headline capacity figure on the report is 27 h (+13.6%) too high per user, which understates utilisation and is inconsistent with the row data shown right below it.

**Actual**
- Header total: `225 hours`
- First user's row total: `198h`

**Expected**
- Header total for a single-user (or per-user) view: **198 hours**. With N users who all have the same calendar, it is N x 198 h. It must equal the sum of the row totals.
- Row total 198 h is **correct**: 22 working days x 9 h.

**Root cause (derived):** 225 = 5 buckets x 45 h, so the header adds up the D3 week buckets, including Nov 2-4 (3 days x 9 h = 27 h), while the row total is calculated from the real Oct 1-31 range. Fixing D3 (clipping or aligning the buckets) should fix D4, but D4 needs its own check because the header and row use different calculation paths.

---

## Q1: Time-zone suffix on to_date (needs confirmation)

`to_date=2026-10-08T23:59:59.999Z` means end of day in **UTC**. If the portal or user time zone is not UTC (for example Asia/Kolkata, UTC+5:30), end of day Oct 8 local time is `2026-10-08T18:29:59.999Z`. The request as sent would then include entries from 00:00 to 05:29 IST on Oct 9 and leave out entries from the first 5.5 h of the start day.

- **Not a bug if:** the portal time zone is UTC, or the backend ignores the `Z` and reads the value as a local date.
- **Bug (Medium) if:** the portal TZ is not UTC and a time log made early on the day after the range end shows up in the report.

**Re-verify:** check Portal Settings > time zone. Log 1 h at about 01:00 local time on Oct 9 (in a test project), then run Last 7 Days. That hour must **not** appear.

---

## How to re-verify after a fix

Run on **Thu 08 Oct 2026**, or mock the clock or system date to that day. Use the same portal settings: Sunday week start, Mon-Fri 9 h. Use a test user with no leave or holidays in Sep 27 - Nov 7 so that capacity is predictable.

| Check | Where | Pass criteria |
|---|---|---|
| D1 | Days > Relative > Last 7 Days | Header `10-02-2026 to 10-08-2026` (or `10-01 to 10-07` if the spec excludes today); exactly 7 day columns; request from/to matches the header; capacity 45 h/user |
| D2a | Days > This Week | Header `10-04-2026 to 10-10-2026`; 7 columns Sun-Sat; request to_date ends Oct 10 23:59:59.999 (or exclusive Oct 11 00:00) |
| D2b | Days > Last Week | Header `09-27-2026 to 10-03-2026`; 7 columns; no overlap with This Week |
| D2c | Overlap test | Log 2 h on Sun Oct 4. It appears in This Week only, not in Last Week |
| D3 | Weeks > This Month | 5 columns: Oct 1-3, 4-10, 11-17, 18-24, 25-31; capacities 18/45/45/45/45; no November dates |
| D4 | Weeks > This Month | Header total = sum of row totals = 198 h x users; each row's cells add up to its row total |
| Q1 | Network tab | from_date/to_date offsets match the portal TZ (or are documented as local); the boundary time-log test passes |

**Regression edges to include**
- A date where the month starts on a Sunday (for example **Nov 2026**, Nov 1 = Sun). The first week bucket must be a full Nov 1-7.
- A month that ends mid-week (Oct 2026 ends on a Saturday, which is the clean case; **Dec 2026** ends on Thu, so the last bucket must be Dec 27-31).
- Run Last 7 Days and This Week on a **Sunday** (week start) and a **Saturday** (week end) to catch boundary off-by-ones.
- A portal whose week starts **Monday**, to make sure the bucketing follows the setting and is not hard-coded.

**Helper to recompute expected capacity** (offline):

```python
import datetime as d
def cap(a, b, h=9):  # inclusive range, Mon-Fri working days
    return sum(h for i in range((b-a).days+1) if (a+d.timedelta(i)).weekday() < 5)
D=d.date
print(cap(D(2026,10,1), D(2026,10,31)))   # 198
print(cap(D(2026,11,1), D(2026,11,4)))    # 27  -> 198+27 = 225 (buggy header)
print(cap(D(2026,10,2), D(2026,10,8)))    # 45  (correct Last 7 Days)
print(cap(D(2026,10,1), D(2026,10,3)))    # 18  (first Sunday-aligned bucket)
```
