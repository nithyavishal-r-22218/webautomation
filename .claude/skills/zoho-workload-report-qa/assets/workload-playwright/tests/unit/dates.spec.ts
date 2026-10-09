import { test, expect } from '@playwright/test';
import { expectedRange, headerText, daysInclusive, availableHours, NoRuleError, fmt, parseMDY, detectDateOrder, setDateOrder, shown, parseShown } from '../../src/dates';

// Reference day of the live runs: Thursday 8 Oct 2026, weeks start on Sunday, Mon–Fri 9 h.
const today = new Date(2026, 9, 8);
const nineHours = { '1': 540, '2': 540, '3': 540, '4': 540, '5': 540 };

test.describe('expectedRange — Days unit', () => {
  const cases: [string, string][] = [
    ['Last 7 Days', '10-02-2026 to 10-08-2026'],
    ['Next 7 Days', '10-08-2026 to 10-14-2026'],
    ['Last 180 Days', '04-12-2026 to 10-08-2026'],
    ['Next 180 Days', '10-08-2026 to 04-05-2027'],
    ['This Week', '10-04-2026 to 10-10-2026'],
    ['Last Week', '09-27-2026 to 10-03-2026'],
    ['Next Week', '10-11-2026 to 10-17-2026'],
    ['This Month', '10-01-2026 to 10-31-2026'],
    ['Last Month', '09-01-2026 to 09-30-2026'],
    ['Next Month', '11-01-2026 to 11-30-2026'],
  ];
  for (const [opt, header] of cases) test(opt, () => expect(headerText(expectedRange('days', opt, today))).toBe(header));

  test('N-day windows are exactly N days', () => {
    for (const opt of ['Last 7 Days', 'Next 7 Days', 'Last 180 Days', 'Next 180 Days'])
      expect(daysInclusive(expectedRange('days', opt, today)), opt).toBe(Number(opt.match(/\d+/)![0]));
  });
  test('weeks never overlap', () => {
    const last = expectedRange('days', 'Last Week', today), cur = expectedRange('days', 'This Week', today);
    expect(last[1].getTime()).toBeLessThan(cur[0].getTime());
  });
  test('rolling 3-month options have no rule until the spec says so', () => {
    expect(() => expectedRange('days', 'Last 3 Months', today)).toThrow(NoRuleError);
  });
});

test.describe('expectedRange — Weeks and Months units (matches the live portal)', () => {
  const cases: [string, string, string][] = [
    ['weeks', 'Last 7 Weeks', '08-23-2026 to 10-10-2026'],
    ['weeks', 'Next 7 Weeks', '10-04-2026 to 11-21-2026'],
    ['weeks', 'Last 15 Weeks', '06-28-2026 to 10-10-2026'],
    ['weeks', 'Next 15 Weeks', '10-04-2026 to 01-16-2027'],
    ['weeks', 'Last 25 Weeks', '04-19-2026 to 10-10-2026'],
    ['weeks', 'Next 25 Weeks', '10-04-2026 to 03-27-2027'],
    ['months', 'Last 3 Months', '08-01-2026 to 10-31-2026'],
    ['months', 'Next 3 Months', '10-01-2026 to 12-31-2026'],
    ['months', 'Last 6 Months', '05-01-2026 to 10-31-2026'],
    ['months', 'Next 6 Months', '10-01-2026 to 03-31-2027'],
  ];
  for (const [unit, opt, header] of cases)
    test(`${unit} / ${opt}`, () => expect(headerText(expectedRange(unit as 'weeks', opt, today))).toBe(header));
});

test.describe('availableHours from business hours', () => {
  const r = (a: string, b: string) => [parseMDY(a), parseMDY(b)] as [Date, Date];
  test('October 2026 = 22 working days = 198 h', () => expect(availableHours(r('10-01-2026', '10-31-2026'), nineHours)).toBe(198));
  test('Weeks bucket overrun (D-03): Oct 1 – Nov 4 = 225 h', () => expect(availableHours(r('10-01-2026', '11-04-2026'), nineHours)).toBe(225));
  test('custom Oct 12 – Nov 6 = 180 h', () => expect(availableHours(r('10-12-2026', '11-06-2026'), nineHours)).toBe(180));
  test('holidays are excluded', () => expect(availableHours(r('10-01-2026', '10-31-2026'), nineHours, ['10-02-2026'])).toBe(189));
  test('fmt/parse round-trip', () => expect(fmt(parseMDY('03-31-2027'))).toBe('03-31-2027'));
});

test.describe('UI date order (day-month portals such as customworkload)', () => {
  test.afterEach(() => setDateOrder('mdy'));
  test('a day above 12 → dmy', () => expect(detectDateOrder('31-10-2026 to 06-11-2026')).toBe('dmy'));
  test('a month-day date → mdy', () => expect(detectDateOrder('10-31-2026 to 11-06-2026')).toBe('mdy'));
  test('ambiguous: the valid, shorter span wins', () => expect(detectDateOrder('04-10-2026 to 11-10-2026')).toBe('dmy'));
  test('undecidable → mdy', () => expect(detectDateOrder('no dates')).toBe('mdy'));
  test('dmy header text and parse round-trip', () => {
    setDateOrder('dmy');
    expect(headerText([new Date(2026, 9, 4), new Date(2026, 9, 11)])).toBe('04-10-2026 to 11-10-2026');
    expect(shown(parseShown('31-10-2026'))).toBe('31-10-2026');
  });
});
