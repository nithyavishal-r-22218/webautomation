import { test, expect, preserveViewSettings } from '../../src/fixtures';
import { env, stateExists } from '../../src/env';
import { ZpApi } from '../../src/api';

/**
 * Scope of an Edit on the view under test (default All Users): does the Admin's change also change the view for
 * other users (portal-wide) or only for the Admin (per user)? The spec has not said, so:
 *   ZP_EDIT_SCOPE=portal|user   → asserted
 *   unset                       → result recorded as "check spec"; the test still checks the Admin side
 * The other user's view is read through GET /reports/workload/meta?view_id=… (chart_details), which works for
 * predefined views whose API names (zp.workload.customview.allusers) differ from their dropdown labels.
 * Second user: ZP_SCOPE_USER_STATE (or ZP_PERM_USER_STATE) — any user who can open the report.
 */
const USER_STATE = process.env.ZP_SCOPE_USER_STATE || process.env.ZP_PERM_USER_STATE || '';
// Not serial: every case sets what it checks, so one failure must not skip the rest. workers=1 keeps the
// order; preserveViewSettings() reuses the saved original snapshot if a new worker starts after a failure.
test.describe.configure({ mode: 'default' });
preserveViewSettings();
test.skip(!stateExists(USER_STATE), 'needs ZP_SCOPE_USER_STATE (a second user who can open the report)');

test('SCOPE-01 an Admin edit of view type and description: does another user see it?', async ({ wl, edit, browser }) => {
  const viewId = wl.d.meta!.custom_view_id;
  const user = await ZpApi.open(browser, USER_STATE);
  const probe = await user.api.call('GET', `/reports/workload/meta?project_id=0&view_id=${viewId}`);
  if (probe.status() !== 200) { await user.ctx.close(); test.skip(true, `the second user cannot open the report (meta ${probe.status()}): give their profile Workload View or use another login`); }
  const userMeta = async () => (await user.api.getJson<{ chart_details?: Record<string, unknown> }>(`/reports/workload/meta?project_id=0&view_id=${viewId}`)).chart_details ?? {};
  const before = await userMeta();

  await edit.openEdit();
  const target = (await edit.formState()).viewType === 'heatmap' ? 'bar' : 'heatmap';
  await edit.setViewType(target); await edit.setDescription(`${env.runId} scope check`); await edit.save();
  expect((await wl.chartType()).toLowerCase(), 'Admin sees the new type').toContain(target.slice(0, 4));
  const adminDetails = (await new ZpApi(wl.page, wl.d).getJson<{ chart_details?: Record<string, unknown> }>(`/reports/workload/meta?project_id=0&view_id=${viewId}`)).chart_details ?? {};

  const after = await userMeta();
  await user.ctx.close();
  const changed = JSON.stringify(after) !== JSON.stringify(before);
  const scope = changed && JSON.stringify(after) === JSON.stringify(adminDetails) ? 'portal' : changed ? 'partial' : 'user';
  test.info().annotations.push({ type: process.env.ZP_EDIT_SCOPE ? 'scope' : 'check spec',
    description: `other user's chart_details ${changed ? 'changed' : 'unchanged'} after the Admin set ${target} ⇒ edit scope: ${scope}` });
  if (process.env.ZP_EDIT_SCOPE) expect(scope, 'edit scope per spec').toBe(process.env.ZP_EDIT_SCOPE);
});
