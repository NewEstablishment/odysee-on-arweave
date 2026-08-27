import assert from 'node:assert/strict';
import fs from 'node:fs';

const baseUrl = String(process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18801').replace(/\/+$/, '');
const chromiumPath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || firstExisting(['/usr/bin/chromium', '/usr/bin/brave']);
const writeUrl = `${baseUrl}/id?0.%21=true&committers=all`;
const name = `hb-smoke-${Date.now()}`;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#111827"/><circle cx="64" cy="60" r="32" fill="#22c55e"/><text x="112" y="68" font-family="Arial" font-size="22" fill="white">HB upload</text></svg>';

const profile = await writeJson({ type: 'channel', name });
assert.ok(profile.cookie, 'the profile write must mint an identity cookie');

const uploadResponse = await fetch(writeUrl, {
  method: 'POST',
  headers: {
    accept: 'application/json',
    cookie: profile.cookie,
    'content-type': 'image/svg+xml',
  },
  body: svg,
});
const uploadText = await uploadResponse.text();
assert.equal(uploadResponse.ok, true, `upload failed: ${uploadResponse.status} ${uploadText.slice(0, 500)}`);
const dataId = responseId(uploadResponse, uploadText);
assert.match(dataId, /^[0-9A-Za-z_-]{43}$/);

const readUrl = `${baseUrl}/${dataId}`;
const readResponse = await fetch(readUrl);
const readBody = await readResponse.text();
const readType = readResponse.headers.get('content-type') || '';
assert.equal(readResponse.ok, true);
assert.equal(readBody, svg);

const rangeResponse = await fetch(readUrl, { headers: { range: 'bytes=5-18' } });
const rangeBody = await rangeResponse.text();
const rangeHeader = rangeResponse.headers.get('content-range') || '';
assert.equal(rangeResponse.status, 206);
assert.equal(rangeHeader, `bytes 5-18/${Buffer.byteLength(svg)}`);
assert.equal(rangeBody, svg.slice(5, 19));

const index = await writeJson(
  {
    schema: 'odysee-upload@1.0',
    type: 'upload',
    name,
    filename: `${name}.svg`,
    'content-type': 'image/svg+xml',
    'source-size': String(Buffer.byteLength(svg)),
    'data-id': dataId,
    'streaming-url': `/${dataId}`,
    title: 'HB Smoke',
    'channel-id': profile.id,
    'channel-name': name,
    timestamp: Math.floor(Date.now() / 1000),
  },
  profile.cookie
);

const exactIndex = await fetch(`${baseUrl}/${index.id}?accept-bundle=true`, {
  headers: { accept: 'application/json' },
});
const exactText = await exactIndex.text();
assert.equal(exactIndex.ok, true, `index read failed: ${exactIndex.status} ${exactText.slice(0, 500)}`);
assert.equal(exactIndex.headers.get('schema'), 'odysee-upload@1.0');
assert.equal(exactIndex.headers.get('data-id'), dataId);

const queryResponse = await fetch(`${baseUrl}/~query@1.0/only`, {
  method: 'POST',
  headers: { accept: 'application/json', 'content-type': 'application/json' },
  body: JSON.stringify({
    schema: 'odysee-upload@1.0',
    name,
    only: ['schema', 'name'],
    return: 'paths',
    'cache-control': ['no-store', 'no-cache'],
  }),
});
const queryText = await queryResponse.text();
assert.equal(queryResponse.ok, true, `query failed: ${queryResponse.status} ${queryText.slice(0, 500)}`);
assert.ok(queryText.includes(index.id), 'the upload index must be discoverable by schema and name');

let render = { skipped: true, reason: 'no chromium executable found' };
if (chromiumPath) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 360, height: 220 } });
  const response = await page.goto(readUrl, { waitUntil: 'load', timeout: 10000 });
  const svgCount = await page.locator('svg').count();
  const screenshotPath = process.env.SCREENSHOT_PATH || '/tmp/odysee-hb-upload-smoke.png';
  const screenshot = await page.screenshot({ path: screenshotPath, fullPage: false });
  await browser.close();

  assert.equal(response.status(), 200);
  assert.ok(svgCount >= 1);
  assert.ok(screenshot.length >= 1000);
  render = { skipped: false, status: response.status(), svgCount, screenshotBytes: screenshot.length, screenshotPath };
}

console.log(
  JSON.stringify(
    {
      profileId: profile.id,
      dataId,
      indexId: index.id,
      readback: { status: readResponse.status, contentType: readType, bytes: readBody.length },
      range: { status: rangeResponse.status, contentRange: rangeHeader, bytes: rangeBody.length },
      query: { status: queryResponse.status, discovered: true },
      render,
    },
    null,
    2
  )
);

async function writeJson(message, cookie) {
  const response = await fetch(writeUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(message),
  });
  const body = await response.text();
  assert.equal(response.ok, true, `message write failed: ${response.status} ${body.slice(0, 500)}`);
  const id = responseId(response, body);
  assert.match(id, /^[0-9A-Za-z_-]{43}$/);
  return { id, cookie: cookie || cookiePair(response.headers.get('set-cookie')) };
}

function responseId(response, body) {
  const fromHeader = response.headers.get('message-id') || response.headers.get('id');
  if (fromHeader) return fromHeader.replace(/^\/+|^"|"$/g, '').trim();
  try {
    const parsed = JSON.parse(body);
    return String(parsed['message-id'] || parsed.id || parsed.body || '')
      .replace(/^\/+|^"|"$/g, '')
      .trim();
  } catch {
    return body.replace(/^\/+|^"|"$/g, '').trim();
  }
}

function cookiePair(setCookie) {
  return String(setCookie || '')
    .split(/,(?=[^;,]+=)/)[0]
    .split(';')[0]
    .trim();
}

function firstExisting(paths) {
  return paths.find((path) => fs.existsSync(path)) || '';
}
