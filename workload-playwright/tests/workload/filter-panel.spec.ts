import { test, expect } from '../../src/fixtures';
import { K, qa } from '../../src/locators';
import { FilterPanel, criteriaOf } from '../../src/pages/FilterPanel';
import { assertSavedViewUnchanged, clearAndDiscard, findSection, readTruth, STANDARD_FIELDS, type Truth } from '../../src/filterChecks';

/**
 * FLT-PN — Toolbar › Filter panel mechanics (seen live 12-10-2026):
 *  every section + its conditions are discoverable · Reset clears the choices without a request and the next Find
 *  drops the filter and the unsaved state · a section × removes only that section · two sections combine with
 *  pattern "1 AND 2" · the value-list and panel search boxes narrow their lists · Cancel sends nothing ·
 *  Find with a condition but no value sends no criterion.
 */
test.describe.configure({ mode: 'default', timeout: 900_000 });
let truth: Truth;
test.beforeAll(async ({ browser }, info) => { test.setTimeout(300_000); truth = await readTruth(browser, info.project.use.storageState as string | undefined); });
test.afterAll(async ({ browser }, info) => { if (truth) await assertSavedViewUnchanged(browser, info.project.use.storageState as string | undefined, truth); });

test('FLT-PN-01 every section is listed with a value type and at least Is; standard sections present', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const sections = await fp.sections();
  test.info().annotations.push({ type: 'sections', description: sections.map(s => `${s.group}/${s.label}[${s.ftype}:${s.conditions.length}]`).join(' · ') });
  expect(sections.length, 'sections').toBeGreaterThanOrEqual(16);
  for (const s of sections) {
    expect.soft(s.ftype, `${s.label} has a value type`).not.toBe('');
    expect.soft(s.conditions.length, `${s.label} offers conditions`).toBeGreaterThan(0);
    expect.soft(new Set(s.conditions.map(c => c.code)).size, `${s.label} condition codes unique`).toBe(s.conditions.length);
  }
  for (const [key, label] of Object.entries(STANDARD_FIELDS)) expect.soft(findSection(sections, key), `standard section ${label}`).toBeTruthy();
  // every section can be expanded and shows a value control
  for (const s of sections) {
    try { await fp.expand(s.field); await fp.collapse(s.field); }
    catch (e) { expect.soft(false, `${s.label} expands to a value control: ${String(e).split('\n')[0]}`).toBe(true); }
  }
  await fp.cancel();
});

test('FLT-PN-02 Reset clears the panel without a request; Find after Reset drops the filter and the unsaved state', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const status = findSection(await fp.sections(), '4');
  test.skip(!status, 'no Status section');
  await fp.expand(status!.field); await fp.setConditionOf(status!.field, 'all_open');
  const cap = fp.capture(); await fp.find(); await wl.loadAllRows(); cap.stop();
  expect(criteriaOf(cap.data.filters[0] ?? '').length, 'filter applied').toBe(1);
  await expect(qa(wl.page, K.saveAs)).toBeVisible();
  await fp.open();
  const cap2 = fp.capture();
  await fp.reset();
  await wl.page.waitForTimeout(2_000);
  cap2.stop();
  expect(cap2.data.filters, 'Reset sends no data request').toHaveLength(0);
  expect(await fp.isOpen(), 'panel stays open after Reset').toBe(true);
  expect(await fp.conditionOf(status!.field), 'Status condition back to default').toBe(status!.conditions[0]!.code);
  expect(await fp.selectionCount(status!.field), 'Status badge cleared').toBe(0);
  expect(await fp.chips(), 'chips stay until Find').toContain('Status');
  // Find after Reset: no criterion, chips gone, view clean again
  wl.d.resetOwners();
  const after = await fp.find(); await wl.loadAllRows();
  expect(criteriaOf(new URL(after.url()).searchParams.get('filter') ?? ''), 'no criterion after Reset + Find').toEqual([]);
  expect(await fp.chips(), 'chips gone').toBe('');
  await expect(wl.rows()).toHaveCount(truth.owners.size + (truth.unassignedId ? 1 : 0));
  await expect(qa(wl.page, K.saveAs), 'no unsaved change after Reset + Find').toBeHidden();
  if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard();
});

test('FLT-PN-03 two sections combine (pattern "1 AND 2"); a section × removes only its criterion', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const sections = await fp.sections();
  const rt = findSection(sections, 'resourcetype'), status = findSection(sections, '4');
  test.skip(!rt || !status, 'needs User/Resource and Status');
  await fp.expand(rt!.field); await fp.setConditionOf(rt!.field, 'is'); await fp.tickIds(rt!.field, ['1']);
  await fp.expand(status!.field); await fp.setConditionOf(status!.field, 'all_closed');
  const cap = fp.capture(); wl.d.resetOwners(); const first = await fp.find(); await wl.loadAllRows(); cap.stop();
  const f = JSON.parse(new URL(first.url()).searchParams.get('filter') ?? '{}');
  const crit = criteriaOf(JSON.stringify(f));
  expect(crit.map(c => c.field_name).sort(), 'both criteria sent').toEqual(['resource_type', 'status']);
  expect(f.pattern, 'AND pattern').toBe('1 AND 2');
  const chips = await fp.chips();
  expect(chips).toContain('User/Resource: Is Users'); expect(chips).toContain('Status: All Closed');
  const usersOnly = [...truth.owners.values()].filter(o => !o.isResource).map(o => o.id);
  for (const id of cap.data.owners.keys()) expect.soft(usersOnly, `combined result is a subset of Users: ${cap.data.owners.get(id)?.name}`).toContain(id);
  for (const o of cap.data.owners.values()) expect.soft(o.totalWork, `${o.name}: closed-task work ≤ all work`).toBeLessThanOrEqual(truth.owners.get(o.id)?.totalWork ?? 0);
  // section × on Status, Find: only resource_type left
  await fp.open();
  await fp.clearSection(status!.field);
  expect(await fp.selectionCount(status!.field), 'Status badge cleared').toBe(0);
  expect(await fp.selectionCount(rt!.field), 'User/Resource badge kept').toBe(1);
  wl.d.resetOwners();
  const second = await fp.find(); await wl.loadAllRows();
  expect(criteriaOf(new URL(second.url()).searchParams.get('filter') ?? '').map(c => c.field_name), 'only resource_type left').toEqual(['resource_type']);
  expect(await fp.chips(), 'Status chip gone').not.toContain('Status');
  await expect(wl.rows()).toHaveCount(usersOnly.length);
  await clearAndDiscard(wl, fp, truth, 'PN-03');
});

test('FLT-PN-04 value-list search and the panel "Filter Search" narrow their lists', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const sections = await fp.sections();
  const status = findSection(sections, '4');
  test.skip(!status, 'no Status section');
  await fp.expand(status!.field);
  const all = await fp.valueOptions(status!.field);
  const target = all.find(o => o.label.length > 3)!;
  await fp.searchValues(status!.field, target.label);
  await expect.poll(async () => (await wl.page.locator(`#filtval_${status!.field} label[data-zpqa^="resourceutil_${status!.field}_"]`).filter({ visible: true }).allInnerTexts()).map(t => t.trim()),
    { message: 'list narrowed to the search' }).toEqual(all.filter(o => o.label.toLowerCase().includes(target.label.toLowerCase())).map(o => o.label));
  await fp.searchValues(status!.field, '');
  await fp.collapse(status!.field);
  // panel search: only matching section headers stay visible
  const box = qa(wl.page, 'resourceutil_filterSearchBox');
  await expect(box, 'panel Filter Search box').toBeVisible();
  const pick = sections.find(s => s.label === 'Priority') ?? sections[sections.length - 1]!;
  await box.click(); await box.pressSequentially(pick.label, { delay: 30 });
  await expect.poll(() => wl.page.locator('div.zps-filter-popup [data-zpqa^="resourceutil_fltcheck_"]').filter({ visible: true }).allInnerTexts(), { message: 'sections narrowed' })
    .toEqual(sections.filter(s => s.label.toLowerCase().includes(pick.label.toLowerCase())).map(s => s.label));
  await box.fill('');
  await expect.poll(() => wl.page.locator('div.zps-filter-popup [data-zpqa^="resourceutil_fltcheck_"]').filter({ visible: true }).count()).toBeGreaterThanOrEqual(10);
  await fp.cancel();
});

test('FLT-PN-05 Cancel after changes in two sections: no request, no chip, rows unchanged, no unsaved state', async ({ wl }) => {
  const fp = new FilterPanel(wl.page);
  await wl.loadAllRows();
  const before = await wl.rows().count();
  await fp.open();
  const sections = await fp.sections();
  const rt = findSection(sections, 'resourcetype'), status = findSection(sections, '4');
  test.skip(!rt || !status, 'needs User/Resource and Status');
  await fp.expand(rt!.field); await fp.setConditionOf(rt!.field, 'is_not'); await fp.tickIds(rt!.field, ['6']);
  await fp.expand(status!.field); await fp.setConditionOf(status!.field, 'all_open');
  const cap = fp.capture();
  await fp.cancel();
  await wl.page.waitForTimeout(1500);
  cap.stop();
  expect(cap.data.filters, 'no data request after Cancel').toHaveLength(0);
  expect(await fp.chips(), 'no chip').toBe('');
  await expect(wl.rows()).toHaveCount(before);
  await expect(qa(wl.page, K.saveAs)).toBeHidden();
  // the panel reopens with the un-applied choices still shown? record either way
  await fp.open();
  test.info().annotations.push({ type: 'check spec', description: `after Cancel the panel reopens with User/Resource=${await fp.conditionOf(rt!.field)} ticks ${JSON.stringify(await fp.tickedIds(rt!.field).catch(() => []))}, Status=${await fp.conditionOf(status!.field)}` });
  await fp.reset(); await fp.cancel();
});

test('FLT-PN-06 Find with a condition but no value sends no criterion (list, text and number sections)', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const sections = await fp.sections();
  const picks = [findSection(sections, '4'), findSection(sections, '32'), findSection(sections, '48')].filter(Boolean) as typeof sections;
  for (const s of picks) {
    await fp.expand(s.field);
    await fp.setConditionOf(s.field, s.conditions[0]!.code);
    const cap = fp.capture();
    await fp.findNoWait();
    cap.stop();
    const sent = cap.data.filters.flatMap(criteriaOf);
    expect.soft(sent, `${s.label}: no criterion without a value`).toEqual([]);
    test.info().annotations.push({ type: 'check spec', description: `${s.label} + no value + Find: ${cap.data.filters.length} request(s), panel ${await fp.isOpen() ? 'stays open' : 'closes'}` });
    if (!(await fp.isOpen())) await fp.open();
    await fp.collapse(s.field);
  }
  await fp.cancel();
  await clearAndDiscard(wl, fp, truth, 'PN-06');
});

test('FLT-PN-08 chip × removes one value and re-queries; many values collapse the bar and Show More reveals Clear filter', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const status = findSection(await fp.sections(), '4');
  test.skip(!status, 'no Status section');
  await fp.expand(status!.field); await fp.setConditionOf(status!.field, 'is');
  const all = (await fp.valueOptions(status!.field)).map(o => o.id);
  test.skip(all.length < 3, 'needs at least three statuses');
  await fp.tickIds(status!.field, all.slice(0, 3));
  wl.d.resetOwners(); await fp.find(); await wl.loadAllRows();
  expect(await fp.chipValues(status!.field), 'three chips').toEqual(all.slice(0, 3));
  // × on the first chip
  wl.d.resetOwners();
  const r = await fp.removeChipValue(status!.field, all[0]!);
  await wl.loadAllRows();
  const crit = criteriaOf(new URL(r.url()).searchParams.get('filter') ?? '');
  expect(crit.map(c => c.value), 'request carries the remaining two values').toEqual([all.slice(1, 3)]);
  expect(await fp.chipValues(status!.field), 'two chips left').toEqual(all.slice(1, 3));
  await fp.open(); await fp.expand(status!.field);
  expect(await fp.tickedIds(status!.field), 'panel follows the chip removal').toEqual(all.slice(1, 3).sort());
  // every value: chips overflow
  await fp.tickIds(status!.field, all);
  wl.d.resetOwners(); await fp.find(); await wl.loadAllRows();
  expect(await fp.chipValues(status!.field), 'one chip per value').toEqual(all);
  const overflow = await fp.chipOverflow();
  const clearShown = await fp.clearFilterVisible();
  test.info().annotations.push({ type: 'evidence', description: `${all.length} values: ${all.length - overflow} chips shown, +${overflow} folded; Clear filter visible = ${clearShown}; Show More offered = ${await fp.showMore().isVisible()}` });
  if (!clearShown) {
    // Expected (confirmed 12-10-2026): with many chips the bar collapses; "Show More" expands it and shows Clear filter
    await expect(fp.showMore(), '"Show More" control offered while the bar is collapsed').toBeVisible();
    await fp.expandChips();
  }
  await expect(qa(wl.page, K.filterClear), `"Clear filter" reachable with ${all.length} values${clearShown ? '' : ' after Show More'}`).toBeVisible();
  expect(await fp.chipValues(status!.field), 'every value still listed after Show More').toEqual(all);
  await clearAndDiscard(wl, fp, truth, 'PN-08');
});

test('FLT-PN-09 a filtered result that spans several pages scrolls in completely (UI rows = API owners)', async ({ wl }) => {
  // the data endpoint pages owners by 15: a portal with more owners than one page exercises filtered pagination
  test.skip(truth.owners.size <= 15, `portal has ${truth.owners.size} owners (one page): filtered pagination not exercisable here`);
  const fp = new FilterPanel(wl.page); await fp.open();
  const role = findSection(await fp.sections(), 'userrole');
  test.skip(!role, 'no Role section');
  await fp.expand(role!.field); await fp.setConditionOf(role!.field, 'is');
  await fp.tickIds(role!.field, (await fp.valueOptions(role!.field)).map(o => o.id)); // every role keeps every user
  const cap = fp.capture(); wl.d.resetOwners();
  await fp.find(); await wl.loadAllRows(); cap.stop();
  test.info().annotations.push({ type: 'evidence', description: `${cap.data.filters.length} filtered data requests (pages + Unassigned) for ${cap.data.owners.size} owners` });
  expect(cap.data.owners.size, 'more than one page of filtered owners').toBeGreaterThan(15);
  const rows = (await wl.rows().evaluateAll(es => es.map(e => (e.getAttribute('data-zpqa') ?? '').replace('username-', '')))).sort();
  expect(rows, 'every filtered page is rendered').toEqual([...cap.data.owners.keys(), ...cap.data.unassignedIds].sort());
  await clearAndDiscard(wl, fp, truth, 'PN-09');
});

test('FLT-PN-07 a filter is a toolbar change: Save as › Discard clears the unsaved state; the next data load is unfiltered', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const rt = findSection(await fp.sections(), 'resourcetype');
  test.skip(!rt, 'no User/Resource section');
  await fp.expand(rt!.field); await fp.setConditionOf(rt!.field, 'is'); await fp.tickIds(rt!.field, ['1']);
  wl.d.resetOwners(); await fp.find(); await wl.loadAllRows();
  await expect(qa(wl.page, K.viewDropdown)).toContainText('*');
  const items = await wl.saveAsItems();
  // Existing is offered only on an editable (custom) view; a predefined view such as All Users gets New + Discard (seen 12-10-2026)
  const current = [...wl.d.views.values()].find(v => (v.custom_view_id || v.id) === wl.d.meta?.custom_view_id);
  expect(Object.keys(items), 'Save as offers New and Discard').toEqual(expect.arrayContaining([K.saveAsNew, K.discard]));
  test.info().annotations.push({ type: 'check spec', description: `Save as on ${current?.name ?? 'the view'} (is_editable=${current?.is_editable}, is_default=${current?.is_default_view}): ${Object.keys(items).join(', ')} — Existing absent on All Users although is_editable is true (D-15 family)` });
  await wl.discard();
  // Expected behaviour (confirmed by the user 12-10-2026): Discard removes the unsaved marker and Save as; the chips and
  // the filtered grid may stay on screen until the next data load, and the next data request carries no filter.
  await expect(qa(wl.page, K.viewDropdown), 'unsaved marker gone').not.toContainText('*');
  await expect(qa(wl.page, K.saveAs), 'Save as gone').toBeHidden();
  const chipsAfter = await fp.chips();
  wl.d.resetOwners(); const [data] = await wl.refresh(); await wl.loadAllRows();
  const after = criteriaOf(new URL(data.url()).searchParams.get('filter') ?? '');
  test.info().annotations.push({ type: 'evidence', description: `after Discard: chips "${chipsAfter}" (shown until the next data load — expected); refresh request criteria ${JSON.stringify(after)}; rows ${await wl.rows().count()} of ${truth.owners.size + (truth.unassignedId ? 1 : 0)}` });
  expect(after, 'the next data request carries no filter').toEqual([]);
  await expect(wl.rows(), 'every row back after the next data load').toHaveCount(truth.owners.size + (truth.unassignedId ? 1 : 0));
  expect(await fp.chips(), 'chips gone after the next data load').toBe('');
});
