import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NATIVE_IMAGE_MAX_BYTES, uploadNativeImage, validateNativeImage } from '../../ui/util/nativeImageUpload.ts';

const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
const id = 'i'.repeat(43);
const base = 'https://node.example';
// Node has Blob/fetch but no browser decoder; real decoding is tested separately.
globalThis.createImageBitmap = async () => {
  throw new Error('Install a decoder mock for this test.');
};

test('image preflight and generic write contract', async (t) => {
  const writes = [];
  let closed = 0;
  const decode = t.mock.method(globalThis, 'createImageBitmap', async () => ({
    width: 20,
    height: 10,
    close() {
      closed++;
    },
  }));
  t.mock.method(globalThis, 'fetch', async (...args) => {
    writes.push(args);
    return new Response('', { headers: { 'message-id': id } });
  });
  assert.deepEqual(await uploadNativeImage(png, `${base}/`), { id, url: `${base}/${id}` });
  assert.equal(writes[0][0], `${base}/id?0.%21=true&committers=all`);
  assert.equal(writes[0][1].body, png, 'exact input bytes, not multipart or a rewritten image');
  assert.equal(writes[0][1].credentials, 'include');
  assert.equal(writes[0][1].redirect, 'error');
  assert.deepEqual(writes[0][1].headers, { accept: 'application/json', 'content-type': 'image/png' });
  assert.equal(closed, 1);

  for (const file of [
    new Blob([], { type: 'image/png' }),
    new Blob([new Uint8Array(NATIVE_IMAGE_MAX_BYTES + 1)], { type: 'image/png' }),
    new Blob(['<svg></svg>'], { type: 'image/svg+xml' }),
    new Blob(['<script>fake</script>'], { type: 'image/png' }),
    new Blob([await png.arrayBuffer()], { type: 'image/jpeg' }),
    new Blob([await png.arrayBuffer()]),
  ])
    await assert.rejects(uploadNativeImage(file, base));
  await assert.rejects(uploadNativeImage(png, ''), /No HyperBEAM node/);
  assert.equal(writes.length, 1, 'invalid input must never write');
  assert.equal(decode.mock.callCount(), 1, 'byte/type/size rejection precedes decoding');
  await validateNativeImage(new Blob([png, new Uint8Array(NATIVE_IMAGE_MAX_BYTES - png.size)], { type: 'image/png' }));

  const gif = new Blob(['GIF89a'], { type: 'image/gif' });
  await assert.rejects(validateNativeImage(gif), /Choose a PNG, JPEG or WebP/);
  await validateNativeImage(gif, true);
  await validateNativeImage(new Blob([Uint8Array.from([255, 216, 255])], { type: 'image/jpeg' }));
  await validateNativeImage(new Blob(['RIFF1234WEBP'], { type: 'image/webp' }));
  // This suite isolates transport/preflight with a decoder stub. The browser
  // companion tests real decoding; a signature prefix alone is not accepted.
  decode.mock.mockImplementation(async () => {
    throw new Error('decoder details');
  });
  await assert.rejects(uploadNativeImage(png, base), /could not be decoded/);
  for (const [width, height] of [
    [8193, 1],
    [1, 8193],
    [0, 1],
  ]) {
    decode.mock.mockImplementation(async () => ({
      width,
      height,
      close() {
        closed++;
      },
    }));
    const before = closed;
    await assert.rejects(uploadNativeImage(png, base), /dimensions/);
    assert.equal(closed, before + 1, 'release decoded bitmap even on dimension rejection');
  }
  assert.equal(writes.length, 1);
});

test('acknowledgements fail closed; retry repeats a normal write', async (t) => {
  t.mock.method(globalThis, 'createImageBitmap', async () => ({ width: 1, height: 1, close() {} }));
  let response;
  t.mock.method(globalThis, 'fetch', async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  for (const value of ['', '../wrong', 'a'.repeat(44)]) {
    response = new Response('', { headers: { 'message-id': value } });
    await assert.rejects(uploadNativeImage(png, base), /invalid ID/);
  }
  for (const value of [null, 23, { id }]) {
    response = Response.json({ 'message-id': value });
    await assert.rejects(uploadNativeImage(png, base), /invalid ID/);
  }
  response = new Response('', { status: 503 });
  await assert.rejects(uploadNativeImage(png, base), /503/);
  response = new TypeError('Failed to fetch');
  await assert.rejects(uploadNativeImage(png, base), /Failed to fetch/);
  response = Response.json({ 'message-id': id });
  assert.equal((await uploadNativeImage(png, base)).id, id);
});
