import fs from 'node:fs';

const baseUrl = (process.env.BASE_URL || 'http://localhost:1337').replace(/\/+$/, '');
const authToken = process.env.AUTH_TOKEN || 'odysee-smoke-token';
const chromiumPath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || firstExisting(['/usr/bin/chromium', '/usr/bin/brave']);
const readBase = `${baseUrl}/$/api/hyperbeam-upload/v1`;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#111827"/><circle cx="64" cy="60" r="32" fill="#22c55e"/><text x="112" y="68" font-family="Arial" font-size="22" fill="white">HB upload</text></svg>';

const uploadResponse = await fetch(`${readBase}/large`, {
  method: 'POST',
  headers: {
    cookie: `auth_token=${authToken}`,
    'content-type': 'image/svg+xml',
    'x-odysee-filename': 'hb-smoke.svg',
  },
  body: svg,
});

const uploadBody = await uploadResponse.json().catch(() => null);
if (!uploadResponse.ok || !uploadBody?.id) {
  throw new Error(`Upload failed: ${uploadResponse.status} ${JSON.stringify(uploadBody)}`);
}

const readUrl = `${readBase}/read/${encodeURIComponent(uploadBody.id)}`;
const readResponse = await fetch(readUrl);
const readBody = await readResponse.text();
const readType = readResponse.headers.get('content-type') || '';

if (!readResponse.ok || !readType.includes('image/svg+xml') || !readBody.includes('HB upload')) {
  throw new Error(
    `Readback failed: status=${readResponse.status} content-type=${readType} body=${readBody.slice(0, 80)}`
  );
}

const rangeResponse = await fetch(readUrl, { headers: { range: 'bytes=5-18' } });
const rangeBody = await rangeResponse.text();
const rangeHeader = rangeResponse.headers.get('content-range') || '';
const expectedRangeBody = svg.slice(5, 19);

if (rangeResponse.status !== 206 || rangeHeader !== `bytes 5-18/${svg.length}` || rangeBody !== expectedRangeBody) {
  throw new Error(
    `Range failed: status=${rangeResponse.status} content-range=${rangeHeader} body=${JSON.stringify(rangeBody)}`
  );
}

const claim = {
  claim_id: uploadBody.id,
  name: 'hb-smoke',
  normalized_name: 'hb-smoke',
  permanent_url: `lbry://hb-smoke#${uploadBody.id}`,
  canonical_url: `lbry://hb-smoke#${uploadBody.id}`,
  short_url: `lbry://hb-smoke#${uploadBody.id}`,
  type: 'claim',
  value_type: 'stream',
  streaming_url: `/$/api/hyperbeam-upload/v1/read/${encodeURIComponent(uploadBody.id)}`,
  value: {
    title: 'HB Smoke',
    source: {
      media_type: 'image/svg+xml',
      name: 'hb-smoke.svg',
      size: String(svg.length),
    },
  },
  hyperbeam: {
    upload_device: '~odysee-upload@1.0',
    upload_id: uploadBody.id,
  },
};

const indexResponse = await fetch(`${readBase}/index`, {
  method: 'POST',
  headers: {
    cookie: `auth_token=${authToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ claim }),
});
const indexBody = await indexResponse.json().catch(() => null);

if (!indexResponse.ok || indexBody?.result?.item?.claim_id !== uploadBody.id) {
  throw new Error(`Index failed: ${indexResponse.status} ${JSON.stringify(indexBody)}`);
}

const listResponse = await fetch(`${readBase}/list`, {
  method: 'POST',
  headers: {
    cookie: `auth_token=${authToken}`,
    'content-type': 'application/json',
  },
  body: '{}',
});
const listBody = await listResponse.json().catch(() => null);
const listed = Array.isArray(listBody?.result?.items)
  ? listBody.result.items.some((item) => item?.claim_id === uploadBody.id)
  : false;

if (!listResponse.ok || !listed) {
  throw new Error(`List failed: ${listResponse.status} ${JSON.stringify(listBody)}`);
}

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

  if (response.status() !== 200 || svgCount < 1 || screenshot.length < 1000) {
    throw new Error(
      `Render failed: status=${response.status()} svgCount=${svgCount} screenshotBytes=${screenshot.length}`
    );
  }

  render = {
    skipped: false,
    status: response.status(),
    svgCount,
    screenshotBytes: screenshot.length,
    screenshotPath,
  };
}

console.log(
  JSON.stringify(
    {
      upload: {
        id: uploadBody.id,
        chunkCount: uploadBody.chunk_count,
        size: uploadBody.size,
      },
      readback: {
        status: readResponse.status,
        contentType: readType,
        bytes: readBody.length,
      },
      range: {
        status: rangeResponse.status,
        contentRange: rangeHeader,
        bytes: rangeBody.length,
      },
      index: {
        status: indexResponse.status,
        listed,
        totalItems: listBody?.result?.total_items,
      },
      render,
    },
    null,
    2
  )
);

function firstExisting(paths) {
  return paths.find((path) => fs.existsSync(path)) || '';
}
