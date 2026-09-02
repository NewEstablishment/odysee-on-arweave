import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateStaticBuild } from './static-manifest.mjs';

const directory = path.resolve(process.argv[2] || 'web/dist/public');
const files = await validateStaticBuild(directory);
const index = await fs.readFile(path.join(directory, 'index.html'), 'utf8');
const serverTemplate = await fs.readFile(path.join(directory, 'index-web.html'), 'utf8');
const homepageModule = await fs.readFile(path.resolve('custom/homepages/v2/index.ts'), 'utf8').catch(() => '');

function fail(message) {
  throw new Error(`Static manifest build check failed: ${message}`);
}

const indexUrls = [...index.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
if (!index.includes('window.__ODYSEE_MANIFEST_PREFIX__')) fail('manifest prefix bootstrap is missing');
if (!indexUrls.some((url) => url.startsWith('./assets/'))) fail('index.html has no relative entry asset');
if (indexUrls.some((url) => /^\/(?:assets|font|img|public)\//.test(url))) {
  fail('index.html contains a root-relative local asset');
}

const cssFiles = files.filter((file) => file.path.endsWith('.css'));
for (const file of cssFiles) {
  const css = await fs.readFile(file.absolutePath, 'utf8');
  if (/url\(\s*['"]?\/(?!\/)/.test(css)) fail(`${file.path} contains a root-relative url()`);
}

const assetFiles = files.filter((file) => file.path.startsWith('assets/'));
if (assetFiles.some((file) => !/^[A-Za-z0-9_.-]+$/.test(path.basename(file.path)))) {
  fail('an emitted asset name contains a HyperBEAM-reserved character');
}

const localContentLocator = homepageModule.match(/["']([A-Za-z0-9_-]{43}|[0-9a-f]{64}:[0-9]+)["']/i)?.[1];
if (!localContentLocator) fail('materialized local-content data is missing');
let localContentBundled = false;
for (const file of assetFiles.filter((file) => file.path.endsWith('.js'))) {
  if ((await fs.readFile(file.absolutePath, 'utf8')).includes(localContentLocator)) {
    localContentBundled = true;
    break;
  }
}
if (!localContentBundled) fail('materialized local-content locators were not bundled');

const templateAssetUrls = [...serverTemplate.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((match) => match[1]);
if (!templateAssetUrls.length || templateAssetUrls.some((url) => !url.startsWith('/public/assets/'))) {
  fail('index-web.html assets are not rooted under /public/');
}
if (serverTemplate.includes('window.__ODYSEE_MANIFEST_PREFIX__')) {
  fail('the dynamic server template contains the manifest bootstrap');
}

process.stdout.write(`Static manifest build check passed (${files.length} files).\n`);
