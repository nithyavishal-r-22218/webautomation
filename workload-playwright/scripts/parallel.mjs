#!/usr/bin/env node
/**
 * Multi-portal runner: the same suite against several portals at once, one Playwright process per portal.
 * Each process has its own portal, Admin session, report and output folders and API budget (src/rate.ts),
 * so the portals never share state. Portals are listed in portals.json.
 *
 *   node scripts/parallel.mjs auth   [portals]          DB sign-in (npm run auth:db) for each portal's Admin
 *   node scripts/parallel.mjs seed   [targets]          inventory the source portal, then copy its data into each target
 *   node scripts/parallel.mjs test   [args…]            QUEUE (default): every selected test goes into one queue, longest
 *                                                       first; each portal takes the next test the moment it is free, so no
 *                                                       portal waits while work is left and nothing is tied to a portal
 *   node scripts/parallel.mjs files  [args…]            older mode: whole spec files assigned to portals up front
 *   node scripts/parallel.mjs mirror [args…]            run the selected spec files on every portal
 *   node scripts/parallel.mjs shard  [args…]            split the selected TESTS evenly across the portals (playwright
 *                                                       --shard=i/N per portal; specs in mode 'parallel' split per test),
 *                                                       so no portal sits idle while another still has a long file
 *
 * Options: --portals=a,b (default: all in portals.json, or ZP_PORTALS). Anything else is passed to `playwright test`
 * (spec files, --grep, --grep-invert, --project; default --project=workload). The queue orders tests by their last
 * duration (reports/test-durations.json, kept by the runner), else 2 min; a test whose process dies without a result is
 * queued once more for any free portal. Results of every test are merged into reports/parallel-results.json.
 * A portal entry in portals.json may still restrict what it takes with `only` / `skip` (regexes on spec paths).
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(ROOT);
const cfg = JSON.parse(fs.readFileSync('portals.json', 'utf8'));
const argv = process.argv.slice(2);
const cmd = ['auth', 'seed', 'test', 'files', 'mirror', 'shard'].includes(argv[0]) ? argv.shift() : 'test';
const opt = Object.fromEntries(argv.filter(a => /^--portals=/.test(a)).map(a => a.slice(2).split('=')));
const rest = argv.filter(a => !/^--portals=/.test(a));
const listed = (opt.portals || process.env.ZP_PORTALS || Object.keys(cfg.portals).join(',')).split(',').map(s => s.trim()).filter(Boolean);
for (const p of listed) if (!cfg.portals[p]) die(`portal "${p}" is not in portals.json`);

/** Environment of one portal: .env, then defaults for the portal, then portals.json overrides and seeded settings. */
function envFor(p) {
  const isSource = p === cfg.source;
  const e = {
    ...process.env, ZP_PORTAL: p,
    ZP_ADMIN_STATE: `auth/${p}/admin.json`, ZP_AUTH_DIR: `auth/${p}`,
    ZP_REPORTS_DIR: `reports/${p}`, ZP_OUTPUT_DIR: `test-results/${p}`,
    // a fixed run id per run, so views created by both portals carry the same prefix
    RUN_ID: process.env.RUN_ID || runId,
  };
  // ids that belong to one portal must not leak into another
  if (!isSource) for (const k of ['ZP_PERM_PROJECT_ID', 'ZP_BUG_PROJECT_ID', 'ZP_EDIT_VIEW_ID']) e[k] = '';
  Object.assign(e, cfg.portals[p].env ?? {});
  const seeded = `${e.ZP_REPORTS_DIR}/portal-settings.json`;
  if (!isSource && fs.existsSync(seeded)) Object.assign(e, JSON.parse(fs.readFileSync(seeded, 'utf8')));
  return e;
}
const runId = `QA-WL-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}`;

function run(p, args, { quiet = false } = {}) {
  return new Promise(resolve => {
    const child = spawn('npx', ['playwright', 'test', ...args], { env: envFor(p), stdio: ['ignore', 'pipe', 'pipe'] });
    const tag = `[${p}]`.padEnd(18);
    let buf = '';
    const out = d => {
      buf += d.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
      const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) if (l.trim() && !/NODE_TLS_REJECT_UNAUTHORIZED|trace-warnings/.test(l) && !(quiet && /^\[rate\]/.test(l))) console.log(tag + l);
    };
    child.stdout.on('data', out); child.stderr.on('data', out);
    child.on('close', code => { if (buf.trim()) console.log(tag + buf); resolve(code ?? 1); });
  });
}

/** Spec files and test counts that `playwright test <args>` would run (listed with the source portal's settings). */
function listFiles(args) {
  const r = spawnSync('npx', ['playwright', 'test', '--list', '--reporter=json', ...args], { env: envFor(cfg.source), encoding: 'utf8', maxBuffer: 64 << 20 });
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  const counts = new Map();
  const walk = s => { for (const x of s.suites ?? []) walk(x); for (const sp of s.specs ?? []) counts.set(sp.file, (counts.get(sp.file) ?? 0) + sp.tests.length); };
  walk(j);
  return counts;
}
/** Every test `playwright test <args>` would run: file, line, title (listed with the source portal's settings). */
function listTests(args) {
  const r = spawnSync('npx', ['playwright', 'test', '--list', '--reporter=json', ...args], { env: envFor(cfg.source), encoding: 'utf8', maxBuffer: 64 << 20 });
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  const out = [];
  const walk = s => { for (const x of s.suites ?? []) walk(x); for (const sp of s.specs ?? []) out.push({ file: sp.file, line: sp.line, title: sp.title }); };
  walk(j);
  return out;
}
const DUR_FILE = 'reports/test-durations.json';
const loadDur = () => { try { return JSON.parse(fs.readFileSync(DUR_FILE, 'utf8')); } catch { return {}; } };
const reEsc = t => t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
/** Statuses and durations of the tests in one JSON report. */
function readReport(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')); const out = [];
    const walk = s => { for (const x of s.suites ?? []) walk(x); for (const sp of s.specs ?? []) for (const t of sp.tests) out.push({ file: sp.file, title: sp.title, status: t.status, seconds: (t.results ?? []).reduce((a, r) => a + r.duration / 1000, 0), issues: (t.annotations ?? []).filter(a => a.type === 'issue').map(a => a.description.split(':')[0]), errors: (t.results ?? []).flatMap(r => (r.errors ?? []).map(e => String(e.message ?? '').replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0].slice(0, 200))).slice(0, 3) }); };
    walk(j); return out;
  } catch { return []; }
}

/** Seconds per spec file: the longest last run of that file on any portal (each portal's results.json). */
function durations() {
  const d = new Map();
  for (const p of Object.keys(cfg.portals)) {
    const f = `${envFor(p).ZP_REPORTS_DIR}/results.json`;
    if (!fs.existsSync(f)) continue;
    const per = new Map();
    const walk = s => { for (const x of s.suites ?? []) walk(x); for (const sp of s.specs ?? []) for (const t of sp.tests) for (const r of t.results ?? []) per.set(sp.file, (per.get(sp.file) ?? 0) + r.duration / 1000); };
    walk(JSON.parse(fs.readFileSync(f, 'utf8')));
    for (const [k, v] of per) d.set(k, Math.max(d.get(k) ?? 0, v));
  }
  return d;
}
const matches = (re, file) => !re || new RegExp(re).test(file);
const playwrightArgs = () => (rest.some(a => /^--project/.test(a)) ? rest : ['--project=workload', ...rest]);

async function main() {
  if (cmd === 'auth') {
    const codes = await Promise.all(listed.map(p => run(p, ['--project=auth-db', '--reporter=line'], { quiet: true })));
    return codes.some(c => c) ? 1 : 0;
  }
  if (cmd === 'seed') {
    const targets = rest.length ? rest : listed.filter(p => p !== cfg.source);
    console.log(`inventory of ${cfg.source} …`);
    if (await run(cfg.source, ['--project=tools', 'tests/tools/portal-probe.spec.ts', '--reporter=line'], { quiet: true })) return 1;
    const src = path.resolve(envFor(cfg.source).ZP_REPORTS_DIR, 'inventory.json');
    const codes = [];
    for (const t of targets) {
      process.env.ZP_SEED_SOURCE = src;
      process.env.ZP_SEED_SOURCE_PROJECT_ID = envFor(cfg.source).ZP_PERM_PROJECT_ID ?? '';
      codes.push(await run(t, ['--project=tools', 'tests/tools/seed-portal.spec.ts', '--reporter=line']));
      codes.push(await run(t, ['--project=tools', 'tests/tools/portal-probe.spec.ts', '--reporter=line'], { quiet: true }));
    }
    return codes.some(c => c) ? 1 : 0;
  }

  const args = playwrightArgs();
  if (cmd === 'shard') {
    const n = listed.length;
    console.log(`shard run ${runId}: ${n} portals, each runs shard i/${n} of: ${args.join(' ')}`);
    const started = Date.now();
    const codes = await Promise.all(listed.map((p, i) => run(p, [...args, `--shard=${i + 1}/${n}`])));
    const summary = { runId, mode: 'shard', minutes: Math.round((Date.now() - started) / 60000), portals: Object.fromEntries(listed.map((p, i) => [p, { shard: `${i + 1}/${n}`, exit: codes[i], results: `${envFor(p).ZP_REPORTS_DIR}/results.json` }])) };
    fs.mkdirSync('reports', { recursive: true }); fs.writeFileSync('reports/parallel-summary.json', JSON.stringify(summary, null, 2));
    console.log(`done in ${summary.minutes} min`);
    return codes.some(c => c) ? 1 : 0;
  }
  if (cmd === 'test') return queueRun(args);
  const files = listFiles(args);
  if (!files.size) die('no tests selected');
  // everything that is not a spec path (flags and their values, e.g. --grep "x") goes to every portal's process
  const isPath = a => /\.spec\.ts$/.test(a) || /^tests\//.test(a);
  const flags = args.filter(a => !isPath(a));
  const plan = new Map(listed.map(p => [p, { files: [], est: 0 }]));
  if (cmd === 'mirror') for (const p of listed) plan.get(p).files = [...files.keys()].filter(f => matches(cfg.portals[p].only, f) && !(cfg.portals[p].skip && matches(cfg.portals[p].skip, f)));
  else {
    const dur = durations();
    const est = f => dur.get(f) ?? files.get(f) * 120;
    for (const f of [...files.keys()].sort((a, b) => est(b) - est(a))) {
      const ok = listed.filter(p => matches(cfg.portals[p].only, f) && !(cfg.portals[p].skip && matches(cfg.portals[p].skip, f)));
      if (!ok.length) { console.log(`no portal may run ${f}; skipped`); continue; }
      const p = ok.reduce((a, b) => (plan.get(a).est <= plan.get(b).est ? a : b));
      plan.get(p).files.push(f); plan.get(p).est += est(f);
    }
  }
  console.log(`${cmd === 'mirror' ? 'mirror' : 'files'} run ${runId}`);
  for (const [p, v] of plan) console.log(`  ${p}: ${v.files.length} files${v.est ? `, ~${Math.round(v.est / 60)} min` : ''}\n    ${v.files.join('\n    ')}`);
  const started = Date.now();
  const codes = await Promise.all([...plan].filter(([, v]) => v.files.length).map(([p, v]) => run(p, [...flags, ...v.files.map(f => `tests/${f}`)])));
  const summary = { runId, mode: cmd, minutes: Math.round((Date.now() - started) / 60000), portals: Object.fromEntries([...plan].map(([p, v], i) => [p, { files: v.files, exit: codes[i] ?? null, results: `${envFor(p).ZP_REPORTS_DIR}/results.json`, html: `${envFor(p).ZP_REPORTS_DIR}/html` }])) };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/parallel-summary.json', JSON.stringify(summary, null, 2));
  console.log(`done in ${summary.minutes} min; per-portal reports: ${[...plan.keys()].map(p => envFor(p).ZP_REPORTS_DIR + '/html').join(', ')}`);
  return codes.some(c => c) ? 1 : 0;
}
/** The queue: one list, longest test first; every portal takes the next test it may run as soon as it is free. */
async function queueRun(args) {
  const tests = listTests(args);
  if (!tests.length) die('no tests selected');
  // flags for each single-test run: everything except spec paths and the selection flags already applied by the listing
  const flags = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/\.spec\.ts$/.test(a) || /^tests\//.test(a) || /^--shard/.test(a)) continue;
    if (/^(-g|--grep|--grep-invert)$/.test(a)) { i++; continue; }
    if (/^(--grep|--grep-invert)=/.test(a)) continue;
    flags.push(a);
  }
  const dur = loadDur();
  const key = t => `${t.file}|${t.title}`;
  const est = t => dur[key(t)] ?? 120;
  const queue = [...tests].sort((a, b) => est(b) - est(a)).map(t => ({ ...t, tries: 0 }));
  const allowed = (p, t) => matches(cfg.portals[p].only, t.file) && !(cfg.portals[p].skip && matches(cfg.portals[p].skip, t.file));
  const dir = `reports/queue/${runId}`; fs.mkdirSync(dir, { recursive: true });
  const results = []; const busy = Object.fromEntries(listed.map(p => [p, 0]));
  let n = 0; const total = queue.length; const started = Date.now();
  console.log(`queue run ${runId}: ${total} tests on ${listed.length} portals (${listed.join(', ')}), ~${Math.round(queue.reduce((a, t) => a + est(t), 0) / 60 / listed.length)} min each if spread evenly`);
  async function worker(p) {
    for (;;) {
      const i = queue.findIndex(t => allowed(p, t));
      if (i < 0) return;
      const t = queue.splice(i, 1)[0]; const k = ++n; t.tries++;
      const out = path.resolve(dir, `${String(k).padStart(4, '0')}-${p}.json`);
      console.log(`[${p}]`.padEnd(18) + `▶ ${k}/${total} ${t.title.slice(0, 110)}`);
      const t0 = Date.now();
      // the file plus the exact title (anchored at the end, after a separator) selects this test; no line number, so a spec
      // edited while the queue runs is still found
      const code = await runWith(p, [...flags, `tests/${t.file}`, '--grep', `(^|\\s)${reEsc(t.title)}$`], { ZP_RESULTS_FILE: out, ZP_HTML_REPORT: '0' });
      busy[p] += (Date.now() - t0) / 1000;
      const got = readReport(out).filter(r => r.title === t.title);
      if (!got.length && t.tries < 2) { console.log(`[${p}]`.padEnd(18) + `↻ no result (exit ${code}) — back in the queue: ${t.title.slice(0, 90)}`); queue.unshift(t); continue; }
      const r = got[0] ?? { file: t.file, title: t.title, status: 'crashed', seconds: (Date.now() - t0) / 1000, issues: [], errors: [`exit ${code}`] };
      results.push({ ...r, portal: p });
      dur[key(t)] = Math.round(r.seconds);
      const mark = { expected: '✓', flaky: '~', skipped: '-', unexpected: '✘', crashed: '✘' }[r.status] ?? '?';
      console.log(`[${p}]`.padEnd(18) + `${mark} ${k}/${total} ${r.status}${r.issues.length ? ` (${[...new Set(r.issues)].join(', ')})` : ''} ${Math.round(r.seconds)}s · ${t.title.slice(0, 90)}`);
    }
  }
  await Promise.all(listed.map(worker));
  fs.writeFileSync(DUR_FILE, JSON.stringify(dur, null, 1));
  const count = st => results.filter(r => r.status === st).length;
  const summary = {
    runId, mode: 'queue', minutes: Math.round((Date.now() - started) / 60000), tests: total,
    counts: { expected: count('expected'), unexpected: count('unexpected'), flaky: count('flaky'), skipped: count('skipped'), crashed: count('crashed') },
    knownDefects: Object.fromEntries([...new Set(results.flatMap(r => r.issues))].map(d => [d, results.filter(r => r.issues.includes(d)).length])),
    portals: Object.fromEntries(listed.map(p => [p, { tests: results.filter(r => r.portal === p).length, busyMinutes: Math.round(busy[p] / 60) }])),
    failures: results.filter(r => r.status === 'unexpected' || r.status === 'crashed').map(r => ({ portal: r.portal, file: r.file, title: r.title, errors: r.errors })),
    results,
  };
  fs.writeFileSync('reports/parallel-results.json', JSON.stringify(summary, null, 2));
  fs.writeFileSync('reports/parallel-summary.json', JSON.stringify({ ...summary, results: undefined }, null, 2));
  console.log(`done in ${summary.minutes} min: ${JSON.stringify(summary.counts)}; per portal ${JSON.stringify(summary.portals)}; known defects ${JSON.stringify(summary.knownDefects)}`);
  for (const f of summary.failures) console.log(`  ✘ [${f.portal}] ${f.title.slice(0, 100)} — ${f.errors[0] ?? ''}`);
  console.log('all results: reports/parallel-results.json');
  return summary.failures.length ? 1 : 0;
}
function runWith(p, args, extraEnv) {
  return new Promise(resolve => {
    const child = spawn('npx', ['playwright', 'test', ...args], { env: { ...envFor(p), ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const out = d => {
      buf += d.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
      const lines = buf.split('\n'); buf = lines.pop();
      // only errors reach the console here; the per-test JSON holds the rest
      for (const l of lines) if (/Error:|ERR_|Timeout|No tests found/.test(l) && !/NODE_TLS/.test(l)) console.log(`[${p}]`.padEnd(18) + '  ' + l.trim().slice(0, 200));
    };
    child.stdout.on('data', out); child.stderr.on('data', out);
    child.on('close', code => resolve(code ?? 1));
  });
}
function die(m) { console.error(m); process.exit(2); }
main().then(c => process.exit(c), e => { console.error(e); process.exit(1); });
