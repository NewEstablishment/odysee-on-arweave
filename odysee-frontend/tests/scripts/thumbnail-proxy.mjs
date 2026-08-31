import assert from 'node:assert/strict';

import { directImageUrl, unwrapThumbnailProxyUrl } from '../../ui/util/thumbnailProxy.ts';

assert.equal(
  directImageUrl('https://127.0.0.1:18801/native-id', ['http://127.0.0.1:18801']),
  'http://127.0.0.1:18801/native-id'
);
assert.equal(directImageUrl('http://localhost:18801/native-id'), 'http://localhost:18801/native-id');
assert.equal(directImageUrl('http://192.168.1.20/native-id'), 'http://192.168.1.20/native-id');
assert.equal(directImageUrl('/native-id'), '/native-id');
assert.equal(directImageUrl('data:image/png;base64,AA=='), 'data:image/png;base64,AA==');
assert.equal(directImageUrl('https://thumbs.odycdn.com/image.webp'), null);
assert.equal(
  directImageUrl('https://thumbs.odycdn.com/image.webp', [], true),
  'https://thumbs.odycdn.com/image.webp',
  'HyperBEAM mode must load a remote source directly instead of wrapping it in the legacy optimizer'
);
assert.equal(
  directImageUrl('http://thumbs.odycdn.com/image.webp', [], true),
  'https://thumbs.odycdn.com/image.webp',
  'public remote images must not introduce mixed content in a secure manifest'
);
assert.equal(
  unwrapThumbnailProxyUrl(
    'https://thumbnails.odycdn.com/optimize/s:390:220/quality:85/plain/https://spee.ch/missing-thumb-png'
  ),
  'https://spee.ch/missing-thumb-png'
);
assert.equal(
  directImageUrl(
    'https://thumbnails.odycdn.com/optimize/s:390:220/quality:85/plain/https://spee.ch/missing-thumb-png',
    [],
    true
  ),
  'https://spee.ch/missing-thumb-png',
  'an inherited optimizer URL must be unwrapped before it reaches the browser'
);

console.log('Thumbnail proxy boundary tests passed');
