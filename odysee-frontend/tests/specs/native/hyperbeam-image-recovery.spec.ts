import { expect, test, type Route } from '@playwright/test';
import path from 'node:path';
import { localManifestAssets } from './local-manifest-assets';

const manifest = String(process.env.HYPERBEAM_MANIFEST_URL || '').replace(/\/+$/, '');

test('profile image and metadata recover immediately from offline without reloading or repeating saved bytes', async ({
  page,
}) => {
  test.skip(!manifest, 'Provide an isolated HYPERBEAM_MANIFEST_URL.');
  test.setTimeout(180_000);
  const context = page.context();
  await localManifestAssets(context, manifest);
  await page.goto(`${manifest}/#/$/signup`);
  const handle = `recovery-${Date.now()}`;
  await page.locator('input[name="hyperbeam_name"]').fill(handle);
  const signup = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.request().headers().type === 'channel'
  );
  await page.getByRole('button', { name: 'Create account' }).click();
  const root = (await signup).headers()['message-id'];
  expect(root).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await expect(page).not.toHaveURL(/#\/\$\/signup/);
  await page.goto(`${manifest}/#/@${handle}:${root}?view=edit`);
  await page.waitForLoadState('networkidle');
  const title = page.locator('input[name="profile_display_name"]');
  await title.fill('Offline recovery preserved');
  await page.getByRole('combobox', { name: 'Bio', exact: true }).fill('Recovery test biography');
  const save = page.getByRole('button', { name: 'Save profile', exact: true });
  const input = page.locator('#profile_avatar_id');
  const file = path.resolve('ui/component/channelThumbnail/gerbil.png');
  let imageAttempts = 0;
  const revisions: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.headers()['content-type'] === 'image/png') imageAttempts++;
  });
  page.on('response', (response) => {
    if (
      response.ok() &&
      new URL(response.url()).pathname === '/id' &&
      response.request().method() === 'POST' &&
      (response.request().postData() || '').includes('"schema":"odysee-profile-revision@1.0"')
    ) {
      revisions.push(response.headers()['message-id']);
    }
  });

  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (reached = resolve));
  const hold = async (route: Route) => {
    if (route.request().headers()['content-type'] === 'image/png') {
      reached();
      await gate;
    }
    await route.continue();
  };
  await page.route('**/id?*', hold);
  try {
    await input.setInputFiles(file);
    await started;
    await expect(save).toBeDisabled();
    await expect(page.getByRole('status')).toContainText('Uploading image');
    await context.setOffline(true);
    release();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(save).toBeEnabled();
    expect(revisions).toHaveLength(0);
  } finally {
    release();
    await context.setOffline(false);
    await page.unroute('**/id?*', hold);
  }

  // Image selection is an explicit retry; no reload, TTL wait or hidden retry.
  const uploaded = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.request().headers()['content-type'] === 'image/png'
  );
  await input.setInputFiles(file);
  const image = await uploaded;
  expect(image.ok()).toBe(true);
  const imageId = image.headers()['message-id'];
  const preview = page.getByRole('img', { name: 'Avatar preview', exact: true });
  await expect(preview).toHaveAttribute('src', `${new URL(manifest).origin}/${imageId}`);
  await expect(save).toBeEnabled();
  expect(imageAttempts).toBe(2);

  try {
    await context.setOffline(true);
    await save.click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(save).toBeEnabled();
    await expect(title).toHaveValue('Offline recovery preserved');
    await expect(preview).toHaveAttribute('src', `${new URL(manifest).origin}/${imageId}`);
    expect(revisions).toHaveLength(0);
  } finally {
    await context.setOffline(false);
  }
  const saved = page.waitForResponse(
    (r) =>
      r.ok() &&
      new URL(r.url()).pathname === '/id' &&
      r.request().method() === 'POST' &&
      (r.request().postData() || '').includes('"schema":"odysee-profile-revision@1.0"')
  );
  await save.evaluate((button) => button.scrollIntoView({ block: 'center' }));
  await save.click();
  const revision = await saved;
  expect(revision.request().postDataJSON()).toMatchObject({ 'profile-id': root, 'avatar-id': imageId, revision: 1 });
  await expect(page).not.toHaveURL(/view=edit/, { timeout: 30000 });
  expect(revisions).toHaveLength(1);
  expect(imageAttempts).toBe(2);
  await page.reload();
  await expect(page.getByText('Offline recovery preserved', { exact: true }).first()).toBeVisible();
  const avatar = page.locator(`img[src$="/${imageId}"]`).first();
  await expect(avatar).toBeVisible();
  await expect.poll(() => avatar.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
});
