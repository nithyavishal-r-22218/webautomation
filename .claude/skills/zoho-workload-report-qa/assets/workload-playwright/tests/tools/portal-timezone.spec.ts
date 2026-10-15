// Read or set the portal time zone (ZP_SET_TIMEZONE=<IANA zone>; without it the zone is only read). npm run portal:timezone
import { test, expect } from '../../src/fixtures';
import { portalTimeZone, setPortalTimeZone } from '../../src/portalSettings';

test('portal time zone: read / set', async ({ wl }) => {
  console.log('TIMEZONE before', await portalTimeZone(wl.page));
  const target = process.env.ZP_SET_TIMEZONE; if (!target) return;
  console.log('SET', target, '→', await setPortalTimeZone(wl.page, target));
  const after = await portalTimeZone(wl.page); console.log('TIMEZONE after', after);
  expect(after, 'zone set').toBe(target);
});
