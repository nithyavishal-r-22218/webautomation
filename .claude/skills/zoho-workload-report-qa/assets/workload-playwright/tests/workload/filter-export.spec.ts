import { test, expect, knownDefect } from '../../src/fixtures';
import { env } from '../../src/env';
import { K, qa } from '../../src/locators';
import { ZpApi } from '../../src/api';
import { FilterPanel } from '../../src/pages/FilterPanel';
import type { WorkloadPage } from '../../src/pages/WorkloadPage';
import { findSection, clearAndDiscard, readTruth, assertSavedViewUnchanged, type Truth } from '../../src/filterChecks';
import { captureRaw, exportPdf, manDays, parsePdf, tokenMatches, uiRows, uiTotals, type ParsedPdf, type RawOwner } from '../../src/pdfExport';

/**
 * FLT-EX — Toolbar › Export to PDF with filters, validated end to end. Each case exports through the UI (password
 * prompt → No), saves the PDF under reports/export, extracts its text and checks it in layers:
 *   file   %PDF-, workload_report_export_<id>.pdf, ≥ 1 page, application/pdf response
 *   header portal name, "view by <data label>" = toolbar label, Project, Date = toolbar range, Exported On = now
 *   filter every applied section and value is printed (the PDF lists the values first, comma-separated, then
 *          "<Section>: <Condition>"; for All Open / All Closed the condition is printed with the values); nothing without a filter
 *   rows   names in UI order, as "name(count)"; one data line per UI row; no row the filter removed
 *   totals each row total = the UI total; = API total_work in man days
 *   days   one value per day of the range; each = the API day value (cut values compared as prefixes)
 * The saved view is checked unchanged after the suite; views created here are deleted.
 */
test.describe.configure({ mode: 'default', timeout: 900_000 });
let truth: Truth;
test.beforeAll(async ({ browser }, info) => { test.setTimeout(300_000); truth = await readTruth(browser, info.project.use.storageState as string | undefined); });
test.afterAll(async ({ browser }, info) => { if (truth) await assertSavedViewUnchanged(browser, info.project.use.storageState as string | undefined, truth); });

const dmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
const mdy = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/** Every layer for one exported PDF. `raw` = owners from the data responses behind the current grid. */
async function validate(wl: WorkloadPage, name: string, pdf: Awaited<ReturnType<typeof exportPdf>>, raw: Map<string, RawOwner>, o: { chips?: string[]; noChips?: boolean; project?: string; checkDays?: boolean; portal?: string; noValues?: boolean } = {}): Promise<ParsedPdf> {
  const p = parsePdf(pdf.text);
  const e: string[] = [];
  const soft = (ok: boolean, msg: string) => { if (!ok) e.push(msg); expect.soft(ok, `${name}: ${msg}`).toBe(true); };
  // file
  soft(/^workload_report_export_\d+\.pdf$/.test(pdf.suggested), `file name ${pdf.suggested}`);
  soft(pdf.pages >= 1, `${pdf.pages} page(s)`);
  // header
  const title = o.portal ?? (await wl.page.title()).split(' - ')[0]!.trim();
  soft(p.portal === title, `portal "${p.portal}" = "${title}"`);
  const label = await wl.dataLabel();
  soft(p.viewBy === label, `view by "${p.viewBy}" = toolbar data label "${label}"`);
  const range = (await qa(wl.page, K.calendar).innerText()).replace(/\s+/g, ' ').trim();
  soft(p.dateRange === range, `Date "${p.dateRange}" = toolbar range "${range}"`);
  soft(p.project === (o.project ?? 'All Projects'), `Project "${p.project}" = "${o.project ?? 'All Projects'}"`);
  const now = new Date();
  soft(p.exportedOn.startsWith(dmy(now)) || p.exportedOn.startsWith(mdy(now)), `Exported On "${p.exportedOn}" is today`);
  const tm = p.exportedOn.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (tm) { let h = Number(tm[1]) % 12; if (/pm/i.test(tm[3]!)) h += 12; const mins = h * 60 + Number(tm[2]); const nowMins = now.getHours() * 60 + now.getMinutes(); soft(Math.abs(nowMins - mins) <= 15, `Exported On time ${tm[0]} within 15 min of now`); }
  // filter
  for (const c of o.chips ?? []) soft(p.flat.includes(c.replace(/\s+/g, '')), `filter "${c}" printed (chips text "${p.chips}")`);
  if (o.noChips) soft(!/:\s*(Is|Is Not|All Open|All Closed|Contains)/.test(p.chips), `no filter printed (got "${p.chips}")`);
  // rows
  const rows = await uiRows(wl);
  let at = -1;
  for (const r of rows) { const i = p.flat.indexOf(r.key, at + 1); soft(i > at, `row "${r.text}" printed in UI order`); if (i > at) at = i; }
  if (!o.noValues) soft(p.dataLines.length === rows.length, `${p.dataLines.length} data lines = ${rows.length} UI rows`);
  // totals vs UI and API
  const totals = await uiTotals(wl);
  const dayMinutes = Math.max(...Object.values(wl.d.meta!.default_business_hours_details.working_day_availability).map(Number));
  const [from, to] = await wl.headerRange();
  const days: Date[] = []; for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  let cut = 0, checked = 0;
  rows.forEach((r, i) => {
    const line = o.noValues ? undefined : p.dataLines[i]; if (!line) return;
    if (totals[i]) soft(line[0] === totals[i], `${r.text}: total "${line[0]}" = UI "${totals[i]}"`);
    const api = raw.get(r.id);
    if (api && /d$/.test(line[0]!)) soft(tokenMatches(line[0]!, manDays(api.totalWork, dayMinutes)), `${r.text}: total "${line[0]}" = API ${manDays(api.totalWork, dayMinutes)}`);
    if (o.checkDays !== false) {
      soft(line.length - 1 === days.length, `${r.text}: ${line.length - 1} day values = ${days.length} days in the range`);
      if (api) days.forEach((d, k) => {
        const tok = line[k + 1]; if (!tok) return;
        checked++; if (tok.endsWith('...')) cut++;
        const want = manDays(api.days.get(ymd(d)) ?? 0, dayMinutes);
        soft(tokenMatches(tok, want), `${r.text} ${dmy(d)}: "${tok}" = API ${want}`);
      });
    }
  });
  test.info().annotations.push({ type: 'pdf', description: `${name}: ${pdf.file} (${pdf.size} B, ${pdf.pages} p); header "${p.portal} / ${p.viewBy} / ${p.project} / ${p.dateRange} / ${p.exportedOn}"; chips "${p.chips}"; ${p.dataLines.length} rows; ${checked} day values, ${cut} cut ("0.3...")${e.length ? `; ${e.length} failed layer(s)` : ''}` });
  if (cut) test.info().annotations.push({ type: 'check spec', description: `${name}: ${cut} of ${checked} day values are cut in the PDF (e.g. "0.3..." for 0.333d) — the exported value cannot be read exactly` });
  return p;
}

async function applyUsers(fp: FilterPanel, wl: WorkloadPage) {
  await fp.open(); await fp.expand('resourcetype'); await fp.setConditionOf('resourcetype', 'is'); await fp.tickIds('resourcetype', ['1']);
  const cap = captureRaw(wl.page); wl.d.resetOwners(); await fp.find(); await wl.loadAllRows(); cap.stop();
  return cap.owners;
}

test('FLT-EX-01 no filter: PDF lists every row (Unassigned and resources too) with totals and day values = UI and API; no filter printed', async ({ wl }) => {
  const cap = captureRaw(wl.page); await wl.goto(); await wl.loadAllRows(); cap.stop();
  const pdf = await exportPdf(wl.page, 'EX-01-no-filter');
  const p = await validate(wl, 'EX-01', pdf, cap.owners, { noChips: true });
  expect(p.dataLines.length, 'all owners + Unassigned').toBe(truth.owners.size + (truth.unassignedId ? 1 : 0));
  await expect(qa(wl.page, K.saveAs), 'exporting is not a view change').toBeHidden();
});

test('FLT-EX-02 User/Resource Is Users: the filter is printed and only user rows are exported', async ({ wl }) => {
  const fp = new FilterPanel(wl.page);
  const raw = await applyUsers(fp, wl);
  const pdf = await exportPdf(wl.page, 'EX-02-users');
  const p = await validate(wl, 'EX-02', pdf, raw, { chips: ['User/Resource: Is', 'Users'] });
  const usersOnly = [...truth.owners.values()].filter(o => !o.isResource);
  expect(p.dataLines.length, 'only users exported').toBe(usersOnly.length);
  for (const o of truth.owners.values()) if (o.isResource) expect.soft(p.flat.includes(o.name.replace(/\s+/g, '')), `resource ${o.name} not exported`).toBe(false);
  expect.soft(p.flat.includes('UnassignedUser'), 'Unassigned row not exported').toBe(false);
  await clearAndDiscard(wl, fp, truth, 'EX-02');
});

test('FLT-EX-03 two sections (Users + Status All Open): both filters printed; totals reduced and = UI and API', async ({ wl }) => {
  const fp = new FilterPanel(wl.page);
  await fp.open(); await fp.expand('resourcetype'); await fp.setConditionOf('resourcetype', 'is'); await fp.tickIds('resourcetype', ['1']);
  const st = findSection(await fp.sections(), '4'); test.skip(!st, 'no Status section');
  await fp.expand(st!.field); await fp.setConditionOf(st!.field, 'all_open');
  const cap = captureRaw(wl.page); wl.d.resetOwners(); await fp.find(); await wl.loadAllRows(); cap.stop();
  const pdf = await exportPdf(wl.page, 'EX-03-users-open');
  await validate(wl, 'EX-03', pdf, cap.owners, { chips: ['User/Resource: Is', 'Users', 'Status:', 'All Open'] });
  for (const o of cap.owners.values()) if (!o.unassigned) expect.soft(o.totalWork, `${o.name}: open-task work ≤ all work`).toBeLessThanOrEqual(truth.owners.get(o.id)?.totalWork ?? Infinity);
  await clearAndDiscard(wl, fp, truth, 'EX-03');
});

test('FLT-EX-04 every Status value (chip bar overflows into Show More): are all applied values printed in the PDF?', async ({ wl }) => {
  const fp = new FilterPanel(wl.page); await fp.open();
  const st = findSection(await fp.sections(), '4'); test.skip(!st, 'no Status section');
  await fp.expand(st!.field); await fp.setConditionOf(st!.field, 'is');
  const opts = await fp.valueOptions(st!.field);
  await fp.tickIds(st!.field, opts.map(o => o.id));
  const cap = captureRaw(wl.page); wl.d.resetOwners(); await fp.find(); await wl.loadAllRows(); cap.stop();
  const overflow = await fp.chipOverflow();
  const pdf = await exportPdf(wl.page, 'EX-04-all-statuses');
  const p = await validate(wl, 'EX-04', pdf, cap.owners, { chips: ['Status: Is'] });
  const missing = opts.filter(o => !p.flat.includes(o.label.replace(/\s+/g, ''))).map(o => o.label);
  test.info().annotations.push({ type: 'check spec', description: `${opts.length} Status values applied (${overflow ? `+${overflow} folded behind Show More` : 'all chips visible'}); PDF prints ${opts.length - missing.length}${missing.length ? `; missing: ${missing.join(', ')}` : ''}` });
  expect.soft(missing, 'every applied value is printed in the PDF').toEqual([]);
  await clearAndDiscard(wl, fp, truth, 'EX-04');
});

test('FLT-EX-05 another data label with a filter: "view by" follows the label and totals = UI', async ({ wl }) => {
  const fp = new FilterPanel(wl.page);
  const raw = await applyUsers(fp, wl);
  const original = await wl.dataLabel();
  await qa(wl.page, K.dataLabel).click();
  const items = wl.page.locator('.popuplist.cradio').filter({ visible: true });
  const labels = (await items.allInnerTexts()).map(t => t.trim());
  const idx = labels.findIndex(t => t && t !== original && /hour/i.test(t));
  const pick = idx >= 0 ? idx : labels.findIndex(t => t && t !== original);
  test.skip(pick < 0, 'only one data label offered');
  await items.nth(pick).click(); await wl.page.waitForTimeout(3000); await wl.loadAllRows();
  const now = await wl.dataLabel();
  const pdf = await exportPdf(wl.page, `EX-05-${now}`);
  await validate(wl, 'EX-05', pdf, raw, { chips: ['User/Resource: Is', 'Users'], checkDays: false });
  // back to the original label
  await qa(wl.page, K.dataLabel).click();
  await wl.page.locator('.popuplist.cradio').filter({ visible: true }).filter({ hasText: original }).first().click().catch(() => wl.page.keyboard.press('Escape'));
  await wl.page.waitForTimeout(2000);
  await clearAndDiscard(wl, fp, truth, 'EX-05');
});

test('FLT-EX-06 project-level report with a filter: Project is the project name; rows and totals = UI', async ({ wl }) => {
  const projectId = process.env.ZP_PERM_PROJECT_ID || '';
  test.skip(!projectId, 'set ZP_PERM_PROJECT_ID');
  const portalTitle = (await wl.page.title()).split(' - ')[0]!.trim(); // the project page title is the project name
  await wl.gotoProject(projectId); await wl.d.ready();
  const api = new ZpApi(wl.page, wl.d);
  const pj = await api.getJson<any>(`/projects/${projectId}`);
  const projectName = String((Array.isArray(pj) ? pj[0] : pj.project ?? pj)?.name ?? '');
  test.skip(!(await qa(wl.page, K.exportPdf).isVisible()), 'no Export to PDF on the project report');
  const fp = new FilterPanel(wl.page); await fp.open();
  const st = findSection(await fp.sections(), '4'); test.skip(!st, 'no Status section');
  await fp.expand(st!.field); await fp.setConditionOf(st!.field, 'all_open');
  const cap = captureRaw(wl.page); wl.d.resetOwners(); await fp.find(); await wl.loadAllRows(); cap.stop();
  const pdf = await exportPdf(wl.page, 'EX-06-project');
  await validate(wl, 'EX-06', pdf, cap.owners, { chips: ['Status:', 'All Open'], project: projectName, portal: portalTitle });
  if (await qa(wl.page, K.filterClear).isVisible()) await Promise.race([fp.clear(), new Promise(r => setTimeout(r, 30_000))]).catch(() => {});
  if (await qa(wl.page, K.saveAs).isVisible()) await wl.discard().catch(() => {});
});

test('FLT-EX-07 a view with a saved filter: exported rows are the filtered ones (no chip printed — WL-D-26)', async ({ wl }) => {
  const api = new ZpApi(wl.page, wl.d);
  const name = `${env.runId}-export-saved`;
  const id = await api.createView(name, { determiner: { pattern: '1', criteria: [{ field_name: 'resource_type', condition: 'is', value: ['1'] }] } });
  try {
    await wl.goto();
    const listed = (await api.views('created_views')).find(v => v.name === name);
    const ids = [id, listed?.id, listed?.custom_view_id].filter(Boolean) as string[];
    const cap = captureRaw(wl.page);
    const data = wl.page.waitForResponse(r => /\/reports\/workload\?/.test(r.url()) && ids.includes(new URL(r.url()).searchParams.get('view_id') ?? ''), { timeout: 150_000 });
    wl.d.resetOwners(); await wl.openViews(); await wl.viewItem('My Custom Views', name).click(); await data; await wl.loadAllRows(); cap.stop();
    const pdf = await exportPdf(wl.page, 'EX-07-saved-filter');
    // the API-created view is a Heatmap with "No Legend": the PDF prints colours and names, no numbers
    const p = await validate(wl, 'EX-07', pdf, cap.owners, { noValues: true, checkDays: false });
    expect(p.viewBy, 'view by follows the view\'s legend').toBe(await wl.dataLabel());
    for (const o of truth.owners.values()) expect.soft(p.flat.includes(o.name.replace(/\s+/g, '')), `${o.name} ${o.isResource ? 'not ' : ''}exported`).toBe(!o.isResource);
    expect.soft(p.flat.includes('UnassignedUser'), 'Unassigned row not exported').toBe(false);
    test.info().annotations.push({ type: 'evidence', description: `saved filtered view export: filter text "${p.chips}" (WL-D-26: nothing tells the reader the export is filtered)` });
    if (!p.chips) knownDefect('WL-D-26', 'a filter saved with the view is applied but shown nowhere — also not in the exported PDF');
    expect(p.chips, 'the PDF says the data is filtered').not.toBe('');
  } finally { await api.deleteView(id).catch(() => {}); }
});

test('FLT-EX-08 password-protect Yes: a password prompt appears and nothing downloads until it is completed (no password typed)', async ({ wl }) => {
  const fp = new FilterPanel(wl.page);
  await applyUsers(fp, wl);
  let downloaded = false;
  const onDl = () => { downloaded = true; };
  wl.page.on('download', onDl);
  await qa(wl.page, K.exportPdf).click();
  await qa(wl.page, 'alert-Yes').click();
  await wl.page.waitForTimeout(2500);
  const pw = wl.page.locator('input[type="password"]').filter({ visible: true });
  const dialogText = await wl.page.locator('[role=dialog], [class*="popup" i], [class*="modal" i]').filter({ visible: true }).allInnerTexts().then(a => a.join(' | ').replace(/\s+/g, ' ').slice(0, 300));
  test.info().annotations.push({ type: 'evidence', description: `after Yes: ${await pw.count()} password field(s); dialog "${dialogText}"` });
  expect(await pw.count(), 'a password field is offered').toBeGreaterThan(0);
  await wl.page.waitForTimeout(3000);
  expect(downloaded, 'nothing downloads before a password is set').toBe(false);
  // close without typing a password
  const cancel = wl.page.getByRole('button', { name: /^(cancel|close)$/i }).filter({ visible: true }).first();
  if (await cancel.isVisible().catch(() => false)) await cancel.click(); else await wl.page.keyboard.press('Escape');
  wl.page.off('download', onDl);
  await clearAndDiscard(wl, fp, truth, 'EX-08');
});
