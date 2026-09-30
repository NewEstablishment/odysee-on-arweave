import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { localManifestAssets } from './local-manifest-assets';

const manifest = String(process.env.HYPERBEAM_MANIFEST_URL || '').replace(/\/+$/, '');
const mediaFile = process.env.HYPERBEAM_TEST_VIDEO;

test('playing video floats before navigation and is cleared by the upload wizard', async ({ page }) => {
  test.skip(!manifest || !mediaFile, 'Provide a test manifest and HYPERBEAM_TEST_VIDEO (playable MP4).');
  test.setTimeout(180_000);
  const origin = new URL(manifest).origin;
  const stamp = Date.now();
  await localManifestAssets(page.context(), manifest);
  await page.goto(`${manifest}/#/$/signup`);
  await page.locator('input[name="hyperbeam_name"]').fill(`float-${stamp}`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).not.toHaveURL(/#\/\$\/signup/, { timeout: 20000 });
  const bytes = await page.request.post(`${origin}/id?0.%21=true&committers=all`, {
    headers: { 'content-type': 'video/mp4' },
    data: await readFile(mediaFile!),
  });
  expect(bytes.ok()).toBe(true);
  const dataId = bytes.headers()['message-id'];
  const upload = await page.request.post(`${origin}/id?0.%21=true&committers=all`, {
    data: {
      schema: 'odysee-upload@1.0',
      type: 'upload',
      name: `float-${stamp}`,
      title: `Floating playback ${stamp}`,
      'data-id': dataId,
      'streaming-url': `/${dataId}`,
      'content-type': 'video/mp4',
      timestamp: Math.floor(Date.now() / 1000),
    },
  });
  expect(upload.ok()).toBe(true);
  await page.goto(`${manifest}/#/$/id/${upload.headers()['message-id']}`);
  const video = page.locator('video').first();
  await expect(video).toBeVisible({ timeout: 30000 });
  // Use the actual media element, never synthetic Redux playback state.
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
  });
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 20000 })
    .toBeGreaterThan(2);
  if (process.env.HYPERBEAM_TEST_FULL_PLAYBACK === 'true') {
    // Optional short-fixture end-to-end playback: no seek or accelerated rate.
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.ended), { timeout: 120000 })
      .toBe(true);
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.currentTime = 0;
      await element.play();
    });
  }
  // Edit must work with one normal click while media is actively playing.
  // Do not pause first or force the click: both mask the reported regression.
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.locator('input[name="content_title"]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.content__viewer--floating')).toHaveCount(0);
  await page.goto(`${manifest}/#/$/id/${upload.headers()['message-id']}`);
  await expect(video).toBeVisible({ timeout: 30000 });
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
  });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(1);
  // Same-document navigation preserves the player; a page.goto/reload would
  // destroy it and make the regression assertion vacuous.
  await page.evaluate(() => {
    window.location.hash = '#/$/settings';
  });
  await expect(page.locator('.content__viewer--floating')).toBeVisible({ timeout: 20000 });
  const before = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(before + 0.5);
  await page.evaluate(() => {
    window.location.hash = '#/$/upload';
  });
  await expect(page.locator('input[type="file"]').first()).toBeAttached({ timeout: 20000 });
  await expect(page.locator('.content__viewer--floating')).toHaveCount(0);
  await page.locator('input[type="file"]').first().setInputFiles(mediaFile!);
  await expect(page.getByText('Ready to Upload', { exact: false }).first()).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('input[name="content_title"]')).toBeVisible();
});
