/**
 * Date oracle for the Workload Report. Everything is computed from "today" and the portal's settings,
 * so the same tests work in any portal on any day.
 */
export type Unit = 'days' | 'weeks' | 'months';
export type Range = [Date, Date];

const at = (y: number, m: number, d: number) => new Date(y, m, d);
export const addDays = (x: Date, n: number) => at(x.getFullYear(), x.getMonth(), x.getDate() + n);
export const startOfDay = (x: Date) => at(x.getFullYear(), x.getMonth(), x.getDate());
export const startOfWeek = (x: Date, weekStart = 0) => addDays(startOfDay(x), -((x.getDay() - weekStart + 7) % 7));

/** MM-DD-YYYY, the format the header (`topbar_calendar`) and column tooltips use. */
export const fmt = (d: Date) =>
  `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
export const parseMDY = (s: string) => { const [m, d, y] = s.split('-').map(Number); return at(y, m - 1, d); };

/**
 * Date order the UI shows (header, custom-range input, picker): it follows the user's date-format setting —
 * customworkload shows DD-MM-YYYY, other portals MM-DD-YYYY. Set once per page by WorkloadPage.goto()
 * (ZP_DATE_ORDER, else detectDateOrder on the header). fmt/parseMDY stay MM-DD-YYYY for internal keys.
 */
export type DateOrder = 'mdy' | 'dmy';
let shownOrder: DateOrder = 'mdy';
export const setDateOrder = (o: DateOrder) => { shownOrder = o; };
export const dateOrder = () => shownOrder;
export const shown = (d: Date) => {
  const mm = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return shownOrder === 'dmy' ? `${dd}-${mm}-${d.getFullYear()}` : `${mm}-${dd}-${d.getFullYear()}`;
};
export const parseShown = (s: string) => {
  const [a, b, y] = s.split('-').map(Number);
  return shownOrder === 'dmy' ? at(y, b - 1, a) : at(y, a - 1, b);
};
/**
 * Order of a period such as "04-10-2026 to 11-10-2026" (ported from the Java suite's orderOf): a first part
 * above 12 means day-month, a second part above 12 means month-day; otherwise the reading that gives a valid,
 * shorter span wins. Month-day-year when undecidable.
 */
export function detectDateOrder(period: string): DateOrder {
  const dates = period.match(/\d{2}-\d{2}-\d{4}/g) ?? [];
  for (const d of dates) {
    if (Number(d.slice(0, 2)) > 12) return 'dmy';
    if (Number(d.slice(3, 5)) > 12) return 'mdy';
  }
  if (dates.length >= 2) {
    const span = (o: DateOrder) => {
      const p = (s: string) => { const [a, b, y] = s.split('-').map(Number); return o === 'dmy' ? at(y, b - 1, a) : at(y, a - 1, b); };
      const [x, z] = [p(dates[0]!), p(dates[1]!)];
      return isNaN(x.getTime()) || isNaN(z.getTime()) ? -1 : (z.getTime() - x.getTime()) / 864e5;
    };
    const dm = span('dmy'), md = span('mdy');
    if (dm >= 0 && (md < 0 || dm < md)) return 'dmy';
  }
  return 'mdy';
}
export const headerText = ([a, b]: Range) => `${shown(a)} to ${shown(b)}`;
export const daysInclusive = ([a, b]: Range) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 864e5) + 1;

export class NoRuleError extends Error {}

/**
 * Expected window for a Relative option. Throws NoRuleError when the spec does not define the option,
 * so a test can mark it "check spec" instead of passing on a guess.
 */
export function expectedRange(unit: Unit, option: string, today: Date, weekStart = 0): Range {
  const t = startOfDay(today);
  const sow = startOfWeek(t, weekStart);
  const y = t.getFullYear(), m = t.getMonth();
  const n = Number(option.match(/\d+/)?.[0] ?? 0);
  const last = option.startsWith('Last'), next = option.startsWith('Next');

  switch (option) {
    case 'This Week': return [sow, addDays(sow, 6)];
    case 'Last Week': return [addDays(sow, -7), addDays(sow, -1)];
    case 'Next Week': return [addDays(sow, 7), addDays(sow, 13)];
    case 'This Month': return [at(y, m, 1), at(y, m + 1, 0)];
    case 'Last Month': return [at(y, m - 1, 1), at(y, m, 0)];
    case 'Next Month': return [at(y, m + 1, 1), at(y, m + 2, 0)];
  }
  if (/ Days$/.test(option) && (last || next)) return last ? [addDays(t, -(n - 1)), t] : [t, addDays(t, n - 1)];
  if (unit === 'weeks' && / Weeks$/.test(option)) return last ? [addDays(sow, -7 * (n - 1)), addDays(sow, 6)] : [sow, addDays(sow, 7 * n - 1)];
  if (unit === 'months' && / Months$/.test(option)) return last ? [at(y, m - n + 1, 1), at(y, m + 1, 0)] : [at(y, m, 1), at(y, m + n, 0)];
  throw new NoRuleError(`No spec rule for ${unit} / "${option}" (e.g. Days > Last 3 Months is rolling today, not calendar months) — confirm with product`);
}

/**
 * Available hours in a range from the portal's business hours:
 * meta.default_business_hours_details.working_day_availability = { "<ISO weekday 1 = Mon … 7 = Sun>": minutes }
 * (as the Java suite's WorkloadReportApi verified: 22 working days in October 2026).
 * Holidays from the same object are excluded.
 */
export function availableHours(range: Range, workingDayMinutes: Record<string, number>, holidays: string[] = []): number {
  const hol = new Set(holidays);
  let minutes = 0;
  for (let d = startOfDay(range[0]); d <= range[1]; d = addDays(d, 1)) {
    if (hol.has(fmt(d))) continue;
    minutes += workingDayMinutes[String(d.getDay() || 7)] ?? 0;
  }
  return minutes / 60;
}

/**
 * Holidays from workload meta (`default_business_hours_details.holidays`) as MM-DD-YYYY strings.
 * Accepts plain strings or objects with a date-like field, in YYYY-MM-DD, YYYYMMDD or MM-DD-YYYY form,
 * so availableHours() stays correct in portals that do have a holiday list.
 */
export function holidaysFromMeta(meta: { default_business_hours_details?: { holidays?: unknown[] } } | undefined): string[] {
  const raw = meta?.default_business_hours_details?.holidays ?? [];
  const toMDY = (s: string): string | null => {
    let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/); if (m) return `${m[2]}-${m[3]}-${m[1]}`;
    m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/); if (m) return s;
    return null;
  };
  const out: string[] = [];
  for (const h of raw) {
    if (typeof h === 'string') { const v = toMDY(h); if (v) out.push(v); continue; }
    if (h && typeof h === 'object') for (const k of ['date', 'holiday_date', 'start_date', 'from']) {
      const v = (h as Record<string, unknown>)[k]; if (typeof v === 'string' && toMDY(v)) { out.push(toMDY(v)!); break; }
    }
  }
  return out;
}
