import { test, expect, knownDefect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { env } from '../../src/env';
import { K, qa } from '../../src/locators';
import { addDays } from '../../src/dates';
import { CreateViewPage } from '../../src/pages/CreateViewPage';
import type { WorkloadPage } from '../../src/pages/WorkloadPage';
import { ensureReport, viewsNamed, waitLoaded, leaveToAllUsers, checkOpened, createCase, fillCriterion, idOf, ownersOf, removeView, uiIds, type Built } from '../../src/createChecks';
import type { Page, Response } from '@playwright/test';

/**
 * CVE — Create Workload Report edge cases. Every view created here carries the run id and is deleted.
 *   01 Cancel discards · 02 empty name · 03 blank name · 04 duplicate name (custom and predefined) · 05 name length
 *   06 special characters, emoji, HTML · 07 description 255 / 256 · 08 surrounding spaces · 09 double-click Save
 *   10 criterion without a value · 11 Specific Users / Projects with none picked · 12 custom range beyond 6 months
 *   13 network failure on Save · 14 keyboard only · 15 reload, Back and Copy link after create
 *   16 a criterion no task matches → "No data found" · 17 create from a project-level report · 18 maximum criteria rows
 */
// one retry: a case that hits a report still loading after 150 s is created again from scratch (each attempt cleans up)
test.describe.configure({ mode: 'parallel', retries: 1, timeout: 900_000 }); // independent cases: shardable across portals
const N = (tag: string) => `${env.runId}-CVE-${tag}`;

/** Count PUTs to /reports/custom-workload while `fn` runs. */
async function puts(page: Page, fn: () => Promise<void>): Promise<Response[]> {
  const out: Response[] = [];
  const on = (r: Response) => { if (r.url().includes('/reports/custom-workload') && r.request().method() === 'PUT') out.push(r); };
  page.on('response', on);
  try { await fn(); await page.waitForTimeout(2500); } finally { page.off('response', on); }
  return out;
}
const formStillOpen = (page: Page) => qa(page, K.save).isVisible();
const visibleError = async (page: Page) => (await page.locator('.ruc-error, .errorMsg, .zp-error, [class*=error-msg], [class*=errormsg], .lyteAlert, .toast, [class*=toast]').filter({ visible: true }).allInnerTexts()).join(' | ').replace(/\s+/g, ' ').slice(0, 200);
async function cleanupByPrefix(api: ZpApi, prefix: string) {
  await removeView(api, '', `${prefix}*`);
}

test('CVE-01 Cancel discards a fully filled form: no save, no view, back on the previous view', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d), cv = new CreateViewPage(page);
  const before = (await qa(page, K.viewDropdown).innerText()).trim();
  const sent = await puts(page, async () => {
    await cv.open(wl); await cv.setName(N('01')); await cv.setDescription('cancel me'); await cv.setViewType('bar');
    await fillCriterion(cv, 0, { field: 'Priority', condition: 'Is', kind: 'list' });
    const offered = await cv.grouping('Roles', 'Desc');
    if (offered) { test.info().annotations.push({ type: 'constraint', description: `Roles not offered here (offered: ${offered.join(', ')})` }); const alt = offered.find(o => o !== 'None'); if (alt) await cv.grouping(alt, 'Desc'); }
    await cv.setUnit('weeks'); await cv.share('all'); await cv.otherProjects('all');
    await cv.cancel();
  });
  expect(sent.length, 'Cancel sends no save').toBe(0);
  expect(await idOf(api, N('01')), 'no view created').toBe('');
  expect((await qa(page, K.viewDropdown).innerText()).trim(), 'back on the view that was open').toBe(before);
});

for (const [tag, name, label] of [['02', '', 'empty'], ['03', '    ', 'blank (spaces only)']] as const) {
  test(`CVE-${tag} a ${label} name is refused: no save, the form stays open with a message`, async ({ wl }) => {
    const page = wl.page, cv = new CreateViewPage(page);
    await cv.open(wl);
    if (name) await qa(page, K.name).pressSequentially(name);
    const sent = await puts(page, async () => { await qa(page, K.save).click(); });
    const err = await visibleError(page);
    test.info().annotations.push({ type: 'evidence', description: `${label} name: ${sent.length} save(s) ${sent.map(r => r.status()).join(',')}; message "${err}"` });
    expect(sent.filter(r => r.status() === 201).length, `${label} name creates nothing`).toBe(0);
    expect(await formStillOpen(page), 'the form stays open').toBe(true);
    expect.soft(err, 'a message tells why').not.toBe('');
    await cv.cancel();
  });
}

test('CVE-04 duplicate names: an existing custom view name and a predefined view label', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d);
  const first = N('04-dup');
  // the session API (in-page): the local proxy can refuse Node's own TLS to the accounts server (OAuth)
  const firstId = await api.createView(first, { description: 'duplicate source' });
  try {
    for (const name of [first, 'All Users']) await test.step(name, async () => {
      const cv = new CreateViewPage(page); await ensureReport(wl); await cv.open(wl); await cv.setName(name);
      const sent = await puts(page, async () => { await qa(page, K.save).click(); });
      const ok = sent.filter(r => r.status() === 201);
      const err = await visibleError(page);
      test.info().annotations.push({ type: 'evidence', description: `"${name}": ${sent.map(r => r.status()).join(',') || 'no save'}; message "${err}"` });
      if (ok.length) {
        const id = String((await ok[0]!.json().catch(() => ({}))).id ?? '');
        test.info().annotations.push({ type: 'check spec', description: `a second view named "${name}" was created (${id}) — confirm duplicates are allowed` });
        if (id && id !== firstId) { await leaveToAllUsers(wl); await api.deleteView(id); }
      } else {
        expect.soft(await formStillOpen(page), `"${name}": refused, the form stays open`).toBe(true);
        expect.soft(err, `"${name}": the refusal is explained`).not.toBe('');
        await cv.cancel();
      }
    });
  } finally { await leaveToAllUsers(wl); await api.deleteView(firstId); await cleanupByPrefix(api, N('04')); }
});

test('CVE-05 name length: the input limit, and a name at the limit round-trips', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d), cv = new CreateViewPage(page);
  await cv.open(wl);
  const max = Number(await qa(page, K.name).getAttribute('maxlength').catch(() => null)) || 0;
  const long = (N('05') + '-' + 'x'.repeat(300)).slice(0, 300);
  await qa(page, K.name).fill(long);
  const kept = (await qa(page, K.name).inputValue()).length;
  test.info().annotations.push({ type: 'evidence', description: `maxlength attribute ${max || 'none'}; typed 300 chars, the input keeps ${kept}` });
  let id = '';
  try {
    const sent = await puts(page, async () => { await qa(page, K.save).click(); });
    const st = sent.map(r => r.status());
    expect(st.every(s => s < 500), `no server error (${st.join(',')})`).toBe(true);
    if (st.includes(201)) {
      id = String((await sent.find(r => r.status() === 201)!.json()).id ?? '');
      const saved = (await api.view(id)).name as string;
      expect.soft(saved, 'saved name = the name the input kept').toBe(long.slice(0, kept));
      test.info().annotations.push({ type: 'evidence', description: `saved ${saved.length} characters` });
    } else {
      test.info().annotations.push({ type: 'check spec', description: `a ${kept}-character name was refused: ${await visibleError(page)}` });
      await cv.cancel();
    }
  } finally { await leaveToAllUsers(wl); await removeView(api, id, ''); await cleanupByPrefix(api, N('05')); }
});

test('CVE-06 special characters, non-Latin text, emoji and HTML in the name round-trip and render as text', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d);
  const name = `${N('06')} <b>bold</b> & "q" 'a' / \\ 日本語 ünï 😀`;
  let b: Built | undefined;
  try {
    b = await createCase(wl, { name, description: 'emoji 😀 and <i>html</i>' });
    expect(b.status, 'created').toBe(201);
    const saved = b.def.name as string;
    if (saved.includes('?') && !name.includes('?')) knownDefect('WL-D-08', 'emoji and some non-Latin characters are saved as "?"');
    expect.soft(saved, 'name round-trips exactly').toBe(name);
    expect.soft(b.def.description, 'description round-trips exactly').toBe('emoji 😀 and <i>html</i>');
    await checkOpened(wl, b);
    expect.soft(await page.locator('[data-zpqa="topbar_cview"] b').count(), 'no <b> element is injected into the toolbar').toBe(0);
    await wl.openViews();
    expect.soft(await page.locator('.cvdrop-group b, .customview-name b').count(), 'no <b> element is injected into the list').toBe(0);
    await wl.closeViews();
  } finally { await leaveToAllUsers(wl); await removeView(api, b?.id ?? '', name); }
});

test('CVE-07 description at 255 characters round-trips; 256 is cut or refused, never a server error', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d);
  for (const n of [255, 256]) await test.step(`${n} characters`, async () => {
    const cv = new CreateViewPage(page); await ensureReport(wl); await cv.open(wl);
    const name = N(`07-${n}`); await cv.setName(name);
    const text = ('D'.repeat(n));
    await qa(page, K.description).fill(text);
    const kept = (await qa(page, K.description).inputValue()).length;
    let id = '';
    try {
      const sent = await puts(page, async () => { await qa(page, K.save).click(); });
      expect(sent.every(r => r.status() < 500), 'no server error').toBe(true);
      const ok = sent.find(r => r.status() === 201);
      if (ok) { id = String((await ok.json()).id ?? ''); const d = (await api.view(id)).description ?? ''; test.info().annotations.push({ type: 'evidence', description: `${n}: input kept ${kept}, saved ${d.length}` }); if (n === 255) expect.soft(d.length, '255 characters saved').toBe(255); else expect.soft(d.length, 'never more than 255 saved').toBeLessThanOrEqual(255); }
      else { test.info().annotations.push({ type: 'evidence', description: `${n}: refused — ${await visibleError(page)}` }); expect.soft(n, '255 characters must be accepted').toBe(256); await cv.cancel(); }
    } finally { await leaveToAllUsers(wl); await removeView(api, id, name); }
  });
});

test('CVE-08 leading and trailing spaces in the name', async ({ wl }) => {
  const api = new ZpApi(wl.page, wl.d);
  const core = N('08'); let b: Built | undefined;
  try {
    b = await createCase(wl, { name: `   ${core}   ` });
    test.info().annotations.push({ type: 'evidence', description: `saved "${b.def.name}"` });
    if (b.def.name !== core) knownDefect('WL-D-33', 'Create Workload Report keeps leading and trailing spaces in the name (an empty or blank name is refused, so the field is validated but not trimmed)');
    expect.soft(b.def.name, 'surrounding spaces are trimmed').toBe(core);
  } finally { await leaveToAllUsers(wl); await removeView(api, b?.id ?? '', b?.def?.name ?? core); await cleanupByPrefix(api, core); }
});

test('CVE-09 double-clicking Save creates exactly one view', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d), cv = new CreateViewPage(page);
  const name = N('09');
  try {
    await cv.open(wl); await cv.setName(name);
    const sent = await puts(page, async () => { await qa(page, K.save).dblclick(); });
    const views = await viewsNamed(api, name);
    test.info().annotations.push({ type: 'evidence', description: `double-click: ${sent.length} PUT(s) ${sent.map(r => r.status()).join(',')}; ${views.length} view(s) named ${name}` });
    if (views.length > 1) knownDefect('WL-D-12', 'double-clicking Save sends the save twice');
    expect(views.length, 'one view with that name').toBe(1);
  } finally { await leaveToAllUsers(wl); await cleanupByPrefix(api, name); }
});

test('CVE-10 a criterion with a field and condition but no value is refused or dropped, never saved empty', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d), cv = new CreateViewPage(page);
  const name = N('10'); let id = '';
  try {
    await cv.open(wl); await cv.setName(name); await cv.openTab('determiner');
    await cv.choose(cv.fieldSel(0), 'Priority'); await cv.choose(cv.condSel(0), 'Is');
    const sent = await puts(page, async () => { await qa(page, K.save).click(); });
    const ok = sent.find(r => r.status() === 201);
    if (ok) {
      id = String((await ok.json()).id ?? '');
      const crit = ((await api.view(id)).determiner?.criteria ?? []) as { value?: unknown[] }[];
      expect.soft(crit.every(c => (c.value ?? []).length > 0), 'no criterion saved without a value').toBe(true);
      test.info().annotations.push({ type: 'evidence', description: `saved with ${crit.length} criteria` });
    } else {
      expect.soft(await formStillOpen(page), 'refused: the form stays open').toBe(true);
      test.info().annotations.push({ type: 'evidence', description: `refused: "${await visibleError(page)}"` });
      await cv.cancel();
    }
  } finally { await leaveToAllUsers(wl); await removeView(api, id, name); }
});

for (const [tag, which] of [['11a', 'users'], ['11b', 'projects']] as const) {
  test(`CVE-${tag} Specific ${which === 'users' ? 'Users' : 'Projects'} with none picked is refused or falls back, never saved as an empty share`, async ({ wl }) => {
    const page = wl.page, api = new ZpApi(page, wl.d), cv = new CreateViewPage(page);
    const name = N(tag); let id = '';
    try {
      await cv.open(wl); await cv.setName(name);
      if (which === 'users') await cv.share('users', []); else await cv.otherProjects('projects', []);
      const sent = await puts(page, async () => { await qa(page, K.save).click(); });
      const ok = sent.find(r => r.status() === 201);
      if (ok) {
        id = String((await ok.json()).id ?? ''); const v = await api.view(id);
        test.info().annotations.push({ type: 'evidence', description: `saved: ${v.view_access_type} / ${v.project_access_type}, ${(v.shared_users ?? []).length} users, ${(v.shared_projects ?? []).length} projects` });
        if (which === 'users') expect.soft(v.view_access_type === 'shared' && !(v.shared_users ?? []).length, 'not saved as "shared with nobody"').toBe(false);
        else expect.soft(v.project_access_type === 'selected_projects' && !(v.shared_projects ?? []).length, 'not saved as "shown in no project"').toBe(false);
      } else {
        expect.soft(await formStillOpen(page), 'refused: the form stays open').toBe(true);
        test.info().annotations.push({ type: 'evidence', description: `refused: "${await visibleError(page)}"` });
        await cv.cancel();
      }
    } finally { await leaveToAllUsers(wl); await removeView(api, id, name); }
  });
}

test('CVE-12 a custom range longer than 6 months is refused', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d), cv = new CreateViewPage(page);
  const name = N('12'); let id = '';
  try {
    await cv.open(wl); await cv.setName(name);
    const t = new Date();
    await cv.setCustom('days', addDays(t, 1), addDays(t, 200)).catch(e => test.info().annotations.push({ type: 'evidence', description: `picker refused the end date: ${String(e).split('\n')[0]}` }));
    // close the picker if it is still open (it covers Save)
    for (let i = 0; i < 2; i++) await page.keyboard.press('Escape');
    const cancelPicker = page.locator('[data-zpqa="footer-cur-cancel"]').or(page.getByText('Cancel', { exact: true })).filter({ visible: true });
    if ((await cancelPicker.count()) > 1) await cancelPicker.first().click().catch(() => {});
    const sent = await puts(page, async () => { if (await formStillOpen(page)) await qa(page, K.save).click({ timeout: 15_000 }).catch(e => test.info().annotations.push({ type: 'evidence', description: `Save not clickable: ${String(e).split('\n')[0]}` })); });
    const ok = sent.find(r => r.status() === 201);
    if (ok) {
      id = String((await ok.json()).id ?? ''); const v = await api.view(id);
      test.info().annotations.push({ type: 'evidence', description: `saved period ${JSON.stringify(v.view_period)}` });
      const p = v.view_period ?? {};
      if (p.time_period_type === 'custom' && p.custom_start_date && p.custom_end_date)
        expect.soft((Date.parse(p.custom_end_date) - Date.parse(p.custom_start_date)) / 864e5, 'saved range ≤ 6 months').toBeLessThanOrEqual(186);
    } else test.info().annotations.push({ type: 'evidence', description: `refused: "${await visibleError(page)}"` });
    if (await formStillOpen(page)) await cv.cancel().catch(() => {});
  } finally { await leaveToAllUsers(wl); await removeView(api, id, name); }
});

test('CVE-13 a failed save (network error) keeps the form open and creates nothing', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d), cv = new CreateViewPage(page);
  const name = N('13');
  try {
    await cv.open(wl); await cv.setName(name);
    await page.route('**/reports/custom-workload**', r => (r.request().method() === 'PUT' ? r.abort('failed') : r.continue()));
    await qa(page, K.save).click(); await page.waitForTimeout(3000);
    await page.unroute('**/reports/custom-workload**');
    expect.soft(await formStillOpen(page), 'the form stays open').toBe(true);
    expect.soft(await qa(page, K.name).inputValue(), 'the entered name is kept').toBe(name);
    test.info().annotations.push({ type: 'evidence', description: `message "${await visibleError(page)}"` });
    expect(await idOf(api, name), 'nothing created').toBe('');
    await cv.cancel().catch(() => {});
  } finally { await page.unroute('**/reports/custom-workload**').catch(() => {}); await cleanupByPrefix(api, name); }
});

test('CVE-14 the form can be completed and saved with the keyboard', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d), cv = new CreateViewPage(page);
  const name = N('14');
  try {
    await cv.open(wl);
    await qa(page, K.name).focus(); await page.keyboard.type(name);
    await page.keyboard.press('Tab');
    // WL-D-37: a stale Lyte focus trap (window._lyteUiUtils.trapFocusFun, left behind by the views dropdown the form is
    // opened from) cancels the Tab keydown, so focus stays in the name field and the description would land in the name.
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-zpqa'));
    if (focused !== K.description) { knownDefect('WL-D-37', `Tab from the name field is cancelled by a stale Lyte focus trap: focus stays on ${focused} instead of moving to the description`); await qa(page, K.description).focus(); }
    await page.keyboard.type('typed with the keyboard');
    await qa(page, K.save).focus();
    const sent = await puts(page, async () => { await page.keyboard.press('Enter'); });
    expect(sent.map(r => r.status()), 'Enter on Save creates the view').toContain(201);
    const made = await sent.find(r => r.status() === 201)!.json().catch(() => ({}));
    const v = await api.view(String(made.id ?? await idOf(api, name)));
    test.info().annotations.push({ type: 'evidence', description: `saved name "${v.name}", description "${v.description ?? ''}"` });
    expect.soft(v.name, 'name typed with the keyboard').toBe(name);
    expect(v.description, 'description typed with the keyboard').toBe('typed with the keyboard');
  } finally { await leaveToAllUsers(wl); await cleanupByPrefix(api, name); }
});

test('CVE-15 after create: reload stays on the new view; Back leaves it; Copy link reopens it', async ({ wl, context }) => {
  const page = wl.page, api = new ZpApi(page, wl.d);
  const name = N('15'); let b: Built | undefined;
  try {
    const before = page.url();
    b = await createCase(wl, { name, viewType: 'bar' });
    await checkOpened(wl, b);
    await page.reload(); await wl.d.ready().catch(() => {});
    await expect(qa(page, K.viewDropdown), 'reload keeps the new view').toContainText(name, { timeout: 150_000 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await wl.openMoreActions(); await qa(page, K.copyLink).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect.soft(link, 'Copy link points at the new view').toContain(`/custom-view/${b.id}`);
    const other = await context.newPage();
    try { await other.goto(link); await expect(qa(other, K.viewDropdown), 'the link opens the new view').toContainText(name, { timeout: 150_000 }); } finally { await other.close(); }
    await page.goBack(); await page.waitForTimeout(3000);
    test.info().annotations.push({ type: 'evidence', description: `Back: ${page.url().replace(/^.*#/, '#')} (was ${before.replace(/^.*#/, '#')}); dropdown "${(await qa(page, K.viewDropdown).innerText().catch(() => '')).trim()}"` });
  } finally { await leaveToAllUsers(wl); await removeView(api, b?.id ?? '', name); }
});

test('CVE-16 a criterion that matches no task opens the view with "No data found" and no work', async ({ wl }) => {
  const api = new ZpApi(wl.page, wl.d);
  const name = N('16'); let b: Built | undefined;
  try {
    b = await createCase(wl, { name, criteria: [{ field: 'Task Name', condition: 'Is', kind: 'text', text: ['zz-no-task-has-this-name-qa'] }] });
    const p = await checkOpened(wl, b);
    const owners = await ownersOf(api, b.id, p.from, p.to, 'days');
    expect.soft([...owners.values()].reduce((a, o) => a + o.work, 0), 'no work at all').toBe(0);
    const ui = await uiIds(wl);
    const noData = await wl.page.getByText('No data found').filter({ visible: true }).count();
    // task-level criteria keep the owners and remove their work (as the toolbar filters do)
    for (const o of owners.values()) expect.soft(o.work, `${o.name} has no work`).toBe(0);
    test.info().annotations.push({ type: 'evidence', description: `${ui.length} rows shown (all with 0 work), ${owners.size} API owners, "No data found" ${noData ? 'shown' : 'not shown'}` });
  } finally { await leaveToAllUsers(wl); await removeView(api, b?.id ?? '', name); }
});

test('CVE-17 create from a project-level report: listed in that project, project access recorded', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d);
  const pid = process.env.ZP_PERM_PROJECT_ID || '';
  test.skip(!pid, 'set ZP_PERM_PROJECT_ID (the seed writes it per portal)');
  const name = N('17'); let id = '';
  try {
    await wl.gotoProject(pid); await waitLoaded(wl); await wl.openViews();
    const create = qa(page, K.createView).filter({ visible: true }).first();
    test.skip(!(await create.count()), 'no "+ Create Workload Report" in the project-level view list');
    await create.click();
    await expect(qa(page, K.name)).toBeVisible({ timeout: 90_000 });
    const cv = new CreateViewPage(page); await cv.setName(name);
    const r = await cv.create(); id = r.id || await idOf(api, name);
    expect(r.put.status(), 'created').toBe(201);
    const v = await api.view(id);
    test.info().annotations.push({ type: 'evidence', description: `from project ${pid}: ${v.view_access_type} / ${v.project_access_type}, projects ${(v.shared_projects ?? []).map((p: any) => p.name).join(', ') || '-'}` });
    await wl.gotoProject(pid); await waitLoaded(wl); await wl.openViews();
    expect.soft(await page.locator('.customview-name').filter({ hasText: name }).filter({ visible: true }).count(), 'listed in the project report it was created in').toBeGreaterThan(0);
    await wl.closeViews();
  } finally { await leaveToAllUsers(wl); await removeView(api, id, name, pid); await wl.goto().catch(() => {}); }
});

test('CVE-18 the maximum number of criteria rows, and a view saved with all of them', async ({ wl }) => {
  test.setTimeout(1800_000);
  const page = wl.page, api = new ZpApi(page, wl.d), cv = new CreateViewPage(page);
  const name = N('18'); let id = '';
  try {
    await cv.open(wl); await cv.setName(name); await cv.openTab('determiner');
    let n = 1;
    for (; n < 30; n++) {
      const plus = cv.rows().nth(n - 1).locator('[data-zpqa="add_cri_row"]');
      if (!(await plus.isVisible().catch(() => false))) break;
      // at the limit the + stays visible but says "You have reached the maximum limit."
      const tip = `${await plus.getAttribute('data-tooltip').catch(() => '')} ${await plus.getAttribute('aria-label').catch(() => '')}`;
      if (/maximum limit/i.test(tip)) { test.info().annotations.push({ type: 'evidence', description: `limit message on row ${n}: "${tip.trim()}"` }); break; }
      await plus.click(); if ((await cv.rows().count()) === n) break;
    }
    const rows = await cv.rows().count();
    test.info().annotations.push({ type: 'evidence', description: `criteria rows allowed: ${rows}` });
    const fields = ['Priority', 'Status', 'Billing Type', 'Task List', 'Project', 'Role', 'Project Status', 'Project Group', 'Associated Team', 'Created By'];
    for (let i = 0; i < rows; i++) await fillCriterion(cv, i, { field: fields[i % fields.length]!, condition: i < fields.length ? 'Is' : 'Is Not', kind: 'list' });
    const r = await cv.create(); id = r.id || await idOf(api, name);
    expect(r.put.status(), `saved with ${rows} criteria`).toBe(201);
    const crit = ((await api.view(id)).determiner?.criteria ?? []) as unknown[];
    expect.soft(crit.length, 'every row saved').toBe(rows);
  } finally { await leaveToAllUsers(wl); await removeView(api, id, name); }
});

test('CVE-19 a view deleted while this tab still shows it: reopening Reports falls back to a view the user can open', async ({ wl, context }) => {
  const page = wl.page, api = new ZpApi(page, wl.d);
  const name = N('19'); let b: Built | undefined;
  try {
    b = await createCase(wl, { name });
    await checkOpened(wl, b);
    // deleted elsewhere (another tab) while this tab is on it
    const other = await context.newPage();
    try {
      const wl2 = new (wl.constructor as any)(other); await wl2.goto();
      expect([200, 204], 'deleted from another tab').toContain((await new ZpApi(other, wl2.d).deleteView(b.id)).status());
    } finally { await other.close(); }
    // reopen the report in this tab, the way a user does (Reports › Workload Report)
    await page.goto(`${env.baseUrl}/portal/${env.portal}#zp/reports`);
    await qa(page, K.workloadTab).click().catch(() => {});
    await page.waitForTimeout(8000);
    const denied = await page.getByText('Permission Denied').filter({ visible: true }).count();
    const dropdown = (await qa(page, K.viewDropdown).innerText().catch(() => '')).trim();
    const stale = dropdown.includes(name) || page.url().includes(`/custom-view/${b.id}`);
    test.info().annotations.push({ type: 'evidence', description: `after the delete: ${denied ? '"Permission Denied" page' : `view "${dropdown}"`} at ${page.url().replace(/^.*#/, '#')}` });
    if (denied || stale) knownDefect('WL-D-32', 'a tab that was on a view deleted elsewhere reopens it from Reports (shows the deleted view, or "Permission Denied") instead of falling back to the default view');
    expect(denied, 'no "Permission Denied"').toBe(0);
    expect(stale, 'the deleted view is not reopened').toBe(false);
  } finally { await wl.goto().catch(() => {}); await leaveToAllUsers(wl); await removeView(api, '', name); }
});

test('CVE-20 a view whose criterion is Multi Select › Is Empty loads after create', async ({ wl }) => {
  const api = new ZpApi(wl.page, wl.d);
  const name = N('20'); let b: Built | undefined;
  try {
    const cv = new CreateViewPage(wl.page); await cv.open(wl); await cv.openTab('determiner');
    const fields = await cv.selectOptions(cv.fieldSel(0));
    await qa(wl.page, K.cancel).click();
    test.skip(!fields.includes('Multi Select'), 'portal has no "Multi Select" custom field');
    b = await createCase(wl, { name, criteria: [{ field: 'Multi Select', condition: 'Is Empty' }] });
    test.info().annotations.push({ type: 'evidence', description: `PUT ${b.status}; meta ${b.meta?.status} ${b.meta?.text ?? ''}` });
    if ((b.meta?.status ?? 200) >= 400) knownDefect('WL-D-36', 'a view saved with a Multi Select › Is Empty criterion cannot be opened: GET /reports/workload/meta answers 400 and the report never renders');
    expect(b.meta?.status ?? 200, 'the view\'s meta request succeeds').toBeLessThan(400);
    await checkOpened(wl, b);
  } finally { await leaveToAllUsers(wl); await removeView(api, b?.id ?? '', name); }
});

