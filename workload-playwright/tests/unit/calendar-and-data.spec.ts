import { test, expect } from '@playwright/test';
import { expectedRange, headerText, availableHours, holidaysFromMeta, parseMDY, type Range } from '../../src/dates';
import { loadFixture, expectedDaily, caseKeys, label } from '../../src/expected';

// Thursday 8 Oct 2026.
const today = new Date(2026, 9, 8);
const nine = { '1': 540, '2': 540, '3': 540, '4': 540, '5': 540 };
const r = (a: string, b: string): Range => [parseMDY(a), parseMDY(b)];

test.describe('portals whose week starts on Monday (ZP_WEEK_START=1)', () => {
  const cases: [string, string, string][] = [
    ['days', 'This Week', '10-05-2026 to 10-11-2026'],
    ['days', 'Last Week', '09-28-2026 to 10-04-2026'],
    ['days', 'Next Week', '10-12-2026 to 10-18-2026'],
    ['weeks', 'Next 2 Weeks', '10-05-2026 to 10-18-2026'],
    ['weeks', 'Last 2 Weeks', '09-28-2026 to 10-11-2026'],
  ];
  for (const [unit, opt, header] of cases)
    test(`${unit} / ${opt}`, () => expect(headerText(expectedRange(unit as 'days', opt, today, 1))).toBe(header));
  test('Days-unit N-day windows do not depend on week start', () =>
    expect(headerText(expectedRange('days', 'Last 7 Days', today, 1))).toBe(headerText(expectedRange('days', 'Last 7 Days', today, 0))));
});

test.describe('holidays from workload meta', () => {
  test('strings and objects in any common date format', () => {
    const meta = { default_business_hours_details: { holidays: ['2026-10-02', '20261026', '12-25-2026', { date: '2026-11-30' }, { holiday_date: '2026-12-31T00:00:00Z' }, { name: 'no date' }, 42] } };
    expect(holidaysFromMeta(meta)).toEqual(['10-02-2026', '10-26-2026', '12-25-2026', '11-30-2026', '12-31-2026']);
  });
  test('empty or missing list', () => { expect(holidaysFromMeta(undefined)).toEqual([]); expect(holidaysFromMeta({})).toEqual([]); });
  test('holidays reduce available hours (Oct 2026 with 2 holidays = 180 h)', () =>
    expect(availableHours(r('10-01-2026', '10-31-2026'), nine, holidaysFromMeta({ default_business_hours_details: { holidays: ['2026-10-02', '2026-10-26'] } }))).toBe(180));
  test('a holiday on a weekend changes nothing', () =>
    expect(availableHours(r('10-01-2026', '10-31-2026'), nine, ['10-03-2026'])).toBe(198));
});

test.describe('real-data fixture (Q4 2026 import) — expected values', () => {
  const fx = loadFixture();
  const E = expectedDaily(fx);
  const month = (owner: string, mm: string) => [...E].filter(([k]) => k.startsWith(`${owner}|2026${mm}`)).reduce((s, [, v]) => s + v, 0);
  test('111 tasks and 111 cases', () => { expect(fx.tasks).toHaveLength(111); expect(fx.cases).toHaveLength(111); });
  test('525 owner-day checks across all cases (same as the verified browser run)', () =>
    expect(fx.cases.reduce((s, c) => s + caseKeys(fx, c).length, 0)).toBe(525));
  test('monthly totals match the verified run (new file only)', () => {
    expect(month('Vishal PLAdmin', '10')).toBe(8145);
    expect(month('vishal PL manager', '10')).toBe(7200);
    expect(month('Vishal plemployee', '10')).toBe(8100); // 135 h
  });
  test('labels follow 540-minute availability', () => {
    expect([label(0, 540), label(270, 540), label(540, 540), label(810, 540)]).toEqual([null, 'under', 'optimal', 'over']);
  });
  test('every user has over, optimal, under and unallocated weeks in each month', () => {
    const owners = [...new Set(fx.cases.filter(c => c.kind === 'week').map(c => c.id.replace(/ (Oct|Nov|Dec) W\d.*$/, '')))];
    for (const o of owners) for (const mon of ['Oct', 'Nov', 'Dec']) {
      const states = fx.cases.filter(c => c.kind === 'week' && c.id.startsWith(`${o} ${mon} `)).map(c => c.id.replace(/^.* W\d /, '').replace(/ \(no task\)$/, ''));
      expect(new Set(states), `${o} ${mon}`).toEqual(new Set(['Over-allocated', 'Optimally allocated', 'Under-allocated', 'Unallocated']));
    }
  });
});
