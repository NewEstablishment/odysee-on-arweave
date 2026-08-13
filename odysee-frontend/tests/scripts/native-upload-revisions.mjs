import assert from 'node:assert/strict';

import { isNextNativeUploadRevision, latestNativeUploadRevision } from '../../ui/util/nativeUploadRevisions.ts';

const root = {
  schema: 'odysee-upload@1.0',
  type: 'upload',
  state: 'active',
  revision: 0,
  'message-id': 'root-id',
  'version-ref': 'root-version',
  owner: 'owner-a',
  'data-id': 'media-id',
  name: 'video-name',
  timestamp: 100,
  title: 'Original',
};

const update = {
  ...root,
  revision: 1,
  'message-id': 'update-id',
  'version-ref': 'update-version',
  'revision-of': 'root-id',
  'previous-version': 'root-version',
  'revision-timestamp': 200,
  operation: 'update',
  title: 'Updated',
};

const deletion = {
  ...update,
  revision: 2,
  'message-id': 'delete-id',
  'version-ref': 'delete-version',
  'previous-version': 'update-version',
  'revision-timestamp': 300,
  operation: 'delete',
  state: 'deleted',
};

assert.equal(isNextNativeUploadRevision(root, root, update), true);
assert.equal(latestNativeUploadRevision(root, [deletion, update])['message-id'], 'delete-id');

assert.equal(isNextNativeUploadRevision(root, root, { ...update, owner: 'attacker' }), false);
assert.equal(isNextNativeUploadRevision(root, root, { ...update, 'data-id': 'replacement-media' }), false);
assert.equal(isNextNativeUploadRevision(root, root, { ...update, revision: 2 }), false);
assert.equal(isNextNativeUploadRevision(root, root, { ...update, name: 'hijacked-name' }), false);
assert.equal(isNextNativeUploadRevision(root, root, { ...update, timestamp: 101 }), false);
assert.equal(isNextNativeUploadRevision(root, root, { ...update, operation: 'delete', state: 'active' }), false);

const earlierFork = { ...update, 'message-id': 'fork-a', 'revision-timestamp': 150 };
const laterFork = { ...update, 'message-id': 'fork-b', 'revision-timestamp': 250 };
assert.equal(latestNativeUploadRevision(root, [laterFork, earlierFork])['message-id'], 'fork-b');

const afterDelete = {
  ...deletion,
  revision: 3,
  'message-id': 'resurrection-id',
  'version-ref': 'resurrection-version',
  'previous-version': 'delete-version',
  'revision-timestamp': 400,
  operation: 'update',
  state: 'active',
};
assert.equal(latestNativeUploadRevision(root, [update, deletion, afterDelete])['message-id'], 'delete-id');

console.log('native upload revision projection tests passed');
