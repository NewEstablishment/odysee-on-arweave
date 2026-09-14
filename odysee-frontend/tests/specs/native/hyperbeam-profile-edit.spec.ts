import { expect, test } from '@playwright/test';
import path from 'node:path';

const manifest = String(process.env.HYPERBEAM_MANIFEST_URL || '').replace(/\/+$/, '');
test('profile metadata and images keep identity, reject unauthorized updates and preserve history', async ({
  page,
  browser,
}) => {
  test.skip(!manifest, 'Set HYPERBEAM_MANIFEST_URL to the isolated manifest.');
  test.setTimeout(180_000);
  const handle = `profile-${Date.now()}`;
  await page.goto(`${manifest}/#/$/signup`);
  await page.locator('input[name="hyperbeam_name"]').fill(handle);
  const signup = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/id' &&
      response.request().headers().type === 'channel'
  );
  await page.getByRole('button', { name: 'Create account' }).click();
  const rootId = (await signup).headers()['message-id'];
  await expect(page).not.toHaveURL(/#\/\$\/signup/, { timeout: 20000 });
  const channel = `${manifest}/#/@${handle}:${rootId}`;
  const editor = `${channel}?view=edit`;
  await page.goto(editor);
  await expect(page.locator('input[name="profile_display_name"]')).toBeVisible({ timeout: 30000 });
  await page.locator('input[name="profile_display_name"]').fill('Profile QA title');
  await page.getByRole('combobox', { name: 'Bio', exact: true }).fill('Profile QA biography');
  const imagePath = path.resolve('ui/component/channelThumbnail/gerbil.png');
  await page
    .locator('#profile_avatar_id')
    .setInputFiles({ name: 'not-an-image.png', mimeType: 'image/png', buffer: Buffer.from('<script>bad</script>') });
  await expect(page.getByRole('alert')).toContainText('Choose a PNG, JPEG or WebP image.');
  await page.locator('#profile_avatar_id').setInputFiles(imagePath);
  await expect(page.getByRole('img', { name: 'Avatar preview' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeEnabled();
  await page.locator('#profile_banner_id').setInputFiles(imagePath);
  await expect(page.getByRole('img', { name: 'Banner preview' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeEnabled();
  await page.screenshot({ path: '/tmp/odysee-profile-editor.png', fullPage: true });
  let failOnce = true;
  await page.route('**/id?*', async (route) => {
    if (failOnce && (route.request().postData() || '').includes('"schema":"odysee-profile-revision@1.0"')) {
      failOnce = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"test unavailable"}' });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('503');
  await expect(page.locator('input[name="profile_display_name"]')).toHaveValue('Profile QA title');
  const write = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/id' &&
      (response.request().postData() || '').includes('"schema":"odysee-profile-revision@1.0"')
  );
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  const saved = await write;
  expect(saved.ok()).toBe(true);
  const versionId = saved.headers()['message-id'];
  const payload = saved.request().postDataJSON();
  expect(payload['profile-id']).toBe(rootId);
  expect(payload.description).toBe('Profile QA biography');
  await expect(page).not.toHaveURL(/view=edit/, { timeout: 30000 });
  await page.goto(channel);
  await expect(page.getByText('Profile QA title', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await page.reload();
  await expect(page.getByText('Profile QA title', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  const avatar = page.locator(`img[src$="/${payload['avatar-id']}"]`).first();
  await expect(avatar).toBeVisible();
  await expect.poll(() => avatar.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const reader = await browser.newContext();
  try {
    const visitor = await reader.newPage();
    await visitor.goto(channel);
    await expect(visitor.getByText('Profile QA title', { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await visitor.goto(editor);
    await expect(visitor.locator('input[name="profile_display_name"]')).toHaveCount(0);
    const forged = await reader.request.post(`${new URL(manifest).origin}/id?0.%21=true&committers=all`, {
      data: { ...payload, revision: 2, 'previous-version': versionId, title: 'Foreign profile takeover' },
    });
    expect(forged.ok()).toBe(true); // Generic storage accepts evidence; product projection rejects this signer.
    await visitor.goto(channel);
    await expect(visitor.getByText('Profile QA title', { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await expect(visitor.getByText('Foreign profile takeover')).toHaveCount(0);
  } finally {
    await reader.close();
  }
  const stale = await page.request.post(`${new URL(manifest).origin}/id?0.%21=true&committers=all`, {
    data: { ...payload, revision: 2, 'previous-version': rootId, title: 'Stale profile update' },
  });
  expect(stale.ok()).toBe(true);
  await page.goto(editor);
  await expect(page.locator('input[name="profile_display_name"]')).toHaveValue('Profile QA title', { timeout: 30000 });
  await page.locator('input[name="profile_display_name"]').fill('Final profile title');
  await page.getByRole('combobox', { name: 'Bio', exact: true }).fill('');
  await page.getByRole('button', { name: 'Remove avatar' }).click();
  await page.getByRole('button', { name: 'Remove banner' }).click();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page).not.toHaveURL(/view=edit/, { timeout: 30000 });
  await page.goto(editor);
  await expect(page.locator('input[name="profile_display_name"]')).toHaveValue('Final profile title', {
    timeout: 30000,
  });
  await expect(page.getByRole('combobox', { name: 'Bio', exact: true })).toHaveValue('');
  await expect(page.getByRole('img', { name: 'Avatar preview' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Banner preview' })).toHaveCount(0);
  await page.goto(`${manifest}/#/$/id/${versionId}`);
  await expect(page.getByText('Profile QA title', { exact: true }).first()).toBeVisible({ timeout: 30000 });
});
