import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MANIFEST_CONTENT_TYPE,
  MANIFEST_ID_REGEX,
  contentTypeForPath,
  createPathManifest,
  publishStaticManifest,
  validateStaticBuild,
} from './static-manifest.mjs';

function testId(index) {
  return Buffer.alloc(32, index).toString('base64url');
}

async function temporaryBuild(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odysee-static-manifest-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
  await fs.mkdir(path.join(directory, 'img'), { recursive: true });
  await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><title>Odysee</title>');
  await fs.writeFile(path.join(directory, 'assets', 'app.js'), 'console.log("odysee")');
  await fs.writeFile(path.join(directory, 'img', 'pixel.png'), Buffer.from([1, 2, 3]));
  return directory;
}

test('creates a deterministic Arweave path manifest', () => {
  const manifest = createPathManifest(
    new Map([
      ['index.html', testId(1)],
      ['assets/app.js', testId(2)],
    ])
  );

  assert.deepEqual(Object.keys(manifest.paths), ['assets/app.js', 'index.html']);
  assert.deepEqual(manifest.index, { path: 'index.html' });
  assert.equal(manifest.manifest, 'arweave/paths');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(contentTypeForPath('font/app.woff2'), 'font/woff2');
});

test('rejects paths reserved by HyperBEAM', async (t) => {
  const directory = await temporaryBuild(t);
  await fs.writeFile(path.join(directory, 'assets', 'vendor~ui.js'), 'bad');
  await assert.rejects(validateStaticBuild(directory), /Unsafe manifest path/);
});

test('publishes assets and the manifest through generic signed writes', async (t) => {
  const directory = await temporaryBuild(t);
  const expectedIndex = await fs.readFile(path.join(directory, 'index.html'));
  const requests = [];
  const manifestId = testId(200);
  let assetNumber = 0;

  const fetchImpl = async (url, options = {}) => {
    const target = new URL(url);
    if (!options.method || options.method === 'GET') {
      assert.equal(target.pathname, `/${manifestId}`);
      return new Response(expectedIndex, { headers: { 'content-type': 'text/html' } });
    }

    const headers = new Headers(options.headers);
    const body = Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body));
    const record = { headers, body, url: `${target.pathname}${target.search}` };
    requests.push(record);
    assert.equal(options.method, 'POST');
    assert.equal(record.url, '/id?!=true&committers=all');
    assert.equal(headers.get('x-odysee-auth-token'), 'test-token');

    if (headers.get('content-type') === MANIFEST_CONTENT_TYPE) {
      return new Response('{}', { headers: { 'message-id': manifestId } });
    }

    assetNumber += 1;
    const id = testId(assetNumber);
    if (assetNumber === 1) return new Response('{}', { headers: { id } });
    if (assetNumber === 2) return Response.json({ path: `/${id}` });
    return new Response(id);
  };

  const progress = [];
  const result = await publishStaticManifest({
    directory,
    nodeUrl: 'http://manifest.test',
    authToken: 'test-token',
    concurrency: 2,
    fetchImpl,
    onProgress: (entry) => progress.push(entry),
  });

  assert.equal(result.id, manifestId);
  assert.equal(result.fileCount, 3);
  assert.equal(progress.length, 3);
  assert(Object.values(result.manifest.paths).every(({ id }) => MANIFEST_ID_REGEX.test(id)));

  const manifestRequest = requests.find((record) => record.headers.get('content-type') === MANIFEST_CONTENT_TYPE);
  assert(manifestRequest);
  const manifest = JSON.parse(manifestRequest.body.toString('utf8'));
  assert.deepEqual(Object.keys(manifest.paths), ['assets/app.js', 'img/pixel.png', 'index.html']);
});
