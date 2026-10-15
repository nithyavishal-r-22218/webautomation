import { test, expect, knownDefect } from '../../src/fixtures';
import type { Page, Response } from '@playwright/test';
import fs from 'fs';
import { env } from '../../src/env';
import { K, qa } from '../../src/locators';
import { ZpApi } from '../../src/api';
import { WorkloadPage } from '../../src/pages/WorkloadPage';
import { PREDEFINED_VIEW_LABELS } from '../../src/discover';
import { uiRows } from '../../src/pdfExport';

/**
 * DVA — the ••• actions on every predefined (default) view, end to end (seen 13-10-2026):
 *   Copy link  "Copied to clipboard"; the clipboard holds …#zp/reports/workload/custom-view/<view id>/details; opening it
 *              in a new page shows the same view and the same rows
 *   Edit       "Edit Workload Report" with the name locked; the form matches the saved definition (view type, unit,
 *              data label, description); Cancel sends no PUT; a description change is saved (PUT 200, API reads it
 *              back) without touching the view's rule, settings or rows, and is then restored and read back
 *   Clone      a create form named "<view> (1)"; saving it creates a new custom view whose settings match the source;
 *              its rule and rows are compared with the source (a custom view cannot hold the hierarchy "current
 *              user" rule — see WL-D-28); the clone is deleted
 * Descriptions are snapshotted to reports/dva-snapshot.json (with the app's own save body) before the first save; the
 * restore replays that PUT with the original description, falls back to the UI, and is read back through the API.
 */
test.describe.configure({ mode: 'default', timeout: 900_000 });
const SNAP = `${env.reportsDir}/dva-snapshot.json`;
const KEY = Object.fromEntries(Object.entries(PREDEFINED_VIEW_LABELS).map(([k, l]) => [l, k]));
const esc = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
const snap = () => (fs.existsSync(SNAP) ? JSON.parse(fs.readFileSync(SNAP, 'utf8')) : {});
const keep = (k: string, v: unknown) => { const s = snap(); if (!(k in s)) { s[k] = v; fs.mkdirSync(env.reportsDir, { recursive: true }); fs.writeFileSync(SNAP, JSON.stringify(s, null, 2)); } };
const drop = (k: string) => { const s = snap(); delete s[k]; if (Object.keys(s).length) fs.writeFileSync(SNAP, JSON.stringify(s, null, 2)); else fs.rmSync(SNAP, { force: true }); };

const dataFor = (page: Page, ids: string[]) => page.waitForResponse((r: Response) => {
  const u = new URL(r.url()); return /\/reports\/workload(\/groups\/owners)?$/.test(u.pathname) && ids.includes(u.searchParams.get('view_id') ?? '') && u.searchParams.get('fetch_unassignee') !== 'true';
}, { timeout: 150_000 });
async function settle(wl: WorkloadPage) {
  let last = -1, same = 0;
  for (let i = 0; i < 30 && same < 3; i++) { await wl.scroller().evaluate(el => { el.scrollTop = el.scrollHeight; }).catch(() => {}); await wl.page.waitForTimeout(800); const n = await wl.rows().count(); same = n === last ? same + 1 : 0; last = n; }
}
async function open(wl: WorkloadPage, label: string, ids: string[], group = 'Predefined Views', retried = false): Promise<string[]> {
  const first = dataFor(wl.page, ids);
  await wl.openViews();
  const item = group === 'Predefined Views'
    ? wl.page.locator('.customview-name').filter({ hasText: new RegExp(`^\\s*${esc(label)}\\s*$`) }).first()
    : wl.viewItem(group, label);
  await item.click();
  await first;
  // rows or "No data found" must appear: a view stuck on its spinner is reported, not read as empty
  const loaded = await expect.poll(async () => (await wl.rows().count()) > 0 || await wl.page.getByText('No data found').filter({ visible: true }).first().isVisible().catch(() => false),
    { timeout: 150_000, intervals: [1000] }).toBe(true).then(() => true, () => false);
  if (!loaded && !retried) { test.info().annotations.push({ type: 'evidence', description: `${label}: still loading after 150 s — reloading once` }); await wl.goto(); return open(wl, label, ids, group, true); }
  if (!loaded) { test.info().annotations.push({ type: 'evidence', description: `${label}: still loading after a reload (spinner)` }); await wl.page.screenshot({ path: `${env.reportsDir}/dva-${label.replace(/[^\w-]+/g, '_')}-spinner.png` }).catch(() => {}); }
  expect.soft(loaded, `${label} finished loading (rows or "No data found")`).toBe(true);
  await settle(wl);
  return (await uiRows(wl)).map(r => r.id).sort();
}
const putWatch = (page: Page) => { const puts: { status: number; body: any }[] = []; const on = async (r: Response) => { if (r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT') puts.push({ status: r.status(), body: JSON.parse(r.request().postData() ?? '{}') }); }; page.on('response', on); return { puts, stop: () => page.off('response', on) }; };
const radioValue = (page: Page, values: string[]) => page.evaluate((vals) => {
  const on = [...document.querySelectorAll('ruc-radio-button')].filter(r => (r as HTMLElement).offsetParent && /ruc-checked/.test(r.className)).map(r => (r.querySelector('input') as HTMLInputElement | null)?.value ?? '');
  return on.find(v => vals.includes(v)) ?? '';
}, values);
const tab = (page: Page, name: string) => page.getByText(name, { exact: true }).filter({ visible: true }).first();
/** ••• › Edit, confirmed by the Save button; one retry when the menu click is lost. */
async function openEdit(wl: WorkloadPage) {
  // The API budget can hold the form's requests for over a minute: a form that opens late counts as open, and the
  // retry only reopens the menu while the toolbar is still there.
  const form = () => wl.page.getByText('Edit Workload Report').filter({ visible: true }).first();
  for (let i = 0; i < 2; i++) {
    if (await qa(wl.page, K.save).isVisible() || await form().isVisible()) break;
    await wl.openMoreActions(); await qa(wl.page, K.edit).click({ timeout: 15_000 }).catch(() => {});
    if (await qa(wl.page, K.save).waitFor({ state: 'visible', timeout: 90_000 }).then(() => true, () => false)) return;
    if (await form().isVisible()) break;
    await wl.page.keyboard.press('Escape');
  }
  await expect(qa(wl.page, K.save), 'edit form open').toBeVisible({ timeout: 90_000 });
}

for (const [key, label] of Object.entries(PREDEFINED_VIEW_LABELS)) {
  test(`DVA ${label}: Copy link opens the same view; Edit matches the definition, Cancel, save + restore; Clone`, async ({ wl, context }) => {
    const page = wl.page; const api = new ZpApi(page, wl.d);
    const listed = (await api.views('predefined_views')).find(v => v.name === key);
    test.skip(!listed, `portal has no ${label} view`);
    const viewId = listed!.custom_view_id || listed!.id;
    const ids = [listed!.id, listed!.custom_view_id].filter(Boolean) as string[];
    const def0 = await api.view(viewId);
    const rows0 = await open(wl, label, ids);
    test.info().annotations.push({ type: 'definition', description: `${label}: ${JSON.stringify({ determiner: def0.determiner, view_type: def0.report_preference?.view_type, legend: def0.report_preference?.legend, report_based_on: def0.report_preference?.report_based_on, period: def0.view_period, group_by: def0.group_by, description: def0.description })}`.slice(0, 600) });

    // ---- Copy link
    await test.step('Copy link', async () => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await wl.openMoreActions(); await qa(page, K.copyLink).click();
      await expect.soft(page.getByText('Copied to clipboard').filter({ visible: true }).first(), 'toast "Copied to clipboard"').toBeVisible();
      const link = await page.evaluate(() => navigator.clipboard.readText());
      expect(link, 'clipboard holds the view link').toMatch(new RegExp(`/portal/${esc(env.portal)}#zp/reports/workload/custom-view/(${ids.join('|')})/details$`));
      const other = await context.newPage();
      try {
        const first = dataFor(other, ids);
        await other.goto(link);
        await first;
        const wl2 = new WorkloadPage(other);
        await expect(qa(other, K.viewDropdown), 'the link opens the view').toContainText(label, { timeout: 150_000 });
        await settle(wl2);
        expect((await uiRows(wl2)).map(r => r.id).sort(), 'the link shows the same rows').toEqual(rows0);
      } finally { await other.close(); }
    });

    // ---- Edit: form = definition; Cancel sends nothing
    await test.step('Edit › Cancel', async () => {
      const w = putWatch(page);
      await openEdit(wl);
      await expect(page.getByText('Edit Workload Report').filter({ visible: true }).first(), 'edit form opens').toBeVisible();
      await expect(qa(page, K.name), 'name shows the view').toHaveValue(label);
      expect.soft(await qa(page, K.name).isDisabled(), 'a predefined view\'s name is locked').toBe(true);
      expect.soft(await qa(page, K.description).inputValue(), 'description = saved description').toBe(String(def0.description ?? ''));
      expect.soft(await radioValue(page, ['bar', 'heatmap', 'timeline']), 'view type = saved').toBe(String(def0.report_preference?.view_type ?? ''));
      await tab(page, 'Time Period').click().catch(() => {});
      expect.soft(await radioValue(page, ['days', 'weeks', 'months']), 'unit = saved').toBe(String(def0.view_period?.time_period ?? ''));
      await qa(page, K.cancel).click(); await expect(qa(page, K.save)).toBeHidden();
      await page.waitForTimeout(1000); w.stop();
      expect(w.puts.length, 'Cancel sends no PUT').toBe(0);
      expect(JSON.stringify((await api.view(viewId)).determiner ?? {}), 'rule unchanged after Cancel').toBe(JSON.stringify(def0.determiner ?? {}));
    });

    // ---- Edit: save a description, rule and rows untouched, then restore
    await test.step('Edit › Save description, then restore', async () => {
      const original = String(def0.description ?? '');
      keep(`desc:${viewId}`, { label, description: original });
      const text = `${env.runId} edit check on ${label}`;
      let appBody: Record<string, any> | null = null; // the app's own save request, replayed to restore
      try {
        await openEdit(wl);
        await qa(page, K.description).fill(text);
        const w = putWatch(page);
        const back = dataFor(page, ids);
        await qa(page, K.save).click();
        await back; await settle(wl); w.stop();
        appBody = w.puts[0]?.body ?? null;
        if (appBody) { const k = snap(); if (k[`desc:${viewId}`]) { k[`desc:${viewId}`].body = { ...appBody, description: original }; fs.writeFileSync(SNAP, JSON.stringify(k, null, 2)); } }
        expect(w.puts.map(p => p.status), 'one PUT, 200').toEqual([200]);
        const def1 = await api.view(viewId);
        expect(def1.description, 'description saved').toBe(text);
        expect.soft(JSON.stringify(def1.determiner ?? {}), 'rule unchanged by an edit').toBe(JSON.stringify(def0.determiner ?? {}));
        expect.soft(JSON.stringify(def1.report_preference ?? {}), 'report preference unchanged').toBe(JSON.stringify(def0.report_preference ?? {}));
        expect.soft(JSON.stringify(def1.group_by ?? {}), 'grouping unchanged').toBe(JSON.stringify(def0.group_by ?? {}));
        expect.soft((await qa(page, K.viewDropdown).innerText()).trim().startsWith(label), 'name unchanged').toBe(true);
        expect.soft((await uiRows(wl)).map(r => r.id).sort(), 'rows unchanged after the edit').toEqual(rows0);
      } finally {
        // restore: replay the app's own save request with the original description (no toolbar or menu involved);
        // the UI is the fallback. An empty description must be cleared by keys: fill('') is not registered.
        const current = async () => String((await api.view(viewId)).description ?? '');
        if (appBody && await current() !== original) {
          const r = await api.saveView({ ...appBody, description: original });
          test.info().annotations.push({ type: 'recovery', description: `${label}: restore by replaying the app's PUT → ${r.status()}` });
        }
        for (let attempt = 0; attempt < 2 && await current() !== original; attempt++) {
          try {
            await wl.goto(); await open(wl, label, ids);
            await openEdit(wl);
            const box = qa(page, K.description);
            await box.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Delete');
            if (original) await box.pressSequentially(original);
            const back = dataFor(page, ids);
            await qa(page, K.save).click(); await back.catch(() => null);
          } catch (e) { test.info().annotations.push({ type: 'recovery', description: `${label}: UI restore attempt ${attempt + 1} failed: ${String(e).split('\n')[0]}` }); }
        }
        expect(String((await api.view(viewId)).description ?? ''), `${label}: description restored`).toBe(original);
        drop(`desc:${viewId}`);
      }
    });

    // ---- Clone
    await test.step('Clone', async () => {
      const name = `${env.runId}-clone-${label.replace(/[^\w]+/g, '-')}`;
      let cloneId = '';
      try {
        await wl.goto(); await open(wl, label, ids);
        await wl.openMoreActions(); await qa(page, K.clone).click();
        await expect(page.getByText('Create Workload Report').filter({ visible: true }).first(), 'clone opens the create form').toBeVisible({ timeout: 150_000 }); // the API budget can hold the form's requests
        expect.soft(await qa(page, K.name).inputValue(), 'suggested name "<view> (n)"').toMatch(new RegExp(`^${esc(label)} \\(\\d+\\)$`));
        expect.soft(await radioValue(page, ['bar', 'heatmap', 'timeline']), 'clone keeps the view type').toBe(String(def0.report_preference?.view_type ?? ''));
        // what the Criteria tab shows for the source rule
        await tab(page, 'Criteria').click().catch(() => {});
        const criteriaText = (await page.locator('[class*="criteria" i]').filter({ visible: true }).allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ').slice(0, 300);
        await qa(page, K.name).fill(name);
        const put = page.waitForResponse(r => r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT', { timeout: 150_000 });
        await qa(page, K.save).click();
        const resp = await put;
        expect(resp.status(), 'clone saved (201)').toBe(201);
        const body = JSON.parse(resp.request().postData() ?? '{}');
        cloneId = String((await resp.json().catch(() => ({}))).id ?? '');
        const list = await api.allViews();
        const mine = list.get(name);
        if (!cloneId && mine) cloneId = mine.custom_view_id || mine.id;
        expect(cloneId, 'clone listed').not.toBe('');
        const def2 = await api.view(cloneId);
        const sameRule = JSON.stringify(def2.determiner ?? {}) === JSON.stringify(def0.determiner ?? {}) || (JSON.stringify(def0.determiner ?? {}) === '{}' && JSON.stringify(def2.determiner ?? {}) === '{}');
        test.info().annotations.push({ type: 'evidence', description: `${label} clone: Criteria tab "${criteriaText}"; PUT determiner ${JSON.stringify(body.determiner ?? null)}; saved ${JSON.stringify(def2.determiner ?? {})}; source ${JSON.stringify(def0.determiner ?? {})}` });
        expect.soft(def2.report_preference?.view_type, 'clone view type = source').toBe(def0.report_preference?.view_type);
        expect.soft(def2.report_preference?.legend, 'clone data label = source').toBe(def0.report_preference?.legend);
        expect.soft(def2.report_preference?.report_based_on, 'clone reports for = source').toBe(def0.report_preference?.report_based_on);
        expect.soft(JSON.stringify(def2.group_by ?? []), 'clone grouping = source').toBe(JSON.stringify(def0.group_by ?? []));
        // rows of the clone vs the source
        await wl.goto();
        const group = mine?.group === 'shared_views' ? 'Shared Views' : 'My Custom Views';
        const cloneIds = [cloneId, mine?.id, mine?.custom_view_id].filter(Boolean) as string[];
        const rows2 = await open(wl, name, cloneIds, group);
        test.info().annotations.push({ type: 'evidence', description: `${label} clone rows ${rows2.length} vs source ${rows0.length}` });
        if (!sameRule || JSON.stringify(rows2) !== JSON.stringify(rows0))
          test.info().annotations.push({ type: 'check spec', description: `${label}: the clone does not keep the view's rule — rule ${sameRule ? 'kept' : 'dropped'}, ${rows2.length} rows vs ${rows0.length} (custom views cannot hold some built-in rules; WL-D-28 family)` });
        if (!sameRule) knownDefect('WL-D-30', 'Clone of a default view saves no criteria — the copy lists every owner instead of the view\'s rule');
        expect.soft(sameRule, 'the clone keeps the view\'s criteria').toBe(true);
        if (sameRule) expect.soft(rows2, 'a clone with the same rule shows the same rows').toEqual(rows0);
      } finally {
        if (cloneId) expect([204, 200], 'clone deleted').toContain((await api.deleteView(cloneId)).status());
        else { const left = (await api.allViews()).get(name); if (left) await api.deleteView(left.custom_view_id || left.id); }
      }
    });
    void KEY;
  });
}
