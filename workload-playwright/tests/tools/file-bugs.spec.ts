import { test, expect } from '../../src/fixtures';
// Run: ZP_BUG_PROJECT_ID=<project id> npx playwright test tests/tools/file-bugs.spec.ts --project=tools
import { env } from '../../src/env';
import fs from 'fs';
import path from 'path';

/**
 * Files the open filter defects as issues in project ZP_BUG_PROJECT_ID with their repro video attached, through the
 * portal's own API from inside the page (the local proxy refuses Node sockets):
 *   POST /attachments (multipart upload_file) → POST /projects/{id}/issues {name, description} → POST …/issues/{id}/attachments {attachment_ids}
 * Input: reports/repro/<ID>.mp4 (or .webm) and the BUGS table below. Output: reports/repro/filed.json.
 */
const PROJECT = process.env.ZP_BUG_PROJECT_ID || '';
const BUGS: { id: string; title: string; steps: string[] }[] = [
  { id: 'WL-D-24', title: 'Workload Report › Filter: Group By hides the filter chip bar while the filter stays applied', steps: [
    'Open Reports › Workload Report (All Users).',
    'Toolbar › Filter › User/Resource › Is › tick Users › Find. Chip bar shows "User/Resource: Is Users", the grid shows only users, the view is marked unsaved.',
    'Toolbar › Group By › Roles.',
    'Actual: the grid stays filtered (users only) and the view stays unsaved, but the chip bar disappears — no indication of the active filter and no Clear filter while grouped.',
    'Expected: the chip bar stays visible while grouped so the filter can be seen and cleared.' ] },
  { id: 'WL-D-25', title: 'Workload Report › Filter: moving the period with the toolbar arrows leaves the filter state inconsistent (chips dropped while the view stays unsaved, or Clear filter inert)', steps: [
    'Open Reports › Workload Report (All Users).',
    'Toolbar › Filter › User/Resource › Is › tick Users › Find. Chip bar shows the filter, the grid shows only users, the view is marked unsaved.',
    'Click the toolbar "next period" arrow (›).',
    'Actual (seen in the recording): the chip bar disappears and every row comes back, including the resource and the Unassigned row, while the view is still marked unsaved with "Save as" shown.',
    'Actual (seen in another run): the chips stay for the new period but "Clear filter" does nothing — no data request, chips and filtered rows remain; only Filter › Reset › Find clears it.',
    'Expected: the arrows keep the toolbar filter for the new period, the chip bar reflects it, and Clear filter removes it.' ] },
  { id: 'WL-D-26', title: 'Workload Report › Filter: a filter saved with a view is applied but shown nowhere', steps: [
    'Open Reports › Workload Report › Filter › User/Resource › Is › Users › Find, then Save as › New Workload Report (or create a view through the API with a determiner on resource_type).',
    'Open the new view from the view list.',
    'Actual: the data is filtered (only users; the resource and the Unassigned row are gone) but there is no chip bar, the Filter panel shows no ticked value and no badge, and there is no Clear filter — the user cannot tell the view is filtered or remove the filter from the toolbar.',
    'Expected: the saved filter is shown in the chip bar and in the panel like a toolbar filter.' ] },
  { id: 'WL-D-27', title: 'Workload Report › Filter: Save as › Discard does nothing for a View-only profile', steps: [
    'Sign in as a user whose profile has only the View permission for the Workload Report (global and project).',
    'Open Reports › Workload Report › Filter › User/Resource › Is › Users › Find. The view is marked unsaved and "Save as" appears.',
    'Click Save as › Discard (the item is enabled; "New Workload Report" is disabled).',
    'Actual: nothing happens — the filter, the unsaved marker and Save as stay. Only Clear filter removes the filter.',
    'Expected: Discard drops the unsaved toolbar change for this profile as it does for an Admin.' ] },
];

test('file the open filter defects with their videos', async ({ wl }) => {
  test.skip(!PROJECT, 'set ZP_BUG_PROJECT_ID');
  test.setTimeout(900_000);
  const page = wl.page;
  const portalId = wl.d.portalId;
  const filed: Record<string, unknown>[] = [];
  const outFile = `${env.reportsDir}/repro/filed.json`;
  const already = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) as Record<string, unknown>[] : [];
  for (const b of BUGS) {
    if (already.some(x => x.id === b.id && x.issueId)) { filed.push(already.find(x => x.id === b.id)!); continue; }
    const video = ['mp4', 'webm'].map(ext => path.join(`${env.reportsDir}/repro`, `${b.id}.${ext}`)).find(p => fs.existsSync(p));
    const description = `<div>${b.steps.map((s, i) => `<p>${i + 1}. ${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('')}<p>Evidence: ${video ? path.basename(video) : 'no recording'} (Playwright reproduction, portal customworkload, 13-10-2026). Automated check: workload-playwright filter specs.</p></div>`;
    const res = await page.evaluate(async ({ portalId, project, name, description, videoB64, videoName, mime }) => {
      const csrf = { 'X-ZCSRF-TOKEN': (window as any).getZPCSRFName() + '=' + (window as any).getZPCSRFValue() };
      const base = `${location.origin}/api/v3/portal/${portalId}`;
      const out: Record<string, unknown> = {};
      // 1 create the issue
      const c = await fetch(`${base}/projects/${project}/issues`, { method: 'POST', credentials: 'include', headers: { ...csrf, 'content-type': 'application/json' }, body: JSON.stringify({ name, description }) });
      const cj = await c.json().catch(() => ({})); out.createStatus = c.status; out.create = JSON.stringify(cj).slice(0, 300);
      const issue = cj.issue ?? cj.bug ?? cj; out.issueId = String(issue?.id ?? ''); out.key = issue?.key ?? issue?.prefix ?? '';
      if (!out.issueId || !videoB64) return out;
      // 2 upload the video
      const bin = Uint8Array.from(atob(videoB64), ch => ch.charCodeAt(0));
      const fd = new FormData(); fd.append('upload_file', new Blob([bin], { type: mime }), videoName);
      fd.append('attachment_details', JSON.stringify({ location_details: { project_id: project } }));
      const u = await fetch(`${base}/attachments`, { method: 'POST', credentials: 'include', headers: csrf, body: fd });
      const uj = await u.json().catch(() => ({})); out.uploadStatus = u.status; out.upload = JSON.stringify(uj).slice(0, 300);
      const ids = ((uj.attachment ?? uj.attachments ?? []) as any[]).map(a => String(a.attachment_id ?? a.id)).filter(Boolean);
      out.attachmentIds = ids;
      if (!ids.length) return out;
      // 3 associate: POST /projects/{id}/issues/{id}/attachments answered 500 on 13-10-2026; entity-attachments with the
      //   WorkDrive resource id (third_party_file_id from the upload) works
      const tp = ((uj.attachment ?? uj.attachments ?? []) as any[]).map(a => String(a.third_party_file_id ?? '')).filter(Boolean);
      const a = await fetch(`${base}/entity-attachments`, { method: 'POST', credentials: 'include', headers: { ...csrf, 'content-type': 'application/json' }, body: JSON.stringify({ entity_type: 'bug', entity_id: out.issueId, thirdparty_id: tp }) });
      out.associateStatus = a.status; out.associate = (await a.text()).slice(0, 200);
      return out;
    }, { portalId, project: PROJECT, name: b.title, description, videoB64: video ? fs.readFileSync(video).toString('base64') : '', videoName: video ? path.basename(video) : '', mime: video?.endsWith('.mp4') ? 'video/mp4' : 'video/webm' });
    const rec = { id: b.id, title: b.title, video: video ?? null, ...res };
    filed.push(rec);
    test.info().annotations.push({ type: 'filed', description: JSON.stringify(rec).slice(0, 400) });
    fs.mkdirSync(`${env.reportsDir}/repro`, { recursive: true }); fs.writeFileSync(outFile, JSON.stringify(filed, null, 2));
    expect.soft([200, 201], `${b.id} created`).toContain(res.createStatus);
    expect.soft([200, 201], `${b.id} video attached`).toContain(res.associateStatus);
  }
});
