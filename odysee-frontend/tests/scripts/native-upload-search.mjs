import assert from 'node:assert/strict';
import {
  uploadSearchDocuments,
  searchId,
  readVerifiedUpload,
  collectUploads,
} from '../../../scripts/native-upload-search.mjs';
import { normalizeNativeUploadRevision, nativeUploadRevisionMessage } from '../../ui/util/nativeUploadRevisions.ts';

const rootId = 'r'.repeat(43);
const editId = 'e'.repeat(43);
const payload = {
  schema: 'odysee-upload@1.0',
  type: 'upload',
  name: 'video',
  title: 'Original',
  description: 'Old',
  'data-id': 'd'.repeat(43),
  'content-type': 'video/mp4',
  timestamp: 100,
};
const root = { messageId: rootId, payload, owner: 'owner' };
const normalized = normalizeNativeUploadRevision(payload, rootId, 'owner');
const editPayload = nativeUploadRevisionMessage(
  normalized,
  normalized,
  { title: 'Renamed', description: '', tags: ['new'], languages: ['fr'] },
  'edit'
);
const edit = { messageId: editId, payload: editPayload, owner: 'owner' };
const editNormalized = normalizeNativeUploadRevision(editPayload, editId, 'owner');
const foreignDelete = {
  messageId: 'f'.repeat(43),
  payload: nativeUploadRevisionMessage(normalized, editNormalized, {}, 'delete'),
  owner: 'foreign',
};
const docs = uploadSearchDocuments([root, edit, foreignDelete]);
assert.equal(docs.length, 1);
assert.equal(docs[0].id, editId, 'result points at an actually stored exact snapshot');
assert.equal(docs[0].search_id, searchId(rootId), 'edits replace one logical search document');
assert.equal(docs[0].description, '');
assert.deepEqual(docs[0].tags, ['new']);
assert.deepEqual(docs[0].language, ['fr']);
assert.equal(docs[0].release_time, 100);
assert.deepEqual(uploadSearchDocuments([root, edit, { ...foreignDelete, owner: 'owner' }]), []);
assert.equal(
  uploadSearchDocuments([
    root,
    edit,
    { ...edit, messageId: 'g'.repeat(43), payload: { ...editPayload, title: 'Fork' } },
  ])[0].id,
  rootId
);
assert.deepEqual(
  uploadSearchDocuments([root, edit]),
  uploadSearchDocuments([root, edit, edit]),
  'reconciliation is idempotent'
);
const request = async (url) =>
  new Response(JSON.stringify(url.includes('/verify') ? false : url.endsWith('/committer') ? 'owner' : payload), {
    headers: { 'content-type': 'application/json' },
  });
assert.equal(await readVerifiedUpload('http://test', rootId, request), null, 'unverified records never index');
await assert.rejects(
  () => collectUploads('http://test', async () => new Response('', { status: 503 })),
  /discovery failed/
);
await assert.rejects(
  () => readVerifiedUpload('http://test', rootId, async () => new Response('', { status: 503 })),
  /Exact upload read failed/
);
console.log('native upload search authority and locator tests passed');

await assert.rejects(
  () => readVerifiedUpload('http://test', rootId, async () => new Response('', { status: 404 })),
  /Exact upload read failed/,
  'unavailable discovered evidence aborts reconciliation rather than deleting its search document'
);
