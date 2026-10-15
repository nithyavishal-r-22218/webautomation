#!/usr/bin/env python3
"""Compare two portal inventories (tests/tools/portal-probe.spec.ts): tasks, users, teams, reporting, report totals.
Usage: python3 scripts/compare-portals.py reports/inventory.json reports/<portal>/inventory.json"""
import json, sys, collections
A = json.load(open(sys.argv[1])); B = json.load(open(sys.argv[2]))
owner = lambda I: [u['email'].lower() for u in I['users'] if u['profile']['name'] == 'Portal Owner'][0]
def em(I, e): e = (e or '').lower(); return 'OWNER' if e == owner(I) else e
def task(I, t):
    ow = t['owners_and_work']
    who = tuple(sorted(('RESOURCE' if 'Resource' in (o.get('name') or '') else em(I, o.get('email')), o.get('work_values')) for o in ow.get('owners', [])))
    return (t['name'], t['tasklist']['name'], t['status']['name'], t.get('priority'), t.get('billing_type'), t.get('completion_percentage'),
            (t.get('start_date') or '')[:10], (t.get('end_date') or '')[:10], ow.get('work_type'), ow.get('unit'), ow.get('total_work'), who)
problems = 0
def check(label, a, b):
    global problems
    ok = a == b; problems += 0 if ok else 1
    print(f"{'OK ' if ok else 'DIFF'} {label}" + ('' if ok else f"\n     source {a}\n     target {b}"))
for sp in A['projects']:
    if sp['id'] not in A['perProject'] or sp['name'] in ('Bugs', 'Explore Zoho Projects'): continue
    tp = next((p for p in B['projects'] if p['name'] == sp['name']), None)
    if not tp: check(f"project {sp['name']}", 'present', 'missing'); continue
    a, b = A['perProject'][sp['id']], B['perProject'][tp['id']]
    ta = {task(A, t) for t in a['tasks']}; tb = {task(B, t) for t in b['tasks']}
    check(f"{sp['name']}: {len(ta)} tasks (fields, owners, work)", sorted(ta - tb)[:3], sorted(tb - ta)[:3])
    check(f"{sp['name']}: project users", sorted(em(A, u['email']) for u in a['users']), sorted(em(B, u['email']) for u in b['users']))
    check(f"{sp['name']}: task lists", sorted(l['name'] for l in a['tasklists']), sorted(l['name'] for l in b['tasklists']))
    check(f"{sp['name']}: group", (sp.get('project_group') or {}).get('name'), (tp.get('project_group') or {}).get('name'))
def teams(I):
    ids = {u['id']: em(I, u['email']) for u in I['users']}; m = collections.defaultdict(set)
    for uid, ts in I['memberships'].items():
        for t in ts: m[t['name']].add(ids.get(uid))
    return {t['name']: (ids.get(str((t.get('lead') or {}).get('id'))), sorted(m[t['name']])) for t in I['teams']}
check('teams (lead, members)', teams(A), teams(B))
rep = lambda I: {em(I, u['email']): em(I, {x['id']: x['email'] for x in I['users']}.get((u.get('reporting_to') or {}).get('id'), '')) for u in I['users']}
check('reporting lines', rep(A), rep(B))
check('tags', sorted(t['name'] for t in A['tags']), sorted(t['name'] for t in B['tags']))
check('project groups', sorted(g['name'] for g in A['projectGroups']), sorted(g['name'] for g in B['projectGroups']))
check('reporting hierarchy on', A.get('hierarchyEnabled'), B.get('hierarchyEnabled'))
for m in sorted(A.get('workload', {})):
    norm = lambda I: {em(I, k) if '@' in k else k: v for k, v in I['workload'][m].items()}
    check(f'report totals {m} (minutes per owner)', norm(A), norm(B))
print(f"\n{problems} difference(s)")
sys.exit(1 if problems else 0)
