import assert from 'node:assert/strict';

import { isNextNativePlaylistRevision, latestNativePlaylistRevision } from '../../ui/util/nativePlaylistRevisions.ts';

const root = {
  schema: 'odysee-playlist@1',
  type: 'playlist',
  state: 'active',
  revision: 0,
  'message-id': 'root-id',
  'version-ref': 'root-version',
  owner: 'owner-a',
  title: 'Original playlist',
  items: 'claim-a',
};
const revisionOne = {
  ...root,
  revision: 1,
  'message-id': 'revision-one',
  'version-ref': 'revision-one-version',
  'revision-of': 'root-id',
  'previous-version': 'root-version',
  'revision-timestamp': 100,
  title: 'Updated playlist',
};
const revisionTwo = {
  ...revisionOne,
  revision: 2,
  'message-id': 'revision-two',
  'version-ref': 'revision-two-version',
  'previous-version': 'revision-one-version',
  'revision-timestamp': 200,
  items: 'claim-a,claim-b',
};

assert.equal(isNextNativePlaylistRevision(root, root, revisionOne), true);
assert.equal(isNextNativePlaylistRevision(root, root, { ...revisionOne, owner: 'attacker' }), false);
assert.equal(isNextNativePlaylistRevision(root, root, { ...revisionOne, revision: 2 }), false);
assert.equal(isNextNativePlaylistRevision(root, root, { ...revisionOne, 'previous-version': 'wrong-version' }), false);
assert.equal(isNextNativePlaylistRevision(root, root, { ...revisionOne, state: 'deleted' }), false);
assert.equal(latestNativePlaylistRevision(root, [revisionTwo, revisionOne]), revisionTwo);

const earlierFork = { ...revisionOne, 'message-id': 'fork-a', 'revision-timestamp': 150 };
const laterFork = { ...revisionOne, 'message-id': 'fork-b', 'revision-timestamp': 250 };
assert.equal(latestNativePlaylistRevision(root, [laterFork, earlierFork]), laterFork);

console.log('native playlist revision projection tests passed');
