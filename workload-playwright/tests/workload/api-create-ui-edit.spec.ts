import { test, expect } from '../../src/fixtures';
import { env } from '../../src/env';

/**
 * API-01 — the setup/cleanup pattern for edit and delete cases: create a view with the OAuth API (adminApi), edit it
 * in the UI, read the change back through the API, and delete it through the API in afterAll (even when the test fails).
 */
test.describe.configure({ mode: 'serial' });

test.describe('API-01 create by API → edit in UI → delete by API', () => {
  const name = `${env.runId}-api-edit`;
  let id = '';

  test.beforeAll(async ({ adminApi }) => {
    id = await adminApi.createView(name, { description: 'created by API' });
  });

  test.afterAll(async ({ adminApi }) => {
    const cleanup = id ? [`${name}: ${await adminApi.deleteView(id)}`] : await adminApi.deleteViewsByPrefix(name);
    test.info().annotations.push({ type: 'cleanup', description: cleanup.join('; ') || 'nothing to delete' });
    const left = (await adminApi.views('created_views')).filter(v => v.name === name);
    expect(left, `"${name}" gone after the API delete`).toHaveLength(0);
  });

  test('edit the API-created view in the UI and read the change back by API', async ({ wl, edit, adminApi }) => {
    expect(JSON.stringify(await adminApi.view(id)), 'definition saved by the API').toContain('created by API');

    await wl.selectView(name, 'My Custom Views');
    await edit.openEdit();
    await expect(edit.page.locator('[data-zpqa="cviewdescription"]'), 'UI shows the API description').toHaveValue('created by API');
    await edit.setDescription('edited in UI');
    await edit.save();

    expect(JSON.stringify(await adminApi.view(id)), 'definition after the UI save').toContain('edited in UI');
  });
});
