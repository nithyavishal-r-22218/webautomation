import fs from 'fs';
import path from 'path';

/**
 * Expected Workload values for an import fixture. Same rules the report should follow:
 *  hrs/day → value per working day; %/day → value% × availability; hrs (total) → total ÷ working days in range.
 *  Weekends (and holidays) get nothing. Closed/Cancelled tasks still count (observed product behaviour).
 */
export interface FixtureTask {
  name: string; owners: { name: string; value: number }[]; unit: 'hrs/day' | 'hrs' | '%/day';
  totalMinutes: number; start: string | null; end: string | null; status: string; taskList: string;
  priority: string; percent: number; billing: string; team: string | null; tag: string | null; known: string[];
}
export interface FixtureCase { id: string; kind: 'week' | 'edge'; tasks: string[]; owner?: string; from?: string; to?: string }
export interface Fixture { availabilityMinutes: number; quarter: { from: string; to: string }; tasks: FixtureTask[]; cases: FixtureCase[] }

export const loadFixture = (file = path.join(__dirname, '../tests/data/fixtures/wl-full-coverage.expected.json')): Fixture =>
  JSON.parse(fs.readFileSync(file, 'utf8'));

const iso = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const days = (a: string, b: string) => { const out: Date[] = []; for (let d = new Date(a + 'T00:00:00'); d <= new Date(b + 'T00:00:00'); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) out.push(d); return out; };
const working = (d: Date, holidays: Set<string>) => d.getDay() % 6 !== 0 && !holidays.has(iso(d));

/** owner|YYYYMMDD → expected minutes (working days only). */
export function expectedDaily(fx: Fixture, holidays: string[] = []): Map<string, number> {
  const hol = new Set(holidays), out = new Map<string, number>();
  for (const t of fx.tasks) {
    if (!t.start || !t.end) continue;
    const w = days(t.start, t.end).filter(d => working(d, hol));
    for (const o of t.owners) {
      const perDay = t.unit === 'hrs/day' ? o.value : t.unit === '%/day' ? Math.round(o.value / 100 * fx.availabilityMinutes) : (w.length ? Math.round(o.value / w.length) : 0);
      for (const d of w) out.set(`${o.name}|${iso(d)}`, (out.get(`${o.name}|${iso(d)}`) ?? 0) + perDay);
    }
  }
  return out;
}
/** The owner-days a case covers (incl. weekend days of a weekend-only task, which must stay 0). */
export function caseKeys(fx: Fixture, c: FixtureCase): string[] {
  if (!c.tasks.length) return days(fmtIso(c.from!), fmtIso(c.to!)).map(d => `${c.owner}|${iso(d)}`);
  const keys = new Set<string>();
  for (const name of c.tasks) {
    const t = fx.tasks.find(x => x.name === name)!;
    if (!t.start || !t.end) continue;
    const all = days(t.start, t.end);
    const list = t.known.includes('WL-D-17') ? all : all.filter(d => d.getDay() % 6 !== 0);
    for (const o of t.owners) for (const d of list) keys.add(`${o.name}|${iso(d)}`);
  }
  return [...keys];
}
const fmtIso = (s: string) => s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
export const label = (m: number, av: number) => m === 0 ? null : m > av ? 'over' : m === av ? 'optimal' : 'under';
export const isWorkingKey = (key: string) => { const s = key.split('|')[1]; const d = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); return d.getDay() % 6 !== 0; };
