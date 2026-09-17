import { expect, test } from '@playwright/test';

const manifest = String(process.env.HYPERBEAM_MANIFEST_URL || '').replace(/\/+$/, '');

test('Following paginates past unavailable locators and persists unfollow after refresh', async ({ page, browser }) => {
  test.skip(!manifest, 'Set HYPERBEAM_MANIFEST_URL to an isolated node manifest.');
  test.setTimeout(180_000);
  const origin = new URL(manifest).origin;
  const creator = await browser.newContext();
  const stamp = Date.now();
  const profiles: { id: string; name: string }[] = [];
  const records: { id: string; channel: string; title: string }[] = [];
  const requests: any[] = [];
  let emptyFirstPage = false;
  try {
    const write = async (data: any) => {
      const response = await creator.request.post(`${origin}/id?0.%21=true&committers=all`, { data });
      expect(response.ok()).toBe(true);
      return response.headers()['message-id'];
    };
    for (const suffix of ['a', 'b']) {
      const name = `feed-${suffix}-${stamp}`;
      profiles.push({ id: await write({ type: 'channel', name }), name });
    }
    const dataId = await write({ body: 'Following acceptance media fixture' });
    for (let i = 0; i < 66; i++) {
      const profile = profiles[i % 2];
      const title = `Feed item ${String(i).padStart(2, '0')} ${stamp}`;
      const id = await write({
        schema: 'odysee-upload@1.0',
        type: 'upload',
        name: `feed-item-${i}-${stamp}`,
        title,
        'channel-id': profile.id,
        'channel-name': profile.name,
        'data-id': dataId,
        'content-type': 'video/mp4',
        timestamp: Math.floor(Date.now() / 1000) - i - 60,
      });
      records.push({ id, channel: profile.id, title });
    }
    // Only discovery is controlled. Profile, upload, commitment and follow
    // reads/writes use the real node. This does not certify live legacy sourcing.
    await page.route('**/~search@1.0/query*', async (route) => {
      const request = route.request().postDataJSON();
      requests.push(request);
      // Fixtures have no scheduled/live tags; auxiliary upcoming searches are empty.
      if ((request.filter || []).some((value: string) => value.startsWith('tags IN '))) {
        return route.fulfill({ json: [] });
      }
      const filter = (request.filter || []).find((value: string) => value.startsWith('channel_claim_id IN '));
      if (!filter) return route.fulfill({ json: [] });
      const channels = JSON.parse(filter.slice('channel_claim_id IN '.length));
      let ranked = records.filter((record) => channels.includes(record.channel));
      if (request.sort?.[0] === 'release_time:asc') ranked = [...ranked].reverse();
      const ids = ranked.slice(request.offset || 0, (request.offset || 0) + request.limit).map((record) => record.id);
      // A stale locator on page one must not hide page two.
      if ((request.offset || 0) < 48 && channels.length === 2 && ids.length > 3) ids[3] = 'z'.repeat(43);
      if (emptyFirstPage && !request.offset && channels.length === 2) ids.fill('z'.repeat(43));
      await route.fulfill({ json: ids });
    });
    await page.goto(`${manifest}/#/$/signup`);
    await page.locator('input[name="hyperbeam_name"]').fill(`feed-viewer-${stamp}`);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).not.toHaveURL(/#\/\$\/signup/, { timeout: 20000 });
    for (const profile of profiles) {
      await page.goto(`${manifest}/#/@${profile.name}:${profile.id}`);
      const followed = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/id' &&
          (response.request().postData() || '').includes('odysee-subscription@1.0')
      );
      await page.getByTitle('Follow this channel', { exact: true }).first().click();
      expect((await followed).ok()).toBe(true);
      await expect(page.getByTitle('Unfollow this channel', { exact: true }).first()).toBeVisible();
    }
    await page.goto(`${manifest}/#/$/following`);
    const feed = page.locator('.main__channelsFollowing');
    await expect(feed.getByText(records[0].title, { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await page.mouse.wheel(0, 20000);
    await expect.poll(() => requests.some((request) => request.offset > 0), { timeout: 20000 }).toBe(true);
    await expect
      .poll(
        async () => {
          await page.mouse.wheel(0, 20000);
          return feed.getByText(records[65].title, { exact: true }).first().isVisible();
        },
        { timeout: 30000 }
      )
      .toBe(true);
    const newestTitles = await feed.locator('.claim-preview__title').allTextContents();
    expect(newestTitles.filter((title) => title.includes('Feed item')).map((title) => title.trim())).toEqual(
      records.filter((_, index) => index !== 3 && index !== 27).map((record) => record.title)
    );
    emptyFirstPage = true;
    await page.reload();
    // No visible first-page tiles and no scroll event: discovery must continue.
    await expect(feed.getByText(records[41].title, { exact: true }).first()).toBeVisible({ timeout: 30000 });
    emptyFirstPage = false;
    await page.goto(`${manifest}/#/$/following?order=new&sort=old`);
    await expect(feed.getByText(records[65].title, { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await expect
      .poll(
        async () => {
          const titles = await feed.locator('.claim-preview__title').allTextContents();
          return titles.find((title) => title.includes('Feed item'))?.trim();
        },
        { timeout: 20000 }
      )
      .toBe(records[65].title);
    expect(requests.some((request) => request.sort?.[0] === 'release_time:asc')).toBe(true);
    await page.goto(`${manifest}/#/$/following?order=new&sort=new`);
    await page.reload();
    await expect(feed.getByText(records[0].title, { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await page.goto(`${manifest}/#/@${profiles[1].name}:${profiles[1].id}`);
    await page.getByTitle('Unfollow this channel', { exact: true }).first().click();
    const unfollowed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/id' &&
        (response.request().postData() || '').includes('"operation":"unfollow"')
    );
    await page.getByRole('button', { name: 'Unfollow', exact: true }).click();
    expect((await unfollowed).ok()).toBe(true);
    await expect(page.getByTitle('Follow this channel', { exact: true }).first()).toBeVisible();
    requests.length = 0;
    await page.goto(`${manifest}/#/$/following`);
    await expect(feed.getByText(records[0].title, { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await expect(feed.getByText(records[1].title, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(feed.getByText(records[0].title, { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await expect(feed.getByText(records[1].title, { exact: true })).toHaveCount(0);
    const feedRequests = requests.filter((request) => request.limit >= 24);
    expect(feedRequests.length).toBeGreaterThan(0);
    for (const request of feedRequests) {
      expect(request.filter).toContain(`channel_claim_id IN ["${profiles[0].id}"]`);
      expect(request.offset || 0).toBe(0);
    }
  } finally {
    await creator.close();
  }
});
