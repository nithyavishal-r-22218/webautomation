"""Generate the case list + a JS runner for project-level Workload verification.

Expected values come only from the import file (new project => no other data).
Output: cases.json (for the report) and runner.js (pasted into the browser).
"""
import json, sys, datetime as dt, collections, re
import openpyxl

IMP, PID, OUTDIR = sys.argv[1], sys.argv[2], sys.argv[3]
AV = 9 * 60  # minutes / working day
ws = openpyxl.load_workbook(IMP).active
rows = list(ws.values)
H = {h: i for i, h in enumerate(rows[0])}


def d(s):
    return dt.datetime.strptime(s, '%d/%m/%Y').date() if s else None


def mins(s):
    h, m = s.split(':')
    return int(h) * 60 + int(m)


UNIT = {'hrs/day': 'hours_per_day', 'hrs': 'hours', '%/day': '%_per_day'}
tasks, daily, contrib = [], collections.defaultdict(int), collections.defaultdict(list)
for r in rows[1:]:
    g = lambda k: r[H[k]]
    s, e = d(g('Start Date')), d(g('Due Date'))
    owners = [o.strip() for o in g('Owner').split(',')] if g('Owner') else ['Unassigned']
    unit = g('Work Hours Unit')
    vals = (g('Work Hours Per Owner') or '0:00').split(',')
    wds = [s + dt.timedelta(i) for i in range((e - s).days + 1)] if s else []
    wds = [x for x in wds if x.weekday() < 5]
    ow = []
    for o, v in zip(owners, vals):
        if unit == 'hrs/day':
            pd, wv = mins(v), mins(v)
        elif unit == '%/day':
            pd, wv = round(float(v) / 100 * AV), float(v)
        else:
            pd, wv = (round(mins(v) / len(wds)) if wds else 0), mins(v)
        ow.append({'n': o, 'v': wv})
        for x in wds:
            daily[(o, x)] += pd
            contrib[(o, x)].append(g('Task Name'))
    tasks.append({'name': g('Task Name'), 'owners': ow, 'unit': UNIT[unit], 'total': mins(g('Work hours')),
                  'start': s.isoformat() if s else None, 'end': e.isoformat() if e else None,
                  'status': g('Custom Status'), 'tl': g('Task List Name'), 'pr': g('Priority'),
                  'pct': int(g('% Completed')), 'bt': g('Billing Type'), 'team': g('Associated Team'), 'tag': g('Tags'),
                  'pct_over_100': unit == '%/day' and any(float(v) > 100 for v in vals),
                  'weekend_only': bool(s) and not wds and unit != 'hrs'})


def label(m):
    return None if m == 0 else ('over' if m > AV else ('optimal' if m == AV else 'under'))


# ---- weekly scenario cases + edge cases (one expectation per owner-day) ----
cases = []
week_re = re.compile(r'^WL (Oct|Nov|Dec) W(\d) (.+?)( \(\d of \d\))? - (.+)$')
groups = collections.OrderedDict()
for t in tasks:
    m = week_re.match(t['name'])
    if m:
        key = f"W|{m.group(5)}|{m.group(1)}|W{m.group(2)}"
        groups.setdefault(key, {'id': f"{m.group(5)} {m.group(1)} W{m.group(2)} {m.group(3)}", 'tasks': []})['tasks'].append(t)
    else:
        groups[f"E|{t['name']}"] = {'id': t['name'].split(' ')[0] + ' ' + t['name'].split(' ', 1)[1], 'tasks': [t]}
for key, g in groups.items():
    exp = []
    known = []
    for t in g['tasks']:
        if t['pct_over_100']:
            known.append('F1')
        if t['weekend_only']:
            known.append('F2')
        if not t['start']:
            continue
        s, e = dt.date.fromisoformat(t['start']), dt.date.fromisoformat(t['end'])
        x = s
        while x <= e:
            for o in t['owners']:
                if x.weekday() < 5 or t['weekend_only']:
                    exp.append((o['n'], x))
            x += dt.timedelta(1)
    exp = sorted(set(exp))
    checks = [{'u': u, 'd': x.strftime('%Y%m%d'), 'm': daily.get((u, x), 0) if x.weekday() < 5 else 0,
               'a': label(daily.get((u, x), 0)) if x.weekday() < 5 and u != 'Unassigned' else None} for u, x in exp]
    if not g['tasks'][0]['start']:
        checks = []
    st = 'Unallocated' if 'Unallocated' in g['id'] else ''
    if 'Unallocated' in g['id'] and not any(t['owners'] for t in g['tasks']):
        pass
    cases.append({'id': g['id'], 'kind': 'week' if key.startswith('W') else 'edge', 'known': sorted(set(known)), 'checks': checks,
                  'tasks': [t['name'] for t in g['tasks']]})

# Unallocated weeks with no task at all: expect zero work for that user on those days
plan_re = None
USERS = ['Vishal workload', 'Vishal PLAdmin', 'vishal PL manager', 'Vishal plemployee', 'Vishal plreadonly',
         'Vishal liteuser', 'Vishal customprofile', 'UIAutomation_Workload_Resource']
WEEKS = {'Oct': [(5, 9), (12, 16), (19, 23), (26, 30)], 'Nov': [(2, 6), (9, 13), (16, 20), (23, 27)],
         'Dec': [(7, 11), (14, 18), (21, 25), (28, 31)]}
MN = {'Oct': 10, 'Nov': 11, 'Dec': 12}
existing = {c['id'].rsplit(' ', 1)[0] if False else None for c in cases}
for u in USERS:
    for mon, wk in WEEKS.items():
        for i, (a, b) in enumerate(wk):
            tag = f"{u} {mon} W{i + 1}"
            if any(c['id'].startswith(tag + ' ') for c in cases):
                continue
            days = [dt.date(2026, MN[mon], x) for x in range(a, b + 1)]
            cases.append({'id': f"{tag} Unallocated (no task)", 'kind': 'week', 'known': [],
                          'checks': [{'u': u, 'd': x.strftime('%Y%m%d'), 'm': 0, 'a': None} for x in days], 'tasks': []})

# ---- monthly totals ----
months = {'Oct': (dt.date(2026, 10, 1), dt.date(2026, 10, 31)), 'Nov': (dt.date(2026, 11, 1), dt.date(2026, 11, 30)),
          'Dec': (dt.date(2026, 12, 1), dt.date(2026, 12, 31))}
totals = []
for u in USERS + ['Unassigned']:
    for mon, (a, b) in months.items():
        tot = sum(v for (o, x), v in daily.items() if o == u and a <= x <= b)
        k = []
        for t in tasks:
            if t['start'] and any(o['n'] == u for o in t['owners']) and t['start'] <= b.isoformat() and t['end'] >= a.isoformat():
                if t['pct_over_100']:
                    k.append('F1')
                if t['weekend_only']:
                    k.append('F2')
        totals.append({'u': u, 'mon': mon, 'm': tot, 'known': sorted(set(k))})

json.dump({'cases': cases, 'totals': totals, 'tasks': tasks}, open(f'{OUTDIR}/cases.json', 'w'), indent=1)

runner = r"""
(async () => {
const PID = '%PID%';
const C = %CASES%;
const zp = window.__zp;
const norm = s => (s||'').toString().toLowerCase().replace(/[^a-z0-9%]/g,'');
const tm = s => { if (s==null) return null; const m = String(s).match(/^(\d+):(\d+)$/); return m ? (+m[1])*60+(+m[2]) : Number(s); };
const nm = o => o.zpuid && o.name==='Unassigned User' ? 'Unassigned' : ((o.first_name||'') + (o.last_name ? ' '+o.last_name : '')).trim();
// tasks
let T = []; for (let p=1; p<5; p++) { const r = await zp('GET', `/projects/${PID}/tasks?page=${p}&per_page=100`); T = T.concat(r.j.tasks||[]); if (!r.j.page_info.has_next_page) break; }
const byName = {}; T.forEach(t => byName[t.name] = t);
const field = [];
for (const e of C.tasks) {
  const t = byName[e.name]; const f = [];
  if (!t) { field.push({n:e.name, f:['MISSING']}); continue; }
  const ow = t.owners_and_work || {}; const os = (ow.owners||[]);
  const an = os.map(nm).sort().join(','), en = e.owners.map(o=>o.n).sort().join(',');
  if (an !== en) f.push(`owners ${an} != ${en}`);
  if (ow.unit !== e.unit) f.push(`unit ${ow.unit} != ${e.unit}`);
  for (const o of e.owners) { const a = os.find(x => nm(x)===o.n); if (a && Math.abs(tm(a.work_values) - o.v) > 0.01) f.push(`work ${o.n} ${a.work_values} != ${o.v}`); }
  if (Math.abs(tm(ow.total_work) - e.total) > 1) f.push(`total ${ow.total_work} != ${e.total} min`);
  const sd = t.start_date ? String(t.start_date).slice(0,10) : null, ed = t.end_date ? String(t.end_date).slice(0,10) : null;
  if (sd !== e.start) f.push(`start ${sd} != ${e.start}`);
  if (ed !== e.end) f.push(`end ${ed} != ${e.end}`);
  if ((t.status||{}).name !== e.status) f.push(`status ${(t.status||{}).name} != ${e.status}`);
  if ((t.tasklist||{}).name !== e.tl) f.push(`tasklist ${(t.tasklist||{}).name} != ${e.tl}`);
  if (norm(t.priority) !== norm(e.pr)) f.push(`priority ${t.priority} != ${e.pr}`);
  if (+t.completion_percentage !== e.pct) f.push(`pct ${t.completion_percentage} != ${e.pct}`);
  if (norm(t.billing_type) !== norm(e.bt)) f.push(`billing ${t.billing_type} != ${e.bt}`);
  field.push({n:e.name, f, known: e.pct_over_100 ? 'F1' : ''});
}
// workload, per month, users + unassigned
const W = {}; const A = {}; const MT = {};
const months = {Oct:['2026-10-01','2026-10-31'], Nov:['2026-11-01','2026-11-30'], Dec:['2026-12-01','2026-12-31']};
for (const [mon,[a,b]] of Object.entries(months)) {
  for (const un of [false, true]) {
    let idx = 1, more = true;
    while (more) {
      const q = `/reports/workload?project_id=${PID}&from_date=${a}T00:00:00.000Z&to_date=${b}T23:59:59.999Z&time_period=days&report_based_on=users&index=${idx}&range=15` + (un ? '&fetch_unassignee=true' : '');
      const r = await zp('GET', q); if (r.s !== 200) return 'workload API '+r.s+' '+JSON.stringify(r.j).slice(0,200);
      for (const o of (r.j.owners||[])) {
        const u = un ? 'Unassigned' : o.name;
        MT[u+'|'+mon] = (o.work||{}).total_work || 0;
        for (const dw of ((o.work||{}).total_date_work||[])) { W[u+'|'+dw.date] = (W[u+'|'+dw.date]||0) + dw.work; A[u+'|'+dw.date] = dw.allocation; }
      }
      more = !un && r.j.page_info && r.j.page_info.has_next; idx += 15;
    }
  }
}
const res = [];
for (const c of C.cases) {
  const bad = [];
  for (const k of c.checks) {
    const am = W[k.u+'|'+k.d]||0, al = A[k.u+'|'+k.d]||null;
    if (am !== k.m) bad.push(`${k.u} ${k.d}: ${am} != ${k.m} min`);
    else if (k.a && al !== k.a) bad.push(`${k.u} ${k.d}: label ${al} != ${k.a}`);
  }
  res.push({id:c.id, kind:c.kind, n:c.checks.length, pass: bad.length===0, known:c.known.join(','), bad: bad.slice(0,3)});
}
const tot = C.totals.map(t => { const a = MT[t.u+'|'+t.mon]||0; return {u:t.u, mon:t.mon, act:a, exp:t.m, pass: a===t.m, known:t.known.join(',')}; });
// any non-zero day not covered by an expectation (extra allocation)
const expKeys = new Set(); C.cases.forEach(c => c.checks.forEach(k => expKeys.add(k.u+'|'+k.d)));
const extra = Object.entries(W).filter(([k,v]) => v>0 && !expKeys.has(k)).map(([k,v])=>k+'='+v);
window.__run = {field, res, tot, extra};
const fF = field.filter(x=>x.f.length);
return JSON.stringify({
  fieldCases: field.length, fieldFail: fF.length, fieldFailSample: fF.slice(0,6).map(x=>x.n.slice(0,40)+': '+x.f.join('; ')),
  wlCases: res.length, wlPass: res.filter(r=>r.pass).length,
  wlFail: res.filter(r=>!r.pass).map(r=>`${r.id} [${r.known||'NEW'}] ${r.bad[0]||''}`),
  totals: tot.length, totFail: tot.filter(t=>!t.pass).map(t=>`${t.u} ${t.mon} ${t.act}!=${t.exp} [${t.known||'NEW'}]`),
  extraDays: extra.slice(0,20)
});
})()
"""
js = runner.replace('%PID%', PID).replace('%CASES%', json.dumps(
    {'cases': cases, 'totals': totals, 'tasks': tasks}, separators=(',', ':')))
open(f'{OUTDIR}/runner.js', 'w').write(js)
print('cases', len(cases), 'checks', sum(len(c['checks']) for c in cases), 'totals', len(totals), 'tasks', len(tasks), 'js bytes', len(js))
