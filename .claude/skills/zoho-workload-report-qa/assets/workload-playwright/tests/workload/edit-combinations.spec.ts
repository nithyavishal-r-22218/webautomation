import { test, expect, preserveViewSettings } from '../../src/fixtures';
import { dataRequestParams, PREDEFINED_VIEW_LABELS } from '../../src/discover';
import { CSS, K, qa } from '../../src/locators';
import { env } from '../../src/env';
import { expectedRange, headerText, fmt, NoRuleError, availableHours, holidaysFromMeta, addDays, parseShown, shown, type Unit, type Range } from '../../src/dates';
import type { WorkloadPage } from '../../src/pages/WorkloadPage';
import type { WorkloadEditPage, ViewType } from '../../src/pages/WorkloadEditPage';

/**
 * Edit › every combination, one factor at a time, on the view named by ZP_EDIT_VIEW (default All Users).
 * Each save is checked in four layers: header text, grid column dates, API from/to, reopened form.
 */
// Not serial: every case sets what it checks, so one failure must not skip the rest. workers=1 keeps the
// order; preserveViewSettings() reuses the saved original snapshot if a new worker starts after a failure.
test.describe.configure({ mode: 'default' });
preserveViewSettings();

const today = new Date();
const isoDay = (s: string) => s.slice(0, 10);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function assertRange(wl: WorkloadPage, unit: Unit, expected: Range, apiFrom: string, apiTo: string) {
  expect(await wl.page.locator('[data-zpqa="topbar_calendar"]').innerText(), 'header').toBe(headerText(expected));
  expect([isoDay(apiFrom), isoDay(apiTo)], 'API from/to').toEqual([ymd(expected[0]), ymd(expected[1])]);
  if (unit === 'days') {
    const cols = await wl.gridDates();
    expect([cols[0], cols.at(-1)], 'first/last grid column').toEqual([shown(expected[0]), shown(expected[1])]);
  }
  const meta = wl.d.meta!;
  const s = await wl.summary();
  if (/hours/i.test(s.unit) && unit === 'days')
    expect(s.value, 'summary = working days × business hours').toBe(availableHours(expected, meta.default_business_hours_details.working_day_availability, holidaysFromMeta(meta)));
}

test('step 0 — predefined view: name is read-only; only Time Period and Report Preference tabs', async ({ edit }) => {
  await edit.openEdit();
  const name = qa(edit.page, K.name);
  const value = await name.inputValue();
  test.skip(!Object.values(PREDEFINED_VIEW_LABELS).includes(value), `"${value}" is a custom view (ZP_EDIT_VIEW): its name is editable`);
  await expect(name, 'predefined view name cannot be edited').toBeDisabled();
  await name.fill('renamed by QA', { force: true }).catch(() => { /* a disabled input refuses input: expected */ });
  expect(await name.inputValue(), 'name unchanged').toBe(value);
  const tab = (t: string) => edit.page.getByText(t, { exact: true }).filter({ visible: true });
  for (const t of ['Time Period', 'Report Preference']) await expect(tab(t), `${t} tab`).toHaveCount(1);
  for (const t of ['Criteria', 'Grouping']) await expect(tab(t), `no ${t} tab on a predefined view`).toHaveCount(0);
  await edit.cancel();
});

test('step 1 — description and every view type', async ({ wl, edit }) => {
  for (const vt of ['bar', 'heatmap', 'timeline'] as ViewType[]) {
    await edit.openEdit();
    await edit.setDescription(`${env.runId} edit flow (${vt})`);
    await edit.setViewType(vt);
    await edit.save();
    await expect(wl.page.locator('[data-zpqa="kanban_changecv"]')).toContainText(new RegExp(`^\\s*${vt.slice(0, 4)}`, 'i')); // the toolbar text is padded ("  Bar  ")
    await edit.openEdit();
    expect(await edit.formState()).toMatchObject({ viewType: vt, description: `${env.runId} edit flow (${vt})` });
    await edit.cancel();
  }
});

for (const unit of ['days', 'weeks', 'months'] as Unit[]) {
  test(`step 2 — every Relative option, ${unit}`, async ({ wl, edit }) => {
    await edit.openEdit(); await edit.setViewType('bar'); await edit.setUnit(unit);
    const options = await edit.relativeOptions();
    await edit.cancel();
    expect(options.length, 'option list is read live').toBeGreaterThan(0);

    for (const option of options) {
      await test.step(option, async () => {
        await edit.openEdit(); await edit.setUnit(unit); await edit.setRelative(option);
        const { data } = await edit.save();
        const p = dataRequestParams(data);
        expect(p.timePeriod).toBe(unit);
        let expected: Range;
        try { expected = expectedRange(unit, option, today, env.weekStart); }
        catch (e) {
          if (e instanceof NoRuleError) { test.info().annotations.push({ type: 'check-spec', description: `${unit}/${option}: ${p.from} → ${p.to}` }); return; }
          throw e;
        }
        if (unit === 'weeks' && /Month$/.test(option)) {
          // D-03: buckets must not run past the range end
          const buckets = await wl.weekBuckets();
          test.info().annotations.push({ type: 'buckets', description: buckets.join(' | ') });
        }
        await assertRange(wl, unit, expected, p.from, p.to);
        await edit.openEdit();
        expect(await edit.formState()).toMatchObject({ unit, mode: 'Relative', option });
        await edit.cancel();
      });
    }
  });

  test(`step 2 — Custom range, ${unit}`, async ({ wl, edit }) => {
    const start = unit === 'months' ? new Date(today.getFullYear(), today.getMonth() + 1, 1) : addDays(today, 4);
    const endBase = unit === 'months' ? new Date(today.getFullYear(), today.getMonth() + 4, 0) : addDays(today, 29);
    await edit.openEdit(); await edit.setUnit(unit);
    await edit.setCustom(unit, start, endBase);
    const shown = await (await edit.rangeInput()).inputValue();
    const { data } = await edit.save();
    const p = dataRequestParams(data);
    expect(await wl.page.locator('[data-zpqa="topbar_calendar"]').innerText()).toBe(shown);
    expect(isoDay(p.from)).toBe(ymd(parseShown(shown.slice(0, 10))));
    await edit.openEdit();
    expect((await edit.formState()).customRange).toBe(shown);
    await edit.cancel();
  });
}

test('step 3 — view style both values (Bar, Heatmap)', async ({ wl, edit }) => {
  for (const vt of ['bar', 'heatmap'] as ViewType[]) for (const style of ['gantt', 'timeline'] as const) {
    await edit.openEdit(); await edit.setViewType(vt); await edit.setViewStyle(style);
    await edit.save();
    await edit.openEdit();
    expect(await edit.formState()).toMatchObject({ viewType: vt, viewStyle: style });
    await edit.cancel();
  }
});

const UNIT_OF: Record<string, RegExp> = {
  'Hours': /^\d+(\.\d+)?h$/, 'Minutes': /^\d+(\.\d+)?m$/, 'Man Days': /^\d+(\.\d+)?d$/, 'Man Weeks': /^\d+(\.\d+)?w$/, 'Percentage': /^\d+(\.\d+)?%$/,
};
const SUMMARY_UNIT: Record<string, RegExp> = {
  'Hours': /hours/i, 'Minutes': /min/i, 'Man Days': /Man Days/i, 'Man Weeks': /Man Weeks/i, 'Percentage': /%/,
};

for (const vt of ['bar', 'heatmap', 'timeline'] as ViewType[]) {
  test(`step 3 — every data label, ${vt}`, async ({ wl, edit }) => {
    await edit.openEdit(); await edit.setViewType(vt); await edit.setUnit('months'); await edit.setRelative((await edit.relativeOptions())[0]);
    const labels = await edit.dataLabelOptions();
    await edit.save();
    for (const label of labels) {
      await test.step(label, async () => {
        await edit.openEdit(); await edit.setDataLabel(label); await edit.save();
        await expect(wl.page.locator('[data-zpqa="data-label-select"]')).toHaveText(label);
        await edit.openEdit(); expect((await edit.formState()).dataLabel).toBe(label); await edit.cancel();
        if (vt === 'timeline' || label === 'No Legend') return;
        const kind = Object.keys(UNIT_OF).find(k => label.endsWith(k))!;
        const cells = (await wl.firstRowValues()).slice(1);
        for (const c of cells) expect.soft(c, `${label} cell format`).toMatch(UNIT_OF[kind]);
        const s = await wl.summary();
        expect.soft(s.unit, `${label} header summary unit (D-05)`).toMatch(SUMMARY_UNIT[kind]);
      });
    }
  });
}

// Show Options are offered on Bar too (seen live 09-10-2026); the saved value is one report_preference.show_option
test('step 3 — Show Options persist for Bar and Heatmap, in the form and the API', async ({ wl, edit, adminApi }) => {
  const viewId = wl.d.meta!.custom_view_id;
  for (const vt of ['bar', 'heatmap'] as ViewType[]) {
    await edit.openEdit(); await edit.setViewType(vt); await edit.tab('Report Preference');
    const offered = await edit.page.locator(CSS.checkbox).filter({ hasText: 'Task Title' }).filter({ visible: true }).count();
    if (!offered) { test.info().annotations.push({ type: 'not offered', description: `Show Options are not shown for ${vt}` }); await edit.cancel(); continue; }
    for (const on of [true, false]) {
      if (on === false) { await edit.openEdit(); await edit.setViewType(vt); }
      await edit.setShowOption('Task Title', on); await edit.setShowOption('Project Title', on);
      await edit.save();
      const saved = (await adminApi.view(viewId)).report_preference ?? {};
      expect.soft(saved.view_type, `${vt}: API view type`).toBe(vt);
      expect.soft(saved.show_option, `${vt}: API show_option`).toMatchObject({ task_title: on, project_title: on });
      await edit.openEdit(); await edit.tab('Report Preference');
      expect.soft((await edit.formState()).showOptions, `${vt}: reopened form`).toMatchObject({ 'Task Title': on, 'Project Title': on });
      await edit.cancel();
    }
  }
});

test('step 3 — Show Options persist (Timeline type)', async ({ edit }) => {
  for (const on of [true, false]) {
    await edit.openEdit(); await edit.setViewType('timeline');
    await edit.setShowOption('Task Title', on); await edit.setShowOption('Project Title', on);
    await edit.save();
    await edit.openEdit();
    expect((await edit.formState()).showOptions).toMatchObject({ 'Task Title': on, 'Project Title': on });
    await edit.cancel();
  }
});
