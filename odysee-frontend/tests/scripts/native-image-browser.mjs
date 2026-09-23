// Real Chromium decoding + actual service adapters against an in-memory HTTP
// fixture. This does NOT claim node commitment verification or full editor QA.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { chromium } from 'playwright';

const files = {
  '/image.js': '../../ui/util/nativeImageUpload.ts',
  '/thumbnail.js': '../../ui/services/thumbnailUpload.ts',
  '/profile.js': '../../ui/services/profileImageUpload.ts',
};
const modules = {};
for (const [url, file] of Object.entries(files)) {
  modules[url] = stripTypeScriptTypes(await readFile(new URL(file, import.meta.url), 'utf8'))
    .replaceAll("'util/nativeImageUpload'", "'/image.js'")
    .replaceAll("'util/hyperbeamDevices'", "'/node.js'");
}
const images = new Map();
const writes = [];
let failNext = false;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://fixture').pathname;
    if (req.method === 'POST' && path === '/id') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      writes.push({ url: req.url, type: req.headers['content-type'], body });
      if (failNext) {
        failNext = false;
        res.writeHead(503).end();
        return;
      }
      const id = createHash('sha256').update(body).digest('base64url');
      images.set(id, { body, type: req.headers['content-type'] });
      res.writeHead(200, { 'message-id': id }).end();
    } else if (images.has(path.slice(1))) {
      const image = images.get(path.slice(1));
      res.writeHead(200, { 'content-type': image.type }).end(image.body);
    } else if (modules[path] || path === '/node.js') {
      res
        .writeHead(200, { 'content-type': 'text/javascript' })
        .end(modules[path] || 'export const hyperbeamNodeBase = () => location.origin;');
    } else if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Image service fixture</title>
        <script type="module">
          import thumbnail from '/thumbnail.js'; import {uploadProfileImage} from '/profile.js';
          window.upload = async (type, bytes, profile = false) => {
            const file = new File([new Uint8Array(bytes)], 'fixture', {type});
            if (profile) return uploadProfileImage(file);
            const form = new FormData(); form.set('file-input', file); return thumbnail(form);
          };
        </script>`);
    } else res.writeHead(404).end();
  } catch (_) {
    res.writeHead(500).end();
  }
});
let browser;
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.upload === 'function');
  const fixtures = await page.evaluate(async () => {
    const result = [];
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 18;
    canvas.getContext('2d').fillRect(0, 0, 32, 18);
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type));
      result.push({ type, bytes: [...new Uint8Array(await blob.arrayBuffer())] });
    }
    return result;
  });
  const png = fixtures[0];
  for (const profile of [false, true])
    for (const fixture of fixtures) {
      const result = await page.evaluate(
        ({ fixture, profile }) => window.upload(fixture.type, fixture.bytes, profile),
        { fixture, profile }
      );
      const url = profile ? `${origin}/${result}` : result.message;
      assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), Buffer.from(fixture.bytes));
      assert.equal(writes.at(-1).type, fixture.type);
      assert.equal(writes.at(-1).url, '/id?0.%21=true&committers=all');
    }
  const gif = {
    type: 'image/gif',
    bytes: [...Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')],
  };
  await page.evaluate((f) => window.upload(f.type, f.bytes), gif);
  const before = writes.length;
  for (const fixture of [
    { type: 'image/png', bytes: png.bytes.slice(0, 12) },
    { type: 'image/jpeg', bytes: png.bytes },
    { type: 'image/svg+xml', bytes: [...Buffer.from('<svg/>')] },
    { ...gif, profile: true },
  ]) {
    const rejected = await page.evaluate(async (f) => {
      try {
        await window.upload(f.type, f.bytes, Boolean(f.profile));
        return false;
      } catch (_) {
        return true;
      }
    }, fixture);
    assert.equal(rejected, true);
  }
  assert.equal(writes.length, before, 'invalid images never reach the server');
  failNext = true;
  const failure = await page.evaluate(async (f) => {
    try {
      await window.upload(f.type, f.bytes);
      return '';
    } catch (e) {
      return e.message;
    }
  }, png);
  assert.match(failure, /503/);
  const retry = await page.evaluate((f) => window.upload(f.type, f.bytes), png);
  await page.reload();
  const fresh = await browser.newContext();
  try {
    const visitor = await fresh.newPage();
    await visitor.goto(retry.message);
    assert.equal(await visitor.locator('img').evaluate((img) => img.naturalWidth), 32);
  } finally {
    await fresh.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: real PNG/JPEG/WebP/GIF decode, profile restrictions, exact bytes, both adapters, invalid input, retry and fresh-reader image rendering. Fixture transport only; no live node/editor sign-off.'
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
