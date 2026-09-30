import { expect, test } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { localManifestAssets } from './local-manifest-assets';

const manifest = String(process.env.HYPERBEAM_MANIFEST_URL || '').replace(/\/+$/, '');
const media = process.env.HYPERBEAM_TEST_VIDEO;

test('thumbnail picker writes portable IDs on create and replace, with exact historical images', async ({
  page,
  browser,
}) => {
  test.skip(!manifest || !media, 'Provide an isolated manifest and a short playable HYPERBEAM_TEST_VIDEO.');
  test.setTimeout(180_000);
  const origin = new URL(manifest).origin;
  await localManifestAssets(page.context(), manifest);
  await page.goto(`${manifest}/#/$/signup`);
  const stamp = Date.now();
  await page.locator('input[name="hyperbeam_name"]').fill(`thumb-${stamp}`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).not.toHaveURL(/#\/\$\/signup/);
  await page.goto(`${manifest}/#/$/upload`);
  await page.locator('input[type="file"]').first().setInputFiles(media!);
  await expect(page.getByText('Ready to Upload', { exact: false }).first()).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.locator('input[name="content_title"]').fill(`Thumbnail ${stamp}`);

  async function pick(file: string, failOnce = false) {
    if (failOnce) {
      await page.route('**/id?*', async (route) => {
        if (route.request().headers()['content-type'] === 'image/png') {
          await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"test unavailable"}' });
        } else await route.continue();
      });
    }
    await page.locator('.thumbnail-picker input[type="file"]').setInputFiles(file);
    const imageWrite = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/id' &&
        r.request().headers()['content-type'] === 'image/png'
    );
    await page.getByRole('dialog').getByRole('button', { name: 'Upload', exact: true }).click();
    const response = await imageWrite;
    if (failOnce) {
      expect(response.status()).toBe(503);
      await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText(
        'Image upload failed (503).'
      );
      await page
        .getByRole('dialog', { name: 'Error', exact: true })
        .getByRole('button', { name: 'OK', exact: true })
        .click();
      await page.unroute('**/id?*');
      return pick(file);
    }
    expect(response.ok()).toBe(true);
    const id = response.headers()['message-id'];
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const bytes = await page.request.get(`${origin}/${id}`);
    expect(bytes.ok()).toBe(true);
    expect(await bytes.body()).toEqual(await readFile(file));
    await expect(page.locator('.thumbnail-picker__upload-status')).toHaveCount(0);
    return id;
  }
  async function save(label: string) {
    await expect(page.locator('.content__viewer--floating')).toHaveCount(0);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    const metadataWrite = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/id' &&
        (r.request().postData() || '').includes('odysee-upload@1.0')
    );
    await page.locator('.publish-wizard__footer').getByRole('button', { name: label, exact: true }).click();
    const response = await metadataWrite;
    expect(response.ok()).toBe(true);
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Success', exact: true })).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).first().click();
    return { id: response.headers()['message-id'], payload: response.request().postDataJSON() };
  }
  const firstImage = await pick(path.resolve('ui/component/channelThumbnail/gerbil.png'), true);
  const root = await save('Publish');
  expect(root.payload['thumbnail-id']).toBe(firstImage);
  expect(root.payload['thumbnail-url'] || '').toBe('');
  await page.goto(`${manifest}/#/$/id/${root.id}`);
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const current = page.getByRole('img', { name: 'Current thumbnail', exact: true });
  await expect(current).toHaveAttribute('src', `${origin}/${firstImage}`);
  const secondImage = await pick(path.resolve('ui/component/selectAsset/thumbnail-missing.png'));
  expect(secondImage).not.toBe(firstImage);
  const revision = await save('Update');
  expect(revision.payload['thumbnail-id']).toBe(secondImage);
  expect(revision.payload['thumbnail-url']).toBe('');
  await page.goto(`${manifest}/#/$/id/${revision.id}`);
  await page.reload();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.getByRole('img', { name: 'Current thumbnail', exact: true })).toHaveAttribute(
    'src',
    `${origin}/${secondImage}`
  );
  await page.getByRole('button', { name: 'Remove thumbnail', exact: true }).click();
  const cleared = await save('Update');
  expect(cleared.payload['thumbnail-id']).toBe('');
  expect(cleared.payload['thumbnail-url']).toBe('');
  await page.goto(`${manifest}/#/$/id/${cleared.id}`);
  await page.reload();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.getByRole('img', { name: 'Current thumbnail', exact: true })).toHaveCount(0);

  const reader = await browser.newContext();
  await localManifestAssets(reader, manifest);
  try {
    const visitor = await reader.newPage();
    for (const [version, image] of [
      [root.id, firstImage],
      [revision.id, secondImage],
    ]) {
      const requests: string[] = [];
      visitor.on('request', (r) => requests.push(r.url()));
      await visitor.goto(`${manifest}/#/$/id/${version}`);
      await expect.poll(() => requests.includes(`${origin}/${image}`)).toBe(true);
      const response = await reader.request.get(`${origin}/${image}`);
      expect(response.ok()).toBe(true);
    }
  } finally {
    await reader.close();
  }
});
