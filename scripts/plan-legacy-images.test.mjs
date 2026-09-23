import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planLegacyImages } from './plan-legacy-images.mjs';

const txid = 'a'.repeat(64);
const claim_id = 'c'.repeat(40);
const stream = {
  txid,
  nout: 0,
  claim_id,
  value_type: 'stream',
  value: { thumbnail: { url: 'https://images.example/video.png' } },
};
const channel = {
  txid,
  nout: 1,
  claim_id: 'd'.repeat(40),
  value_type: 'channel',
  value: {
    thumbnail: { url: 'https://images.example/avatar.png' },
    cover: { url: 'https://images.example/banner.png' },
  },
};

test('inventories streams, channel avatars/banners and embedded signing channels', () => {
  const result = planLegacyImages([{ ...stream, signing_channel: channel }, channel, stream]);
  assert.equal(result.entries.length, 3);
  assert.deepEqual(
    result.entries.map((entry) => entry.role),
    ['thumbnail', 'avatar', 'banner']
  );
  assert.equal(result.entries[0].legacy_outpoint, `${txid}:0`);
  assert.equal(result.summary.hosts['images.example'], 3);
  assert.ok(result.entries.every((entry) => entry.status === 'planned-not-fetched'));
  assert.deepEqual(result.issues, []);
  assert.equal(planLegacyImages([stream]).entries[0].job_id, result.entries[0].job_id);
});

test('supports Chainquery image locators without claiming complete banner coverage', () => {
  const result = planLegacyImages([
    { legacy_outpoint: `${txid}:2`, claim_type: 'channel', thumbnail_url: 'https://images.example/a.png' },
  ]);
  assert.equal(result.entries[0].role, 'avatar');
  assert.equal(result.summary.channels_without_banner_field, 1);
});

test('unwraps optimizer; does not deduplicate different versions by URL', () => {
  const url = 'https://thumbnails.odycdn.com/optimize/s:390:220/plain/https://images.example/video.png';
  const result = planLegacyImages([
    { ...stream, value: { thumbnail: { url } } },
    { ...stream, nout: 4 },
  ]);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].source_url, stream.value.thumbnail.url);
  assert.equal(result.entries[0].optimizer_unwrapped, true);
});

test('missing immutable evidence and sensitive/unsupported URLs are reported without copying them', () => {
  const result = planLegacyImages([
    { ...stream, txid: undefined },
    ...[
      'https://user:secret@images.example/a',
      'https://images.example/a?token=secret',
      'https://images.example/a#secret',
      'data:image/png;base64,secret',
      'javascript:secret',
    ].map((url) => ({ ...stream, value: { thumbnail: { url } } })),
    null,
  ]);
  assert.equal(result.entries.length, 0);
  assert.equal(result.issues.length, 7);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.throws(() => planLegacyImages({}), /JSON array/);
});
