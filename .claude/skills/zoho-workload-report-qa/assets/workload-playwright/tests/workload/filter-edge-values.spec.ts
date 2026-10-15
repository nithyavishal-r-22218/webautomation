import { test, expect, knownDefect } from '../../src/fixtures';
import { env } from '../../src/env';
import { K, qa } from '../../src/locators';
import { FilterPanel, type FilterSection } from '../../src/pages/FilterPanel';
import { assertSavedViewUnchanged, findSection, isCustomSection, probeFind, readTruth, type ProbeResult, type Truth } from '../../src/filterChecks';

/**
 * FLT-EV — value edge cases. The product spec does not define most of these, so each case is recorded (request,
 * chips, rows, validation text, page health) and only invariants are asserted:
 *   · the page keeps responding after every input (WL-D-22 excepted)
 *   · a request never carries an empty or non-numeric value for a numeric field
 *   · a sent value equals what was typed (after the app's own trimming)
 *   · an inverted range is either rejected or sent as typed — never silently swapped
 * Text: special characters, 255 and 1000 characters, spaces, case, unicode. Numbers: 0, negative, decimal, huge,
 * letters, empty, spaces, Between inverted / half empty, exponent. Dates: inverted Not Between, previous-year and
 * far-future picks (month navigation across years). WL-D-22 is re-run three times to characterise the freeze.
 */
test.describe.configure({ mode: 'default', timeout: 1500_000 });
let truth: Truth;
test.beforeAll(async ({ browser }, info) => { test.setTimeout(300_000); truth = await readTruth(browser, info.project.use.storageState as string | undefined); });
test.afterAll(async ({ browser }, info) => { if (truth) await assertSavedViewUnchanged(browser, info.project.use.storageState as string | undefined, truth); });

const numeric = (v: string) => /^-?\d+(\.\d+)?$/.test(v);
const exponent = (v: string) => /^-?\d+(\.\d+)?e[+-]?\d+$/i.test(v);
/** A frozen report after a Find is the open WL-D-22; recorded as an issue (or failed when the defect is not expected). */
function health(name: string, r: ProbeResult) {
  if (r.responsive) return;
  test.info().annotations.push({ type: 'issue', description: `WL-D-22: ${name} left the report unresponsive${r.jsErrors.length ? ` — ${r.jsErrors[0]}` : ''}` });
  if (!env.expectKnownDefects) expect.soft(r.responsive, `${name}: page still responds (WL-D-22)`).toBe(true);
}
function numericInvariants(name: string, r: ProbeResult, typed: string[]) {
  health(name, r);
  if (!r.requested && !r.responsive) return;
  if (!r.requested || !r.criteria.length) test.info().annotations.push({ type: 'check spec', description: `${name}: ${r.requested ? 'request without a criterion' : 'no request'}; panel ${r.panelOpen ? 'stays open' : 'closed'}; validation "${r.validation.replace(/\|/g, '').trim() || 'none shown'}"` });
  for (const c of r.criteria) {
    for (const v of c.value) {
      expect.soft(v !== '', `${name}: no empty value sent`).toBe(true);
      if (exponent(v.replace(/#$/, ''))) test.info().annotations.push({ type: 'check spec', description: `${name}: exponent notation "${v}" accepted and sent (letters are rejected silently)` });
      else expect.soft(numeric(v.replace(/#$/, '')), `${name}: numeric value sent ("${v}")`).toBe(true);
    }
    const want = typed.map(t => t.trim()).filter(Boolean);
    if (c.value.length === want.length && c.value.every(v => numeric(v.replace(/#$/, '')) || exponent(v.replace(/#$/, '')))) expect.soft(c.value.map(v => v.replace(/#$/, '')), `${name}: sent values = typed`).toEqual(want);
  }
}

test('FLT-EV-01 Completion Percentage: 0, negative, decimal, 100, 101, huge, letters, empty, spaces', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const s = findSection(await fp.sections(), '48');
  test.skip(!s, 'no Completion Percentage');
  for (const [code, v] of [['is', '0'], ['less_than', '-5'], ['greater_than', '2.5'], ['is', '100'], ['greater_than', '101'], ['less_than', '99999999'], ['is', 'abc'], ['is', ''], ['is', ' 50 ']] as const) {
    const r = await probeFind(wl, fp, s!.field, code, { typed: [v] });
    numericInvariants(`Completion ${code} "${v}"`, r, [v]);
    if (v === 'abc' || v === '') expect.soft(r.criteria.length === 0 || r.validation.replace(/\|/g, '').trim() !== '', `Completion ${code} "${v}": rejected or no criterion sent`).toBe(true);
  }
});

test('FLT-EV-02 Allocation hours / percent: zero, negative, exponent, Between inverted and half-empty, percent over 100', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const s = findSection(await fp.sections(), 'allocation');
  test.skip(!s, 'no Allocation Type');
  const cases: { code: string; tab: 'hours' | 'percent'; typed: string[] }[] = [
    { code: 'equal', tab: 'hours', typed: ['0'] }, { code: 'less_than', tab: 'hours', typed: ['-1'] }, { code: 'greater_than', tab: 'hours', typed: ['1e3'] },
    { code: 'between', tab: 'hours', typed: ['100', '1'] }, { code: 'between', tab: 'hours', typed: ['', '5'] }, { code: 'between', tab: 'hours', typed: ['5', ''] },
    { code: 'greater_than', tab: 'percent', typed: ['150'] }, { code: 'between', tab: 'percent', typed: ['50', '50'] },
  ];
  for (const c of cases) {
    const r = await probeFind(wl, fp, s!.field, c.code, { typed: c.typed, tab: c.tab });
    numericInvariants(`Allocation ${c.tab} ${c.code} ${JSON.stringify(c.typed)}`, r, c.typed);
    if (c.code === 'between' && c.typed[0] && c.typed[1] && Number(c.typed[0]) > Number(c.typed[1]) && r.criteria[0])
      expect.soft(r.criteria[0].value.map(v => v.replace(/#$/, '')), 'inverted Between sent as typed, not swapped').toEqual(c.typed);
    if (c.code === 'between' && c.typed.some(t => t === '')) expect.soft(r.criteria.length === 0 || r.validation !== '' || r.criteria[0]!.value.length === 2, `half-empty Between ${JSON.stringify(c.typed)}: rejected, or two values sent`).toBe(true);
  }
});

test('FLT-EV-03 custom Number / Decimal / Currency: 0, negative, decimal, letters', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const nums = (await fp.sections()).filter(isCustomSection).filter(s => s.ftype.toLowerCase() === 'double').slice(0, 2);
  test.skip(!nums.length, 'no numeric custom fields');
  for (const s of nums) for (const [code, v] of [['is', '0'], ['less_than', '-1'], ['greater_than', '1.5'], ['is', 'abc']] as const) {
    const r = await probeFind(wl, fp, s.field, code, { typed: [v] });
    numericInvariants(`${s.label} ${code} "${v}"`, r, [v]);
  }
});

test('FLT-EV-04 Task Name text: special characters, 255 and 1000 characters, surrounding spaces, case, unicode', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const s = findSection(await fp.sections(), '32');
  test.skip(!s, 'no Task Name');
  const long255 = 'a'.repeat(255), long1000 = 'b'.repeat(1000);
  const cases: [string, string][] = [['contains', `%_'"<>&`], ['contains', long255], ['contains', long1000], ['contains', '  UI  '], ['contains', '工作量 🚀'], ['is', `O'Brien "task" <b>`]];
  for (const [code, v] of cases) {
    const r = await probeFind(wl, fp, s!.field, code, { typed: [v] });
    health(`Task Name ${code} ${v.length > 30 ? v.length + ' chars' : JSON.stringify(v)}`, r);
    const sent = r.criteria[0]?.value[0];
    if (sent !== undefined) expect.soft(sent, `Task Name ${code}: sent value is the typed text (trimmed)`).toBe(v.trim().slice(0, sent.length === v.trim().length ? undefined : sent.length));
    if (v.length >= 255) test.info().annotations.push({ type: 'check spec', description: `Task Name ${v.length} chars: sent ${sent?.length ?? 0} chars; typed back ${r.typedBack[0]?.length ?? 0} chars` });
  }
  // case: "ui" vs "UI" — same result set means case-insensitive matching
  const lower = await probeFind(wl, fp, s!.field, 'contains', { typed: ['ui'] });
  const upper = await probeFind(wl, fp, s!.field, 'contains', { typed: ['UI'] });
  test.info().annotations.push({ type: 'check spec', description: `Task Name Contains "ui" → ${lower.rows} rows, "UI" → ${upper.rows} rows (${lower.rows === upper.rows ? 'case-insensitive' : 'case-sensitive'})` });
});

test('FLT-EV-05 Dates: Not Between with From after To; a day in the previous year; two years ahead', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const date = (await fp.sections()).filter(isCustomSection).find(s => s.ftype === 'Date');
  test.skip(!date, 'no Date custom field');
  const today = new Date();
  const back = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
  const inverted = await probeFind(wl, fp, date!.field, 'not_between', { dates: [today, back] });
  health('inverted Not Between', inverted);
  if (inverted.criteria[0]) test.info().annotations.push({ type: 'check spec', description: `Not Between From ${today.toDateString()} To ${back.toDateString()} sent as ${JSON.stringify(inverted.criteria[0].value)}` });
  const lastYear = new Date(today.getFullYear() - 1, 0, 15);
  const prev = await probeFind(wl, fp, date!.field, 'is', { dates: [lastYear] });
  expect.soft(prev.criteria[0]?.value[0], 'previous-year pick sent').toMatch(new RegExp(String(lastYear.getFullYear())));
  const future = new Date(today.getFullYear() + 2, 5, 1);
  const fut = await probeFind(wl, fp, date!.field, 'greater_than_or_equal', { dates: [future] });
  expect.soft(fut.criteria[0]?.value[0], 'far-future pick sent').toMatch(new RegExp(String(future.getFullYear())));
  expect.soft(fut.rows, 'no work two years ahead still lists the owners (or none) without an error').toBeGreaterThanOrEqual(0);
});

test('FLT-EV-06 WL-D-22 characterisation: Date Range Less Than 5 days, three attempts with a reload between', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const date = (await fp.sections()).filter(isCustomSection).find(s => s.ftype === 'Date');
  test.skip(!date, 'no Date custom field');
  let frozen = 0, silent = 0;
  for (let i = 0; i < 3; i++) {
    const r = await probeFind(wl, fp, date!.field, 'less_than', { typed: ['5'], tab: 'range', settle: 15_000 });
    if (!r.responsive) frozen++;
    if (r.responsive && r.requested && r.chips === '') silent++;
    await wl.goto(); await fp.open();
  }
  test.info().annotations.push({ type: 'evidence', description: `3 attempts: ${frozen} froze the report, ${silent} applied silently (no chip bar)` });
  if (frozen || silent) knownDefect('WL-D-22', `relative-date Range filter: ${silent} silent, ${frozen} frozen of 3`);
  else test.info().annotations.push({ type: 'evidence', description: 'WL-D-22 did not reproduce in this run' });
  expect(frozen, 'the report never freezes').toBe(0);
  expect(silent, 'a relative-date Range filter shows a chip bar').toBe(0);
});

test('FLT-EV-07 a list value removed while ticked: after Clear filter nothing is sent and every row is back', async ({ wl }) => {
  // the simplest "stale selection" case: tick, Find, Clear filter, Find again without re-ticking
  const fp = new FilterPanel(wl.page); await fp.open();
  const s = findSection(await fp.sections(), '6') as FilterSection;
  test.skip(!s, 'no Priority');
  await fp.expand(s.field); await fp.setConditionOf(s.field, 'is'); await fp.tickIds(s.field, [(await fp.valueOptions(s.field))[0]!.id]);
  wl.d.resetOwners(); await fp.find(); await wl.loadAllRows();
  wl.d.resetOwners(); await fp.clear(); await wl.loadAllRows();
  await fp.open(); await fp.expand(s.field);
  const ticked = await fp.tickedIds(s.field);
  test.info().annotations.push({ type: 'check spec', description: `after Clear filter the panel shows ${ticked.length} tick(s) in Priority` });
  const cap = fp.capture(); await fp.findNoWait(); cap.stop();
  const sent = cap.data.filters.flatMap(f => (f ? JSON.parse(f).criteria ?? [] : []));
  expect.soft(sent, 'Find after Clear filter sends no stale criterion').toEqual([]);
  if (!(await fp.isOpen())) await fp.open();
  await fp.cancel();
  if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard();
  await expect(wl.rows()).toHaveCount(truth.owners.size + (truth.unassignedId ? 1 : 0));
});
void env;
