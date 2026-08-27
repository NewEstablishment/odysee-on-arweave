import assert from 'node:assert/strict';

import { directImageUrl } from '../../ui/util/thumbnailProxy.ts';

assert.equal(
  directImageUrl('https://127.0.0.1:18801/native-id', ['http://127.0.0.1:18801']),
  'http://127.0.0.1:18801/native-id'
);
assert.equal(directImageUrl('http://localhost:18801/native-id'), 'http://localhost:18801/native-id');
assert.equal(directImageUrl('http://192.168.1.20/native-id'), 'http://192.168.1.20/native-id');
assert.equal(directImageUrl('/native-id'), '/native-id');
assert.equal(directImageUrl('data:image/png;base64,AA=='), 'data:image/png;base64,AA==');
assert.equal(directImageUrl('https://thumbs.odycdn.com/image.webp'), null);

console.log('Thumbnail proxy boundary tests passed');
