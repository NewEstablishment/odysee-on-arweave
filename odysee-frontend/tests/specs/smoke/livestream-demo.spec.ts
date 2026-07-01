import { test, expect } from '../../fixtures';
import { ROUTES } from '../../helpers/routes';

test.describe('Livestream HyperBEAM demo', () => {
  test.skip(!process.env.LIVESTREAM_HYPERBEAM_DEMO_E2E, 'requires local HyperBEAM demo node');

  test('connects a real browser media stream through HyperBEAM signaling', async ({ page }) => {
    await page.goto(ROUTES.livestreamDemo);
    await expect(page.getByText('HYPERBEAM SIGNALING ONLINE')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => {
      const seed = document.querySelector('[data-testid="livestream-demo-peer-seed"]')?.getAttribute('data-peer-id');
      const viewer = document
        .querySelector('[data-testid="livestream-demo-peer-viewer"]')
        ?.getAttribute('data-peer-id');
      return seed && viewer && seed !== viewer;
    });

    await page.evaluate(() => {
      const startButton = Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Start test feed'
      );
      if (!(startButton instanceof HTMLButtonElement)) throw new Error('Start test feed button not found');
      startButton.click();
    });

    await page.waitForFunction(
      () => {
        const text = document.body.innerText || '';
        const videos = Array.from(document.querySelectorAll('video'));
        return (
          text.includes('Media') &&
          text.includes('connected') &&
          videos.length >= 2 &&
          videos.every((video) => video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && !video.paused)
        );
      },
      undefined,
      { timeout: 20_000 }
    );
  });
});
