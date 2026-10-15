#!/usr/bin/env node
/**
 * Local runner for the Control Center (control-center/index.html): a WebSocket server the page connects to, which
 * starts REAL Playwright runs with the environment, portal, browser and options chosen on the page and streams steps
 * and results back. Also serves the run's videos, screenshots and traces over HTTP, so they play in the bug view.
 *
 *   npm run runner            → serves control-center/index.html at http://localhost:9323 (PORT=… to change) and opens it;
 *                               the page connects to ws://localhost:9323 on load. NO_OPEN=1 skips opening the browser.
 *
 * Messages (the schema documented in the page's WebSocketRunner):
 *   client → { type: 'list' } · { type: 'start', runId, config, tests: [{ id, file, title }] } · { type: 'stop' } · { type: 'pause' } · { type: 'resume' }
 *   server → { type: 'hello', … } · { type: 'list', tests } · { type: 'progress' } · { type: 'step' } · { type: 'result' } · { type: 'log' } · { type: 'end' }
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn, spawnSync, exec } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(ROOT);
const PORT = Number(process.env.PORT || 9323);
const portalsCfg = JSON.parse(fs.readFileSync('portals.json', 'utf8'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Per-portal environment, same rules as scripts/parallel.mjs (session file, folders, seeded project id). */
function envForPortal(portal, extra = {}) {
  const p = portalsCfg.portals[portal] || {};
  const e = { ...process.env, ZP_PORTAL: portal, ZP_ADMIN_STATE: `auth/${portal}/admin.json`, ZP_AUTH_DIR: `auth/${portal}`, ZP_REPORTS_DIR: `reports/${portal}`, ZP_OUTPUT_DIR: `test-results/${portal}` };
  if (portal !== portalsCfg.source) for (const k of ['ZP_PERM_PROJECT_ID', 'ZP_BUG_PROJECT_ID', 'ZP_EDIT_VIEW_ID']) e[k] = '';
  Object.assign(e, p.env || {});
  const seeded = `${e.ZP_REPORTS_DIR}/portal-settings.json`;
  if (portal !== portalsCfg.source && fs.existsSync(seeded)) Object.assign(e, JSON.parse(fs.readFileSync(seeded, 'utf8')));
  return { ...e, ...extra };
}

/** The real catalogue: `playwright test --list --reporter=json` plus known durations. */
function listTests() {
  const r = spawnSync('npx', ['playwright', 'test', '--list', '--reporter=json', '--project=unit', '--project=workload', '--project=permissions', '--project=data'], { env: envForPortal(portalsCfg.source), encoding: 'utf8', maxBuffer: 64 << 20 });
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  let dur = {}; try { dur = JSON.parse(fs.readFileSync('reports/test-durations.json', 'utf8')); } catch {}
  const out = [];
  const rel = f => path.relative(ROOT, path.resolve(j.config?.rootDir || 'tests', f)).replace(/\\/g, '/');
  const walk = (s, fileHint) => { for (const x of s.suites || []) walk(x, x.file || fileHint); for (const sp of s.specs || []) for (const t of sp.tests || []) { const file = rel(sp.file || fileHint); const id = `${file}::${sp.title}`; if (out.some(o => o.id === id)) continue; const tags = sp.title.match(/@\w+/g) || []; out.push({ id, project: t.projectName || t.projectId || 'workload', file, title: sp.title, line: sp.line, tags, est: (dur[`${file}|${sp.title}`] || 0) * 1000 || (/unit/.test(file) ? 500 : 120000), mutating: !/tests\/unit\//.test(file), offline: /tests\/unit\//.test(file), needsLogin: /permissions/.test(file) ? 'cp' : (/tests\/unit\//.test(file) ? null : 'admin'), defect: (sp.title.match(/WL-D-\d+/) || [])[0] || null }); } };
  walk(j);
  return out;
}

const esc = s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
let child = null, paused = false;

function startRun(ws, msg) {
  if (child) { send(ws, { type: 'log', text: 'A run is already in progress' }); return; }
  const c = msg.config || {}; const tests = msg.tests || [];
  const files = [...new Set(tests.map(t => t.file))]; const projects = [...new Set(tests.map(t => t.project).filter(Boolean))];
  const portal = c.portal || portalsCfg.source;
  const args = ['playwright', 'test', '--reporter=./scripts/stream-reporter.js,json', ...projects.map(p => `--project=${p}`), ...files];
  if (tests.length) args.push('--grep', `(^|\\s)(${tests.map(t => esc(t.title)).join('|')})$`);
  if (c.headed) args.push('--headed');
  if (c.retries != null) args.push(`--retries=${c.retries}`);
  if (c.timeout) args.push(`--timeout=${c.timeout}`);
  if (c.workers) args.push(`--workers=${c.workers}`);
  if (c.trace) args.push(`--trace=${c.trace}`);
  const extra = {
    ZP_BASE_URL: c.baseURL || process.env.ZP_BASE_URL, ZP_WEEK_START: String(c.weekStart ?? 0), ZP_EXPECT_KNOWN_DEFECTS: c.expectKnown ? '1' : '0',
    ZP_SEED_VIEW_PREFIX: c.seedPrefix || 'QA-WL-SEED', RUN_ID: msg.runId || '', ZP_ALLOW_PROFILE_CHANGES: c.allowProfile ? '1' : '0', ZP_HTML_REPORT: '0',
    PLAYWRIGHT_JSON_OUTPUT_NAME: `reports/${portal}/runner-${(msg.runId || 'run').replace(/\W+/g, '_')}.json`,
    ...(['chrome', 'msedge'].includes(c.browser) ? { ZP_BROWSER_CHANNEL: c.browser } : {}),
  };
  if (['firefox', 'webkit'].includes(c.browser)) send(ws, { type: 'log', text: `Browser ${c.browser}: this suite has no ${c.browser} project in playwright.config.ts — running with Chromium` });
  if (c.video === 'off' || c.screenshot === 'off') send(ws, { type: 'log', text: 'Video and screenshot modes come from playwright.config.ts (retain-on-failure / only-on-failure); the page setting is recorded only' });
  const env = envForPortal(portal, extra);
  if (!fs.existsSync(env.ZP_ADMIN_STATE)) send(ws, { type: 'log', text: `No saved session at ${env.ZP_ADMIN_STATE}: run "npm run auth:portals" first` });
  log(`start ${msg.runId}: ${tests.length} tests, portal ${portal}, ${c.browser}${c.headed ? ' headed' : ''}, ${env.ZP_BASE_URL}`);
  send(ws, { type: 'log', text: `npx ${args.map(a => (/\s|\(/.test(a) ? JSON.stringify(a) : a)).join(' ')}` });
  send(ws, { type: 'log', text: `portal ${portal} on ${env.ZP_BASE_URL} · session ${env.ZP_ADMIN_STATE}` });
  fs.mkdirSync(`reports/${portal}`, { recursive: true });
  const logFile = `reports/${portal}/runner-${(msg.runId || 'run').replace(/\W+/g, '_')}.log`;
  const raw = fs.createWriteStream(logFile, { flags: 'a' }); raw.write(`\n# ${new Date().toISOString()} npx ${args.join(' ')}\n# config ${JSON.stringify(c)}\n`);
  child = spawn('npx', args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stdout.on('data', d => raw.write(d)); child.stderr.on('data', d => raw.write(d));
  let buf = '', done = 0, total = tests.length;
  child.stdout.on('data', d => {
    buf += d.toString(); const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { send(ws, { type: 'log', text: line.replace(/\u001b\[[0-9;]*m/g, '') }); continue; }
      if (m.t === 'begin') { total = m.total || total; send(ws, { type: 'progress', done, total, current: null }); }
      else if (m.t === 'begin-test') send(ws, { type: 'progress', done, total, current: { id: m.testId, title: m.title } });
      else if (m.t === 'step') send(ws, { type: 'step', testId: m.testId, index: m.index, total: Math.max(m.index + 1, 1), step: m.step, status: m.status, entry: m.entry });
      else if (m.t === 'result') { done = m.done; send(ws, { type: 'result', ...m, attachments: m.attachments.map(a => ({ ...a, url: `http://localhost:${PORT}/file?p=${encodeURIComponent(a.path)}` })) }); send(ws, { type: 'progress', done, total, current: null }); }
      else if (m.t === 'log') send(ws, { type: 'log', text: m.text });
      else if (m.t === 'end') { /* the process close event sends end */ }
    }
  });
  child.stderr.on('data', d => { const s = d.toString().replace(/\u001b\[[0-9;]*m/g, '').trim(); if (s && !/NODE_TLS_REJECT|trace-warnings/.test(s)) send(ws, { type: 'log', text: s }); });
  const started = Date.now();
  child.on('close', code => { log(`run ended with code ${code}`); raw.end(`# exit ${code}\n`); send(ws, { type: 'end', stopped: code === null || child?.killed === true, done, total, elapsed: Date.now() - started, code, log: logFile, results: extra.PLAYWRIGHT_JSON_OUTPUT_NAME }); child = null; paused = false; });
}
function signalRun(sig) { if (!child) return; try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} } }

const send = (ws, o) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (u.pathname === '/file') {
    const p = path.resolve(u.searchParams.get('p') || ''); const ok = p.startsWith(path.resolve('test-results')) || p.startsWith(path.resolve('reports'));
    if (!ok || !fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
    const type = { '.webm': 'video/webm', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.zip': 'application/zip', '.md': 'text/markdown', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream';
    const stat = fs.statSync(p); const range = req.headers.range;
    if (range && type.startsWith('video')) { const [a, b] = range.replace('bytes=', '').split('-'); const start = Number(a), end = b ? Number(b) : stat.size - 1; res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 }); return fs.createReadStream(p, { start, end }).pipe(res); }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' }); return fs.createReadStream(p).pipe(res);
  }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    const page = path.join(ROOT, 'control-center', 'index.html');
    if (!fs.existsSync(page)) { res.writeHead(404); return res.end('control-center/index.html not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return fs.createReadStream(page).pipe(res);
  }
  if (u.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, running: !!child, portals: Object.keys(portalsCfg.portals) })); }
  res.writeHead(404); res.end('runner-server: use the WebSocket');
});
const wss = new WebSocketServer({ server });
let cachedList = null, cachedAt = 0; // `--list` takes ~10 s: a refresh within 30 s reuses the last list
wss.on('connection', ws => {
  log('page connected');
  send(ws, { type: 'hello', root: ROOT, portals: Object.keys(portalsCfg.portals), running: !!child, fileBase: `http://localhost:${PORT}/file?p=` });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === 'list') { try { if (!cachedList || (m.refresh && Date.now() - cachedAt > 30_000)) { cachedList = listTests(); cachedAt = Date.now(); } send(ws, { type: 'list', tests: cachedList }); } catch (e) { send(ws, { type: 'log', text: `list failed: ${e.message}` }); send(ws, { type: 'list', tests: [] }); } }
    else if (m.type === 'start') startRun(ws, m);
    else if (m.type === 'stop') { log('stop'); signalRun('SIGTERM'); setTimeout(() => signalRun('SIGKILL'), 8000); }
    else if (m.type === 'pause') { paused = true; signalRun('SIGSTOP'); send(ws, { type: 'log', text: 'paused (the Playwright process is suspended)' }); }
    else if (m.type === 'resume') { paused = false; signalRun('SIGCONT'); send(ws, { type: 'log', text: 'resumed' }); }
  });
});
server.on('error', e => { if (e.code === 'EADDRINUSE') { console.error(`port ${PORT} is already in use — is another "npm run runner" open? Use PORT=9324 npm run runner`); process.exit(1); } throw e; });
server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  log(`Control Center: ${url}  (runs start from the page; keep this terminal open, Ctrl+C stops it)`);
  if (process.env.NO_OPEN !== '1') exec(process.platform === 'darwin' ? `open ${url}` : process.platform === 'win32' ? `start ${url}` : `xdg-open ${url}`, () => {});
});
