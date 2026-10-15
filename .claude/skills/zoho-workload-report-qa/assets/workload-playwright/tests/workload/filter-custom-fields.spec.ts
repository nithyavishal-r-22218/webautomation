import { test, expect } from '../../src/fixtures';
import { FilterPanel, NO_VALUE_CONDITIONS, DATE_RANGE_CONDITIONS, DATE_PICK_CONDITIONS, type FilterSection } from '../../src/pages/FilterPanel';
import { assertSavedViewUnchanged, checkPartition, isCustomSection, readTruth, runCases, type FilterCase, type Truth } from '../../src/filterChecks';

/**
 * FLT-CF — Toolbar › Filter › task custom fields. Sections differ per portal, so they are discovered from the open
 * panel and driven by their value type (the `ftype` of #filtval_<field>):
 *   picklist / multipicklist / checkbox lists  Is · Is Not · Is (all) · Is Empty
 *   userpicklist                               Is · Is Not · Is Empty (+ team tab when offered)
 *   singleline / multiline (text)              every condition with a sample string; Is Empty
 *   Double (number, decimal, percent, currency) every condition with 5; Is Empty
 *   Date / Date & Time                         every relative condition; Range tab (N days before/after); Date tab (calendar)
 * Every case is task-level: an owner never gains work, and Is + Is Not partition the unfiltered work.
 */
test.describe.configure({ mode: 'default', timeout: 2400_000 });
let truth: Truth;
test.beforeAll(async ({ browser }, info) => { test.setTimeout(300_000); truth = await readTruth(browser, info.project.use.storageState as string | undefined); });
test.afterAll(async ({ browser }, info) => { if (truth) await assertSavedViewUnchanged(browser, info.project.use.storageState as string | undefined, truth); });

const has = (s: FilterSection, code: string) => s.conditions.some(c => c.code === code);
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d; };

async function casesFor(fp: FilterPanel, s: FilterSection): Promise<FilterCase[]> {
  const p = `CF ${s.label}`;
  const cases: FilterCase[] = [];
  const ftype = s.ftype.toLowerCase();
  if (ftype === 'picklist' || ftype === 'multipicklist' || ftype === 'userpicklist') {
    await fp.expand(s.field);
    const options = await fp.valueOptions(s.field);
    if (options.length) {
      const first = options[0]!;
      cases.push({ name: `${p} Is ${first.label}`, section: s, code: 'is', ids: [first.id], level: 'task' });
      if (has(s, 'is_not')) cases.push({ name: `${p} Is Not ${first.label}`, section: s, code: 'is_not', ids: [first.id], level: 'task' });
      if (options.length > 1 && ftype !== 'userpicklist') cases.push({ name: `${p} Is all values`, section: s, code: 'is', ids: options.map(o => o.id), level: 'task' });
      if (ftype === 'userpicklist' && (await fp.tabs(s.field)).some(t => t.value === 'teams')) {
        await fp.selectTab(s.field, 'teams');
        const teams = await fp.valueOptions(s.field);
        if (teams.length) cases.push({ name: `${p} Is team ${teams[0]!.label}`, section: s, code: 'is', tab: 'teams', ids: [teams[0]!.id], level: 'task' });
        await fp.selectTab(s.field, 'users');
      }
    } else test.info().annotations.push({ type: 'skip', description: `${s.label}: no values offered` });
    if (has(s, 'is_empty')) cases.push({ name: `${p} Is Empty`, section: s, code: 'is_empty', level: 'task' });
  } else if (ftype === 'singleline' || ftype === 'multiline') {
    for (const c of s.conditions) cases.push(NO_VALUE_CONDITIONS.has(c.code)
      ? { name: `${p} ${c.text}`, section: s, code: c.code, level: 'task' }
      : { name: `${p} ${c.text} a`, section: s, code: c.code, typed: ['a'], level: 'task' });
  } else if (ftype === 'double') {
    for (const c of s.conditions) cases.push(NO_VALUE_CONDITIONS.has(c.code)
      ? { name: `${p} ${c.text}`, section: s, code: c.code, level: 'task' }
      : { name: `${p} ${c.text} 5`, section: s, code: c.code, typed: ['5'], level: 'task' });
  } else if (ftype === 'date') {
    for (const c of s.conditions) {
      if (c.code === 'select') continue; // the "Select" placeholder is not a condition
      if (NO_VALUE_CONDITIONS.has(c.code)) cases.push({ name: `${p} ${c.text}`, section: s, code: c.code, level: 'task' });
      // Range tab: the filter is applied without a chip bar, and Less Than freezes the report (WL-D-22, 12-10-2026)
      else if (DATE_RANGE_CONDITIONS.has(c.code)) cases.push({ name: `${p} ${c.text} (Range tab)`, section: s, code: c.code, tab: 'range', typed: c.code === 'between' ? ['3', '4'] : ['5'], level: 'task', knownDefect: 'WL-D-22' });
      // Is / ≤ / ≥ / Not Between switch the control to read-only date boxes themselves (no tab to click; seen 12-10-2026)
      else if (DATE_PICK_CONDITIONS.has(c.code)) cases.push({ name: `${p} ${c.text} (Date tab)`, section: s, code: c.code, dates: c.code === 'not_between' ? [day(-7), day(0)] : [day(0)], level: 'task' });
      else cases.push({ name: `${p} ${c.text}`, section: s, code: c.code, level: 'task', note: 'unknown date condition kind: no value set' });
    }
  } else {
    test.info().annotations.push({ type: 'check spec', description: `${s.label}: unknown value type "${s.ftype}" — Is/Is Not with the first value only` });
    await fp.expand(s.field);
    const options = await fp.valueOptions(s.field);
    if (options.length) for (const code of ['is', 'is_not']) if (has(s, code)) cases.push({ name: `${p} ${code} ${options[0]!.label}`, section: s, code, ids: [options[0]!.id], level: 'task' });
  }
  return cases;
}

test('FLT-CF-00 custom-field sections are discovered (list for this portal)', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const custom = (await fp.sections()).filter(isCustomSection);
  test.info().annotations.push({ type: 'custom fields', description: custom.map(s => `${s.label} [${s.ftype}: ${s.conditions.map(c => c.code).join('/')}]`).join(' · ') || 'none' });
  for (const s of custom) expect.soft(s.conditions.length, `${s.label} offers conditions`).toBeGreaterThan(0);
  await fp.cancel();
});

// One test per custom field type group keeps the run time per test bounded; each test covers every section of its type.
// Date sections have 20 conditions each (about 3 min per case with the API budget), so each Date section gets two
// tests: `relative` (the 13 no-value options) and `ranged` (Range tab + Date tab calendar). Up to three Date sections.
const GROUPS = ['picklist', 'userpicklist', 'text', 'double',
  'date:0:relative', 'date:0:ranged', 'date:1:relative', 'date:1:ranged', 'date:2:relative', 'date:2:ranged'] as const;
for (const group of GROUPS) {
  test(`FLT-CF ${group} custom fields: every condition`, async ({ wl }) => {
    if (group.startsWith('date')) test.setTimeout(3600_000);
    const fp = new FilterPanel(wl.page); await fp.open();
    const [kind, nth, part] = group.split(':') as [string, string | undefined, 'relative' | 'ranged' | undefined];
    const match = (s: FilterSection) => {
      const t = s.ftype.toLowerCase();
      return kind === 'picklist' ? (t === 'picklist' || t === 'multipicklist' || !['userpicklist', 'singleline', 'multiline', 'double', 'date'].includes(t))
        : kind === 'text' ? (t === 'singleline' || t === 'multiline') : t === kind;
    };
    let sections = (await fp.sections()).filter(isCustomSection).filter(match);
    if (nth !== undefined) sections = sections.slice(Number(nth), Number(nth) + 1);
    test.skip(!sections.length, `portal has no ${group} custom fields`);
    let cases: FilterCase[] = [];
    for (const s of sections) cases.push(...await casesFor(fp, s));
    if (part === 'relative') cases = cases.filter(c => !c.tab && !c.dates);
    if (part === 'ranged') cases = cases.filter(c => !!c.tab || !!c.dates);
    for (const s of sections) await fp.collapse(s.field).catch(() => {});
    const r = await runCases(wl, fp, truth, cases);
    for (const s of sections) {
      const isCase = cases.find(c => c.section === s && c.code === 'is' && !c.tab), notCase = cases.find(c => c.section === s && c.code === 'is_not' && !c.tab);
      if (isCase && notCase) checkPartition(`${s.label} Is/Is Not`, truth, r.get(isCase.name), r.get(notCase.name));
    }
  });
}
