import fs from 'fs';
import { test } from '../../src/fixtures';
import { CreateViewPage } from '../../src/pages/CreateViewPage';
import { env } from '../../src/env';
import { K, qa } from '../../src/locators';
// temporary probe (deleted after use): the popovers of date / allocation criteria values
test('value popovers', async ({ wl }) => {
  test.setTimeout(1200_000);
  const page = wl.page, cv = new CreateViewPage(page);
  const out: Record<string, unknown> = {};
  await cv.open(wl); await cv.openTab('determiner');
  const pop = async () => page.evaluate(() => {
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null && (e as HTMLElement).getBoundingClientRect().width > 0;
    const p = [...document.querySelectorAll('lyte-popover-content, .lytePopover, lyte-beta-popover .lytePopoverContent, .brule-custdate-pop, lyte-calendar, .lyteCalendarPopup, ruc-calendar')].filter(vis);
    return p.map(e => ({ tag: e.tagName.toLowerCase(), cls: (e.className || '').toString().slice(0, 60), text: (e as HTMLElement).innerText.replace(/\s+/g, ' ').slice(0, 400),
      inputs: [...e.querySelectorAll('input')].filter(vis).map(i => `${i.type}:${i.getAttribute('data-zpqa') ?? ''}:${i.placeholder}:${i.value}`),
      keys: [...e.querySelectorAll('[data-zpqa]')].filter(vis).map(k => k.getAttribute('data-zpqa')).slice(0, 30) }));
  });
  const shot = async (n: string) => page.screenshot({ path: `${env.reportsDir}/pop-${n}.png` });
  for (const [f, c, how] of [['Allocation Type', 'Equals', 'trigger'], ['Allocation Type', 'Between', 'trigger'], ['Date', 'Less Than', 'range'], ['Date', 'Between', 'range'], ['Date', 'Is', 'date'], ['Date & Time', 'Greater Than or Equal', 'date']] as const) {
    await cv.choose(cv.fieldSel(0), f); await cv.choose(cv.condSel(0), c);
    const row = cv.rows().nth(0);
    if (how === 'trigger') await row.locator('[data-zpqa="custom-allocation-trigger"]').click();
    else if (how === 'range') await row.locator('daterange-picker .select-style').click();
    else await row.locator('ruc-date input').first().click();
    await page.waitForTimeout(1200);
    out[`${f} ${c}`] = await pop(); await shot(`${f}-${c}`.replace(/\W+/g, '_'));
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  }
  fs.writeFileSync(`${env.reportsDir}/create-popovers.json`, JSON.stringify(out, null, 1));
  await qa(page, K.cancel).click().catch(() => {});
});
