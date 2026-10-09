import openpyxl, datetime as dt, sys, collections
f=sys.argv[1]
wb=openpyxl.load_workbook(f,data_only=True)
t=wb['Tasks']; rows=list(t.values); H=rows[0]
ix={h:i for i,h in enumerate(H)}
AV=9
def d(s): return dt.datetime.strptime(s,'%d/%m/%Y').date() if s else None
def hh(s): a,b=s.split(':'); return int(a)+int(b)/60
exp=collections.defaultdict(float)
for r in rows[1:]:
    s,e=d(r[ix['Start Date']]),d(r[ix['Due Date']])
    if not s: continue
    owners=[o.strip() for o in r[ix['Owner']].split(',')] if r[ix['Owner']] else ['Unassigned']
    u=r[ix['Work Hours Unit']]; vals=(r[ix['Work Hours Per Owner']] or '0:00').split(',')
    wds=[s+dt.timedelta(i) for i in range((e-s).days+1) if (s+dt.timedelta(i)).weekday()<5]
    for o,v in zip(owners,vals):
        if u=='hrs/day': pd=hh(v)
        elif u=='%/day': pd=float(v)/100*AV
        else: pd=hh(v)/len(wds) if wds else 0
        for x in wds: exp[(o,x)]+=pd
# previous import
old=openpyxl.load_workbook(sys.argv[2]).active
for r in list(old.values)[1:]:
    if not r[0] or r[0]=='General': continue
    s,e=d(r[5]),d(r[6]); owners=[o.strip() for o in (r[1] or 'Unassigned').split(',')]; vals=(r[13] or '0:00').split(',')
    for o,v in zip(owners,vals):
        pd=hh(v) if r[14]=='hrs/day' else 0
        x=s
        while x<=e:
            if x.weekday()<5: exp[(o,x)]+=pd
            x+=dt.timedelta(1)
de=wb['Daily Expected']; dates=[c.value for c in de[3]][2:]
bad=0
for row in de.iter_rows(min_row=4,max_row=12):
    u=row[0].value
    for c,dd in zip(row[2:],dates):
        dd=dd.date() if hasattr(dd,'date') else dd
        if abs((c.value or 0)-exp.get((u,dd),0))>1e-6: bad+=1; print('MISMATCH',u,dd,c.value,exp.get((u,dd),0)) if bad<10 else None
print('daily mismatches',bad)
# weekly state check vs plan (new file only would include previous; just print Oct weeks for VW)
we=wb['Weekly Expected']
cnt=collections.Counter(r[7] for r in list(we.values)[1:] if r[0] and r[7])
print('weekly states',dict(cnt))
me=wb['Monthly Expected']
for r in list(me.values)[1:]:
    if r[0] and r[1]!='Q4 2026': print(f'{r[0]:32} {r[1]} hrs={r[5]:7.2f} %={r[8]:.2%} over={r[12]} opt={r[13]} under={r[14]} unalloc={r[15]} closed={r[10]:.2f}')
