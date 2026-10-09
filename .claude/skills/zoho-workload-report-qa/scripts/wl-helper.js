// Paste into the Claude in Chrome javascript tool once per page load (re-install after any navigation).
// Drives the Workload Report edit form and reads results in layers. Keep each call to 2–3 saves.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fire = el => { for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); };
const sels = () => [...document.querySelectorAll('ruc-select')].filter(s => s.offsetParent !== null);
window.__wl = {
  sleep, fire,
  // Opens ••• › Edit. Edit is the first item and sits under the "More Actions" tooltip: never click by position.
  async open() { document.querySelector('[data-zpqa="more_actions"]').click(); await sleep(800); document.querySelector('[data-zpqa="edit_customview"]').click(); await sleep(1500); },
  async tab(name) { const t = [...document.querySelectorAll('*')].find(x => x.children.length === 0 && (x.innerText || '').trim() === name && x.getBoundingClientRect().height > 0); fire(t); await sleep(600); },
  // Selects work with dispatched pointer events; radios and checkboxes do NOT — use real clicks at pos().
  async pick(i, text) { fire(sels()[i].querySelector('.zselectbox__selected')); await sleep(700); const li = [...document.querySelectorAll('li.zdropdownlist__item')].find(l => l.innerText.trim() === text); if (!li) return 'NOLI:' + text; fire(li); await sleep(600); return sels()[i].querySelector('.zselectbox__text')?.innerText.trim(); },
  options() { return [...new Set([...document.querySelectorAll('li.zdropdownlist__item')].filter(l => l.getBoundingClientRect().height > 0).map(l => l.innerText.trim()))]; },
  pos(value) { const r = [...document.querySelectorAll('input[type=radio]')].find(r => r.offsetParent !== null && r.value === value); const b = (r.closest('ruc-radio-button') || r).getBoundingClientRect(); return [Math.round(b.left + 8), Math.round(b.top + b.height / 2)]; },
  state() { return { radios: [...document.querySelectorAll('ruc-radio-button')].filter(r => r.offsetParent !== null && /ruc-checked/.test(r.className)).map(r => r.querySelector('input')?.value), selects: sels().map(s => s.querySelector('.zselectbox__text')?.innerText.trim()), range: [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null && /\d{2}-\d{2}-\d{4}/.test(i.value)).map(i => i.value)[0], desc: document.querySelector('[data-zpqa="cviewdescription"]')?.value }; },
  async save() { document.querySelector('[data-zpqa="bt_save_customview"]').click(); await sleep(3500); const g = s => document.querySelector(`[data-zpqa="${s}"]`)?.innerText.trim().replace(/\n/g, ' '); return { period: g('topbar_calendar'), chart: g('kanban_changecv'), label: g('data-label-select') }; },
  // Header summary, e.g. "Oct 1-Oct 31 198 hours" (innerText: textContent glues "Oct 8" and "1161").
  summary() { const e = [...document.querySelectorAll('*')].filter(x => x.children.length <= 3 && /^\s*[A-Z][a-z]{2} \d{1,2}\s*-\s*[A-Z][a-z]{2} \d{1,2}\s*[\d.,]+\s*(hours|Man Days|Man Weeks|%|minutes)\s*$/i.test(x.textContent || '')).sort((a, b) => a.textContent.length - b.textContent.length)[0]; return e ? (e.innerText || e.textContent).replace(/\s+/g, ' ').trim() : ''; },
  // Grid column dates from each column tooltip ("Date: MM-DD-YYYY").
  cols() { const c = [...document.querySelectorAll('*')].filter(e => e.children.length <= 3 && /^\s*\S{1,12}( - \S{1,8})?\s*Date: \d{2}-\d{2}-\d{4}Day: \w+Type: [\w ]+\s*$/.test(e.textContent)); const u = [...new Set(c.map(e => e.textContent.match(/Date: (\d{2}-\d{2}-\d{4})/)[1]))]; return { n: u.length, first: u[0], last: u.at(-1) }; },
  weekBuckets() { return [...document.querySelectorAll('.weekNameColumn')].map(e => e.textContent.replace(/Date:.*$/s, '').trim()); },
  // First user row: total, then period cells.
  row1() { const r = document.querySelector('[data-zpqa^="username-"]'); if (!r) return []; const y = r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2; return [...document.querySelectorAll('*')].filter(e => { const b = e.getBoundingClientRect(); return e.children.length === 0 && (e.innerText || '').trim() && Math.abs(b.top + b.height / 2 - y) < 20 && b.left > 400; }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(e => e.innerText.trim()); },
  // API layer: from/to of the last first-page data request. Prints only the params (full URLs are blocked).
  lastReq() { const e = performance.getEntriesByType('resource').map(r => r.name).filter(n => /reports\/workload\?/.test(n) && /index=1&/.test(n) && !/fetch_unassignee=true/.test(n)).pop(); if (!e) return null; const u = new URL(e); return { from: u.searchParams.get('from_date'), to: u.searchParams.get('to_date'), tp: u.searchParams.get('time_period') }; },
  // One save of a Time Period option, verified in all layers. Call performance.clearResourceTimings() first.
  async run(mode, option) { performance.clearResourceTimings(); await this.open(); await this.tab('Time Period'); const before = this.state(); if (before.selects[0] !== mode) await this.pick(0, mode); const picked = option ? await this.pick(1, option) : null; const r = await this.save(); await sleep(500); return { before, picked, header: r.period, chart: r.chart, summary: this.summary(), cols: this.cols(), req: this.lastReq() }; },
};
'installed';
