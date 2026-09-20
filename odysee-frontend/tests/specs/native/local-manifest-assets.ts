import type { BrowserContext } from '@playwright/test';
import path from 'node:path';

// Optional test-only asset transport for an already-built bundle. API reads and
// writes still reach the real node; this is NOT manifest-publication acceptance.
export async function localManifestAssets(context: BrowserContext, manifest: string) {
  const directory = process.env.HYPERBEAM_TEST_ASSET_DIR;
  if (!directory) return;
  const root = path.resolve(directory);
  const prefix = new URL(manifest);
  await context.route(
    (url) =>
      url.origin === prefix.origin &&
      (url.pathname === prefix.pathname || url.pathname.startsWith(`${prefix.pathname}/`)),
    async (route) => {
      const suffix = decodeURIComponent(new URL(route.request().url()).pathname.slice(prefix.pathname.length));
      const file = path.resolve(root, `.${suffix || '/'}`, suffix === '' || suffix === '/' ? 'index.html' : '');
      if (!file.startsWith(`${root}${path.sep}`)) return route.abort();
      await route.fulfill({ path: file });
    }
  );
}
