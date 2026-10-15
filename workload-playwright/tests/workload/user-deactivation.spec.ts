import { test, expect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { K, qa } from '../../src/locators';
import { CreateViewPage } from '../../src/pages/CreateViewPage';
import { waitLoaded } from '../../src/createChecks';
import { activateUser, deactivateUser } from '../../src/portalSettings';

/**
 * A deactivated user and the Workload Report. One seeded user (ZP_DEACTIVATE_USER, default Vishal plreadonly) is
 * deactivated with the call the Users page uses and reactivated at the end; role and profile are read back.
 *   UD-01 while deactivated: no row in All Users, not in the report API's owners, not offered in the Specific Users picker;
 *         the row count drops by exactly one; UD-02 after reactivation everything is back and the user keeps role + profile.
 * Needs ZP_ALLOW_USER_CHANGES=1 (the user approved on 15-10-2026; the person loses access for a few minutes).
 */
test.describe.configure({ mode: 'default', timeout: 600_000 });
test.skip(process.env.ZP_ALLOW_USER_CHANGES !== '1', 'a portal user is deactivated and reactivated: set ZP_ALLOW_USER_CHANGES=1');
const TARGET = process.env.ZP_DEACTIVATE_USER || 'plreadonly';

test('UD-01/02 a deactivated user disappears from the report, its API owners and the pickers; reactivation restores all', async ({ wl }) => {
  const page = wl.page, api = new ZpApi(page, wl.d), cv = new CreateViewPage(page); await waitLoaded(wl);
  const users = await api.users(); const me = await api.me();
  const u = users.find((x: any) => x.email.includes(TARGET) || x.full_name === TARGET); expect(u, `user "${TARGET}" active in the portal`).toBeTruthy();
  expect(String(u.id) !== String(me.id), 'never the signed-in Admin').toBe(true);
  const id = String(u.id), name = String(u.full_name), role = u.role?.name, profile = u.profile?.name;
  const v = wl.d.view('zp.workload.customview.allusers'); const viewId = String(v.custom_view_id || v.id);
  const month = () => { const d = new Date(); const f = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; return { from: `${f}-01`, to: `${f}-${new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()}` }; };
  const owners = async () => (await api.workload({ ...month(), timePeriod: 'days', viewId })).map(o => o.name);
  await wl.loadAllRows(); const rows0 = await wl.rows().count();
  expect(await qa(page, `username-${id}`).count(), `${name} has a row`).toBe(1);
  const owners0 = await owners(); expect(owners0, `${name} among the API owners`).toContain(name);
  await cv.open(wl); await cv.share('users', []); const offered0 = await cv.pickerOptions('users', name.slice(0, 10)); await cv.cancel();
  expect(offered0.some(o => o.includes(name)), `${name} offered in Specific Users before`).toBe(true);
  test.info().annotations.push({ type: 'snapshot', description: `${name} (${id}): role ${role}, profile ${profile}; ${rows0} rows, ${owners0.length} owners` });
  let deactivated = false;
  try {
    const d = await deactivateUser(api, id); expect(d.status(), `deactivate → ${(await d.text()).slice(0, 120)}`).toBe(200); deactivated = true;
    await expect.poll(async () => (await api.users()).some((x: any) => String(x.id) === id), { message: 'gone from the active user list' }).toBe(false);
    const rec = await api.getJson<any>(`/users/${id}`); test.info().annotations.push({ type: 'evidence', description: `GET /users/${id} while deactivated: deactivated_by ${rec.deactivated_by ?? '-'}, status ${rec.status ?? '-'}` });
    await page.reload(); await wl.goto(); await waitLoaded(wl); await wl.loadAllRows();
    const rows1 = await wl.rows().count();
    expect.soft(await qa(page, `username-${id}`).count(), `${name} has no row while deactivated`).toBe(0);
    expect.soft(rows1, 'exactly one row fewer').toBe(rows0 - 1);
    const owners1 = await owners(); expect.soft(owners1.includes(name), `${name} not among the API owners`).toBe(false);
    expect.soft(owners1.length, 'one owner fewer in the API').toBe(owners0.length - 1);
    await cv.open(wl); await cv.share('users', []); const offered1 = await cv.pickerOptions('users', name.slice(0, 10)); await cv.cancel();
    expect.soft(offered1.some(o => o.includes(name)), `${name} not offered in Specific Users while deactivated (${offered1.join(', ') || '-'})`).toBe(false);
    await wl.openViews(); await wl.closeViews();
  } finally {
    if (deactivated) {
      const a = await activateUser(api, id); expect(a.status(), `activate → ${(await a.text()).slice(0, 120)}`).toBe(200);
      await expect.poll(async () => (await api.users()).some((x: any) => String(x.id) === id), { message: 'back in the active user list', timeout: 60_000 }).toBe(true);
      const back = (await api.users()).find((x: any) => String(x.id) === id);
      expect.soft(back?.role?.name, 'role kept').toBe(role); expect.soft(back?.profile?.name, 'profile kept').toBe(profile);
      await page.reload(); await wl.goto(); await waitLoaded(wl); await wl.loadAllRows();
      expect.soft(await wl.rows().count(), 'row count back').toBe(rows0);
      expect.soft(await qa(page, `username-${id}`).count(), `${name}'s row back`).toBe(1);
      expect.soft((await owners()).includes(name), `${name} back among the API owners`).toBe(true);
      test.info().annotations.push({ type: 'evidence', description: `reactivated: role ${back?.role?.name}, profile ${back?.profile?.name}` });
    }
  }
});
