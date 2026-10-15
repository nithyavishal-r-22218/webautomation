import fs from 'fs';
import path from 'path';
import { expect, type Page, type Response } from '@playwright/test';
import { K, qa } from './locators';
import { env } from './env';
import type { WorkloadPage } from './pages/WorkloadPage';

// pdf-parse's index runs a self-test when it has no parent module; the lib entry does not
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (b: Buffer) => Promise<{ numpages: number; text: string; info: Record<string, unknown> }>;

/**
 * Toolbar › Export to PDF (`reschart_pdfexport`), seen 13-10-2026:
 *   click → "Attention! Do you wish to password-protect the file? (may contain PII)" Yes (`alert-Yes`) / No (`alert-No`)
 *   No → POST /portal/<portal>/ganttexport → application/pdf download `workload_report_export_<id>.pdf`
 * The PDF is a headless-Chrome print of the rendered report: text order is chips, one data line per row
 * (row total then one value per day; long values are cut to "0.3..."), the day header, the row names
 * ("Vishal liteuser(4)"), then "<portal>", "Workload Report view by <data label>",
 * "Project:<project>Date:<from> to <to>Exported On:<date> <time>".
 */
export interface ExportedPdf { file: string; size: number; pages: number; text: string; info: Record<string, unknown>; suggested: string }
export interface ParsedPdf {
  portal: string; viewBy: string; project: string; dateRange: string; exportedOn: string;
  chips: string; dataLines: string[][]; flat: string; lines: string[];
}

export const DIR = `${env.reportsDir}/export`;
/** Value tokens: 1d, 0.333d, 15.333d, 8h, 110:15h (hours as H:MM), 50%, and cut values such as 0.3... or 110:1... */
const TOKEN = /\d+(?::\d{2})?(?:\.\d+)?(?:d|h|%|m)|\d+(?::\d*)?(?:\.\d*)?\.\.\./g;

export async function exportPdf(page: Page, name: string): Promise<ExportedPdf> {
  fs.mkdirSync(DIR, { recursive: true });
  await qa(page, K.exportPdf).click();
  const no = qa(page, 'alert-No');
  await expect(no, 'password-protect prompt shown').toBeVisible({ timeout: 30_000 });
  const download = page.waitForEvent('download', { timeout: 150_000 });
  const pdfResponse = page.waitForResponse((r: Response) => /\/ganttexport/.test(r.url()), { timeout: 150_000 }).catch(() => null);
  await no.click();
  const d = await download;
  const resp = await pdfResponse;
  if (resp) expect.soft(resp.headers()['content-type'] ?? '', 'export response is a PDF').toContain('application/pdf');
  const file = path.join(DIR, `${name.replace(/[^\w-]+/g, '_')}.pdf`);
  await d.saveAs(file);
  const buf = fs.readFileSync(file);
  expect(buf.subarray(0, 5).toString(), 'file starts with %PDF-').toBe('%PDF-');
  const parsed = await pdfParse(buf);
  return { file, size: buf.length, pages: parsed.numpages, text: parsed.text, info: parsed.info, suggested: d.suggestedFilename() };
}

export function parsePdf(text: string): ParsedPdf {
  const raw = text.split('\n').map(l => l.trim()).filter(Boolean);
  const tokensOnly = (l: string, min: number) => { const t = l.match(TOKEN) ?? []; return t.length >= min && l.replace(TOKEN, '') === ''; };
  // Heatmap exports print the row total on its own line just above the row's day values: join them, so every view
  // reads "total, day 1 … day N" like the Bar export (seen 13-10-2026)
  const lines: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (tokensOnly(raw[i]!, 1) && (raw[i]!.match(TOKEN) ?? []).length === 1 && raw[i + 1] && tokensOnly(raw[i + 1]!, 2)) { lines.push(raw[i]! + raw[i + 1]!); i++; }
    else lines.push(raw[i]!);
  }
  const isData = (l: string) => tokensOnly(l, 2);
  const firstData = lines.findIndex(isData);
  const dataLines = lines.filter(isData).map(l => l.match(TOKEN)!);
  const meta = text.match(/Project:(.*?)Date:(.*?)Exported On:(.*)$/m);
  const viewIdx = lines.findIndex(l => /^Workload Report view by /.test(l));
  return {
    portal: viewIdx > 0 ? lines[viewIdx - 1]! : '',
    viewBy: viewIdx >= 0 ? lines[viewIdx]!.replace(/^Workload Report view by /, '') : '',
    project: meta?.[1]?.trim() ?? '', dateRange: meta?.[2]?.trim() ?? '', exportedOn: meta?.[3]?.trim() ?? '',
    chips: firstData > 0 ? lines.slice(0, firstData).join(' ') : '',
    dataLines, flat: text.replace(/\s+/g, ''), lines,
  };
}

/** UI rows in order: id (data-zpqa username-<id>) and "name(count)" without whitespace, as the PDF prints it. */
export async function uiRows(wl: WorkloadPage): Promise<{ id: string; key: string; text: string }[]> {
  return wl.rows().evaluateAll(es => es.map(e => {
    const id = (e.getAttribute('data-zpqa') ?? '').replace('username-', '');
    const parts = ((e as HTMLElement).innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
    const body = parts.length > 1 && parts[0]!.length <= 2 ? parts.slice(1) : parts; // drop avatar initials
    const text = body.join(' ');
    return { id, key: body.join('').replace(/\s+/g, ''), text };
  }));
}
/** UI row totals (first cell of every grid row), in row order. */
export async function uiTotals(wl: WorkloadPage): Promise<string[]> {
  return wl.page.locator('.monthnameColumn').evaluateAll(es => es.map(e => (e.textContent ?? '').replace(/\s+/g, '')).filter(Boolean));
}

/** Raw owners of every workload data response from now on (pages + Unassigned), for per-day checks. */
export interface RawOwner { id: string; name: string; totalWork: number; days: Map<string, number>; unassigned: boolean }
export function captureRaw(page: Page) {
  const owners = new Map<string, RawOwner>();
  const on = async (r: Response) => {
    if (!/\/reports\/workload\?/.test(r.url()) || !r.ok()) return;
    const un = new URL(r.url()).searchParams.get('fetch_unassignee') === 'true';
    const j = await r.json().catch(() => ({}));
    for (const o of (j.owners ?? []) as any[]) owners.set(String(o.id), {
      id: String(o.id), name: String(o.name ?? ''), totalWork: Number(o.work?.total_work ?? 0), unassigned: un,
      days: new Map(((o.work?.total_date_work ?? []) as any[]).map(d => [String(d.date), Number(d.work ?? 0)])),
    });
  };
  page.on('response', on);
  return { owners, stop: () => page.off('response', on) };
}

/** Man days as the report prints them: work minutes / minutes in a standard day, at most 3 decimals, trailing zeros dropped. */
export const manDays = (minutes: number, dayMinutes: number) => `${Math.round((minutes / dayMinutes) * 1000) / 1000}d`;
/** A PDF token matches an expected value exactly, or as its cut prefix ("0.3..." for "0.333d"). */
export const tokenMatches = (token: string, expected: string) => token === expected || (token.endsWith('...') && expected.startsWith(token.slice(0, -3)));
