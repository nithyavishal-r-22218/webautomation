import { expect, type Locator, type Page } from '@playwright/test';
import { ZpApi } from './api';
import { K, qa } from './locators';
import { waitLoaded } from './createChecks';
import type { WorkloadPage } from './pages/WorkloadPage';

/**
 * The grid's editing surface (seen live 15-10-2026, project-level and global Workload Report):
 *   task bar `#bar_<tid>` (CSS vars --dayStartLeft/--daysAllocate), per-day cells `.resWork` (tooltip "N hours allocated for this day."),
 *   right-hand resize handle `taskbar-<uid>-<tid>-rhs-handle`; hovering a bar opens `#taskhover.resource-info-pop`:
 *   completion `[name=projcomp_per]`, title link `workload-report-popup-open-task-detail` (+ "View Details"), `#dtrange`, `#tstatus`,
 *   `#ownername`, `workload-report-business-hours-name`, "Duration: N day(s)", "Total Work Hours:N", "Days:N", pencil
 *   `workload-report-popup-change-work` ("Change Work Hours"). Clicking the bar (or the pencil) opens the work-hours editor
 *   (`.lytePopoverElement workhrs-form`): radios `ruc-radio-button[rc-qa=work_type_standard|work_type_flexible]`, owner select,
 *   `input_work_in_hours_per_day` (Standard, shows "hrs/day ( N% day )", duration "Nd", total "N:NNhrs"), per-day
 *   `input_work_in_flexible_<YYYY-MM-DD>` (Flexible), `bt_work_form_submit` / `bt_work_form_cancel`, checkbox "Copy the actual duration
 *   of the Task". Done sends PATCH /projects/{pid}/tasks/{tid} {owners_and_work}.
 *   Hovering a user's day cell shows `add-date-task` (+ "Add Task") → the task form (`taskname`, `taskowner`, `taskduedate`,
 *   `taskenddate`, `taskadd`, `taskcancel`) → legacy POST addcalendartask.do. Task rows (hover) show `resourcetil_assignuser`
 *   ("Assign User") and a drag handle; dropping a bar on another user's row sends PATCH /tasks/{tid} (new owner) + bulk-update.
 *   At global level the per-project group header `resGroupExpand_<pid>_<uid>` carries `resourcetil_swapprojtasks` ("Replace Task
 *   Owner" → `.zpsPopUpDefault` with `swap-project-tasks-save|cancel|close`) and `add-date-task` ("Assign Task": New / Existing).
 * Test data: a QA project created by API with copy_task_duration:false tasks, trashed afterwards.
 */
export interface GeFixture { pid: string; pname: string; emp: any; adm: any; unassignedId: string; t1: string; t2: string; t3: string }
const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** This month's dates for the fixture: a 2-week task starting on the 2nd Monday, a 3-day unassigned task, a 3-day task in week 1. */
export function fixtureDates() {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  const first = new Date(y, m, 1); const last = new Date(y, m + 1, 0);
  const mondays: Date[] = []; for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) if (d.getDay() === 1) mondays.push(new Date(d));
  const mon2 = mondays[1] ?? mondays[0]!; const fri2 = new Date(mon2); fri2.setDate(fri2.getDate() + 11); // Mon … Fri next week
  const tue = new Date(mon2); tue.setDate(tue.getDate() + 1); const thu = new Date(mon2); thu.setDate(thu.getDate() + 3);
  const mon1 = mondays[0]!; const wed1 = new Date(mon1); wed1.setDate(wed1.getDate() + 2);
  return { from: ymd(first), to: ymd(last), t1: [ymd(mon2), ymd(fri2)], t2: [ymd(tue), ymd(thu)], t3: [ymd(mon1), ymd(wed1)], emptyDay: ymd(new Date(mon1.getTime() + 7 * 86400000 * 0 + 86400000 * 3)) /* Thu of week 1 */, weekend: ymd(new Date(mon2.getTime() + 5 * 86400000)) };
}
export const workingDays = (from: string, to: string) => { let n = 0; for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1)) if (d.getDay() !== 0 && d.getDay() !== 6) n++; return n; };
const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

export async function createFixture(api: ZpApi, runId: string): Promise<GeFixture> {
  const users = await api.users();
  const emp = users.find((u: any) => /plemployee/i.test(u.email)) ?? users.find((u: any) => !/cwlr|workload|auto/i.test(u.email));
  const adm = users.find((u: any) => /pladmin/i.test(u.email)) ?? users.find((u: any) => u.id !== emp.id && !/cwlr|workload|auto/i.test(u.email));
  const d = fixtureDates();
  const p = await api.createProject(`${runId}-GE`, d.from, d.to);
  await api.addProjectUsers(p.id, [emp, adm].map((u: any) => ({ email: u.email, profile_id: String(u.profile.id), role_id: String(u.role.id) })));
  const mk = async (name: string, [start, end]: string[], owner: string, perDay: string) => { const r = await api.call('POST', `/projects/${p.id}/tasks`, { name, start_date: start, end_date: end, owners_and_work: { work_type: 'standard', unit: 'hours_per_day', copy_task_duration: false, owners: [{ zpuid: owner, work_values: perDay }] } }); expect(r.status(), `create task ${name}: ${(await r.text()).slice(0, 160)}`).toBe(201); return String((await r.json()).id); };
  const un = (await api.workload({ projectId: p.id, from: d.from, to: d.to, unassigned: true }))[0];
  const t1 = await mk('GE task 4h30', d.t1, String(emp.id), '04:30');
  const t2 = un ? await mk('GE unassigned', d.t2, String(un.id), '02:00') : '';
  const t3 = await mk('GE week1 3h', d.t3, String(emp.id), '03:00');
  await new Promise(r => setTimeout(r, 3000)); // let the new project settle before its report is opened
  return { pid: p.id, pname: p.name, emp, adm, unassignedId: un ? String(un.id) : '', t1, t2, t3 };
}
export const task = (api: ZpApi, f: GeFixture, tid: string) => api.getJson<any>(`/projects/${f.pid}/tasks/${tid}`);
export const ownersOf = (t: any): string[] => (t.owners_and_work?.owners ?? []).map((o: any) => `${o.zpuid}`);

/** Open the project report (retrying a slow load once) and expand the employee row. */
export async function openProjectGrid(wl: WorkloadPage, f: GeFixture) {
  // a freshly created project's report can take a while to come up, and a cold deep link can land elsewhere: retry, warming up through the global report
  for (let i = 0; i < 3; i++) { try { if (i) { await wl.goto(); } await wl.gotoProject(f.pid); await waitLoaded(wl); break; } catch (e) { if (i === 2) throw e; await wl.page.waitForTimeout(3000); } }
  await expandUser(wl, String(f.emp.id));
}
export async function openGlobalGrid(wl: WorkloadPage, f: GeFixture) { await wl.goto(); await waitLoaded(wl); await expandUser(wl, String(f.emp.id)); }
export async function expandUser(wl: WorkloadPage, uid: string) {
  const rows = wl.page.locator(`[id^="tasknamerow_${uid}"]`);
  if (await rows.count()) return;
  await qa(wl.page, `expand-collapse-parent-${uid}`).click();
  await expect.poll(() => rows.count(), { message: `tasks of ${uid} listed`, timeout: 120_000 }).toBeGreaterThan(0);
  await wl.page.waitForTimeout(600);
}
/** Heatmap/Bar draw `#bar_<tid>`; the Timeline type draws `#taskitem_<tid>` instead. */
export const bar = (page: Page, tid: string) => page.locator(`#bar_${tid}, #taskitem_${tid}`).first();
export const taskRow = (page: Page, uid: string, text: string | RegExp) => page.locator(`[id^="tasknamerow_${uid}"]`).filter({ hasText: text }).first();
export const dayColumn = (page: Page, date: string) => { const [y, m, d] = date.split('-'); return page.locator('.weekNameColumn').filter({ hasText: new RegExp(`Date: (${d}-${m}|${m}-${d})-${y}`) }).first(); };

/** Hover the bar and read the task card. */
export async function hoverCard(page: Page, tid: string) {
  const b = bar(page, tid); const box = (await b.boundingBox())!;
  await page.mouse.move(box.x + Math.min(30, box.width / 2), box.y + 2); await page.waitForTimeout(400);
  await page.mouse.move(box.x + Math.min(32, box.width / 2), box.y + box.height / 2);
  const card = page.locator('#taskhover');
  await expect(card, 'task hover card').toBeVisible({ timeout: 10_000 });
  const text = (await card.innerText()).replace(/\s+/g, ' ');
  const pick = (re: RegExp) => (text.match(re) || [])[1] ?? '';
  return { card, text, completion: (await card.locator('[name="projcomp_per"]').innerText()).trim(), title: (await card.locator('#tname').innerText()).trim(), range: (await card.locator('#dtrange').innerText()).trim(), status: (await card.locator('#tstatus').innerText()).trim(), owner: (await card.locator('#ownername').innerText()).trim(), businessHours: (await card.locator('[data-zpqa="workload-report-business-hours-name"]').innerText()).trim(), duration: Number(pick(/Duration:\s*(\d+)/)), totalHours: pick(/Total Work Hours:\s*([\d:.]+)/), days: Number(pick(/Days:\s*([\d.]+)/)) };
}
export async function leaveCard(page: Page) { await page.mouse.move(5, 500); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }

// ---------- work-hours editor ----------
export const editor = (page: Page) => page.locator('.lytePopoverElement').filter({ has: page.locator('workhrs-form') }).first();
export async function openEditor(page: Page, tid: string, via: 'bar' | 'pencil' = 'bar') {
  if (via === 'pencil') { const c = await hoverCard(page, tid); await c.card.locator('[data-zpqa="workload-report-popup-change-work"]').click(); }
  else { const box = (await bar(page, tid).boundingBox())!; await page.mouse.click(box.x + Math.min(30, box.width / 2), box.y + box.height / 2); }
  await expect(editor(page), 'work-hours editor').toBeVisible({ timeout: 15_000 });
  return editor(page);
}
export const editorText = async (page: Page) => (await editor(page).innerText()).replace(/\s+/g, ' ').trim();
export async function setStandardHours(page: Page, value: string) {
  const ed = editor(page); const std = ed.locator('ruc-radio-button[rc-qa="work_type_standard"]');
  if (!/ruc-checked/.test((await std.getAttribute('class')) || '')) { await std.locator('label').click(); await page.waitForTimeout(500); }
  const inp = ed.locator('[data-zpqa="input_work_in_hours_per_day"]').first();
  await inp.click(); await page.keyboard.press('Meta+A'); await page.keyboard.press('Backspace'); await inp.pressSequentially(value); await page.keyboard.press('Tab'); await page.waitForTimeout(700);
}
export async function switchFlexible(page: Page) { const ed = editor(page); await ed.locator('ruc-radio-button[rc-qa="work_type_flexible"] label').click(); await expect(ed.locator('[data-zpqa^="input_work_in_flexible_"]').first()).toBeVisible({ timeout: 10_000 }); }
export async function setFlexibleDay(page: Page, date: string, value: string) { const inp = editor(page).locator(`[data-zpqa="input_work_in_flexible_${date}"]`); await inp.click(); await page.keyboard.press('Meta+A'); await page.keyboard.press('Backspace'); await inp.pressSequentially(value); await page.keyboard.press('Tab'); await page.waitForTimeout(600); }
/** Press Done and return the PATCH the editor sends (null when none within 15 s). */
export async function editorDone(page: Page) {
  const patch = page.waitForResponse(r => r.request().method() === 'PATCH' && /\/tasks\/\d+/.test(r.url()) && !/bulk-update/.test(r.url()), { timeout: 15_000 }).catch(() => null);
  await editor(page).locator('[data-zpqa="bt_work_form_submit"]').click();
  const r = await patch; await page.waitForTimeout(1500);
  return r ? { status: r.status(), body: JSON.parse(r.request().postData() || '{}') } : null;
}
export async function editorCancel(page: Page) { await editor(page).locator('[data-zpqa="bt_work_form_cancel"]').click(); await expect(editor(page)).toBeHidden({ timeout: 10_000 }); }
export const barCells = (page: Page, tid: string) => bar(page, tid).locator('.resWork').allInnerTexts();

// ---------- add task from a cell ----------
export async function hoverUserCell(page: Page, uid: string, date: string) {
  const row = page.locator(`[data-zpqa="username-${uid}"]`); const rb = (await row.boundingBox())!; const col = (await dayColumn(page, date).boundingBox())!;
  await page.mouse.move(col.x + col.width / 2, rb.y + rb.height / 2); await page.waitForTimeout(1500);
  return { x: col.x + col.width / 2, y: rb.y + rb.height / 2 };
}
export async function addTaskFromCell(page: Page, uid: string, date: string, name: string | null) {
  await hoverUserCell(page, uid, date);
  const plus = page.locator('[data-zpqa="add-date-task"]').filter({ visible: true }).first();
  await expect(plus, '+ Add Task on the hovered cell').toBeVisible({ timeout: 10_000 });
  await plus.click(); await expect(qa(page, 'taskname'), 'task form').toBeVisible({ timeout: 15_000 });
  const pre = { owner: (await qa(page, 'taskowner').innerText()).trim(), start: await qa(page, 'taskduedate').inputValue(), end: await qa(page, 'taskenddate').inputValue() };
  if (name === null) { await qa(page, 'taskcancel').click(); await expect(qa(page, 'taskname')).toBeHidden({ timeout: 10_000 }); return { pre, post: null as any }; }
  await qa(page, 'taskname').pressSequentially(name);
  const post = page.waitForResponse(r => r.request().method() === 'POST' && /addcalendartask|\/tasks(\?|$)/.test(r.url()), { timeout: 20_000 }).catch(() => null);
  await qa(page, 'taskadd').click(); const r = await post; await page.waitForTimeout(2000);
  return { pre, post: r ? { status: r.status(), url: r.url().replace(/^https?:\/\/[^/]+/, '') } : null };
}

// ---------- drag / reassign ----------
export async function dragBarToUser(page: Page, tid: string, targetUid: string) {
  const b = (await bar(page, tid).boundingBox())!; const target = (await page.locator(`[data-zpqa="username-${targetUid}"]`).boundingBox())!;
  const patch = page.waitForResponse(r => r.request().method() === 'PATCH' && /\/tasks\/\d+/.test(r.url()) && !/bulk-update/.test(r.url()), { timeout: 20_000 }).catch(() => null);
  await page.mouse.move(b.x + 60, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + 60, target.y + target.height / 2, { steps: 12 }); await page.waitForTimeout(400); await page.mouse.up();
  const r = await patch; await page.waitForTimeout(2500);
  return r ? { status: r.status(), body: JSON.parse(r.request().postData() || '{}') } : null;
}
/**
 * Resize a bar by N day columns with its right-hand handle. The handle's `mousedown` listener and the document's
 * mousemove/mouseup listeners do not react to trusted pointer events from the automation (Playwright or CDP), but they do
 * to dispatched DOM MouseEvents, so the drag is dispatched. Returns the bulk-update request the app sends (end_date).
 */
export async function resizeBarByDays(page: Page, uid: string, tid: string, days: number) {
  const b = (await bar(page, tid).boundingBox())!; const y = b.y + b.height / 2;
  const colW = (await page.locator('.weekNameColumn').nth(1).boundingBox())!.width;
  await page.mouse.move(b.x + b.width + 40, y); await page.mouse.move(b.x + b.width - 3, y); await page.waitForTimeout(150);
  const h = page.locator(`[data-zpqa="taskbar-${uid}-${tid}-rhs-handle"]`).first(); const hb = (await h.boundingBox())!; const sx = hb.x + hb.width / 2;
  const patch = page.waitForResponse(r => r.request().method() === 'PATCH' && /bulk-update/.test(r.url()), { timeout: 20_000 }).catch(() => null);
  await h.dispatchEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: y, pageX: sx, pageY: y, button: 0, buttons: 1, which: 1 });
  const steps = 20; for (let i = 1; i <= steps; i++) { const x = sx + (colW * days * i) / steps; await page.evaluate(([x, y]) => { document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x as number, clientY: y as number, button: 0, buttons: 1 })); }, [x, y] as const); await page.waitForTimeout(30); }
  const during = await bar(page, tid).getAttribute('style');
  await page.evaluate(([x, y]) => { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x as number, clientY: y as number, button: 0 })); }, [sx + colW * days, y] as const);
  const r = await patch; await page.waitForTimeout(1500);
  return { during, after: await bar(page, tid).getAttribute('style'), request: r ? { status: r.status(), body: JSON.parse(r.request().postData() || '{}') } : null };
}
/** Everything that appeared since mark(): used where the control's markup is not known in advance. */
export async function mark(page: Page) { await page.evaluate(() => { (window as any).__seen = new WeakSet(); document.querySelectorAll('*').forEach(e => (window as any).__seen.add(e)); }); }
export async function appeared(page: Page) {
  return page.evaluate(() => { const seen = (window as any).__seen as WeakSet<Element>; const news = [...document.querySelectorAll<HTMLElement>('*')].filter(e => !seen.has(e) && (e.offsetWidth || e.offsetHeight) && (e.innerText || '').trim().length > 2); const tops = news.filter(e => !news.some(o => o !== e && o.contains(e))); return tops.slice(0, 3).map(e => ({ tag: `${e.tagName.toLowerCase()}#${e.id}.${String(e.className).slice(0, 40)}`, text: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 300), controls: [...e.querySelectorAll<HTMLElement>('[data-zpqa], button, input, li')].filter(x => x.offsetWidth || x.offsetHeight).map(x => `${x.tagName.toLowerCase()} zpqa=${x.getAttribute('data-zpqa')} ph=${x.getAttribute('placeholder') || ''} t=${(x.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 20)}`).slice(0, 12) })); });
}
/** Pick a user in whatever picker is open: type in its search box, click the matching entry, press its Save/Done if any. */
export async function pickUserInPicker(page: Page, name: string) {
  // the owner picker (`.zpsPopUpDefault`): current owners as chips, a token field "Select User/Resource", Save / Cancel
  const dlg = page.locator('.zpsPopUpDefault').filter({ visible: true }).filter({ hasText: /Owner/ }).first();
  // the token field's input has a placeholder only while empty: take the dialog's last visible text input
  const search = (await dlg.count() ? dlg : page).locator('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])').filter({ visible: true }).last();
  const key = new RegExp(name.split(' ').pop()!.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i'); // "plemployee" / "PLAdmin": the list may show display names or e-mails
  if (await search.count()) { await search.click(); await search.pressSequentially(name.split(' ').pop()!.slice(0, 6)); await page.waitForTimeout(1500); }
  const opt = page.locator('li.zdropdownlist__item, [class*="zdropdownlist__item"], li, [role="option"], label').filter({ visible: true }).filter({ hasText: key }).filter({ hasNot: page.locator('input') }).first();
  const found = await opt.count(); if (found) { await opt.click(); await page.waitForTimeout(800); await page.keyboard.press('Tab'); await page.waitForTimeout(500); } // Tab closes the suggestion list; never Escape here: it closes the dialog
  const dialogs = await page.locator('.zpsPopUpDefault').filter({ visible: true }).evaluateAll(els => els.map(e => (e as HTMLElement).innerText.replace(/\s+/g, ' ').slice(0, 120)));
  let btn = page.locator('.zpsPopUpDefault button').filter({ visible: true }).filter({ hasText: /save|done|assign|update|replace/i }).last();
  if (!(await btn.count())) btn = page.locator('button').filter({ visible: true }).filter({ hasText: /^\s*Save\s*$/ }).last();
  const btnText = (await btn.count()) ? (await btn.innerText()).trim() : '';
  if (await btn.count()) { await btn.click({ timeout: 10_000 }).catch(() => {}); await page.waitForTimeout(1500); if (await btn.isVisible().catch(() => false)) { await btn.click({ force: true }).catch(() => {}); } }
  await page.waitForTimeout(3000);
  return { found: found > 0, btnText, dialogs, stillOpen: await page.locator('.zpsPopUpDefault').filter({ visible: true }).filter({ hasText: /Owner/ }).count() };
}
export const requestLog = (page: Page) => { const log: string[] = []; page.on('request', r => { if (r.method() !== 'GET' && !/\.(js|css|png|svg|woff2?|gif)(\?|$)/.test(r.url()) && !/micstracking|zohocdn|analytics|zcollect|jstracker|setupstats|logRecentAccess|proofing|taskfilter|gettaskowners|conaddtask/.test(r.url())) log.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').replace(/\/api\/v3\/portal\/\d+/, '/api')} ${(r.postData() || '').replace(/zpcp=[0-9a-f]+/, 'zpcp=…').slice(0, 300)}`); }); return { take: () => log.splice(0) }; };
