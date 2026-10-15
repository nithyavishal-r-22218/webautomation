// Playwright reporter that streams one JSON object per line to stdout, for scripts/runner-server.mjs.
// Lines: {"t":"begin"|"step"|"result"|"end", ...}. Anything else on stdout is a plain log line.
const path = require('path');

const layerOf = title => /api|request|fetch|PUT|GET|DELETE|response/i.test(title) ? 'API' : /header|period|summary/i.test(title) ? 'header' : /grid|row|column|owner/i.test(title) ? 'grid' : /form|edit|reopen|save|create/i.test(title) ? 'reopened form' : 'step';
const clean = s => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '');
// Playwright's own actions (category pw:api: goto, click, fill, waitForResponse …) are the reproduction steps when a spec has no test.step()
const actionLayer = title => /request|fetch|waitForResponse|route|apiRequest/i.test(title) ? 'API' : /goto|reload|waitForURL/i.test(title) ? 'navigation' : /fill|type|press|check|select|click|hover|setInputFiles|dragTo/i.test(title) ? 'UI' : /expect|toHave|toBe|toContain|toMatch/i.test(title) ? 'assertion' : 'UI';
const NOISE = /^(expect\.poll|page\.evaluate|locator\.evaluate|page\.waitForTimeout|locator\.count|locator\.textContent|locator\.innerText|locator\.isVisible|locator\.getAttribute|locator\.boundingBox|page\.on|browserContext\.|browser\.)/;
/** Expected / Received lines from a Playwright assertion error, when present. */
const expectedActual = msg => { const m = clean(msg); const e = m.match(/Expected(?: [^:\n]*)?: *(.+)/); const r = m.match(/Received(?: [^:\n]*)?: *(.+)/); return { expected: e ? e[1].trim() : '', actual: r ? r[1].trim() : '' }; };

class StreamReporter {
  constructor() { this.total = 0; this.done = 0; this.steps = new Map(); this.actions = new Map(); }
  emit(o) { process.stdout.write(JSON.stringify(o) + '\n'); }
  testId(test) { const file = path.relative(process.cwd(), test.location.file).replace(/\\/g, '/'); return `${file}::${test.title}`; }
  onBegin(config, suite) { this.rootDir = config.rootDir; this.total = suite.allTests().length; this.emit({ t: 'begin', total: this.total, rootDir: config.rootDir }); }
  onTestBegin(test) { this.steps.set(test.id, []); this.actions.set(test.id, []); this.emit({ t: 'begin-test', testId: this.testId(test), title: test.title, done: this.done, total: this.total }); }
  onStepBegin(test, result, step) { if (step.category !== 'test.step') return; const list = this.steps.get(test.id) || []; this.emit({ t: 'step', testId: this.testId(test), index: list.length, status: 'running', step: { layer: layerOf(step.title), action: step.title, expected: '', actual: '' } }); }
  onStepEnd(test, result, step) {
    if (step.category === 'pw:api' && !(step.parent && step.parent.category === 'pw:api') && !NOISE.test(step.title)) {
      const acts = this.actions.get(test.id) || []; this.actions.set(test.id, acts);
      const title = clean(step.title).replace(/\s+/g, ' ').slice(0, 220); const last = acts[acts.length - 1];
      if (last && last.action === title && !step.error) last.repeat = (last.repeat || 1) + 1; // the same action polled many times → one line "×n"
      else if (acts.length < 300) acts.push({ ts: Math.round(step.startTime.getTime() + step.duration - result.startTime.getTime()), layer: actionLayer(title), action: title, expected: '', actual: step.error ? clean(step.error.message || '').split('\n')[0] : '', ok: !step.error });
      return;
    }
    if (step.category !== 'test.step') return;
    const list = this.steps.get(test.id) || []; this.steps.set(test.id, list);
    const err = step.error ? clean(step.error.message || '').split('\n')[0] : '';
    const entry = { ts: Math.round(step.startTime.getTime() + step.duration - result.startTime.getTime()), layer: layerOf(step.title), action: step.title, expected: err ? 'step passes' : step.title, actual: err || step.title, ok: !step.error };
    list.push(entry);
    this.emit({ t: 'step', testId: this.testId(test), index: list.length - 1, status: step.error ? 'failed' : 'passed', step: { layer: entry.layer, action: entry.action, expected: entry.expected, actual: entry.actual }, entry });
  }
  onTestEnd(test, result) {
    this.done++;
    let steps = this.steps.get(test.id) || [];
    const actions = (this.actions.get(test.id) || []).map(a => ({ ...a, action: a.repeat > 1 ? `${a.action} ×${a.repeat}` : a.action }));
    const ea = expectedActual((result.errors[0] || {}).message || '');
    if (!steps.length) steps = actions; // specs without test.step(): the recorded browser actions are the reproduction steps
    if (result.status !== 'passed' && steps.length && !steps.some(s => s.ok === false)) { const last = steps[steps.length - 1]; last.ok = false; last.expected = ea.expected || last.expected || 'step passes'; last.actual = ea.actual || clean((result.errors[0] || {}).message || '').split('\n')[0] || last.actual; }
    else if (ea.expected) { const failing = steps.find(s => s.ok === false); if (failing) { failing.expected = failing.expected && failing.expected !== 'step passes' ? failing.expected : ea.expected; failing.actual = ea.actual || failing.actual; } }
    const expected = test.expectedStatus; const outcome = test.outcome();
    // a test that expects a known defect (knownDefect → test.fail) and passes anyway means the defect is fixed: report it as passed
    const fixedKnown = result.status === 'passed' && expected === 'failed';
    const status = fixedKnown ? 'passed' : outcome === 'expected' ? 'passed' : outcome === 'flaky' ? 'flaky' : outcome === 'skipped' ? 'skipped' : 'failed';
    const known = test.annotations.some(a => a.type === 'issue') && outcome === 'expected' && result.status === 'failed';
    const errors = result.errors.map(e => clean(e.message || '').split('\n').slice(0, 3).join(' ')).filter(Boolean);
    const attachments = result.attachments.filter(a => a.path).map(a => ({ name: a.name, contentType: a.contentType, path: a.path }));
    this.emit({ t: 'result', testId: this.testId(test), title: test.title, status, rawStatus: result.status, expectedStatus: expected, known, fixedKnown, duration: result.duration, error: errors[0] || null, errors, steps, actions: steps === actions ? [] : actions.slice(-120), actionCount: actions.length, expected: ea.expected, actual: ea.actual, attachments, retry: result.retry, annotations: test.annotations.map(a => `${a.type}: ${a.description || ''}`), done: this.done, total: this.total });
  }
  onEnd(result) { this.emit({ t: 'end', status: result.status, done: this.done, total: this.total }); }
  onStdOut(chunk) { const s = chunk.toString(); if (!s.startsWith('{')) this.emit({ t: 'log', text: clean(s).trimEnd() }); }
  onStdErr(chunk) { const s = clean(chunk.toString()).trimEnd(); if (s && !/NODE_TLS_REJECT|trace-warnings/.test(s)) this.emit({ t: 'log', text: s }); }
  printsToStdio() { return true; }
}
module.exports = StreamReporter;
