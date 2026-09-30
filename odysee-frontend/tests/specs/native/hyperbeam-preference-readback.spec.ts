import { expect, test } from '@playwright/test';
import { localManifestAssets } from './local-manifest-assets';

const manifest = String(process.env.HYPERBEAM_MANIFEST_URL || '').replace(/\/+$/, '');
test('preference saves recover from temporary exact-read unavailability without reposting', async ({ page }) => {
  test.skip(!manifest, 'Set HYPERBEAM_MANIFEST_URL to a disposable node.');
  test.setTimeout(120_000);
  await localManifestAssets(page.context(), manifest);
  await page.goto(`${manifest}/#/$/signup`);
  await page.locator('input[name="hyperbeam_name"]').fill(`pref-retry-${Date.now()}`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).not.toHaveURL(/#\/\$\/signup/, { timeout: 20000 });
  const records = new Map<string, { schema: string; failedReads: number; successfulReads: number }>();
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(manifest).origin) return route.fallback();
    if (request.method() === 'POST' && url.pathname === '/id') {
      let body;
      try {
        body = request.postDataJSON();
      } catch {
        return route.fallback();
      }
      if (body?.schema !== 'odysee-preferences@1.0' && body?.['reference-type'] !== 'odysee-preferences')
        return route.fallback();
      const response = await route.fetch();
      if (response.ok())
        records.set(response.headers()['message-id'], {
          schema: body.schema || 'reference',
          failedReads: 0,
          successfulReads: 0,
        });
      return route.fulfill({ response });
    }
    const record = records.get(url.pathname.slice(1));
    if (request.method() === 'GET' && record) {
      if (record.failedReads < 2) {
        record.failedReads++;
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"temporary test outage"}',
        });
      }
      const response = await route.fetch();
      if (response.ok()) record.successfulReads++;
      return route.fulfill({ response });
    }
    return route.fallback();
  });
  await page
    .getByRole('button', { name: /^(Dark|Light)$/ })
    .first()
    .click();
  await expect
    .poll(() => [...records.values()].filter((record) => record.successfulReads > 0).length, { timeout: 30000 })
    .toBe(2);
  expect(records.size).toBe(2);
  expect([...records.values()].map((record) => record.schema).sort()).toEqual(['odysee-preferences@1.0', 'reference']);
  expect([...records.values()].every((record) => record.failedReads === 2)).toBe(true);
  await expect(page.getByText('Failed to synchronize settings', { exact: false })).toHaveCount(0);
});
