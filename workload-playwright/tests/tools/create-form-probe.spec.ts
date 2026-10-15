import fs from 'fs';
import { test, expect } from '../../src/fixtures';
import { CreateViewPage } from '../../src/pages/CreateViewPage';
import { ZpApi } from '../../src/api';
import { env } from '../../src/env';
import { K, qa } from '../../src/locators';

/**
 * Read-only map of the Create Workload Report form (plus one probe view, created and deleted): every criteria field
 * with its code, conditions (label + code) and value control; time-period options per unit; grouping; data labels per
 * view type and unit; and the exact PUT body of a full create. Output: <reports>/create-form-map.json.
 */
test('map the create form', async ({ wl }) => {
  test.setTimeout(3600_000);
  const page = wl.page, api = new ZpApi(page, wl.d);
  const cv = new CreateViewPage(page);
  const OUT = `${env.reportsDir}/create-form-map.json`;
  // ZP_PROBE_CREATE_ONLY=1 keeps the saved map and runs only the full create
  const createOnly = process.env.ZP_PROBE_CREATE_ONLY === '1' && fs.existsSync(OUT);
  const map: Record<string, any> = createOnly ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { portal: env.portal, at: new Date().toISOString() };
  const save = () => { fs.mkdirSync(env.reportsDir, { recursive: true }); fs.writeFileSync(`${env.reportsDir}/create-form-map.json`, JSON.stringify(map, null, 1)); };
  if (!createOnly) {
  await cv.open(wl);

  // defaults of an untouched form
  await cv.openTab('determiner');
  const crit = { rows: await cv.rows().count(), field: await cv.value(cv.fieldSel(0)), condition: await cv.value(cv.condSel(0)) };
  map.defaults = { ...(await cv.formState()), ...crit };
  save();

  // criteria: every field × every condition
  await cv.openTab('determiner');
  const fields = await cv.selectOptions(cv.fieldSel(0));
  map.fields = [];
  for (const f of fields) {
    await cv.choose(cv.fieldSel(0), f);
    const entry: any = { label: f, code: await cv.value(cv.fieldSel(0)), conditions: [] };
    const conds = await cv.selectOptions(cv.condSel(0));
    for (const c of conds) {
      await cv.choose(cv.condSel(0), c);
      entry.conditions.push({ label: c, code: await cv.value(cv.condSel(0)), value: await cv.describeValue(0).catch(e => ({ kind: `error ${String(e).slice(0, 60)}`, options: [], tabs: [] })) });
    }
    map.fields.push(entry); save();
  }

  // time period options per unit
  map.timePeriod = {};
  for (const u of ['days', 'weeks', 'months'] as const) {
    await cv.setUnit(u);
    map.timePeriod[u] = { relative: await cv.relativeOptions() };
  }
  // grouping
  await cv.openTab('grouping');
  map.grouping = { fields: await cv.selectOptions(cv.groupSelects().nth(0)) };
  await cv.choose(cv.groupSelects().nth(0), 'Roles');
  map.grouping.orders = await cv.selectOptions(cv.groupSelects().nth(1));
  await cv.choose(cv.groupSelects().nth(0), 'None');
  // data labels per view type × unit
  map.dataLabels = {};
  for (const vt of ['bar', 'heatmap', 'timeline'] as const) for (const u of ['days', 'weeks', 'months'] as const) {
    await cv.setViewType(vt); await cv.setUnit(u);
    map.dataLabels[`${vt}/${u}`] = await cv.dataLabelOptions();
  }
  save();
  await qa(page, K.cancel).click();
  }

  // one full create: criteria, grouping, share with a user, show in one project — then read back and delete
  await wl.goto(); await cv.open(wl);
  const name = `${env.runId}-probe`;
  const idOf = async (n: string) => { const v = [...(await api.allViews()).values()].find(x => x.name === n); return v ? String(v.custom_view_id || v.id) : ''; };
  let id = '';
  try {
    await cv.setName(name); await cv.setDescription('probe: full create body');
    await cv.setViewType('bar');
    await cv.criterion(0, 'Allocation Type', 'Is', ['Over-Allocated']);
    await cv.addRow();
    await cv.criterion(1, 'Priority', 'Is', ['High']);
    await cv.grouping('Roles', 'Desc');
    await cv.setUnit('weeks');
    await cv.setDataLabel('Allocated Hours');
    await cv.reportsFor('users');
    await cv.share('users', ['Vishal customprofile']);
    await cv.otherProjects('projects', ['UIAutomation_Workload_Project2']);
    const r = await cv.create();
    map.createPut = { status: r.put.status(), body: r.body, response: (await r.put.text()).slice(0, 2000) };
    id = r.id || await idOf(name);
    map.createdView = id ? await api.view(id) : null;
    save();
    expect(r.put.status(), 'create → 201').toBe(201);
  } finally {
    if (!id) id = await idOf(name);
    if (id) expect([200, 204], 'probe view deleted').toContain((await api.deleteView(id)).status());
  }
});
