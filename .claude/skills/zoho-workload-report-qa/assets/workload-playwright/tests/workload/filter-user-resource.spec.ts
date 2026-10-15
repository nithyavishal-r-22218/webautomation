import { test, expect } from '../../src/fixtures';
import type { Browser } from '@playwright/test';
import { ZpApi } from '../../src/api';
import { K, qa } from '../../src/locators';
import { trackContext } from '../../src/rate';
import { WorkloadPage } from '../../src/pages/WorkloadPage';
import {
  FilterPanel, CONDITION_CODE, USER_RESOURCE_CODE, resourceTypeCriterion, toOwnerRow,
  type FilterCondition, type UserResource, type OwnerRow,
} from '../../src/pages/FilterPanel';

/**
 * FLT-UR — Toolbar › Filter › User/Resource on the view open on load (normally All Users), every condition × value
 * combination, asserted in layers against the API's own data:
 *   1 the resource_type criterion sent with the data request   5 the chip text (condition + values)
 *   2 API owners = exactly the users or resources (is_resource)  6 the toolbar marks the view unsaved (* and Save as)
 *   3 each owner's type and total work unchanged by the filter   7 the panel reopens with the same condition and ticks
 *   4 UI rows = API owners + the Unassigned row (by owner id)    8 Clear filter sends no criterion and restores every row
 * The filter is a toolbar change: each case clears it and discards, and afterAll checks the saved view is unchanged.
 * Ground truth (owners, is_resource, work, Unassigned) is read from the API at the start; nothing is hardcoded.
 */
// 10 min per case: ~25 portal calls each, so with the 150-call budget several cases wait for the 2-minute window
test.describe.configure({ mode: 'default', timeout: 600_000 });

interface Truth { viewId: string; owners: Map<string, OwnerRow>; unassignedId: string; determiner: string }
let truth: Truth;

const typeOf = (o: OwnerRow): UserResource => (o.isResource ? 'resources' : 'users');
const label = (v: UserResource) => (v === 'users' ? 'Users' : 'Resources');

async function readTruth(browser: Browser, storageState: string | undefined): Promise<Truth> {
  const ctx = await browser.newContext({ storageState });
  await trackContext(ctx);
  const page = await ctx.newPage();
  const wl = new WorkloadPage(page); await wl.goto();
  const api = new ZpApi(page, wl.d);
  const viewId = wl.d.meta!.custom_view_id;
  const ch = wl.d.meta!.chart_details;
  const iso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const q = (index: number, unassigned: boolean) => `/reports/workload?project_id=0&from_date=${encodeURIComponent(iso(ch.start_date!) + 'T00:00:00.000Z')}`
    + `&to_date=${encodeURIComponent(iso(ch.end_date!) + 'T23:59:59.999Z')}&time_period=${ch.range || 'days'}&report_based_on=users`
    + `&index=${index}&range=50&filter=${encodeURIComponent('{}')}&view_id=${viewId}&sort_order=asc&fetch_unassignee=${unassigned}`;
  const owners = new Map<string, OwnerRow>();
  for (let index = 1; index < 2000; index += 50) {
    const j = await api.getJson<{ owners?: { id: string; name: string; is_resource?: boolean; work?: { total_work?: number } }[]; page_info?: { has_next?: boolean } }>(q(index, false));
    for (const o of j.owners ?? []) owners.set(String(o.id), toOwnerRow(o));
    if (!j.page_info?.has_next || !(j.owners ?? []).length) break;
  }
  const un = await api.getJson<{ owners?: { id: string }[] }>(q(1, true));
  const view = await api.getJson<{ determiner?: unknown }>(`/views/${viewId}?module=workload`);
  await ctx.close();
  return { viewId, owners, unassignedId: String(un.owners?.[0]?.id ?? ''), determiner: JSON.stringify(view.determiner ?? {}) };
}

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(300_000);
  truth = await readTruth(browser, info.project.use.storageState as string | undefined);
  test.info().annotations.push({ type: 'truth', description: [...truth.owners.values()].map(o => `${o.name}${o.isResource ? ' [resource]' : ''}`).join(', ') });
});

test.afterAll(async ({ browser }, info) => {
  if (!truth) return;
  const ctx = await browser.newContext({ storageState: info.project.use.storageState as string | undefined });
  await trackContext(ctx);
  const page = await ctx.newPage();
  const wl = new WorkloadPage(page); await wl.goto();
  const saved = await new ZpApi(page, wl.d).getJson<{ determiner?: unknown }>(`/views/${truth.viewId}?module=workload`);
  await ctx.close();
  expect(JSON.stringify(saved.determiner ?? {}), 'toolbar filters never change the saved view').toBe(truth.determiner);
});

const COMBINATIONS: [FilterCondition, UserResource[]][] = [
  ['Is', ['users']], ['Is', ['resources']], ['Is', ['users', 'resources']],
  ['Is Not', ['users']], ['Is Not', ['resources']], ['Is Not', ['users', 'resources']],
];

COMBINATIONS.forEach(([cond, values], i) => {
  test(`FLT-UR-0${i + 1} User/Resource ${cond} ${values.map(label).join(' + ')}`, async ({ wl }) => {
    const all = [...truth.owners.values()];
    test.skip(!all.some(o => o.isResource) || !all.some(o => !o.isResource), 'needs at least one user and one resource in the view');
    const expected = all.filter(o => values.includes(typeOf(o)) === (cond === 'Is')).map(o => o.id).sort();
    const fp = new FilterPanel(wl.page);
    try {
      await fp.open(); await fp.expandUserResource();
      await fp.setCondition(cond); await fp.setValues(values);
      const cap = fp.capture(); wl.d.resetOwners();
      const first = await fp.find();
      await wl.loadAllRows();
      cap.stop();

      // 1 request
      expect(resourceTypeCriterion(new URL(first.url()).searchParams.get('filter') ?? ''), 'resource_type criterion sent')
        .toEqual({ condition: CONDITION_CODE[cond], values: values.map(v => USER_RESOURCE_CODE[v]).sort() });
      // 2 API owners
      expect([...cap.data.owners.keys()].sort(), 'API owners = the matching users/resources').toEqual(expected);
      // 3 type and work per owner
      for (const o of cap.data.owners.values()) {
        expect.soft(values.includes(typeOf(o)), `${o.name}: type matches "${cond}"`).toBe(cond === 'Is');
        expect.soft(o.totalWork, `${o.name}: work unchanged by the filter`).toBe(truth.owners.get(o.id)?.totalWork);
      }
      // 4 UI rows by owner id
      const uiIds = (await wl.rows().evaluateAll(es => es.map(e => (e.getAttribute('data-zpqa') ?? '').replace('username-', '')))).sort();
      expect(uiIds, 'UI rows = API owners + Unassigned').toEqual([...expected, ...cap.data.unassignedIds].sort());
      test.info().annotations.push({ type: 'unassigned', description: `${cond} ${values.join('+')}: Unassigned row ${cap.data.unassignedIds.size ? 'shown' : 'hidden'}` });
      // 5 chips
      const chips = await fp.chips();
      expect(chips, 'chip names the condition').toContain(`User/Resource: ${cond}`);
      if (cond === 'Is') expect(chips, 'chip is not "Is Not"').not.toContain('Is Not');
      for (const v of values) expect(chips, `chip lists ${label(v)}`).toContain(label(v));
      // 6 unsaved toolbar change
      await expect(qa(wl.page, K.viewDropdown), 'view marked unsaved').toContainText('*');
      await expect(qa(wl.page, K.saveAs), 'Save as offered').toBeVisible();
      // 7 the panel keeps the choice
      await fp.open(); await fp.expandUserResource();
      expect(await fp.condition(), 'condition kept').toBe(cond);
      expect(await fp.ticked(), 'ticks kept').toEqual((['users', 'resources'] as UserResource[]).filter(v => values.includes(v)));
      await fp.cancel();
      // 8 Clear filter restores every row
      wl.d.resetOwners();
      const cleared = await fp.clear();
      await wl.loadAllRows();
      expect(resourceTypeCriterion(new URL(cleared.url()).searchParams.get('filter') ?? ''), 'no criterion after Clear filter').toBeNull();
      await expect(wl.rows(), 'every row back').toHaveCount(truth.owners.size + (truth.unassignedId ? 1 : 0));
      expect(await fp.chips(), 'chips gone').toBe('');
    } finally {
      if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard(); // leave the view as saved
    }
  });
});

test('FLT-UR-07 Cancel discards the choice: no data request, no chip, rows unchanged', async ({ wl }) => {
  const fp = new FilterPanel(wl.page);
  await wl.loadAllRows();
  const before = await wl.rows().count();
  await fp.open(); await fp.expandUserResource();
  await fp.setCondition('Is Not'); await fp.setValues(['users']);
  const cap = fp.capture();
  await fp.cancel();
  await wl.page.waitForTimeout(1500); // a data request would follow a Find within a second
  cap.stop();
  expect(cap.data.filters, 'no data request after Cancel').toHaveLength(0);
  expect(await fp.chips(), 'no chip').toBe('');
  await expect(wl.rows(), 'rows unchanged').toHaveCount(before);
  await expect(qa(wl.page, K.saveAs), 'no unsaved change').toBeHidden();
});

test('FLT-UR-08 Find with no value ticked (behaviour recorded: check spec)', async ({ wl }) => {
  const fp = new FilterPanel(wl.page);
  try {
    await fp.open(); await fp.expandUserResource();
    await fp.setCondition('Is'); await fp.setValues([]);
    const cap = fp.capture();
    await wl.page.locator(`[data-zpqa="${K.filterFind}"]`).click();
    await wl.page.waitForTimeout(2500);
    cap.stop();
    const criterion = cap.data.filters.map(resourceTypeCriterion).find(Boolean) ?? null;
    const panelOpen = await fp.isOpen();
    test.info().annotations.push({ type: 'check spec', description:
      `no value + Find: ${cap.data.filters.length} data request(s); resource_type criterion ${criterion ? JSON.stringify(criterion) : 'none'}; panel ${panelOpen ? 'stays open' : 'closes'}; rows ${await wl.rows().count()}` });
    // whatever the rule, an empty value must never filter everyone out or send an empty value list
    expect.soft(criterion?.values ?? ['(none)'], 'no empty value list sent').not.toEqual([]);
    if (panelOpen) await fp.cancel();
  } finally {
    if (await qa(wl.page, K.filterClear).isVisible()) await fp.clear();
    if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard();
  }
});
