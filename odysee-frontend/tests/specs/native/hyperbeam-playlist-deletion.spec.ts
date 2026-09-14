import { expect, test } from '@playwright/test';

const manifest = String(process.env.HYPERBEAM_MANIFEST_URL || '').replace(/\/+$/, '');

for (const visibility of ['private', 'public']) {
  test(`${visibility} playlist deletion preserves exact history and survives refresh`, async ({ page, browser }) => {
    test.skip(!manifest, 'Set HYPERBEAM_MANIFEST_URL to an isolated node manifest.');
    test.setTimeout(120_000);
    const title = `${visibility}-delete-${Date.now()}`;
    await page.goto(`${manifest}/#/$/signup`);
    await page.locator('input[name="hyperbeam_name"]').fill(title);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).not.toHaveURL(/#\/\$\/signup/, { timeout: 20000 });
    await page.goto(`${manifest}/#/$/playlists`);
    await page
      .getByRole('button', { name: /^(New Playlist|Create a Playlist)$/ })
      .first()
      .click();
    await page.locator('input[name="new_collection"]').fill(title);
    if (visibility === 'public') await page.locator('label[for="new_collection_public"]').click();
    const initResponse = page.waitForResponse((response) => {
      const body = response.request().postData() || '';
      return (
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/id' &&
        body.includes('"reference-type":"odysee-playlist"') &&
        !body.includes('"reference-id"')
      );
    });
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    const created = await initResponse;
    expect(created.ok()).toBe(true);
    const referenceId = created.headers()['message-id'];
    const snapshotId = created.request().postDataJSON()['reference-value'];
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 20000 });
    const stableUrl = `${manifest}/#/$/playlist/${referenceId}`;
    await page.goto(stableUrl);
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 20000 });
    await page.locator('.menu__button').last().click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
    await page.getByRole('dialog', { name: 'Confirm Playlist Delete' }).getByRole('textbox').fill(title);
    if (visibility === 'public') {
      let failOnce = true;
      await page.route('**/id?*', async (route) => {
        if (failOnce && (route.request().postData() || '').includes('"playlist-state":"deleted"')) {
          failOnce = false;
          await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"test unavailable"}' });
        } else await route.continue();
      });
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled({ timeout: 20000 });
      await expect(page.getByRole('dialog', { name: 'Confirm Playlist Delete' })).toBeVisible();
      await expect(page).toHaveURL(stableUrl);
    }
    const deletionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/id' &&
        (response.request().postData() || '').includes('"playlist-state":"deleted"')
    );
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    expect((await deletionResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/#\/\$\/playlists$/, { timeout: 20000 });
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    await page.goto(stableUrl);
    await expect(page.getByRole('heading', { name: 'Playlist deleted' })).toBeVisible({ timeout: 20000 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Playlist deleted' })).toBeVisible({ timeout: 20000 });
    await page.goto(`${manifest}/#/$/playlist/${snapshotId}`);
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 20000 });
    // A fresh reader has neither optimistic Redux state nor locator hints.
    const reader = await browser.newContext();
    try {
      const visitor = await reader.newPage();
      await visitor.goto(stableUrl);
      await expect(visitor.getByRole('heading', { name: 'Playlist deleted' })).toBeVisible({ timeout: 20000 });
      if (visibility === 'public') {
        await visitor.goto(`${manifest}/#/$/playlist/${snapshotId}`);
        await expect(visitor.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 20000 });
      }
    } finally {
      await reader.close();
    }
  });
}
