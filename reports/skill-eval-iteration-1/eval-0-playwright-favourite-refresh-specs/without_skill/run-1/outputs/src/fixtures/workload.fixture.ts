/**
 * Playwright fixtures for the workload report specs.
 *
 *  - `portal`   (worker option)  PortalConfig injected per Playwright project
 *  - `workload` (test)           WorkloadReportPage already opened on the report
 *  - `allUsers` (test)           `workload` switched to the All Users view; on
 *                                teardown it restores the view's ORIGINAL favourite
 *                                state, so runs are repeatable on shared portals.
 */
import { test as base, expect } from '@playwright/test';
import type { PortalConfig } from '../support/portal-config';
import { WorkloadReportPage } from '../pages/workload-report.page';

export interface WorkloadWorkerOptions {
  portal: PortalConfig;
}

export interface WorkloadTestFixtures {
  workload: WorkloadReportPage;
  allUsers: WorkloadReportPage & { initialFavourite: boolean };
}

export const test = base.extend<WorkloadTestFixtures, WorkloadWorkerOptions>({
  // Overridden per project in playwright.config.ts; undefined here on purpose.
  portal: [undefined as unknown as PortalConfig, { option: true, scope: 'worker' }],

  workload: async ({ page, portal }, use) => {
    if (!portal) throw new Error('No portal configured for this project - see config/portals.example.json');
    const wl = new WorkloadReportPage(page, portal);
    await wl.goto();
    await use(wl);
  },

  allUsers: async ({ workload, portal }, use, testInfo) => {
    await workload.selectView(portal.allUsersViewName);
    const initialFavourite = await workload.isFavourite();
    testInfo.annotations.push(
      { type: 'portal', description: portal.name },
      { type: 'viewId', description: String(await workload.currentViewId()) },
      { type: 'initialFavourite', description: String(initialFavourite) },
    );

    await use(Object.assign(workload, { initialFavourite }));

    // Teardown: put the portal back the way we found it.
    try {
      if (workload.page.isClosed()) return;
      await workload.selectView(portal.allUsersViewName);
      await workload.ensureFavourite(initialFavourite);
    } catch (e) {
      testInfo.annotations.push({ type: 'cleanup-failed', description: String(e) });
      console.warn(`[${portal.name}] could not restore favourite state of "${portal.allUsersViewName}": ${e}`);
    }
  },
});

export { expect };
