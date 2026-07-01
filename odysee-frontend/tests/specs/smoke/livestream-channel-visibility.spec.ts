import { test, expect, type Page } from '../../fixtures';
import { ROUTES } from '../../helpers/routes';

const PUBLIC_CHANNEL = '@Odysee';

type InjectedLivestream = {
  claimId: string;
  channelId: string;
  streamUrl: string;
};

async function injectPendingLivestream(page: Page, channelName: string, title: string) {
  const resolved = await page
    .waitForFunction(
      (channelName) => {
        const store = (window as any).store;
        const state = store?.getState?.();
        const claimsById = state?.claims?.byId || {};
        const channelLookup = channelName.toLowerCase().replace(/^@/, '');

        return Object.values(claimsById).some((claim: any) => {
          const claimName = String(claim?.name || claim?.normalized_name || '')
            .toLowerCase()
            .replace(/^@/, '');
          return claim?.value_type === 'channel' && claim?.claim_id && claimName === channelLookup;
        });
      },
      channelName,
      { timeout: 15_000 }
    )
    .then(() => true)
    .catch(() => false);

  if (!resolved) return false;

  return page.evaluate<InjectedLivestream | false, { channelName: string; title: string }>(
    ({ channelName, title }) => {
      const store = (window as any).store;
      const state = store?.getState?.();
      const claimsById = state?.claims?.byId || {};
      const channelLookup = channelName.toLowerCase().replace(/^@/, '');
      const channelClaim = Object.values(claimsById).find((claim: any) => {
        const claimName = String(claim?.name || claim?.normalized_name || '')
          .toLowerCase()
          .replace(/^@/, '');
        return claim?.value_type === 'channel' && claim?.claim_id && claimName === channelLookup;
      }) as any;

      if (!store || !channelClaim?.claim_id) return false;

      const channelUrl = channelClaim.canonical_url || channelClaim.permanent_url || `lbry://${channelClaim.name}`;
      const claimId = `pending-livestream-channel-smoke-${Date.now()}`;
      const streamUrl = `${channelUrl}/codex-livestream-channel-smoke-${Date.now()}`;
      const normalizedName = 'codex-livestream-channel-smoke';

      store.dispatch({
        type: 'UPDATE_PENDING_CLAIMS',
        data: {
          claims: [
            {
              claim_id: claimId,
              name: normalizedName,
              normalized_name: normalizedName,
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

      return {
        claimId,
        channelId: channelClaim.claim_id,
        streamUrl,
      };
    },
    { channelName, title }
  );
}

async function markLivestreamActive(
  page: Page,
  livestream: InjectedLivestream,
  options: { p2pDelivery?: boolean; swarmId?: string } = {}
) {
  const { p2pDelivery = true, swarmId = `odysee-live-${livestream.claimId}` } = options;

  await page.evaluate(({ livestream, p2pDelivery, swarmId }) => {
    const store = (window as any).store;
    store.dispatch({
      type: 'CLIENT_SETTING_CHANGED',
      data: { key: 'p2p_delivery', value: p2pDelivery },
    });
    store.dispatch({
      type: 'CLIENT_SETTING_CHANGED',
      data: { key: 'p2p_opt_in_dismissed', value: false },
    });
    store.dispatch({
      type: 'LIVESTREAM_IS_LIVE_COMPLETE',
      data: {
        [livestream.channelId]: {
          type: 'application/x-mpegurl',
          isLive: true,
          viewCount: 1,
          creatorId: livestream.channelId,
          thumbnailUrl: null,
          activeClaim: {
            uri: livestream.streamUrl,
            claimUri: livestream.streamUrl,
            claimId: livestream.claimId,
            videoUrl: null,
            videoUrlPublic: null,
            sourceType: 'browser',
            p2pSwarmId: swarmId,
            p2pTrackerUrl: null,
            startedStreaming: {
              toDate: () => new Date(),
            },
          },
        },
      },
    });
  }, { livestream, p2pDelivery, swarmId });
}

test.describe('Livestream channel visibility', () => {
  [
    { label: 'home', route: ROUTES.channel(PUBLIC_CHANNEL) },
    { label: 'content', route: ROUTES.channelTab(PUBLIC_CHANNEL, 'content') },
  ].forEach(({ label, route }) => {
    test(`shows a pending no-source livestream on the channel ${label} route`, async ({ page }) => {
      const title = `Codex livestream ${label} smoke`;

      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      await expect(page).not.toHaveURL(/\/\$\/signin/);

      const injected = await injectPendingLivestream(page, PUBLIC_CHANNEL, title);
      test.skip(!injected, 'Known public channel did not resolve to a channel claim');

      await expect(page.getByText('Live and upcoming')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('link', { name: title }).first()).toBeVisible();
    });
  });

  test('opens a pending active livestream from the channel page into the viewer route', async ({ page }) => {
    const title = 'Codex livestream viewer smoke';

    await page.goto(ROUTES.channel(PUBLIC_CHANNEL));
    await page.waitForLoadState('domcontentloaded');
    await expect(page).not.toHaveURL(/\/\$\/signin/);

    const livestream = await injectPendingLivestream(page, PUBLIC_CHANNEL, title);
    test.skip(!livestream, 'Known public channel did not resolve to a channel claim');
    await markLivestreamActive(page, livestream as InjectedLivestream);

    const streamLink = page.getByRole('link', { name: title }).first();
    await expect(streamLink).toBeVisible({ timeout: 10_000 });
    await streamLink.click();

    await expect(page).not.toHaveURL(/\/\$\/signin/);
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.livestream-browser-viewer__standby')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Waiting for browser stream')).toBeVisible();
    await expect(page.getByTestId('livestream-browser-viewer')).toHaveAttribute(
      'data-room-id',
      `odysee-live-${(livestream as InjectedLivestream).claimId}`
    );
  });

  test('opens a no-source livestream claim into HyperBEAM browser discovery before server live state', async ({ page }) => {
    const title = 'Codex livestream discovery smoke';

    await page.goto(ROUTES.channel(PUBLIC_CHANNEL));
    await page.waitForLoadState('domcontentloaded');
    await expect(page).not.toHaveURL(/\/\$\/signin/);

    const livestream = await injectPendingLivestream(page, PUBLIC_CHANNEL, title);
    test.skip(!livestream, 'Known public channel did not resolve to a channel claim');
    await page.evaluate(() => {
      const store = (window as any).store;
      store.dispatch({
        type: 'CLIENT_SETTING_CHANGED',
        data: { key: 'p2p_delivery', value: true },
      });
    });

    const streamLink = page.getByRole('link', { name: title }).first();
    await expect(streamLink).toBeVisible({ timeout: 10_000 });
    await streamLink.click();

    await expect(page).not.toHaveURL(/\/\$\/signin/);
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.livestream-browser-viewer__standby')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Waiting for browser stream')).toBeVisible();
    await expect(page.getByTestId('livestream-browser-viewer')).toHaveAttribute(
      'data-room-id',
      (livestream as InjectedLivestream).claimId
    );
  });

  test('offers browser P2P opt-in for an active no-source livestream', async ({ page }) => {
    const title = 'Codex livestream viewer opt-in smoke';

    await page.goto(ROUTES.channel(PUBLIC_CHANNEL));
    await page.waitForLoadState('domcontentloaded');
    await expect(page).not.toHaveURL(/\/\$\/signin/);

    const livestream = await injectPendingLivestream(page, PUBLIC_CHANNEL, title);
    test.skip(!livestream, 'Known public channel did not resolve to a channel claim');
    await markLivestreamActive(page, livestream as InjectedLivestream, { p2pDelivery: false });

    const streamLink = page.getByRole('link', { name: title }).first();
    await expect(streamLink).toBeVisible({ timeout: 10_000 });
    await streamLink.click();

    await expect(page).not.toHaveURL(/\/\$\/signin/);
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('P2P streaming available')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Try it' }).click();
    await expect(page.getByText('Waiting for browser stream')).toBeVisible();
  });
});
