import json, sys
c = json.load(open('cases.json'))
PID = sys.argv[1]
U = {'hours_per_day': 'd', 'hours': 't', '%_per_day': 'p'}
tasks = []
for t in c['tasks']:
    tasks.append([t['name'], '|'.join(o['n'] for o in t['owners']), U[t['unit']], '|'.join(str(o['v']) for o in t['owners']),
                  t['total'], (t['start'] or '').replace('-', ''), (t['end'] or '').replace('-', ''), t['status'], t['tl'], t['pr'], t['pct'], t['bt'],
                  ('1' if t['pct_over_100'] else '') + ('2' if t['weekend_only'] else '')])
name_idx = {t['name']: i for i, t in enumerate(c['tasks'])}
cases = []
for k in c['cases']:
    if k['tasks']:
        cases.append([k['id'], [name_idx[n] for n in k['tasks']]])
    else:
        ch = k['checks']
        cases.append([k['id'], [], ch[0]['u'], ch[0]['d'], ch[-1]['d']])
js = r"""(async () => {
const PID='%PID%', AV=540, D=%DATA%;
const zp=window.__zp; const norm=s=>(s||'').toString().toLowerCase().replace(/[^a-z0-9%]/g,'');
const tm=s=>{ if(s==null) return null; const m=String(s).match(/^(\d+):(\d+)$/); return m?(+m[1])*60+(+m[2]):Number(s); };
const nm=o=>o.name==='Unassigned User'?'Unassigned':((o.first_name||'')+(o.last_name?' '+o.last_name:'')).trim();
const pd=s=>new Date(Date.UTC(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8)));
const ymd=d=>d.toISOString().slice(0,10).replace(/-/g,'');
const days=(a,b)=>{const r=[];for(let d=pd(a);d<=pd(b);d=new Date(d.getTime()+864e5)) r.push(d);return r;};
const wk=d=>d.getUTCDay()%6!==0;
const UN={d:'hours_per_day',t:'hours',p:'%_per_day'};
// expected per owner-day from the file
const E={}; const taskDays=[];
D.t.forEach((t,i)=>{ const [n,os,u,vs,tot,s,e]=t; const owners=os.split('|'), vals=vs.split('|').map(Number); const all=s?days(s,e):[]; const w=all.filter(wk); const list=[];
  owners.forEach((o,j)=>{ const perday = u==='d'?vals[j]:(u==='p'?Math.round(vals[j]/100*AV):(w.length?Math.round(vals[j]/w.length):0));
    (t[12].includes('2')?all:w).forEach(d=>{ const k=o+'|'+ymd(d); if(wk(d)) E[k]=(E[k]||0)+perday; list.push(k); }); });
  taskDays[i]=list; });
const lab=m=>m===0?null:(m>AV?'over':(m===AV?'optimal':'under'));
// field checks
let T=[]; for(let p=1;p<5;p++){ const r=await zp('GET',`/projects/${PID}/tasks?page=${p}&per_page=100`); T=T.concat(r.j.tasks||[]); if(!r.j.page_info.has_next_page) break; }
const by={}; T.forEach(t=>by[t.name]=t); const field=[];
D.t.forEach(e=>{ const [n,os,u,vs,tot,s,en,st,tl,pr,pct,bt,fl]=e; const t=by[n]; const f=[]; if(!t){field.push({n,f:['MISSING'],k:fl});return;}
  const ow=t.owners_and_work||{}, o=ow.owners||[]; const an=o.map(nm).sort().join('|'), ex=os.split('|').sort().join('|');
  if(an!==ex) f.push(`owners ${an}!=${ex}`); if(ow.unit!==UN[u]) f.push(`unit ${ow.unit}!=${UN[u]}`);
  os.split('|').forEach((x,j)=>{ const a=o.find(y=>nm(y)===x); const v=Number(vs.split('|')[j]); if(a&&Math.abs(tm(a.work_values)-v)>0.01) f.push(`work ${x} ${a.work_values}!=${v}`); });
  if(Math.abs(tm(ow.total_work)-tot)>1) f.push(`total ${ow.total_work}!=${tot}m`);
  const sd=t.start_date?String(t.start_date).slice(0,10).replace(/-/g,''):'', ed=t.end_date?String(t.end_date).slice(0,10).replace(/-/g,''):'';
  if(sd!==s) f.push(`start ${sd}!=${s}`); if(ed!==en) f.push(`end ${ed}!=${en}`);
  if((t.status||{}).name!==st) f.push(`status ${(t.status||{}).name}!=${st}`); if((t.tasklist||{}).name!==tl) f.push(`tasklist ${(t.tasklist||{}).name}!=${tl}`);
  if(norm(t.priority)!==norm(pr)) f.push(`priority ${t.priority}!=${pr}`); if(+t.completion_percentage!==pct) f.push(`pct ${t.completion_percentage}!=${pct}`);
  if(norm(t.billing_type)!==norm(bt)) f.push(`billing ${t.billing_type}!=${bt}`);
  field.push({n,f,k:fl}); });
// workload API
const W={},A={},MT={}; const M={Oct:['2026-10-01','2026-10-31'],Nov:['2026-11-01','2026-11-30'],Dec:['2026-12-01','2026-12-31']};
for(const [mon,[a,b]] of Object.entries(M)) for(const un of [false,true]){ let idx=1,more=true; while(more){
  const r=await zp('GET',`/reports/workload?project_id=${PID}&from_date=${a}T00:00:00.000Z&to_date=${b}T23:59:59.999Z&time_period=days&report_based_on=users&index=${idx}&range=15`+(un?'&fetch_unassignee=true':''));
  if(r.s!==200) return 'workload API '+r.s;
  (r.j.owners||[]).forEach(o=>{ const u=un?'Unassigned':o.name; MT[u+'|'+mon]=(o.work||{}).total_work||0; ((o.work||{}).total_date_work||[]).forEach(x=>{W[u+'|'+x.date]=(W[u+'|'+x.date]||0)+x.work; A[u+'|'+x.date]=x.allocation;}); });
  more=!un&&r.j.page_info&&r.j.page_info.has_next; idx+=15; } }
// cases
const res=[]; const covered=new Set();
D.c.forEach(c=>{ const [id,ti,u,a,b]=c; let keys=[]; let known=new Set();
  if(ti.length){ ti.forEach(i=>{ taskDays[i].forEach(k=>keys.push(k)); const fl=D.t[i][12]; if(fl.includes('1')) known.add('F1'); if(fl.includes('2')) known.add('F2'); }); }
  else days(a,b).forEach(d=>keys.push(u+'|'+ymd(d)));
  keys=[...new Set(keys)]; const bad=[];
  keys.forEach(k=>{ covered.add(k); const d=k.split('|')[1]; const isW=wk(pd(d)); const em=isW?(E[k]||0):0; const am=W[k]||0;
    if(am!==em) bad.push(`${k} act ${am} exp ${em}`); else if(isW && !k.startsWith('Unassigned') && lab(em) && A[k]!==lab(em)) bad.push(`${k} label ${A[k]} exp ${lab(em)}`); });
  res.push({id,n:keys.length,pass:!bad.length,known:[...known].join(','),bad}); });
const users=[...new Set(D.t.flatMap(t=>t[1].split('|')))];
const tot=[]; users.forEach(u=>Object.entries(M).forEach(([mon,[a,b]])=>{ const ex=Object.entries(E).filter(([k])=>k.startsWith(u+'|')&&k.split('|')[1]>=a.replace(/-/g,'')&&k.split('|')[1]<=b.replace(/-/g,'')).reduce((s,[,v])=>s+v,0); const ac=MT[u+'|'+mon]||0; tot.push({u,mon,ac,ex,pass:ac===ex}); }));
const extra=Object.entries(W).filter(([k,v])=>v>0&&!covered.has(k)).map(([k,v])=>k+'='+v);
window.__run={field,res,tot,extra,W,A};
const fF=field.filter(x=>x.f.length);
return JSON.stringify({fieldCases:field.length, fieldFail:fF.length, fieldFailList:fF.map(x=>x.n.slice(0,45)+' ['+(x.k?'F'+x.k:'NEW')+']: '+x.f.join('; ')).slice(0,15),
  wlCases:res.length, wlPass:res.filter(r=>r.pass).length, wlFail:res.filter(r=>!r.pass).map(r=>`${r.id} [${r.known||'NEW'}] ${r.bad.length} bad: ${r.bad[0]}`),
  totals:tot.length, totPass:tot.filter(t=>t.pass).length, totFail:tot.filter(t=>!t.pass).map(t=>`${t.u} ${t.mon} act ${t.ac} exp ${t.ex}`), extraDays:extra.slice(0,15)});
})()"""
js = js.replace('%PID%', PID).replace('%DATA%', json.dumps({'t': tasks, 'c': cases}, separators=(',', ':')))
open('runner_compact.js', 'w').write(js)
print(len(js))
