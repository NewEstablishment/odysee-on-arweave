import assert from 'node:assert/strict';
import { nativeThumbnailForWrite, nativeThumbnailUrl, readNativeThumbnail } from '../../ui/util/nativeThumbnail.ts';
import {
  normalizeNativeUploadRevision,
  nativeUploadRevisionMessage,
  latestNativeUploadRevision,
} from '../../ui/util/nativeUploadRevisions.ts';
import { uploadSearchDocuments } from '../../../scripts/native-upload-search.mjs';

const image = 'i'.repeat(43),
  replacement = 'j'.repeat(43);
const base = 'https://node.example';
const idMetadata = { thumbnail_id: image, thumbnail_url: '' };
assert.deepEqual(nativeThumbnailForWrite({ thumbnail_url: `${base}/${image}` }, base), idMetadata);
assert.deepEqual(nativeThumbnailForWrite({ thumbnail_id: image }, `${base}/`), idMetadata);
assert.equal(nativeThumbnailUrl(idMetadata, 'https://other-node.example'), `https://other-node.example/${image}`);
assert.deepEqual(nativeThumbnailForWrite({}, base), {});
for (const url of [
  `https://remote.example/${image}`,
  `${base}/${image}?download`,
  `${base}/${image}#x`,
  `${base}/${image}/`,
  `https://node.example.evil/${image}`,
  `https://user@node.example/${image}`,
  `/${image}`,
]) {
  assert.deepEqual(nativeThumbnailForWrite({ thumbnail_url: url }, base), { thumbnail_id: '', thumbnail_url: url });
}
assert.equal(
  nativeThumbnailUrl({ thumbnail_url: `${base}/${image}` }, 'https://other-node.example'),
  `${base}/${image}`,
  'reading old URL metadata does not migrate it'
);
for (const bad of [23, {}, 'short', '../escape', 'a'.repeat(44)]) {
  assert.equal(readNativeThumbnail({ 'thumbnail-id': bad }), null);
  assert.throws(() => nativeThumbnailForWrite({ thumbnail_id: bad }, base), /Invalid/);
}
assert.equal(readNativeThumbnail({ 'thumbnail-id': image, 'thumbnail-url': 'https://remote.example/a.png' }), null);

const owner = 'owner';
const rootId = 'r'.repeat(43);
const payload = {
  schema: 'odysee-upload@1.0',
  type: 'upload',
  name: 'image-test',
  timestamp: 100,
  'data-id': 'd'.repeat(43),
  'thumbnail-url': 'https://legacy.example/original.png',
};
const root = normalizeNativeUploadRevision(payload, rootId, owner);
const firstPayload = nativeUploadRevisionMessage(root, root, idMetadata, 'edit');
const first = normalizeNativeUploadRevision(firstPayload, 'a'.repeat(43), owner);
assert.equal(firstPayload['thumbnail-id'], image);
assert.equal(firstPayload['thumbnail-url'], '');
const secondPayload = nativeUploadRevisionMessage(root, first, { title: 'Metadata-only edit' }, 'edit');
const second = normalizeNativeUploadRevision(secondPayload, 'b'.repeat(43), owner);
assert.equal(second.thumbnail_id, image, 'metadata-only changes keep native image');
const thirdPayload = nativeUploadRevisionMessage(root, second, { thumbnail_id: replacement }, 'edit');
const third = normalizeNativeUploadRevision(thirdPayload, 'c'.repeat(43), owner);
const clearPayload = nativeUploadRevisionMessage(root, third, { thumbnail_url: '' }, 'edit');
const clear = normalizeNativeUploadRevision(clearPayload, 'e'.repeat(43), owner);
assert.equal(clear.thumbnail_id, '');
assert.equal(clear.thumbnail_url, '');
assert.equal(latestNativeUploadRevision(root, [first, second, third, clear]).thumbnail_id, '');
assert.equal(latestNativeUploadRevision(root, [first, second]).thumbnail_id, image, 'exact older selection stays old');
assert.equal(root.thumbnail_url, payload['thumbnail-url']);
assert.equal(
  latestNativeUploadRevision(root, [{ ...first, hyperbeam_owner: 'foreign' }]).thumbnail_url,
  payload['thumbnail-url']
);
assert.equal(
  latestNativeUploadRevision(root, [first, { ...second, previous_version: rootId }]).hyperbeam_message_id,
  first.hyperbeam_message_id
);
const urlPayload = nativeUploadRevisionMessage(
  root,
  third,
  { thumbnail_url: 'https://legacy.example/other.png' },
  'edit'
);
delete urlPayload['thumbnail-id']; // Older sparse URL-only writer.
const urlRevision = normalizeNativeUploadRevision(urlPayload, 'u'.repeat(43), owner);
assert.equal(
  latestNativeUploadRevision(root, [first, second, third, urlRevision]).thumbnail_id,
  '',
  'old URL-only revisions replace native images'
);
assert.equal(normalizeNativeUploadRevision({ ...firstPayload, 'thumbnail-id': 'bad' }, image, owner), null);

const verifiedRoot = { messageId: rootId, payload, owner };
const verified = [verifiedRoot, { messageId: first.hyperbeam_message_id, payload: firstPayload, owner }];
const doc = uploadSearchDocuments(verified)[0];
assert.equal(doc.thumbnail_id, image);
assert.equal(doc.thumbnail_url, '');
assert.equal(doc.has_thumbnail, 1);
assert.equal(doc.id, first.hyperbeam_message_id);
const clearFirst = nativeUploadRevisionMessage(root, first, { thumbnail_url: '' }, 'edit');
const cleared = uploadSearchDocuments([...verified, { messageId: 'z'.repeat(43), payload: clearFirst, owner }])[0];
assert.equal(cleared.has_thumbnail, 0);
assert.equal(cleared.thumbnail_id, '');
console.log('Portable thumbnail reference, revision, compatibility, ownership and search tests passed');
