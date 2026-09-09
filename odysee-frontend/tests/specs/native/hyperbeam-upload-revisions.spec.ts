import { expect, test } from '@playwright/test';

const manifest = String(process.env.HYPERBEAM_MANIFEST_URL || '').replace(/\/+$/, '');
test('native upload edit clears metadata, refreshes, and preserves exact history', async ({ page }) => {
  test.skip(!manifest, 'Set HYPERBEAM_MANIFEST_URL to an isolated node manifest.');
  test.setTimeout(120_000);
  const suffix = Date.now().toString(36);
  await page.goto(`${manifest}/#/$/signup`);
  await page.locator('input[name="hyperbeam_name"]').fill(`upload-test-${suffix}`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).not.toHaveURL(/#\/\$\/signup/, { timeout: 20000 });
  const rootId = await page.evaluate(
    async ({ suffix }) => {
      async function write(body: BodyInit, contentType: string) {
        const response = await fetch('/id?0.%21=true&committers=all', {
          method: 'POST',
          credentials: 'include',
          headers: { accept: 'application/json', 'content-type': contentType },
          body,
        });
        if (!response.ok) throw new Error(`Test write failed (${response.status})`);
        return response.headers.get('message-id')!;
      }
      const dataId = await write(new Blob([new Uint8Array(256)], { type: 'video/mp4' }), 'video/mp4');
      return write(
        JSON.stringify({
          schema: 'odysee-upload@1.0',
          type: 'upload',
          name: `edit-${suffix}`,
          title: `Original ${suffix}`,
          description: 'Description to clear',
          tags: ['revision-regression'],
          languages: ['fr'],
          'data-id': dataId,
          'streaming-url': `/${dataId}`,
          'content-type': 'video/mp4',
          timestamp: 100,
        }),
        'application/json'
      );
    },
    { suffix }
  );
  await page.goto(`${manifest}/#/$/id/${rootId}`);
  await expect(page.getByText(`Original ${suffix}`, { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.locator('input[name="content_title"]').fill(`Edited ${suffix}`);
  await page.getByRole('textbox', { name: /What is your content about/ }).fill('');
  await page.locator('input[name="content_title"]').blur();
  const miniPlayerClose = page.getByRole('button', { name: 'Close', exact: true });
  if (await miniPlayerClose.isVisible()) await miniPlayerClose.click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/id' &&
      (response.request().postData() || '').includes('revision-of')
  );
  await page.locator('.publish-wizard__footer').getByRole('button', { name: 'Update', exact: true }).click();
  const saved = await response;
  expect(saved.ok()).toBe(true);
  const revision = saved.request().postDataJSON();
  expect(revision.description).toBe('');
  expect(revision.tags).toContain('revision-regression');
  expect(revision.languages).toContain('fr');
  const revisionId = saved.headers()['message-id'];
  await page.goto(`${manifest}/#/$/id/${revisionId}`);
  await expect(page.getByText(`Edited ${suffix}`, { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.reload();
  await expect(page.getByText(`Edited ${suffix}`, { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Description to clear', { exact: true })).toHaveCount(0);
  await page.goto(`${manifest}/#/$/id/${rootId}`);
  await expect(page.getByText(`Original ${suffix}`, { exact: true }).first()).toBeVisible({ timeout: 20000 });
});
