import { expect, test } from '@playwright/test';
import { localManifestAssets } from './local-manifest-assets';

const manifest = String(process.env.HYPERBEAM_MANIFEST_URL || '').replace(/\/+$/, '');

test('creator hides and restores foreign roots and replies without deleting immutable history', async ({
  page,
  browser,
}) => {
  test.skip(!manifest, 'Set HYPERBEAM_MANIFEST_URL to a disposable manifest.');
  test.setTimeout(180_000);
  const origin = new URL(manifest).origin;
  const stamp = Date.now();
  const name = `hide-owner-${stamp}`;
  await localManifestAssets(page.context(), manifest);
  await page.goto(`${manifest}/#/$/signup`);
  await page.locator('input[name="hyperbeam_name"]').fill(name);
  const signup = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/id' &&
      response.request().headers().type === 'channel'
  );
  await page.getByRole('button', { name: 'Create account' }).click();
  const profile = (await signup).headers()['message-id'];
  await expect(page).not.toHaveURL(/#\/\$\/signup/, { timeout: 20000 });
  const write = async (request, data) => {
    const response = await request.post(`${origin}/id?0.%21=true&committers=all`, { data });
    expect(response.ok()).toBe(true);
    return response.headers()['message-id'];
  };
  const bytes = await write(page.request, { body: 'non-playable moderation fixture' });
  const video = await write(page.request, {
    schema: 'odysee-upload@1.0',
    type: 'upload',
    name: `hide-video-${stamp}`,
    title: `Hide video ${stamp}`,
    'channel-id': profile,
    'channel-name': name,
    'data-id': bytes,
    'content-type': 'video/mp4',
    timestamp: Math.floor(Date.now() / 1000),
  });
  const foreign = await browser.newContext();
  const guest = await browser.newContext();
  await localManifestAssets(guest, manifest);
  try {
    const foreignProfile = await write(foreign.request, { type: 'channel', name: `hide-author-${stamp}` });
    const rootRef = `hide-root-${stamp}`;
    const makeComment = (body, ref, parent) => ({
      schema: 'odysee-comment@1.0',
      type: 'comment',
      'comment-ref': ref,
      'version-ref': ref,
      target: video,
      parent: parent || video,
      ...(parent ? { 'parent-id': parent } : {}),
      state: 'active',
      author: foreignProfile,
      'profile-id': foreignProfile,
      'profile-name': `hide-author-${stamp}`,
      body,
      'claim-id': video,
      timestamp: Math.floor(Date.now() / 1000),
    });
    const rootText = `Foreign root ${stamp}`;
    const replyText = `Foreign reply ${stamp}`;
    const root = await write(foreign.request, makeComment(rootText, rootRef, null));
    await write(foreign.request, makeComment(replyText, `reply-${stamp}`, rootRef));
    const url = `${manifest}/#/$/id/${video}`;
    await page.goto(url);
    const rootRow = page
      .locator('li.comment')
      .filter({ has: page.getByText(rootText, { exact: true }) })
      .first();
    await expect(rootRow).toBeVisible({ timeout: 30000 });
    await rootRow.locator('.comment__menu .menu__button').first().click();
    await expect(page.getByRole('menuitem', { name: 'Add as moderator', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Hide comment', exact: true }).click();
    await expect(page.getByText(rootText, { exact: true })).toHaveCount(0, { timeout: 20000 });
    await page.reload();
    await page.getByRole('button', { name: 'Hidden comments', exact: true }).click();
    const review = page.getByRole('region', { name: 'Hidden comments', exact: true });
    await expect(review.getByText(rootText, { exact: true })).toBeVisible({ timeout: 30000 });
    const visitor = await guest.newPage();
    await visitor.goto(url);
    await expect(visitor.getByText(`Hide video ${stamp}`, { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await expect(visitor.getByRole('button', { name: 'Hidden comments', exact: true })).toHaveCount(0);
    await expect(visitor.getByText(rootText, { exact: true })).toHaveCount(0);
    await expect(visitor.getByText(replyText, { exact: true })).toHaveCount(0);
    expect(
      (
        await guest.request.get(`${origin}/${root}?accept-bundle=true`, { headers: { accept: 'application/json' } })
      ).ok()
    ).toBe(true);
    await review.getByRole('button', { name: 'Unhide comment', exact: true }).click();
    await expect(review.getByText('No hidden comments.', { exact: true })).toBeVisible({ timeout: 30000 });
    await page.reload();
    await expect(page.getByText(rootText, { exact: true })).toBeVisible({ timeout: 30000 });
    await visitor.reload();
    await expect(visitor.getByText(rootText, { exact: true })).toBeVisible({ timeout: 30000 });
  } finally {
    await foreign.close();
    await guest.close();
  }
});
