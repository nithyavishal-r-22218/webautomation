// Reactivate a portal user (ZP_REACTIVATE_EMAIL or ZP_REACTIVATE_ID) with the API the Users page uses. npm run user:activate
import { test, expect } from '../../src/fixtures';
import { ZpApi } from '../../src/api';
import { activateUser } from '../../src/portalSettings';

test('reactivate user', async ({ wl }) => {
  const api = new ZpApi(wl.page, wl.d); const email = process.env.ZP_REACTIVATE_EMAIL || ''; let id = process.env.ZP_REACTIVATE_ID || '';
  if (email && (await api.users()).some((u: any) => u.email === email)) { console.log('already active'); return; }
  if (!id && email) { const r = await api.call('GET', `/users?page=1&per_page=200&user_status=inactive`); id = String(((await r.json()).users ?? []).find((u: any) => u.email === email)?.id ?? ''); }
  expect(id, 'a user id (ZP_REACTIVATE_ID) or an email found in the inactive list').toBeTruthy();
  const r = await activateUser(api, id); console.log('ACTIVATE', r.status(), (await r.text()).slice(0, 120));
  const after = (await api.users()).find((x: any) => String(x.id) === id || x.email === email);
  console.log('AFTER', after ? `${after.full_name} active (role ${after.role?.name}, profile ${after.profile?.name})` : 'still not active');
  expect(after, 'user active again').toBeTruthy();
});
