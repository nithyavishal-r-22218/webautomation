import { expect, type Locator, type Page } from '@playwright/test';
import { K, qa, qaEnds } from '../locators';
import { setupProfilesUrl } from '../env';

export type Level = 'projectreport' | 'globalreport';
export type Perm = 'view' | 'manage' | 'delete';

/** Setup › Profiles and Roles › Profiles › User Profiles › (Project|Global) Reports › Workload Reports */
export class ProfilesPage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto(setupProfilesUrl());
    await qa(this.page, 'tab_user').click();
  }
  async openWorkload(level: Level) {
    await qaEnds(this.page, `_profile_base_group_${level}`).click();
    await qaEnds(this.page, K.menuWorkload).filter({ visible: true }).click();
  }

  /** Profile names and IDs as this portal has them, read from the grid (never hardcoded). */
  async profiles(): Promise<{ name: string; id: string }[]> {
    return this.page.evaluate(() => {
      const ids = [...new Set([...document.querySelectorAll('input[data-zpqa*="_workloadreport_view"]')]
        .filter(e => (e as HTMLElement).offsetParent !== null)
        .map(e => e.getAttribute('data-zpqa')!.match(/input_profile_checkbox_(\d+)_/)![1]))];
      return ids.map(id => {
        const input = document.querySelector(`input[data-zpqa="input_profile_checkbox_${id}_workloadreport_view"]`)!;
        const x = input.getBoundingClientRect().left;
        const header = [...document.querySelectorAll<HTMLElement>('*')].find(h => {
          const b = h.getBoundingClientRect();
          return h.children.length <= 2 && b.top < input.getBoundingClientRect().top - 40 && Math.abs(b.left + b.width / 2 - x) < 70
            && /^[A-Za-z][\w ()-]{1,40}$/.test((h.innerText || '').trim()) && !/Action Permissions|Workload Report|View|Manage|Delete/.test(h.innerText);
        });
        return { id, name: (header?.innerText ?? '').replace(/\s*\(Default\)\s*/, '').trim() };
      });
    });
  }

  private box(profileId: string, perm: Perm): Locator {
    return this.page.locator(`input[data-zpqa="input_profile_checkbox_${profileId}_workloadreport_${perm}"]`)
      .filter({ visible: true }).locator('xpath=ancestor::ruc-checkbox[1]');
  }
  /** The native input reports checked=false even when ticked: the wrapper's ruc-checked class (or rc-checked="true") is the truth. */
  async isTicked(profileId: string, perm: Perm) { return this.box(profileId, perm).evaluate(e => /\bruc-checked\b/.test(e.className) || e.getAttribute('rc-checked') === 'true'); }

  async set(profileId: string, perm: Perm, on: boolean) {
    if (process.env.ZP_ALLOW_PROFILE_CHANGES !== '1') throw new Error('Profile changes need ZP_ALLOW_PROFILE_CHANGES=1 (explicit approval)');
    if ((await this.isTicked(profileId, perm)) !== on) await this.box(profileId, perm).click();
    await expect.poll(() => this.isTicked(profileId, perm)).toBe(on);
  }
}
