import { test, expect, type Page } from '../../fixtures';
import { getTestChannel, optionalAuthToken } from '../../helpers/auth';
import { ROUTES } from '../../helpers/routes';

test.beforeEach(async () => {
  test.skip(!optionalAuthToken(), 'Skipped - set ODYSEE_AUTH_TOKEN to run authenticated livestream tests');
});

type SeedReplayOptions = {
  claimId?: string | null;
  uri?: string | null;
  title?: string;
  createdAt?: number;
};

async function seedBrowserReplay(page: Page, replayId: string, options: SeedReplayOptions = {}) {
  await page.evaluate(async ({ replayId, options }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('odysee-livestream-replays', 1);
      request.addEventListener('upgradeneeded', () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('replays')) {
          db.createObjectStore('replays', { keyPath: 'id' });
        }
      });
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    const blob = new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'video/webm' });
    const tx = db.transaction('replays', 'readwrite');
    tx.objectStore('replays').put({
      id: replayId,
      blob,
      name: 'codex-browser-replay.webm',
      type: 'video/webm',
      size: blob.size,
      sourceType: 'rtmp',
      channelId: null,
      claimId: options.claimId || null,
      uri: options.uri || null,
      title: options.title || 'Codex browser replay',
      createdAt: options.createdAt || Date.now(),
      durationMs: 1000,
    });
    await new Promise<void>((resolve, reject) => {
      tx.addEventListener('complete', () => resolve(), { once: true });
      tx.addEventListener('error', () => reject(tx.error), { once: true });
    });
    db.close();
  }, { replayId, options });
}

async function deleteBrowserReplay(page: Page, replayId: string) {
  await page.evaluate(async (replayId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('odysee-livestream-replays', 1);
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    const tx = db.transaction('replays', 'readwrite');
    tx.objectStore('replays').delete(replayId);
    await new Promise<void>((resolve, reject) => {
      tx.addEventListener('complete', () => resolve(), { once: true });
      tx.addEventListener('error', () => reject(tx.error), { once: true });
    });
    db.close();
  }, replayId);
}

type InjectedSetupLivestream = {
  claimId: string;
  streamUrl: string;
  title: string;
};

async function injectActiveRtmpLivestream(page: Page, livestream?: InjectedSetupLivestream) {
  return page.evaluate((livestream) => {
    const store = (window as any).store;
    const state = store?.getState?.();
    const claimsById = state?.claims?.byId || {};
    const activeChannelId = state?.app?.activeChannel;
    const activeChannel =
      claimsById[activeChannelId] ||
      (Object.values(claimsById).find((claim: any) => claim?.value_type === 'channel' && claim?.claim_id) as any);

    if (!store || !activeChannel?.claim_id) return false;

    const channelUrl = activeChannel.canonical_url || activeChannel.permanent_url || `lbry://${activeChannel.name}`;
    const claimId = livestream?.claimId || `active-rtmp-livestream-${Date.now()}`;
    const streamUrl = livestream?.streamUrl || `${channelUrl}/codex-rtmp-preview-smoke`;
    const title = livestream?.title || 'Codex RTMP preview smoke';

    store.dispatch({
      type: 'LIVESTREAM_IS_LIVE_COMPLETE',
      data: {
        [activeChannel.claim_id]: {
          type: 'application/x-mpegurl',
          isLive: true,
          viewCount: 1,
          creatorId: activeChannel.claim_id,
          thumbnailUrl: null,
          activeClaim: {
            uri: streamUrl,
            claimUri: streamUrl,
            claimId,
            videoUrl: 'https://example.com/codex-live/index.m3u8',
            videoUrlPublic: 'https://example.com/codex-live/index.m3u8',
            title,
            isLive: true,
            startedStreaming: {
              toDate: () => new Date(),
            },
          },
        },
      },
    });

    return true;
  }, livestream);
}

async function injectPendingLivestreamForActiveChannel(page: Page, title: string) {
  return page.evaluate<InjectedSetupLivestream | false, string>((title) => {
    const store = (window as any).store;
    const state = store?.getState?.();
    const claimsById = state?.claims?.byId || {};
    const activeChannelId = state?.app?.activeChannel;
    const activeChannel =
      claimsById[activeChannelId] ||
      (Object.values(claimsById).find((claim: any) => claim?.value_type === 'channel' && claim?.claim_id) as any);

    if (!store || !activeChannel?.claim_id) return false;

    const channelUrl = activeChannel.canonical_url || activeChannel.permanent_url || `lbry://${activeChannel.name}`;
    const claimId = `pending-setup-livestream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const streamUrl = `${channelUrl}/codex-setup-livestream-${Date.now()}`;
    const name = 'codex-setup-livestream';

    store.dispatch({
      type: 'UPDATE_PENDING_CLAIMS',
      data: {
        claims: [
          {
            claim_id: claimId,
            name,
            normalized_name: name,
            permanent_url: streamUrl,
            canonical_url: streamUrl,
            claimUri: streamUrl,
            uri: streamUrl,
            short_url: streamUrl,
            type: 'claim',
            value_type: 'stream',
            confirmations: 0,
            is_channel_signature_valid: true,
            value: {
              title,
              description: '',
              tags: [],
            },
            signing_channel: {
              claim_id: activeChannel.claim_id,
              name: activeChannel.name,
              permanent_url: activeChannel.permanent_url,
              canonical_url: activeChannel.canonical_url,
              value: activeChannel.value,
            },
            txid: claimId,
            nout: 0,
            meta: { effective_amount: '0' },
            timestamp: Math.floor(Date.now() / 1000),
          },
        ],
        options: { overrideTags: true, overrideSigningChannel: true },
      },
    });

    return { claimId, streamUrl, title };
  }, title);
}

test.describe('Livestream flow surfaces', () => {
  test('loads the normal livestream create form without redirecting to sign-in', async ({ page }) => {
    await page.goto(ROUTES.livestreamCreate);
    await page.waitForLoadState('domcontentloaded');

    await expect(page).not.toHaveURL(/\/\$\/signin/);

    const title = page.getByRole('heading', { name: /create livestream/i }).first();
    const hasCreateForm = await title.isVisible({ timeout: 15_000 }).catch(() => false);
    test.skip(!hasCreateForm, 'Livestream creation is not available for this account state');

    await expect(title).toBeVisible();
    await expect(page.getByText('Anytime')).toBeVisible();
    await expect(page.getByText('Scheduled')).toBeVisible();
  });

  test('loads livestream setup management without redirecting to sign-in', async ({ page }) => {
    await page.goto(ROUTES.home);
    await page.waitForLoadState('domcontentloaded');
    const unselectedLivestream = await injectPendingLivestreamForActiveChannel(page, 'Codex unselected setup stream');
    const selectedLivestream = await injectPendingLivestreamForActiveChannel(page, 'Codex selected setup stream');
    const unselectedReplayId = `codex-unselected-setup-replay-${Date.now()}`;
    const selectedReplayId = `codex-selected-setup-replay-${Date.now()}`;
    await seedBrowserReplay(page, unselectedReplayId, {
      claimId: unselectedLivestream ? unselectedLivestream.claimId : 'unselected-claim',
      uri: unselectedLivestream ? unselectedLivestream.streamUrl : 'lbry://unselected',
      title: 'Codex unselected browser replay',
      createdAt: Date.now() + 1000,
    });
    await seedBrowserReplay(page, selectedReplayId, {
      claimId: selectedLivestream ? selectedLivestream.claimId : 'selected-claim',
      uri: selectedLivestream ? selectedLivestream.streamUrl : 'lbry://selected',
      title: 'Codex selected browser replay',
      createdAt: Date.now(),
    });

    const setupUrl =
      selectedLivestream && selectedLivestream.claimId
        ? `${ROUTES.livestream}?t=Setup&claim_id=${selectedLivestream.claimId}`
        : `${ROUTES.livestream}?t=Setup`;
    await page.goto(setupUrl);
    await page.waitForLoadState('domcontentloaded');
    await page.route('**/streams/kill**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: true }),
      });
    });

    await expect(page).not.toHaveURL(/\/\$\/signin/);
    await expect(page.getByText('Stream Credentials')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Stream Management')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open channel' })).toBeVisible();
    if (selectedLivestream) {
      await expect(
        page
          .locator('.livestream-setup__management-item')
          .filter({ hasText: 'Stream' })
          .getByText(selectedLivestream.title)
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open stream page' })).toBeVisible();
    }
    await expect(page.getByText('Browser Replays')).toBeVisible();
    await expect(page.getByText('Selected replay')).toBeVisible();
    await expect(
      page.locator('.livestream-setup__replay-preview-meta').getByText('Codex selected browser replay')
    ).toBeVisible();
    await expect(page.getByText('Codex unselected browser replay')).toBeVisible();
    await expect(page.locator('.livestream-setup__replay-preview-meta').getByText('RTMP capture')).toBeVisible();
    await expect(page.locator('.livestream-setup__replay-preview-video')).toBeVisible();
    await expect(
      page.locator('.livestream-setup__replay-preview-actions').getByRole('button', { name: 'Download' })
    ).toBeVisible();

    if (selectedLivestream && unselectedLivestream) {
      const unselectedRecentRow = page
        .locator('.livestream-setup__recent-item')
        .filter({ hasText: unselectedLivestream.title });
      await expect(unselectedRecentRow.getByRole('button', { name: 'Manage' })).toBeVisible();
      await unselectedRecentRow.getByRole('button', { name: 'Manage' }).click();
      await expect(page).toHaveURL(new RegExp(`claim_id=${unselectedLivestream.claimId}`));
      await expect(
        page
          .locator('.livestream-setup__management-item')
          .filter({ hasText: 'Stream' })
          .getByText(unselectedLivestream.title)
      ).toBeVisible();
      await expect(
        page.locator('.livestream-setup__replay-preview-meta').getByText('Codex unselected browser replay')
      ).toBeVisible();

      const selectedRecentRow = page
        .locator('.livestream-setup__recent-item')
        .filter({ hasText: selectedLivestream.title });
      await expect(selectedRecentRow.getByRole('button', { name: 'Manage' })).toBeVisible();
      await selectedRecentRow.getByRole('button', { name: 'Manage' }).click();
      await expect(page).toHaveURL(new RegExp(`claim_id=${selectedLivestream.claimId}`));
      await expect(
        page
          .locator('.livestream-setup__management-item')
          .filter({ hasText: 'Stream' })
          .getByText(selectedLivestream.title)
      ).toBeVisible();
      await expect(
        page.locator('.livestream-setup__replay-preview-meta').getByText('Codex selected browser replay')
      ).toBeVisible();
    }

    const browserStreamTab = page
      .locator('.livestream-setup__tabs')
      .getByRole('button', { name: 'Browser Stream (Beta)' });
    if ((await browserStreamTab.count()) === 1 && (await browserStreamTab.isVisible())) {
      await browserStreamTab.click();
      await expect(page.locator('.livestream-studio__management')).toBeVisible();
      await expect(
        page.locator('.livestream-studio__management-actions').getByRole('button', { name: 'Open stream' })
      ).toBeVisible();
      await expect(
        page.locator('.livestream-studio__management-actions').getByRole('button', { name: 'Open channel' })
      ).toBeVisible();
      await page.locator('.livestream-setup__tabs').getByRole('button', { name: 'RTMP Setup' }).click();
    }

    const mismatchActive = await injectActiveRtmpLivestream(page);
    test.skip(!mismatchActive, 'No active channel available for RTMP preview injection');

    await expect(page.getByText('Waiting for ingest.')).toBeVisible();
    await expect(
      page.locator('.livestream-setup__management-item').filter({ hasText: 'Preview' }).getByText('Waiting')
    ).toBeVisible();

    const injected = selectedLivestream && (await injectActiveRtmpLivestream(page, selectedLivestream));
    test.skip(!injected, 'No selected livestream available for RTMP preview injection');
    await expect(page.getByText('Active stream detected.')).toBeVisible();
    await expect(
      page.locator('.livestream-setup__management-item').filter({ hasText: 'Preview' }).getByText('Live')
    ).toBeVisible();

    const previewTab = page.locator('.livestream-setup__tabs').getByRole('button', { name: 'Preview' });
    if ((await previewTab.count()) === 1 && (await previewTab.isVisible())) {
      await previewTab.click();
      await expect(page.locator('.livestream-rtmp-preview')).toBeVisible();
      await expect(page.getByText('OFF AIR')).toBeHidden();
      await page.locator('.livestream-setup__tabs').getByRole('button', { name: 'RTMP Setup' }).click();
    }

    await expect(page.getByRole('button', { name: 'End RTMP' })).toBeVisible();
    await page.getByRole('button', { name: 'End RTMP' }).click();
    await expect(page.getByText('End RTMP stream?')).toBeVisible();
    const killRequest = page.waitForRequest((request) => request.url().includes('/streams/kill'));
    await page.getByRole('button', { name: 'End stream' }).click();
    await killRequest;
    await expect(
      page.locator('.livestream-setup__management-item').filter({ hasText: 'Preview' }).getByText('Waiting')
    ).toBeVisible();
  });

  test('selects a browser-stored replay in the normal replay publish form', async ({ page }) => {
    const replayId = `codex-browser-replay-${Date.now()}`;

    await page.goto(ROUTES.home);
    await page.waitForLoadState('domcontentloaded');
    await seedBrowserReplay(page, replayId);

    await page.goto(`${ROUTES.livestreamCreate}?s=Replay`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page).not.toHaveURL(/\/\$\/signin/);

    const title = page.getByRole('heading', { name: /publish replay/i }).first();
    const hasReplayForm = await title.isVisible({ timeout: 15_000 }).catch(() => false);
    test.skip(!hasReplayForm, 'Livestream replay publishing is not available for this account state');

    await expect(title).toBeVisible();
    await expect(page.getByText('Browser recordings')).toBeVisible();
    await expect(page.getByText('Saved in this browser')).toBeVisible();
    await expect(page.locator('.browser-replay-picker').getByText('RTMP capture')).toBeVisible();
    await page.getByRole('button', { name: /Codex browser replay/ }).click();
    await expect(page.getByText('Browser Replay')).toBeVisible();
    await expect(page.getByText('Using Codex browser replay from browser storage.')).toBeVisible();

    await deleteBrowserReplay(page, replayId);
    await page.evaluate(() => {
      (window as any).store.dispatch({
        type: 'UPDATE_PUBLISH_FORM',
        data: {
          filePath: undefined,
          fileSize: 0,
          fileMime: '',
        },
      });
    });

    await expect(page.getByText('Replay could not be loaded from browser storage.')).toBeVisible();
    await expect(page.getByText('Using Codex browser replay from browser storage.')).toBeHidden();

    await page.evaluate(() => {
      (window as any).store.dispatch({
        type: 'UPDATE_PUBLISH_FORM',
        data: {
          liveEditType: 'use_replay',
          remoteFileUrl: 'https://example.com/codex-replay.mp4',
        },
      });
    });

    await expect(page.getByText('Browser Replay')).toBeHidden();
    await expect(page.getByText('Using Codex browser replay from browser storage.')).toBeHidden();
    await expect(page.getByText('Upload Replay')).toBeVisible();
  });

  test('shows an optimistic no-source livestream in the channel live section', async ({ page }) => {
    const channel = getTestChannel();
    test.skip(!channel, 'Skipped - set ODYSEE_TEST_CHANNEL to verify channel livestream visibility');
    const channelName = channel as string;

    await page.goto(ROUTES.channel(channelName));
    await page.waitForLoadState('domcontentloaded');
    await expect(page).not.toHaveURL(/\/\$\/signin/);

    const injected = await page.evaluate((channelName) => {
      const store = (window as any).store;
      const state = store?.getState?.();
      const claimsById = state?.claims?.byId || {};
      const channelClaim = Object.values(claimsById).find(
        (claim: any) => claim?.value_type === 'channel' && String(claim.name).toLowerCase() === channelName.toLowerCase()
      ) as any;

      if (!store || !channelClaim?.claim_id) return false;

      const channelUrl = channelClaim.canonical_url || channelClaim.permanent_url || `lbry://${channelClaim.name}`;
      const claimId = `pending-livestream-smoke-${Date.now()}`;
      const streamUrl = `${channelUrl}/codex-livestream-smoke`;

      store.dispatch({
        type: 'UPDATE_PENDING_CLAIMS',
        data: {
          claims: [
            {
              claim_id: claimId,
              name: 'codex-livestream-smoke',
              permanent_url: streamUrl,
              canonical_url: streamUrl,
              short_url: streamUrl,
              type: 'claim',
              value_type: 'stream',
              confirmations: 0,
              is_channel_signature_valid: true,
              value: {
                title: 'Codex livestream smoke',
                description: '',
                tags: [],
              },
              signing_channel: {
                claim_id: channelClaim.claim_id,
                name: channelClaim.name,
                permanent_url: channelClaim.permanent_url,
                canonical_url: channelClaim.canonical_url,
                value: channelClaim.value,
              },
              txid: claimId,
              nout: 0,
              meta: { effective_amount: '0' },
              timestamp: Math.floor(Date.now() / 1000),
            },
          ],
          options: { overrideTags: true, overrideSigningChannel: true },
        },
      });

      return true;
    }, channelName);

    test.skip(!injected, 'Test channel did not resolve to a channel claim');

    await expect(page.getByText('Live and upcoming')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Codex livestream smoke')).toBeVisible();
  });
});
