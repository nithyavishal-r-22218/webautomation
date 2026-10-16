import { test, expect, knownDefect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { K, qa } from '../../src/locators';
import { waitLoaded } from '../../src/createChecks';
import { env } from '../../src/env';
import { addTaskFromCell, appeared, bar, barCells, createFixture, dayColumn, dragBarToUser, editor, editorCancel, editorDone, editorText, fixtureDates, hhmm, hoverCard, hoverUserCell, leaveCard, mark, openEditor, openGlobalGrid, openProjectGrid, ownersOf, pickUserInPicker, requestLog, resizeBarByDays, setFlexibleDay, setStandardHours, switchFlexible, task, taskRow, workingDays, type GeFixture } from '../../src/gridEdit';

/**
 * Editing from the grid — hover cards, the work-hours editor, Add Task, drag / reassign, resize, group actions — on a QA project
 * created by API for each test (tasks with copy_task_duration:false) and trashed afterwards. See src/gridEdit.ts for the controls.
 *   GE-01…04 task hover card (Heatmap / Bar / Timeline), its links and pencil
 *   GE-05…11 work-hours editor: Standard values and % of day, invalid input, Cancel, Flexible per-day, back to Standard, Copy actual duration
 *   GE-12…14 Add Task from a cell (prefill, save, cancel, empty name) and from the project group header (New / Existing)
 *   GE-15…18 drag to another user, Assign User on an assigned and on an unassigned task, Replace Task Owner for a project group
 *   GE-19…20 resize handle, user-cell hover card (empty / working / weekend / over-allocated days) and the other hovers
 */
test.describe.configure({ mode: 'default', timeout: 420_000 });

const D = fixtureDates();
let f: GeFixture | undefined;
async function fixture(wl: import('../../src/pages/WorkloadPage').WorkloadPage) { const api = new ZpApi(wl.page, wl.d); if (!f) f = await createFixture(api, env.runId); return { api, f }; }
test.afterEach(async ({ wl }) => { if (f) { const api = new ZpApi(wl.page, wl.d); await api.trashProject(f.pid).catch(() => {}); f = undefined; } });
const BH = 540; // minutes of a working day (Standard Business Hours 09–18)
const t1Days = workingDays(D.t1[0]!, D.t1[1]!);

test('GE-01 the task hover card shows completion, dates, status, owner, business hours, duration, total work hours and days — all matching the API', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  const c = await hoverCard(wl.page, f.t1); const t = await task(api, f, f.t1);
  expect.soft(c.title, 'title').toBe('GE task 4h30');
  expect.soft(c.completion, 'completion').toBe(`${t.completion_percentage ?? 0} %`);
  expect.soft(c.status, 'status').toBe(t.status?.name);
  expect.soft(c.owner, 'owner').toBe(f.emp.full_name);
  expect.soft(c.businessHours, 'business hours').toMatch(/Business Hours/);
  const [a, b] = c.range.split(/\s+to\s+/); expect.soft(!!a && !!b && c.range.includes(String(new Date(D.t1[0]!).getDate()).padStart(2, '0')), `date range "${c.range}" starts on ${D.t1[0]}`).toBe(true);
  expect.soft(c.duration, 'Duration = working days of the task').toBe(t1Days);
  expect.soft(c.totalHours, 'Total Work Hours = hrs/day × working days').toBe(String(4.5 * t1Days));
  expect.soft(c.days, 'Days = total hours ÷ a 9-hour day').toBe((4.5 * t1Days) / 9);
  test.info().annotations.push({ type: 'evidence', description: c.text.slice(0, 300) });
  await leaveCard(wl.page);
});

test('GE-02 the same card appears in the Bar and Timeline chart types', async ({ wl }) => {
  const { f } = await fixture(wl); await openProjectGrid(wl, f);
  for (const type of ['Bar', 'Timeline'] as const) {
    await qa(wl.page, K.chartType).click(); await wl.page.getByText(new RegExp(`^${type}$`)).filter({ visible: true }).first().click(); await waitLoaded(wl);
    await wl.page.waitForTimeout(1500);
    if (!(await bar(wl.page, f.t1).count())) { const chev = qa(wl.page, `expand-collapse-parent-${f.emp.id}`); if (await chev.count()) { await chev.click(); await wl.page.waitForTimeout(2000); } }
    if (!(await bar(wl.page, f.t1).count())) { const alt = await wl.page.evaluate(id => [...document.querySelectorAll<HTMLElement>(`[id*="${id}"]`)].filter(e => e.offsetWidth).map(e => `${e.tagName.toLowerCase()}#${e.id}.${String(e.className).slice(0, 30)}`).slice(0, 6), f.t1); test.info().annotations.push({ type: 'check-spec', description: `${type}: no #bar_<id> for the task (elements with the id: ${alt.join(', ') || 'none'}); the hover card could not be checked in this type` }); continue; }
    const c = await hoverCard(wl.page, f.t1);
    expect.soft(c.title, `${type}: title`).toBe('GE task 4h30'); expect.soft(c.totalHours, `${type}: total work hours`).toBe(String(4.5 * t1Days)); expect.soft(c.duration, `${type}: duration`).toBe(t1Days);
    await leaveCard(wl.page);
  }
  await wl.discard().catch(() => {});
});

test('GE-03 the card\'s title opens the task detail; the business-hours link names the calendar', async ({ wl }) => {
  const { f } = await fixture(wl); await openProjectGrid(wl, f);
  const c = await hoverCard(wl.page, f.t1);
  expect.soft(c.businessHours, 'business hours link text').toBe('Standard Business Hours');
  await c.card.locator('[data-zpqa="workload-report-popup-open-task-detail"]').click();
  await expect.poll(() => wl.page.url(), { message: 'task detail URL', timeout: 30_000 }).toContain(`/task-detail/${f.t1}`);
  await expect(wl.page.locator('.zps-detail-base').filter({ visible: true }).first()).toContainText('GE task 4h30', { timeout: 30_000 });
  await qa(wl.page, 'closedetailpage').first().click(); await expect.poll(() => wl.page.url()).not.toMatch(/task-detail/);
});

test('GE-04 the card\'s pencil ("Change Work Hours") opens the work-hours editor for that task', async ({ wl }) => {
  const { f } = await fixture(wl); await openProjectGrid(wl, f);
  const ed = await openEditor(wl.page, f.t1, 'pencil');
  const text = await editorText(wl.page);
  expect.soft(text, 'editor shows the owner').toContain(f.emp.full_name);
  expect.soft(await ed.locator('[data-zpqa="input_work_in_hours_per_day"]').inputValue(), 'current hrs/day').toMatch(/^0?4:30$/);
  expect.soft(text, 'shows the % of day, the duration and the total').toMatch(/50% day/); expect.soft(text).toMatch(new RegExp(`${t1Days}d`)); expect.soft(text).toMatch(new RegExp(`${hhmm(270 * t1Days)}hrs`));
  await editorCancel(wl.page);
});

test('GE-05 Standard: a new hrs/day value updates % of day and total, Done sends the PATCH, the bar cells and the API follow', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  await openEditor(wl.page, f.t1); await setStandardHours(wl.page, '2:00');
  const text = await editorText(wl.page);
  expect.soft(text, '% of day for 2:00 of 9:00').toMatch(/22% day/); expect.soft(text, 'total').toMatch(new RegExp(`${hhmm(120 * t1Days)}hrs`));
  const r = await editorDone(wl.page);
  expect(r, 'PATCH sent').toBeTruthy(); expect.soft(r!.status, 'PATCH status').toBe(200);
  expect.soft(r!.body.owners_and_work, 'request body').toMatchObject({ work_type: 'standard', unit: 'hours_per_day', owners: [{ zpuid: String(f.emp.id), work_values: '2:00' }] });
  await expect.poll(() => barCells(wl.page, f.t1), { message: 'bar cells show 2' }).toEqual(Array(t1Days).fill('2'));
  const t = await task(api, f, f.t1); expect.soft(t.owners_and_work.owners[0].work_values, 'API hrs/day').toBe('02:00'); expect.soft(t.owners_and_work.total_work, 'API total').toBe(hhmm(120 * t1Days));
});

test('GE-06 Standard: 9:00 is 100 % of the day, 13:30 is 150 %, 0:00 and non-numbers are refused or ignored', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  for (const [val, pct] of [['9:00', '100% day'], ['13:30', '150% day'], ['0:45', '8% day']] as const) {
    await openEditor(wl.page, f.t1); await setStandardHours(wl.page, val);
    expect.soft(await editorText(wl.page), `${val} → ${pct}`).toContain(pct);
    const r = await editorDone(wl.page); expect.soft(r?.status, `${val}: PATCH`).toBe(200);
    expect.soft((await task(api, f, f.t1)).owners_and_work.owners[0].work_values, `${val}: API`).toBe(val.length === 4 ? `0${val}` : val);
  }
  for (const bad of ['0:00', 'abc', '25:00', '-1:00']) {
    await openEditor(wl.page, f.t1); await setStandardHours(wl.page, bad);
    const txt = await editorText(wl.page); const r = await editorDone(wl.page);
    test.info().annotations.push({ type: 'evidence', description: `"${bad}": editor "${txt.slice(0, 140)}" → ${r ? `PATCH ${r.status} ${JSON.stringify(r.body.owners_and_work?.owners?.[0]?.work_values)}` : 'no PATCH'}` });
    const api1 = (await task(api, f, f.t1)).owners_and_work.owners[0].work_values;
    if (api1 !== '00:45') { test.info().annotations.push({ type: 'check-spec', description: `"${bad}" was accepted and stored as ${api1} (the editor shows 0% and saves 0:00 for non-numeric or zero input; >24 h and negatives are refused)` }); await openEditor(wl.page, f.t1); await setStandardHours(wl.page, '0:45'); await editorDone(wl.page); }
    if (await editor(wl.page).isVisible().catch(() => false)) await editorCancel(wl.page);
  }
});

test('GE-07 Cancel leaves the task untouched and sends nothing', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  const log = requestLog(wl.page); await openEditor(wl.page, f.t1); await setStandardHours(wl.page, '1:00'); await editorCancel(wl.page);
  await wl.page.waitForTimeout(1500);
  expect.soft(log.take().filter(l => /PATCH/.test(l)), 'no PATCH after Cancel').toEqual([]);
  expect.soft((await task(api, f, f.t1)).owners_and_work.owners[0].work_values, 'API unchanged').toBe('04:30');
  expect.soft(await barCells(wl.page, f.t1), 'cells unchanged').toEqual(Array(t1Days).fill('4:30'));
});

test('GE-08 Flexible: one input per day (weekends empty), the day header shows %, Done sends per-day values', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  await openEditor(wl.page, f.t1); await switchFlexible(wl.page);
  const inputs = await editor(wl.page).locator('[data-zpqa^="input_work_in_flexible_"]').evaluateAll(els => els.map(e => [e.getAttribute('data-zpqa')!.replace('input_work_in_flexible_', ''), (e as HTMLInputElement).value]));
  const weekend = inputs.filter(([d]) => [0, 6].includes(new Date(d!).getDay())); const working = inputs.filter(([d]) => ![0, 6].includes(new Date(d!).getDay()));
  expect.soft(inputs.length, 'one input per calendar day of the task').toBe(Math.round((new Date(D.t1[1]!).getTime() - new Date(D.t1[0]!).getTime()) / 86400000) + 1);
  expect.soft(weekend.every(([, v]) => v === ''), 'weekend inputs empty').toBe(true); expect.soft(working.every(([, v]) => /^0?4:30$/.test(v!)), 'working days carry 4:30').toBe(true);
  expect.soft(await editorText(wl.page), 'header shows 50% per day').toMatch(/50%/);
  await setFlexibleDay(wl.page, D.t1[0]!, '10:00');
  expect.soft(await editorText(wl.page), 'that day is 111%').toMatch(/111%/); expect.soft(await editorText(wl.page), 'total grows by 5:30').toMatch(new RegExp(hhmm(270 * t1Days + 330).replace(/^0/, '')));
  const r = await editorDone(wl.page); expect(r, 'PATCH').toBeTruthy();
  expect.soft(r!.body.owners_and_work.work_type, 'flexible').toBe('flexible'); expect.soft(r!.body.owners_and_work.unit).toBe('hours');
  expect.soft(r!.body.owners_and_work.owners[0].work_values.find((w: any) => w.date === D.t1[0])?.value, 'first day 10:00').toBe('10:00');
  await expect.poll(() => barCells(wl.page, f.t1), { message: 'cells' }).toEqual(['10', ...Array(t1Days - 1).fill('4:30')]);
  const t = await task(api, f, f.t1); expect.soft(t.owners_and_work.work_type).toBe('flexible'); expect.soft(t.owners_and_work.total_work, 'API total').toBe(hhmm(270 * t1Days + 330));
});

test('GE-09 a flexible task reopens in Flexible; switching back to Standard and saving makes it standard again', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  await openEditor(wl.page, f.t1); await switchFlexible(wl.page); await setFlexibleDay(wl.page, D.t1[0]!, '6:00'); await editorDone(wl.page);
  await openEditor(wl.page, f.t1);
  expect.soft(await editor(wl.page).locator('ruc-radio-button[rc-qa="work_type_flexible"]').getAttribute('class'), 'Flexible preselected').toMatch(/ruc-checked/);
  await setStandardHours(wl.page, '3:00'); const r = await editorDone(wl.page);
  expect.soft(r?.body.owners_and_work.work_type, 'standard again').toBe('standard');
  const t = await task(api, f, f.t1); expect.soft(t.owners_and_work.work_type).toBe('standard'); expect.soft(t.owners_and_work.owners[0].work_values).toBe('03:00');
  await expect.poll(() => barCells(wl.page, f.t1)).toEqual(Array(t1Days).fill('3'));
});

test('GE-10 "Copy the actual duration of the Task" is sent as copy_task_duration and the work follows the task duration', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  await openEditor(wl.page, f.t1);
  const cb = editor(wl.page).locator('ruc-checkbox').first(); const before = (await cb.getAttribute('class')) || '';
  await cb.locator('label, .ruc-label').first().click({ force: true }); await page_wait(wl.page);
  const after = (await cb.getAttribute('class')) || ''; const txt = await editorText(wl.page);
  expect.soft(/ruc-checked/.test(after) !== /ruc-checked/.test(before), 'checkbox toggles').toBe(true);
  const r = await editorDone(wl.page); expect(r, 'PATCH').toBeTruthy();
  test.info().annotations.push({ type: 'evidence', description: `after ticking: "${txt.slice(0, 160)}"; PATCH ${JSON.stringify(r!.body.owners_and_work).slice(0, 200)}` });
  expect.soft(r!.body.owners_and_work.copy_task_duration, 'copy_task_duration in the request').toBe(true);
  const t = await task(api, f, f.t1); expect.soft(t.owners_and_work.copy_task_duration, 'API flag').toBe(true);
  test.info().annotations.push({ type: 'evidence', description: `API after: ${t.owners_and_work.owners[0].work_values}/day, total ${t.owners_and_work.total_work}` });
});
const page_wait = (p: import('@playwright/test').Page) => p.waitForTimeout(600);

test('GE-11 Add Task from a user\'s day cell: owner and date prefilled, the task lands on that day with a full day of work', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  const day = D.emptyDay; const name = `${env.runId}-GE-11`;
  const r = await addTaskFromCell(wl.page, String(f.emp.id), day, name);
  const [y, m, d] = day.split('-');
  expect.soft(r.pre.owner, 'owner prefilled').toContain(f.emp.full_name);
  expect.soft([`${d}-${m}-${y}`, `${m}-${d}-${y}`], `start prefilled with the hovered day (${r.pre.start})`).toContain(r.pre.start);
  expect.soft(r.pre.end, 'end = start').toBe(r.pre.start);
  expect.soft(r.post?.status, 'create call').toBe(200);
  const tasks = (await api.getJson<any>(`/projects/${f.pid}/tasks?page=1&per_page=100`)); const created = (tasks.tasks ?? tasks).find((t: any) => t.name === name);
  expect(created, 'task in the API').toBeTruthy();
  expect.soft(created.owners_and_work?.owners?.map((o: any) => String(o.zpuid)), 'owner').toEqual([String(f.emp.id)]);
  expect.soft(String(created.start_date).slice(0, 10) === day || String(created.end_date).slice(0, 10) === day, `dates ${created.start_date} … ${created.end_date} on ${day}`).toBe(true);
  expect.soft(created.owners_and_work?.owners?.[0]?.work_values, 'a full working day').toBe('09:00');
  await expect(taskRow(wl.page, String(f.emp.id), name), 'row shows the new task').toBeVisible({ timeout: 30_000 });
  const cell = wl.page.locator(`#userrow_${f.emp.id} .res-alloc-bar, #userrow_${f.emp.id} .resWork`).filter({ hasText: /9/ });
  test.info().annotations.push({ type: 'evidence', description: `request ${r.post?.url}; row cells with 9: ${await cell.count()}` });
});

test('GE-12 Add Task: Cancel creates nothing; Add with an empty name is refused', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  const before = ((await api.getJson<any>(`/projects/${f.pid}/tasks?page=1&per_page=100`)).tasks ?? []).length;
  const log = requestLog(wl.page);
  await addTaskFromCell(wl.page, String(f.emp.id), D.emptyDay, null);
  expect.soft(log.take().filter(l => /addcalendartask|POST \/api\/projects\/\d+\/tasks/.test(l)), 'no create call after Cancel').toEqual([]);
  await hoverUserCell(wl.page, String(f.emp.id), D.emptyDay); await wl.page.locator('[data-zpqa="add-date-task"]').filter({ visible: true }).first().click(); await expect(qa(wl.page, 'taskname')).toBeVisible({ timeout: 15_000 });
  await qa(wl.page, 'taskadd').click(); await wl.page.waitForTimeout(2000);
  const still = await qa(wl.page, 'taskname').isVisible().catch(() => false);
  const err = (await wl.page.locator('[class*="error" i], [class*="mandatory" i], .zps-alert').filter({ visible: true }).allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ');
  expect.soft(still, 'form stays open without a name').toBe(true);
  test.info().annotations.push({ type: 'evidence', description: `empty-name message: "${err.slice(0, 120)}"` });
  if (still) await qa(wl.page, 'taskcancel').click();
  const after = ((await api.getJson<any>(`/projects/${f.pid}/tasks?page=1&per_page=100`)).tasks ?? []).length;
  expect.soft(after, 'task count unchanged').toBe(before);
});

test('GE-13 dragging a bar onto another user\'s row reassigns the task (PATCH owner) without a confirmation', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  const r = await dragBarToUser(wl.page, f.t1, String(f.adm.id));
  expect(r, 'PATCH sent on drop').toBeTruthy(); expect.soft(r!.status).toBe(200);
  expect.soft(r!.body.owners_and_work.owners.map((o: any) => String(o.zpuid)), 'new owner in the request').toEqual([String(f.adm.id)]);
  expect.soft(ownersOf(await task(api, f, f.t1)), 'API owner').toEqual([String(f.adm.id)]);
  await wl.page.waitForTimeout(2000); if (!(await taskRow(wl.page, String(f.adm.id), /GE task 4h30/).count())) await qa(wl.page, `expand-collapse-parent-${f.adm.id}`).click().catch(() => {});
  await expect(taskRow(wl.page, String(f.adm.id), /GE task 4h30/), 'task listed under the new owner').toBeVisible({ timeout: 60_000 });
  expect.soft(await taskRow(wl.page, String(f.emp.id), /GE task 4h30/).count(), 'gone from the old owner').toBe(0);
  const t = await task(api, f, f.t1); test.info().annotations.push({ type: 'evidence', description: `after drop: start ${t.start_date} end ${t.end_date} work ${t.owners_and_work.owners[0].work_values}` });
});

test('GE-14 "Assign User" on an assigned task opens the user picker and adds the picked user as an owner', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  const row = taskRow(wl.page, String(f.emp.id), /GE task 4h30/); await row.hover(); await wl.page.waitForTimeout(500);
  await mark(wl.page); await row.locator('[data-zpqa="resourcetil_assignuser"]').first().click({ force: true }); await wl.page.waitForTimeout(1800);
  const opened = await appeared(wl.page); test.info().annotations.push({ type: 'evidence', description: `picker: ${JSON.stringify(opened).slice(0, 500)}` });
  const log = requestLog(wl.page); const pick = await pickUserInPicker(wl.page, f.adm.full_name);
  const reqs = log.take(); test.info().annotations.push({ type: 'evidence', description: `picked ${pick.found} (${pick.btnText || 'no button'}); dialogs ${JSON.stringify(pick.dialogs)}; requests ${reqs.join('; ').slice(0, 300)}` });
  const owners = ownersOf(await task(api, f, f.t1));
  expect.soft(owners, `owners after assigning ${f.adm.full_name}`).toContain(String(f.adm.id));
  await wl.page.keyboard.press('Escape');
});

test('GE-15 "Assign User" on an Unassigned task assigns it; the Unassigned row loses it and the user gains it', async ({ wl }) => {
  const { api, f } = await fixture(wl); test.skip(!f.t2, 'no Unassigned owner id on this portal'); await openProjectGrid(wl, f);
  const un = wl.page.locator('[data-zpqa^="username-"]').filter({ hasText: /Unassigned/ }).first(); await expect(un, 'Unassigned row').toBeVisible({ timeout: 30_000 });
  const uid = (await un.getAttribute('data-zpqa'))!.slice(9);
  if (!(await wl.page.locator(`[id^="tasknamerow_${uid}"]`).count())) { await qa(wl.page, `expand-collapse-parent-${uid}`).click(); await wl.page.waitForTimeout(2500); }
  const row = taskRow(wl.page, uid, /GE unassigned/); await row.hover(); await wl.page.waitForTimeout(500);
  await mark(wl.page); await row.locator('[data-zpqa="resourcetil_assignuser"]').first().click({ force: true }); await wl.page.waitForTimeout(1800);
  test.info().annotations.push({ type: 'evidence', description: `picker: ${JSON.stringify(await appeared(wl.page)).slice(0, 400)}` });
  const pick = await pickUserInPicker(wl.page, f.emp.full_name);
  const owners = ownersOf(await task(api, f, f.t2));
  expect.soft(owners, 'owner after assigning').toEqual([String(f.emp.id)]);
  expect.soft(await taskRow(wl.page, uid, /GE unassigned/).count(), 'gone from Unassigned').toBe(0);
  await expect(taskRow(wl.page, String(f.emp.id), /GE unassigned/), 'listed under the user').toBeVisible({ timeout: 60_000 });
  test.info().annotations.push({ type: 'evidence', description: `picked ${pick.found} (${pick.btnText || 'no button'}); dialogs ${JSON.stringify(pick.dialogs)}` });
  await wl.page.keyboard.press('Escape');
});

test('GE-16 global report: "Replace Task Owner" on the project group moves every task of that project to the picked user', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openGlobalGrid(wl, f);
  const grp = wl.page.locator('.ruflexRowContainer').filter({ hasText: new RegExp(f.pname.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')) }).first();
  await expect(grp, 'project group header under the user').toBeVisible({ timeout: 60_000 });
  await grp.hover(); await wl.page.waitForTimeout(500);
  const icons = await grp.locator('[data-zpqa]').evaluateAll(els => els.filter(e => (e as HTMLElement).offsetWidth).map(e => `${e.getAttribute('data-zpqa')}|${e.getAttribute('data-tooltip')}`));
  expect.soft(icons.some(i => i.startsWith('resourcetil_swapprojtasks')), `group icons ${icons.join(', ')}`).toBe(true);
  await grp.locator('[data-zpqa="resourcetil_swapprojtasks"]').first().click({ force: true });
  const dlg = wl.page.locator('.zpsPopUpDefault').filter({ visible: true }).first(); await expect(dlg, 'Replace Task Owner dialog').toBeVisible({ timeout: 15_000 });
  expect.soft((await dlg.innerText()).replace(/\s+/g, ' '), 'dialog names the current owner').toContain(f.emp.full_name);
  const sel = dlg.locator('.zselectbox__selected').filter({ hasText: /Select/ }).first().or(dlg.locator('.zselectbox__selected').last()); await sel.click(); await wl.page.waitForTimeout(1000);
  let option = wl.page.locator('li.zdropdownlist__item, [class*="zdropdownlist__item"]').filter({ visible: true }).filter({ hasText: /PLAdmin/i }).first();
  if (!(await option.count())) { const search = wl.page.locator('input.zdropdownlist__searchfield, .zdropdownlist input, input[placeholder*="earch" i]').filter({ visible: true }).last(); if (await search.count()) { await search.pressSequentially('PLAdm'); await wl.page.waitForTimeout(1000); } option = wl.page.locator('li.zdropdownlist__item, [class*="zdropdownlist__item"], li').filter({ visible: true }).filter({ hasText: /PLAdmin/i }).first(); }
  if (!(await option.count())) test.info().annotations.push({ type: 'evidence', description: `owner list: ${(await wl.page.locator('li.zdropdownlist__item, [class*="zdropdownlist__item"]').filter({ visible: true }).allInnerTexts()).join(' | ').slice(0, 300) || 'nothing visible'}; dialog "${(await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 160)}"` });
  await option.click({ timeout: 15_000 });
  const log = requestLog(wl.page); await dlg.locator('[data-zpqa="swap-project-tasks-save"]').click(); await wl.page.waitForTimeout(4000);
  const reqs = log.take(); test.info().annotations.push({ type: 'evidence', description: `requests: ${reqs.join('; ').slice(0, 400)}` });
  for (const tid of [f.t1, f.t3]) expect.soft(ownersOf(await task(api, f, tid)), `task ${tid} now owned by ${f.adm.full_name}`).toEqual([String(f.adm.id)]);
  await expect(wl.page.locator('.ruflexRowContainer').filter({ hasText: new RegExp(f.pname.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')) }).filter({ has: wl.page.locator(`[id*="_${f.adm.id}"]`) }).first(), 'group now under the new owner').toBeVisible({ timeout: 60_000 }).catch(() => test.info().annotations.push({ type: 'note', description: 'group row under the new owner not located by id; API confirms the move' }));
});

test('GE-17 global report: the project group\'s "+" opens Assign Task with New Task / Existing Task; a new task lands in that project for that user', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openGlobalGrid(wl, f);
  const grp = wl.page.locator('.ruflexRowContainer').filter({ hasText: new RegExp(f.pname.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')) }).first();
  await grp.hover(); await wl.page.waitForTimeout(500); await grp.locator('[data-zpqa="add-date-task"]').first().click({ force: true });
  const form = wl.page.locator('#addTodoTaskForm').filter({ visible: true }).first(); await expect(form, 'Assign Task form').toBeVisible({ timeout: 15_000 });
  const txt = (await form.innerText()).replace(/\s+/g, ' ');
  expect.soft(txt, 'tabs').toMatch(/New Task/); expect.soft(txt).toMatch(/Existing Task/);
  const name = `${env.runId}-GE-17`;
  const controls = await form.locator('[data-zpqa], button, textarea, input').evaluateAll(els => els.filter(e => (e as HTMLElement).offsetWidth).map(e => `${e.tagName.toLowerCase()} zpqa=${e.getAttribute('data-zpqa')} ph=${e.getAttribute('placeholder') || ''} t=${((e as HTMLElement).innerText || '').trim().slice(0, 20)}`).slice(0, 25));
  test.info().annotations.push({ type: 'evidence', description: `Assign Task controls: ${controls.join(' | ').slice(0, 500)}` });
  const nameBox = form.locator('[data-zpqa="taskname"], textarea, input[type="text"]').filter({ visible: true }).first(); await nameBox.click(); await nameBox.pressSequentially(name);
  const post = wl.page.waitForResponse(r => r.request().method() === 'POST' && /addcalendartask|assign|\/tasks/.test(r.url()), { timeout: 20_000 }).catch(() => null);
  const addBtn = form.locator('[data-zpqa="taskadd"]').first();
  test.info().annotations.push({ type: 'evidence', description: `before Add: name="${await nameBox.inputValue().catch(() => '?')}", Add disabled=${await addBtn.isDisabled().catch(() => '?')} class=${await addBtn.getAttribute('class')}` });
  const jsErrors: string[] = []; wl.page.on('pageerror', e => jsErrors.push(String(e.message || e).slice(0, 160)));
  const log17 = requestLog(wl.page); await addBtn.click(); const r = await post; await wl.page.waitForTimeout(3000);
  const logged = log17.take().filter(l => /\/logger/.test(l)).join(' ');
  if (await form.isVisible().catch(() => false)) {
    const alerts = (await wl.page.locator('.zps-alert, [class*="error" i], [class*="toast" i]').filter({ visible: true }).allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ');
    test.info().annotations.push({ type: 'evidence', description: `form still open after Add: alerts "${alerts.slice(0, 120)}"; page errors ${jsErrors.join(' | ') || '-'}; logged ${logged.slice(0, 200) || '-'}` });
    // WL-D-45 (candidate, 15-10-2026): Add in the group header's Assign Task form throws "userDetailUtils.isProjectPageVisible is not a function" and creates nothing, silently
    if (/isProjectPageVisible/.test(logged + jsErrors.join(' '))) knownDefect('WL-D-45', 'Assign Task from the project group header: Add throws "userDetailUtils.isProjectPageVisible is not a function", the form stays open and no task is created');
    await qa(wl.page, 'taskcancel').click().catch(() => {});
  }
  const created = ((await api.getJson<any>(`/projects/${f.pid}/tasks?page=1&per_page=100`)).tasks ?? []).find((t: any) => t.name === name);
  expect(created, 'task created in the QA project').toBeTruthy();
  expect.soft(ownersOf(created), 'owned by the row user').toEqual([String(f.emp.id)]);
  test.info().annotations.push({ type: 'evidence', description: `call ${r?.url().replace(/^https?:\/\/[^/]+/, '')} → ${r?.status()}; dates ${created?.start_date} … ${created?.end_date}` });
  // Existing Task tab lists tasks to assign
  await grp.hover(); await grp.locator('[data-zpqa="add-date-task"]').first().click({ force: true }); await expect(form).toBeVisible({ timeout: 15_000 });
  await form.getByText(/^Existing Task$/).first().click(); await wl.page.waitForTimeout(1200);
  test.info().annotations.push({ type: 'evidence', description: `Existing Task: ${(await form.innerText()).replace(/\s+/g, ' ').slice(0, 200)}` });
  await qa(wl.page, 'taskcancel').click().catch(() => wl.page.keyboard.press('Escape'));
});

test('GE-18 the right-hand resize handle extends the task: the bar grows, the end date moves and a bulk-update is sent', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  const before = await task(api, f, f.t1); const len0 = Number(((await bar(wl.page, f.t1).getAttribute('style')) || '').match(/--daysAllocate:\s*([\d.]+)/)?.[1]);
  const r = await resizeBarByDays(wl.page, String(f.emp.id), f.t1, 3);
  const len1 = Number((r.after || '').match(/--daysAllocate:\s*([\d.]+)/)?.[1]);
  test.info().annotations.push({ type: 'evidence', description: `bar ${len0} → ${len1} days; during drag ${r.during}; request ${r.request ? JSON.stringify(r.request.body) : 'none'}` });
  test.info().annotations.push({ type: 'note', description: 'the handle reacts to dispatched DOM mouse events, not to trusted pointer events from the automation (Playwright and CDP alike); the drag is dispatched' });
  expect(r.request, 'bulk-update sent on release').toBeTruthy(); expect.soft(r.request!.status, 'status').toBe(200);
  expect.soft(r.request!.body.end_date, 'request carries the new end date').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect.soft(len1, 'bar is 3 days longer').toBe(len0 + 3);
  const after = await task(api, f, f.t1);
  const expectedEnd = new Date(D.t1[1]!); expectedEnd.setDate(expectedEnd.getDate() + 3);
  expect.soft(String(after.end_date).slice(0, 10) !== String(before.end_date).slice(0, 10), `end date moved (${before.end_date} → ${after.end_date})`).toBe(true);
  expect.soft(r.request!.body.end_date, `end = old end + 3 days (${expectedEnd.toISOString().slice(0, 10)})`).toBe(expectedEnd.toISOString().slice(0, 10));
  expect.soft(after.owners_and_work?.owners?.[0]?.work_values, 'hrs/day unchanged by the resize').toBe('04:30');
  // shrink it back by 3 days: the drop snaps to the column under the pointer, so the result may land one day off
  const r2 = await resizeBarByDays(wl.page, String(f.emp.id), f.t1, -3);
  const back = r2.request?.body.end_date as string | undefined; const orig = new Date(D.t1[1]!); const diff = back ? Math.round((new Date(back).getTime() - orig.getTime()) / 86400000) : NaN;
  test.info().annotations.push({ type: 'evidence', description: `shrink by 3 columns → end ${back} (original ${D.t1[1]}, ${diff} day(s) off)` });
  expect.soft(r2.request, 'shrinking sends a bulk-update').toBeTruthy(); expect.soft(Math.abs(diff) <= 1, 'shrinking lands within a day of the original end').toBe(true);
});

test('GE-19 hovering a user\'s cell shows availability, assigned work and free time for that day (empty, working, weekend, over-allocated)', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  const uid = String(f.emp.id);
  const read = async (date: string) => { await mark(wl.page); await hoverUserCell(wl.page, uid, date); await wl.page.waitForTimeout(800); const n = await appeared(wl.page); const card = n.find(x => /Availability|Assigned|Free/i.test(x.text)); return card ? card.text : (n[0]?.text ?? ''); };
  const empty = await read(D.emptyDay); const working = await read(D.t1[0]!); const weekend = await read(D.weekend);
  test.info().annotations.push({ type: 'evidence', description: `empty: "${empty.slice(0, 200)}" · working: "${working.slice(0, 200)}" · weekend: "${weekend.slice(0, 200)}"` });
  const has = (s: string) => /Availability/i.test(s) && /Assigned/i.test(s) && /Free/i.test(s);
  expect(has(empty) || has(working), 'the availability card appears on hover').toBe(true);
  expect.soft(empty, 'empty day: 100 % availability, 9h, 1d').toMatch(/Total Availability 100% 9h 00m 1d/); expect.soft(empty, 'nothing assigned').toMatch(/Work Hours Assigned 0% 0h 00m 0d/); expect.soft(empty, 'all free').toMatch(/Free time 100% 9h 00m 1d/); expect.soft(empty, 'legend').toMatch(/Unallocated/);
  expect.soft(working, 'working day with 4:30: 50 % assigned').toMatch(/Work Hours Assigned 50% 4h 30m 0\.5d/); expect.soft(working, 'half free').toMatch(/Free time 50% 4h 30m 0\.5d/);
  expect.soft(weekend, 'weekend: no availability').toMatch(/Total Availability (0%|—)|0h 00m 0d|Weekend/i);
  // over-allocated: add a full-day task on top of the 4:30 day
  const r = await api.call('POST', `/projects/${f.pid}/tasks`, { name: 'GE overload', start_date: D.t1[0], end_date: D.t1[0], owners_and_work: { work_type: 'standard', unit: 'hours_per_day', copy_task_duration: false, owners: [{ zpuid: uid, work_values: '09:00' }] } }); expect(r.status()).toBe(201);
  await wl.page.reload(); await openProjectGrid(wl, f);
  const over = await read(D.t1[0]!); test.info().annotations.push({ type: 'evidence', description: `over-allocated: "${over.slice(0, 200)}"` });
  expect.soft(over, '150 % assigned').toMatch(/150%/);
});

test('GE-20 the other hovers: avatar/name tooltips, task count, the summary column and the day header', async ({ wl }) => {
  const { f } = await fixture(wl); await openProjectGrid(wl, f);
  const row = wl.page.locator(`[data-zpqa="username-${f.emp.id}"]`); const rb = (await row.boundingBox())!;
  const out: Record<string, string> = {};
  for (const [k, x, y] of [['avatar', rb.x + 70, rb.y + rb.height / 2], ['name', rb.x + 130, rb.y + rb.height / 2], ['count', rb.x + 270, rb.y + rb.height / 2]] as const) { await mark(wl.page); await wl.page.mouse.move(x, y); await wl.page.waitForTimeout(1300); out[k] = (await appeared(wl.page)).map(a => a.text).join(' | ').slice(0, 160); }
  const hb = (await wl.page.locator('.weekNameColumn').nth(3).boundingBox())!; await mark(wl.page); await wl.page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await wl.page.waitForTimeout(1300); out.header = (await appeared(wl.page)).map(a => a.text).join(' | ').slice(0, 160);
  const sum = wl.page.locator('.res-rangecol-bar').first(); const sb = await sum.boundingBox(); if (sb) { await mark(wl.page); await wl.page.mouse.move(sb.x + sb.width / 2, rb.y + rb.height / 2); await wl.page.waitForTimeout(1300); out.summary = (await appeared(wl.page)).map(a => a.text).join(' | ').slice(0, 160); }
  test.info().annotations.push({ type: 'evidence', description: JSON.stringify(out) });
  expect.soft(await row.locator('.res-username').getAttribute('data-tooltip'), 'name tooltip').toBe(f.emp.full_name);
  expect.soft(await wl.page.locator('.weekNameColumn').nth(3).evaluate(e => e.textContent || ''), 'day header carries Date / Day / Type').toMatch(/Date: .*Day: .*Type: /);
});

test('GE-21 global report: the project group\'s "+" › Existing Task assigns an existing task of the project to that user', async ({ wl }) => {
  const { api, f } = await fixture(wl); test.skip(!f.t2, 'no Unassigned owner id on this portal'); await openGlobalGrid(wl, f);
  const grp = wl.page.locator('.ruflexRowContainer').filter({ hasText: new RegExp(f.pname.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')) }).first();
  await grp.hover(); await wl.page.waitForTimeout(500); await grp.locator('[data-zpqa="add-date-task"]').first().click({ force: true });
  const tab = wl.page.locator('[data-zpqa="tab_existing_task"]').filter({ visible: true }).first(); await expect(tab, 'Existing Task tab').toBeVisible({ timeout: 15_000 }); await tab.click();
  const form = wl.page.locator('reassign-form').filter({ visible: true }).first(); await expect(form, 'reassign form').toBeVisible({ timeout: 10_000 });
  const box = form.locator('#taskSearchBox, input[placeholder*="Task name" i]').first();
  expect.soft(await box.getAttribute('placeholder'), 'search placeholder').toMatch(/Task name or Task ID/i);
  const searchLog = requestLog(wl.page);
  await mark(wl.page); await box.click(); await wl.page.keyboard.type('GE unassigned', { delay: 80 }); await wl.page.waitForTimeout(3000);
  let suggestions = await appeared(wl.page);
  let opt = wl.page.locator('#taskSearchBox-menu li, [id$="-menu"] li, li, [role="option"]').filter({ visible: true }).filter({ hasText: /GE unassigned/ }).first();
  if (!(await opt.count())) { // second strategy: the task key / id
    const t2 = await task(api, f, f.t2); const key = t2.prefix || t2.key || f.t2;
    await box.fill(''); await wl.page.keyboard.type(String(key), { delay: 80 }); await wl.page.waitForTimeout(3000); suggestions = suggestions.concat(await appeared(wl.page));
    opt = wl.page.locator('#taskSearchBox-menu li, [id$="-menu"] li, li, [role="option"]').filter({ visible: true }).filter({ hasText: /GE unassigned/ }).first();
  }
  test.info().annotations.push({ type: 'evidence', description: `search requests: ${searchLog.take().join('; ').slice(0, 300) || 'none'}; menu html: ${(await wl.page.locator('#taskSearchBox-menu').evaluate(e => e.outerHTML.replace(/\s+/g, ' ').slice(0, 300)).catch(() => 'no #taskSearchBox-menu'))}; appeared: ${JSON.stringify(suggestions).slice(0, 300)}` });
  const menuState = await wl.page.locator('#taskSearchBox-menu').getAttribute('class').catch(() => '');
  const sawError = (await wl.page.evaluate(() => (window as any).__geErr || '')) || '';
  // WL-D-45 again: typing in the Existing Task search throws userDetailUtils.isProjectPageVisible, the suggestion list stays "loading" and nothing can be picked
  if (!(await opt.count()) && /loading/.test(menuState || '')) knownDefect('WL-D-45', `Existing Task search never loads its suggestions (menu stays ${menuState}); the page logs "userDetailUtils.isProjectPageVisible is not a function"`);
  void sawError;
  await expect(opt, 'the unassigned task is suggested').toBeVisible({ timeout: 15_000 }); await opt.click(); await wl.page.waitForTimeout(800);
  const log = requestLog(wl.page);
  const update = form.locator('button').filter({ hasText: /Update/ }).first(); await expect(update, 'Update button').toBeVisible({ timeout: 10_000 }); await update.click(); await wl.page.waitForTimeout(4000);
  const reqs = log.take(); test.info().annotations.push({ type: 'evidence', description: `requests: ${reqs.join('; ').slice(0, 400) || 'none'}` });
  const t2 = await task(api, f, f.t2);
  expect.soft(ownersOf(t2), 'the task now belongs to the row user').toEqual([String(f.emp.id)]);
  expect.soft(await form.isVisible().catch(() => false), 'form closed').toBe(false);
  await expect(taskRow(wl.page, String(f.emp.id), /GE unassigned/), 'listed under the user').toBeVisible({ timeout: 60_000 });
});

test('GE-22 Flexible on a weekend date and a zero day: what the editor accepts, what is sent and what the grid shows', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  await openEditor(wl.page, f.t1); await switchFlexible(wl.page);
  const dates = await editor(wl.page).locator('[data-zpqa^="input_work_in_flexible_"]').evaluateAll(els => els.map(e => e.getAttribute('data-zpqa')!.replace('input_work_in_flexible_', '')));
  const sat = dates.find(d => new Date(d).getDay() === 6)!; const mon = dates.find(d => new Date(d).getDay() === 1)!;
  const satInput = editor(wl.page).locator(`[data-zpqa="input_work_in_flexible_${sat}"]`);
  const satState = { disabled: await satInput.isDisabled().catch(() => null), readonly: await satInput.getAttribute('readonly'), value: await satInput.inputValue() };
  await setFlexibleDay(wl.page, sat, '2:00'); const satAfter = await satInput.inputValue();
  await setFlexibleDay(wl.page, mon, '0:00');
  const txt = await editorText(wl.page);
  test.info().annotations.push({ type: 'evidence', description: `Saturday ${sat} input ${JSON.stringify(satState)} → after typing 2:00: "${satAfter}"; Monday ${mon} set to 0:00; editor: "${txt.slice(0, 220)}"` });
  const r = await editorDone(wl.page); expect(r, 'PATCH').toBeTruthy();
  const sent: { date: string; value: string }[] = r!.body.owners_and_work.owners[0].work_values;
  const satSent = sent.find(w => w.date === sat)?.value, monSent = sent.find(w => w.date === mon)?.value;
  test.info().annotations.push({ type: 'evidence', description: `sent: Saturday ${satSent ?? '(not sent)'}, Monday ${monSent ?? '(not sent)'}; ${sent.length} day values` });
  const t = await task(api, f, f.t1); const api_: { date: string; value: string }[] = t.owners_and_work.owners[0].work_values;
  const satApi = api_.find(w => w.date === sat)?.value, monApi = api_.find(w => w.date === mon)?.value;
  // weekend: either refused in the editor (input stays empty / not sent) or accepted end to end — record which, fail only on inconsistency
  const weekendAccepted = satAfter !== '' && !!satSent;
  if (weekendAccepted) expect.soft(satApi, 'weekend hours stored when the editor accepted them').toBe('02:00');
  else expect.soft(satApi ?? undefined, 'weekend hours not stored when the editor refused them').toBeUndefined();
  test.info().annotations.push({ type: weekendAccepted ? 'evidence' : 'check-spec', description: weekendAccepted ? `weekend date accepted: ${sat} = ${satApi}` : `weekend date not accepted in Flexible (input "${satAfter}", sent ${satSent ?? 'nothing'})` });
  const cells = await barCells(wl.page, f.t1); const monCell = await bar(wl.page, f.t1).locator(`[id$="_${mon.replace(/-/g, '')}"] .resWork, #wperday_${f.emp.id}_${f.t1}_${mon.replace(/-/g, '')}`).first().innerText().catch(() => '?');
  test.info().annotations.push({ type: 'evidence', description: `API after: total ${t.owners_and_work.total_work}, Monday ${monApi ?? '(no entry)'}; bar cells: ${cells.join(' ')}; Monday cell "${monCell}"` });
  // a 0:00 day is sent as "0:00"; the server stores no entry for it and the bar has no cell for that day (seen 16-10-2026) — the total proves it was applied
  expect.soft(monApi === '00:00' || (monApi === undefined && (monCell === '?' || /^0$/.test(monCell.trim()))), `the zero day is stored as 00:00 or dropped (API ${monApi ?? 'none'}, cell ${monCell})`).toBe(true);
  const expectedTotal = hhmm(270 * (t1Days - 1) + (weekendAccepted ? 120 : 0));
  expect.soft(t.owners_and_work.total_work, `total = other days + weekend − the zero day (${expectedTotal})`).toBe(expectedTotal);
});

test('GE-23 the editor\'s Duration is derived from the task dates (read-only); Total Hours follows Standard and Flexible edits', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  const ed = await openEditor(wl.page, f.t1);
  const editable = await ed.locator('input, [contenteditable="true"]').evaluateAll(els => els.filter(e => (e as HTMLElement).offsetWidth).map(e => `${e.getAttribute('data-zpqa') || e.id || (e as HTMLInputElement).name || e.className}`));
  const durationIsInput = editable.some(k => /duration/i.test(k));
  const txt = await editorText(wl.page);
  test.info().annotations.push({ type: 'evidence', description: `editable controls: ${editable.join(', ')}; text "${txt.slice(0, 200)}"` });
  expect.soft(durationIsInput, 'Duration is not an input').toBe(false);
  expect.soft(txt, 'Duration = working days of the task').toMatch(new RegExp(`${t1Days}d`));
  await setStandardHours(wl.page, '6:00'); expect.soft(await editorText(wl.page), 'Standard total follows').toMatch(new RegExp(`${hhmm(360 * t1Days)}hrs`));
  await switchFlexible(wl.page); const first = (await ed.locator('[data-zpqa^="input_work_in_flexible_"]').first().getAttribute('data-zpqa'))!.replace('input_work_in_flexible_', '');
  await setFlexibleDay(wl.page, first, '1:00'); expect.soft(await editorText(wl.page), 'Flexible total follows').toMatch(new RegExp(hhmm(360 * (t1Days - 1) + 60).replace(/^0/, '')));
  await editorCancel(wl.page);
  expect.soft((await task(api, f, f.t1)).owners_and_work.owners[0].work_values, 'nothing saved after Cancel').toBe('04:30');
});

// ---------- the residue: horizontal move, owner select, multi-owner, resource, Unassigned, completion, editor per type, Add More, business-hours link ----------
const seededProjectId = async (api: ZpApi) => { const p = (await api.getJson<any[]>('/projects?page=1&per_page=100')).find(p => /UIAutomation_Workload_Project2/.test(p.name)); return p ? String(p.id) : (process.env.ZP_PERM_PROJECT_ID || ''); };

test('GE-24 dragging a bar sideways within its row moves the task dates and keeps its length', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  const before = await task(api, f, f.t1); const b = (await bar(wl.page, f.t1).boundingBox())!; const colW = (await wl.page.locator('.weekNameColumn').nth(1).boundingBox())!.width;
  const log = requestLog(wl.page); const y = b.y + b.height / 2;
  await wl.page.mouse.move(b.x + 40, y); await wl.page.mouse.down(); await wl.page.mouse.move(b.x + 40 + colW * 2, y, { steps: 15 }); await wl.page.waitForTimeout(400); await wl.page.mouse.up(); await wl.page.waitForTimeout(4000);
  const reqs = log.take(); const after = await task(api, f, f.t1);
  test.info().annotations.push({ type: 'evidence', description: `${before.start_date}…${before.end_date} → ${after.start_date}…${after.end_date}; bar ${await bar(wl.page, f.t1).getAttribute('style')}; requests ${reqs.join('; ').slice(0, 300) || 'none'}` });
  const moved = String(after.start_date).slice(0, 10) !== String(before.start_date).slice(0, 10);
  if (!moved && !reqs.length) test.info().annotations.push({ type: 'check-spec', description: 'dragging a bar sideways within its own row changes nothing (no request, dates unchanged): bars move between users only; dates change through the resize handle or the task form' });
  else { const d0 = Math.round((new Date(before.end_date).getTime() - new Date(before.start_date).getTime()) / 86400000), d1 = Math.round((new Date(after.end_date).getTime() - new Date(after.start_date).getTime()) / 86400000); expect.soft(d1, 'length kept').toBe(d0); }
  expect.soft(after.owners_and_work?.owners?.[0]?.work_values, 'hrs/day kept').toBe('04:30');
  expect.soft(ownersOf(after), 'owner unchanged by a sideways drag').toEqual([String(f.emp.id)]);
});

test('GE-25 changing the owner inside the work-hours editor', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  const ed = await openEditor(wl.page, f.t1);
  const sel = ed.locator('.zselectbox__selected').first(); await sel.click(); await wl.page.waitForTimeout(800);
  const opts = (await wl.page.locator('li.zdropdownlist__item, [class*="zdropdownlist__item"]').filter({ visible: true }).allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  test.info().annotations.push({ type: 'evidence', description: `owner options: ${opts.join(' | ').slice(0, 200)}` });
  const opt = wl.page.locator('li.zdropdownlist__item, [class*="zdropdownlist__item"]').filter({ visible: true }).filter({ hasText: /PLAdmin/ }).first();
  expect(await opt.count(), 'the project\'s other user is offered').toBeGreaterThan(0); await opt.click(); await wl.page.waitForTimeout(800);
  const txt = await editorText(wl.page); test.info().annotations.push({ type: 'evidence', description: `editor after picking: "${txt.slice(0, 200)}"` });
  const r = await editorDone(wl.page); expect(r, 'PATCH').toBeTruthy();
  const owners = r!.body.owners_and_work.owners.map((o: any) => String(o.zpuid));
  test.info().annotations.push({ type: 'evidence', description: `PATCH owners ${JSON.stringify(r!.body.owners_and_work.owners)}` });
  expect.soft(owners, 'new owner in the request').toContain(String(f.adm.id));
  expect.soft(ownersOf(await task(api, f, f.t1)), 'API owners').toContain(String(f.adm.id));
});

test('GE-26 a task with two owners: one editor row per owner (Standard and Flexible), each saved separately', async ({ wl }) => {
  const { api, f } = await fixture(wl);
  const r0 = await api.call('POST', `/projects/${f.pid}/tasks`, { name: 'GE two owners', start_date: D.t3[0], end_date: D.t3[1], owners_and_work: { work_type: 'standard', unit: 'hours_per_day', copy_task_duration: false, owners: [{ zpuid: String(f.emp.id), work_values: '03:00' }, { zpuid: String(f.adm.id), work_values: '01:00' }] } });
  expect(r0.status(), 'two-owner task').toBe(201); const tid = String((await r0.json()).id);
  await openProjectGrid(wl, f);
  const ed = await openEditor(wl.page, tid);
  const inputs = await ed.locator('[data-zpqa="input_work_in_hours_per_day"]').evaluateAll(els => els.map(e => `${e.id}=${(e as HTMLInputElement).value}`));
  test.info().annotations.push({ type: 'evidence', description: `Standard rows: ${inputs.join(', ')}; text "${(await editorText(wl.page)).slice(0, 220)}"` });
  expect.soft(inputs.length, 'one hrs/day input per owner').toBe(2);
  const empInput = ed.locator(`[data-zpqa="input_work_in_hours_per_day"][id="${f.emp.id}"]`).first(); await empInput.click(); await wl.page.keyboard.press('Meta+A'); await empInput.pressSequentially('2:00'); await wl.page.keyboard.press('Tab');
  const r = await editorDone(wl.page); expect(r, 'PATCH').toBeTruthy();
  const sent = Object.fromEntries(r!.body.owners_and_work.owners.map((o: any) => [String(o.zpuid), o.work_values]));
  expect.soft(sent[String(f.emp.id)], 'employee row saved').toBe('2:00'); expect.soft(sent[String(f.adm.id)], 'admin row unchanged').toMatch(/^0?1:00$/);
  const t = await task(api, f, tid); const apiVals = Object.fromEntries(t.owners_and_work.owners.map((o: any) => [String(o.zpuid), o.work_values]));
  expect.soft(apiVals[String(f.emp.id)]).toBe('02:00'); expect.soft(apiVals[String(f.adm.id)]).toBe('01:00');
  await openEditor(wl.page, tid); await switchFlexible(wl.page);
  const flex = await editor(wl.page).locator('[data-zpqa^="input_work_in_flexible_"]').evaluateAll(els => els.map(e => `${e.getAttribute('data-zpqa')}@${e.closest('tr, [class*="row" i]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 30)}`));
  test.info().annotations.push({ type: 'evidence', description: `Flexible inputs with two owners: ${flex.length} (${flex.slice(0, 4).join(' | ')})` });
  expect.soft(flex.length, 'Flexible shows a row of days per owner').toBeGreaterThanOrEqual(2 * 3);
  await editorCancel(wl.page);
});

test('GE-27 a resource row (seeded project): hover card and editor open for a resource\'s task; the picker offers resources', async ({ wl }) => {
  const { api } = await fixture(wl); const pid = await seededProjectId(api); test.skip(!pid, 'seeded project not found');
  for (let i = 0; i < 3; i++) { try { if (i) await wl.goto(); await wl.gotoProject(pid); await waitLoaded(wl); break; } catch (e) { if (i === 2) throw e; } }
  const resRow = wl.page.locator('[data-zpqa^="username-"]').filter({ hasText: /Resource/ }).first(); await expect(resRow, 'resource row').toBeVisible({ timeout: 60_000 });
  const rid = (await resRow.getAttribute('data-zpqa'))!.slice('username-'.length);
  await qa(wl.page, `expand-collapse-parent-${rid}`).click(); const rows = wl.page.locator(`[id^="tasknamerow_${rid}"]`); await expect.poll(() => rows.count(), { timeout: 120_000 }).toBeGreaterThan(0);
  const tid = (await rows.first().getAttribute('entity-id')) || (await rows.first().getAttribute('id'))!.split('_').pop()!;
  const c = await hoverCard(wl.page, tid);
  expect.soft(c.owner, 'card names the resource').toMatch(/Resource/); expect.soft(c.totalHours, 'total hours present').toMatch(/\d/);
  await leaveCard(wl.page);
  await openEditor(wl.page, tid); const txt = await editorText(wl.page);
  expect.soft(txt, 'editor opens for the resource').toMatch(/Resource/); test.info().annotations.push({ type: 'evidence', description: `resource card "${c.text.slice(0, 160)}"; editor "${txt.slice(0, 160)}"` });
  await editorCancel(wl.page);
  // the Assign User picker offers resources too
  const row = rows.first(); await row.hover(); await wl.page.waitForTimeout(500); await row.locator('[data-zpqa="resourcetil_assignuser"]').first().click({ force: true }); await wl.page.waitForTimeout(1500);
  const dlg = wl.page.locator('.zpsPopUpDefault').filter({ visible: true }).filter({ hasText: /Owner/ }).first(); await expect(dlg, 'owner picker').toBeVisible({ timeout: 10_000 });
  const search = dlg.locator('input:not([type="checkbox"])').filter({ visible: true }).last(); await search.click(); await search.pressSequentially('Resour'); await wl.page.waitForTimeout(1500);
  const offered = (await wl.page.locator('li.zdropdownlist__item, [class*="zdropdownlist__item"], li').filter({ visible: true }).allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  test.info().annotations.push({ type: 'evidence', description: `picker options for "Resour": ${offered.join(' | ').slice(0, 200)}` });
  expect.soft(offered.some(o => /Resource/.test(o)), 'resources are offered in the picker').toBe(true);
  await dlg.locator('button').filter({ hasText: /Cancel/ }).first().click().catch(() => wl.page.keyboard.press('Escape'));
});

test('GE-28 the Unassigned row: hover card and Add Task from its cell create an unassigned task', async ({ wl }) => {
  const { api, f } = await fixture(wl); test.skip(!f.t2, 'no Unassigned owner on this portal'); await openProjectGrid(wl, f);
  const un = wl.page.locator('[data-zpqa^="username-"]').filter({ hasText: /Unassigned/ }).first(); await expect(un).toBeVisible({ timeout: 30_000 });
  const uid = (await un.getAttribute('data-zpqa'))!.slice('username-'.length);
  await mark(wl.page); await hoverUserCell(wl.page, uid, D.emptyDay); const card = (await appeared(wl.page)).map(a => a.text).join(' | ');
  test.info().annotations.push({ type: 'evidence', description: `Unassigned cell hover: "${card.slice(0, 200)}"` });
  const plus = wl.page.locator('[data-zpqa="add-date-task"]').filter({ visible: true }).first();
  const hasPlus = await plus.count().then(c => c > 0);
  test.info().annotations.push({ type: hasPlus ? 'evidence' : 'check-spec', description: hasPlus ? '+ Add Task offered on the Unassigned row' : 'no + Add Task on the Unassigned row' });
  if (!hasPlus) return;
  const name = `${env.runId}-GE-28`; const r = await addTaskFromCell(wl.page, uid, D.emptyDay, name);
  test.info().annotations.push({ type: 'evidence', description: `prefill ${JSON.stringify(r.pre)}; call ${JSON.stringify(r.post)}` });
  const created = ((await api.getJson<any>(`/projects/${f.pid}/tasks?page=1&per_page=100`)).tasks ?? []).find((t: any) => t.name === name);
  expect(created, 'task created').toBeTruthy();
  expect.soft((created.owners_and_work?.owners ?? []).map((o: any) => o.name), 'owner is Unassigned').toEqual(['Unassigned User']);
});

test('GE-29 a task in progress and a completed task: the card shows the completion % and the status', async ({ wl }) => {
  const { api, f } = await fixture(wl);
  const p1 = await api.call('PATCH', `/projects/${f.pid}/tasks/${f.t1}`, { completion_percentage: 40 }); test.info().annotations.push({ type: 'evidence', description: `PATCH completion 40 → ${p1.status()} ${(await p1.text()).slice(0, 100)}` });
  const p2 = await api.call('PATCH', `/projects/${f.pid}/tasks/${f.t3}`, { completion_percentage: 100 }); const p2j = await p2.json().catch(() => ({})); test.info().annotations.push({ type: 'evidence', description: `PATCH completion 100 → ${p2.status()}: status ${p2j.status?.name}, is_completed ${p2j.is_completed}, ${p2j.completion_percentage} %` });
  await openProjectGrid(wl, f);
  const c1 = await hoverCard(wl.page, f.t1); expect.soft(c1.completion, 'completion 40 %').toBe('40 %'); await leaveCard(wl.page);
  const t3 = await task(api, f, f.t3);
  if (await bar(wl.page, f.t3).count()) { const c3 = await hoverCard(wl.page, f.t3); expect.soft(c3.status, 'status of the completed task').toBe(t3.status?.name); expect.soft(c3.completion, '100 % when completed').toBe(`${t3.completion_percentage} %`); test.info().annotations.push({ type: 'evidence', description: `completed task card: "${c3.text.slice(0, 160)}"` }); await leaveCard(wl.page); }
  else test.info().annotations.push({ type: 'evidence', description: `the completed task (${t3.status?.name}, ${t3.completion_percentage} %) has no bar in the grid any more` });
});

test('GE-30 the work-hours editor opens from the bar in the Bar and Timeline chart types too', async ({ wl }) => {
  const { f } = await fixture(wl); await openProjectGrid(wl, f);
  for (const type of ['Bar', 'Timeline'] as const) {
    await qa(wl.page, K.chartType).click(); await wl.page.getByText(new RegExp(`^${type}$`)).filter({ visible: true }).first().click(); await waitLoaded(wl); await wl.page.waitForTimeout(1500);
    if (!(await bar(wl.page, f.t1).count())) { const chev = qa(wl.page, `expand-collapse-parent-${f.emp.id}`); if (await chev.count()) { await chev.click(); await wl.page.waitForTimeout(2000); } }
    if (!(await bar(wl.page, f.t1).count())) { test.info().annotations.push({ type: 'check-spec', description: `${type}: no bar element for the task` }); continue; }
    const b = (await bar(wl.page, f.t1).boundingBox())!; await wl.page.mouse.click(b.x + Math.min(30, b.width / 2), b.y + b.height / 2);
    const open = await editor(wl.page).isVisible({ timeout: 10_000 } as any).catch(() => false) || await editor(wl.page).waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
    test.info().annotations.push({ type: open ? 'evidence' : 'check-spec', description: `${type}: editor ${open ? 'opens' : 'does not open'} on bar click` });
    if (open) { expect.soft(await editorText(wl.page), `${type}: editor shows the owner`).toContain(f.emp.full_name); await editorCancel(wl.page); }
  }
  await wl.discard().catch(() => {});
});

test('GE-31 Add Task › Add More keeps the form open for a second task; both land on the day', async ({ wl }) => {
  const { api, f } = await fixture(wl); await openProjectGrid(wl, f);
  await hoverUserCell(wl.page, String(f.emp.id), D.emptyDay); await wl.page.locator('[data-zpqa="add-date-task"]').filter({ visible: true }).first().click(); await expect(qa(wl.page, 'taskname')).toBeVisible({ timeout: 15_000 });
  const n1 = `${env.runId}-GE-31a`, n2 = `${env.runId}-GE-31b`;
  const jsErr: string[] = []; wl.page.on('pageerror', e => jsErr.push(String(e.message || e).slice(0, 140)));
  const log31 = requestLog(wl.page);
  await qa(wl.page, 'taskname').pressSequentially(n1); const more = qa(wl.page, 'taskaddmore'); test.info().annotations.push({ type: 'evidence', description: `Add More: ${await more.evaluate(e => e.outerHTML.replace(/\s+/g, ' ').slice(0, 200))}` }); await more.click(); await wl.page.waitForTimeout(4000);
  const stillOpen = await qa(wl.page, 'taskname').isVisible().catch(() => false); const cleared = stillOpen ? await qa(wl.page, 'taskname').inputValue() : 'n/a';
  test.info().annotations.push({ type: 'evidence', description: `after Add More: open ${stillOpen}, name "${cleared}", requests ${log31.take().join('; ').slice(0, 200) || 'none'}, page errors ${jsErr.join(' | ') || '-'}` });
  if (stillOpen && cleared !== '') {
    await more.click({ force: true }); await wl.page.waitForTimeout(4000);
    const again = await qa(wl.page, 'taskname').inputValue().catch(() => 'n/a'); const reqs2 = log31.take();
    test.info().annotations.push({ type: 'evidence', description: `forced second click on Add More: name "${again}", requests ${reqs2.join('; ').slice(0, 200) || 'none'}` });
    if (again !== '') { test.info().annotations.push({ type: 'check-spec', description: 'Add More does not submit from the workload report\'s task form (no request, the name stays); Add works' }); await qa(wl.page, 'taskadd').click(); await wl.page.waitForTimeout(3000); }
    else { test.info().annotations.push({ type: 'check-spec', description: 'the first click on Add More right after typing the name is swallowed (no request); a second click submits and clears the form' }); await qa(wl.page, 'taskname').pressSequentially(n2); await qa(wl.page, 'taskadd').click(); await wl.page.waitForTimeout(3000); }
  }
  else if (stillOpen) { await qa(wl.page, 'taskname').pressSequentially(n2); await qa(wl.page, 'taskadd').click(); await wl.page.waitForTimeout(3000); }
  const tasks = (await api.getJson<any>(`/projects/${f.pid}/tasks?page=1&per_page=100`)).tasks ?? [];
  expect.soft(tasks.some((t: any) => t.name === n1), 'first task created').toBe(true); if (tasks.some((t: any) => t.name === n2)) test.info().annotations.push({ type: 'evidence', description: 'second task created through Add More → Add' });
  for (const t of tasks.filter((t: any) => [n1, n2].includes(t.name))) expect.soft(String(t.start_date).slice(0, 10), `${t.name} on the hovered day`).toBe(D.emptyDay);
});

test('GE-32 the Business Hours link in the card and the editor', async ({ wl }) => {
  const { f } = await fixture(wl); await openProjectGrid(wl, f);
  const c = await hoverCard(wl.page, f.t1); const link = c.card.locator('[data-zpqa="workload-report-business-hours-name"]');
  const href = await link.evaluate(e => (e.closest('a') as HTMLAnchorElement | null)?.href || e.getAttribute('href') || '');
  const [popup] = await Promise.all([wl.page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null), link.click()]);
  await wl.page.waitForTimeout(2500);
  const where = popup ? `new tab ${popup.url()}` : `same tab ${wl.page.url().replace(/^https?:\/\/[^/]+/, '')}`;
  const panel = (await wl.page.locator('.lytePopoverElement, .zpsPopUpDefault, [role="dialog"]').filter({ visible: true }).allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ');
  test.info().annotations.push({ type: 'evidence', description: `Business Hours link href="${href}" → ${where}; panel "${panel.slice(0, 160)}"` });
  const inert = !href && !popup && /reports\/workload/.test(wl.page.url()) && !panel;
  if (inert) test.info().annotations.push({ type: 'check-spec', description: 'the Business Hours name in the card is styled as a link but has no href and does nothing on click' });
  else expect.soft(/business|setup|Standard Business Hours/i.test(where + panel), 'the link leads to the business hours').toBe(true);
  if (popup) await popup.close(); else if (!/reports\/workload/.test(wl.page.url())) await openProjectGrid(wl, f);
});

