import { test, expect, knownDefect, preserveViewSettings } from '../../src/fixtures';
import { dataRequestParams } from '../../src/discover';
import { env } from '../../src/env';
import { expectedRange, headerText, fmt, daysInclusive, availableHours, holidaysFromMeta, parseMDY, shown, type Range } from '../../src/dates';

/** Regression checks for the defects found on 8 Oct 2026. Tagged @defect: `npm run test:defects`. */
test.describe.configure({ mode: 'serial' });
preserveViewSettings();

const today = new Date();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('WL-D-02 Days-unit relative windows have the right length @defect', async ({ wl, edit }) => {
  knownDefect('WL-D-02', 'Days-unit relative ranges are one day too long');
  for (const option of ['Last 7 Days', 'Next 7 Days', 'This Week', 'Last Week', 'Next Week', 'Last 180 Days', 'Next 180 Days']) {
    await test.step(option, async () => {
      await edit.openEdit(); await edit.setUnit('days'); await edit.setRelative(option);
      const { data } = await edit.save();
      const exp = expectedRange('days', option, today, env.weekStart);
      const p = dataRequestParams(data);
      const cols = await wl.gridDates();
      expect.soft(await wl.page.locator('[data-zpqa="topbar_calendar"]').innerText(), `${option} header`).toBe(headerText(exp));
      expect.soft(p.from.slice(0, 10), `${option} API from_date`).toBe(ymd(exp[0]));
      expect.soft(p.to.slice(0, 10), `${option} API to_date`).toBe(ymd(exp[1]));
      expect.soft(cols.length, `${option} grid days`).toBe(daysInclusive(exp));
    });
  }
  // Last Week must end before This Week starts
  const thisW = expectedRange('days', 'This Week', today, env.weekStart);
  await edit.openEdit(); await edit.setRelative('Last Week'); await edit.save();
  const lastCols = await wl.gridDates();
  expect(lastCols, 'Last Week overlaps This Week').not.toContain(shown(thisW[0]));
});

test('WL-D-03 Weeks unit buckets stay inside the range and totals agree @defect', async ({ wl, edit }) => {
  knownDefect('WL-D-03', 'Weeks unit buckets weeks from range start and overruns the range end');
  await edit.openEdit(); await edit.setUnit('weeks'); await edit.setRelative('This Month'); await edit.setDataLabel('Available Hours');
  const { data } = await edit.save();
  const p = dataRequestParams(data);
  const range: Range = [new Date(p.from.slice(0, 10) + 'T00:00:00'), new Date(p.to.slice(0, 10) + 'T00:00:00')];
  const buckets = await wl.weekBuckets();
  test.info().annotations.push({ type: 'buckets', description: buckets.join(' | ') });
  const lastEnd = buckets.at(-1)!.split(' - ')[1];
  const lastEndDate = new Date(`${lastEnd} ${range[1].getFullYear()}`);
  expect.soft(lastEndDate.getTime(), 'last week bucket ends inside the range').toBeLessThanOrEqual(range[1].getTime());
  const s = await wl.summary();
  const expectedHours = availableHours(range, wl.d.meta!.default_business_hours_details.working_day_availability, holidaysFromMeta(wl.d.meta));
  expect.soft(s.value, 'header total = available hours in range').toBe(expectedHours);
  const rowTotal = parseFloat((await wl.firstRowValues())[0]);
  expect.soft(rowTotal, 'first user row total = available hours in range').toBe(expectedHours);
});

test('WL-D-05 header summary unit follows the data label @defect', async ({ wl, edit }) => {
  knownDefect('WL-D-05', 'Header summary stays in hours for Minutes and Available Man Weeks');
  await edit.openEdit(); await edit.setUnit('weeks'); await edit.setRelative('This Month'); await edit.save();
  for (const [label, unit] of [['Allocated Minutes', /min/i], ['Available Minutes', /min/i], ['Available Man Weeks', /Man Weeks/i]] as const) {
    await edit.openEdit(); await edit.setDataLabel(label); await edit.save();
    expect.soft((await wl.summary()).unit, label).toMatch(unit);
  }
});

test('WL-D-06 custom month picker opens the end panel on the end year @defect', async ({ edit, page }) => {
  knownDefect('WL-D-06', 'End calendar shows the start year');
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear() + 1, 2, 31);
  await edit.openEdit(); await edit.setUnit('months');
  await edit.setCustom('months', start, end);
  const saved = await (await edit.rangeInput()).inputValue();
  await (await edit.rangeInput()).click();
  const years = await page.getByText(/^\d{4}$/).filter({ visible: true }).allInnerTexts();
  expect.soft(years.at(-1), 'end panel year').toBe(String(end.getFullYear()));
  await page.getByText('OK', { exact: true }).filter({ visible: true }).click();
  expect(await (await edit.rangeInput()).inputValue(), 'saved range unchanged (cosmetic only)').toBe(saved);
  await edit.cancel();
});

test('WL-D-04 percentage summary matches the cells @defect', async ({ wl, edit }) => {
  knownDefect('WL-D-04', 'Percentage summary shows an unexplained value');
  await edit.openEdit(); await edit.setUnit('months'); await edit.setRelative('Next 3 Months'); await edit.setDataLabel('Available Percentage'); await edit.save();
  const cells = (await wl.firstRowValues()).slice(1).map(c => parseFloat(c));
  const s = await wl.summary();
  if (cells.length && cells.every(c => c === cells[0])) expect.soft(s.value, 'summary % equals the uniform cell %').toBe(cells[0]);
  void parseMDY;
});
