// Trash any active QA project left by an interrupted run (names QA-WL-*). npm run cleanup:projects
import { test } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
test('trash leftover QA projects', async ({ wl }) => {
  const api = new ZpApi(wl.page, wl.d);
  const left = (await api.getJson<any[]>('/projects?page=1&per_page=100')).filter(p => /^QA-WL-/.test(p.name));
  for (const p of left) { await api.trashProject(String(p.id)); console.log('TRASHED', p.name); }
  console.log('LEFTOVERS', left.length);
});
