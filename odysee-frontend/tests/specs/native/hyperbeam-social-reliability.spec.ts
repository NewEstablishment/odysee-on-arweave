import { expect, test } from '@playwright/test';

const manifestUrl = String(process.env.HYPERBEAM_MANIFEST_URL || '').replace(/\/+$/, '');

test.describe('native manifest social reliability', () => {
  test.skip(!manifestUrl, 'Set HYPERBEAM_MANIFEST_URL to a node-served manifest URL.');

  test('signup, video reaction toggle, comment lifecycle, and refresh stay usable', async ({ page }) => {
    const suffix = Date.now().toString(36);
    const profileName = `ui-reliability-${suffix}`;
    const uploadName = `ui-reliability-video-${suffix}`;
    const commentText = `UI reliability comment ${suffix}`;
    const legacyChannelId = 'fb364ef587872515f545a5b4b3182b58073f230f';

    // Product actions must not depend on optional decorative browser APIs.
    await page.addInitScript(() => {
      Object.defineProperty(HTMLElement.prototype, 'animate', {
        configurable: true,
        value: undefined,
      });
    });

    await page.goto(`${manifestUrl}/#/$/signup`);
    await page.locator('input[name="hyperbeam_name"]').fill(profileName);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).not.toHaveURL(/#\/\$\/signup/, { timeout: 20_000 });

    const identityCookieNames = (await page.context().cookies())
      .map((cookie) => cookie.name)
      .filter((name) => name.startsWith('secret-'));
    expect(identityCookieNames, 'one signup must leave exactly one node identity cookie').toHaveLength(1);

    const upload = await page.evaluate(
      async ({ uploadName }) => {
        async function write(body: BodyInit, contentType: string) {
          const response = await fetch('/id?0.%21=true&committers=all', {
            method: 'POST',
            credentials: 'include',
            headers: { accept: 'application/json', 'content-type': contentType },
            body,
          });
          const text = await response.text();
          const id = response.headers.get('message-id') || text.replace(/^"|"$/g, '').trim();
          if (!response.ok || !/^[0-9A-Za-z_-]{43}$/.test(id)) {
            throw new Error(`Native test write failed (${response.status}): ${text.slice(0, 200)}`);
          }
          return id;
        }

        const dataId = await write(new Blob([new Uint8Array(256)], { type: 'video/mp4' }), 'video/mp4');
        const recordId = await write(
          JSON.stringify({
            schema: 'odysee-upload@1.0',
            type: 'upload',
            name: uploadName,
            filename: `${uploadName}.mp4`,
            'content-type': 'video/mp4',
            'source-size': '256',
            'data-id': dataId,
            'streaming-url': `/${dataId}`,
            title: 'Native UI reliability video',
            description: 'Created by the manifest reliability regression.',
            timestamp: Math.floor(Date.now() / 1000),
          }),
          'application/json'
        );
        return { dataId, recordId };
      },
      { uploadName }
    );

    await page.goto(`${manifestUrl}/#/$/id/${upload.recordId}`);
    await expect(page.getByText('Native UI reliability video', { exact: true })).toBeVisible({ timeout: 20_000 });

    const likeButton = page.locator('.button-like').first();
    await expect(likeButton).toBeVisible();
    await likeButton.click();
    await expect(likeButton).toHaveClass(/button--fire/, { timeout: 20_000 });
    await expect(likeButton).toBeEnabled({ timeout: 20_000 });

    await likeButton.click();
    await expect(likeButton).not.toHaveClass(/button--fire/, { timeout: 20_000 });
    await expect(likeButton).toBeEnabled({ timeout: 20_000 });

    await likeButton.click();
    await expect(likeButton).toHaveClass(/button--fire/, { timeout: 20_000 });
    await expect(likeButton).toBeEnabled({ timeout: 20_000 });

    const commentInput = page.locator('textarea#create__comment').first();
    await expect(commentInput).toBeVisible({ timeout: 20_000 });
    await commentInput.fill(commentText);
    const commentWritePromise = page.waitForResponse((response) => {
      const request = response.request();
      return (
        request.method() === 'POST' &&
        new URL(response.url()).pathname === '/id' &&
        String(request.postData() || '').includes('odysee-comment@1.0')
      );
    });
    await page
      .locator('form.comment-create')
      .getByRole('button', { name: /^Comment$/ })
      .click();
    const commentWrite = await commentWritePromise;
    expect(commentWrite.status()).toBe(200);
    const commentId = commentWrite.headers()['message-id'];
    expect(commentId).toMatch(/^[0-9A-Za-z_-]{43}$/);
    await expect(page.getByText(commentText, { exact: true })).toBeVisible({ timeout: 20_000 });

    const indexedCommentIds = await page.evaluate(
      async ({ target }) => {
        const response = await fetch('/~query@1.0/only', {
          method: 'POST',
          credentials: 'include',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            schema: 'odysee-comment@1.0',
            type: 'comment',
            'claim-id': target,
            only: ['schema', 'type', 'claim-id'],
            return: 'paths',
            'cache-control': ['no-store', 'no-cache'],
          }),
        });
        const result = await response.json();
        return Object.entries(result)
          .filter(([key]) => /^\d+$/.test(key))
          .map(([, value]) => String(value).replace(/^\/+/, ''));
      },
      { target: upload.recordId }
    );
    expect(indexedCommentIds).toContain(commentId);

    await page.reload();
    await expect(page.getByText('Native UI reliability video', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.button-like').first()).toHaveClass(/button--fire/, { timeout: 20_000 });
    await expect(page.getByText(commentText, { exact: true })).toBeVisible({ timeout: 20_000 });

    const comment = page.locator(`li.comment[id="${commentId}"]`);
    await comment.locator('.comment__menu .menu__button').click();
    await comment.getByText('Remove', { exact: true }).click();
    const deleteWritePromise = page.waitForResponse((response) => {
      const request = response.request();
      const body = String(request.postData() || '');
      return (
        request.method() === 'POST' &&
        new URL(response.url()).pathname === '/id' &&
        body.includes('odysee-comment@1.0') &&
        body.includes('"operation":"delete"')
      );
    });
    await page.getByRole('button', { name: 'Remove', exact: true }).last().click();
    const deleteWrite = await deleteWritePromise;
    expect(deleteWrite.status()).toBe(200);
    await expect(page.getByText(commentText, { exact: true })).not.toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByText('Native UI reliability video', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(commentText, { exact: true })).not.toBeVisible({ timeout: 20_000 });

    await page.goto(`${manifestUrl}/#/@veritasium:${legacyChannelId}`);
    const followButton = page.getByRole('button', { name: 'Follow', exact: true }).first();
    await expect(followButton).toBeVisible({ timeout: 30_000 });
    const followWritePromise = page.waitForResponse((response) => {
      const request = response.request();
      const body = String(request.postData() || '');
      return (
        request.method() === 'POST' &&
        new URL(response.url()).pathname === '/id' &&
        body.includes('odysee-subscription@1.0') &&
        body.includes(`lbry:${legacyChannelId}`)
      );
    });
    await followButton.click();
    const followWrite = await followWritePromise;
    expect(followWrite.status()).toBe(200);
    await expect(page.getByRole('button', { name: /Following/ }).first()).toBeVisible({ timeout: 20_000 });
  });
});
