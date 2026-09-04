import assert from 'node:assert/strict';
import {
  collapseNativeUploadRevisions,
  isNextNativeUploadRevision,
  latestNativeUploadRevision,
  nativeUploadRevisionMessage,
  normalizeNativeUploadRevision,
} from '../../ui/util/nativeUploadRevisions.ts';

const root = normalizeNativeUploadRevision(
  {
    schema: 'odysee-upload@1.0',
    type: 'upload',
    name: 'test-video',
    'data-id': 'data-1',
    'channel-id': 'channel-a',
    'channel-name': '@channel-a',
    timestamp: 100,
    title: 'Original title',
  },
  'root-id',
  'owner-a'
);
assert.ok(root);
assert.equal(root.record_id, 'root-id');
assert.equal(root.state, 'active');

const editMessage = nativeUploadRevisionMessage(root, root, { title: 'Edited title' }, 'edit');
assert.equal(editMessage['revision-of'], 'root-id');
assert.equal(editMessage['previous-version'], 'root-id');
assert.equal(editMessage.revision, 1);
assert.equal(editMessage.operation, 'edit');
assert.equal(editMessage.state, 'active');
assert.equal(editMessage['data-id'], 'data-1');
assert.equal(editMessage['channel-id'], 'channel-a');
assert.equal(Number(editMessage.timestamp), 100);

const revisionOne = normalizeNativeUploadRevision(editMessage, 'rev-1', 'owner-a');
assert.ok(revisionOne);
assert.equal(isNextNativeUploadRevision(root, root, revisionOne), true);

const foreignRevision = { ...revisionOne, hyperbeam_message_id: 'foreign', hyperbeam_owner: 'owner-b' };
assert.equal(isNextNativeUploadRevision(root, root, foreignRevision), false, 'a foreign signer must be rejected');

const retargetedRevision = { ...revisionOne, hyperbeam_message_id: 'retarget', data_id: 'data-other' };
assert.equal(isNextNativeUploadRevision(root, root, retargetedRevision), false, 'the data-id is pinned to the root');

const deleteMessage = nativeUploadRevisionMessage(root, revisionOne, {}, 'delete');
assert.equal(deleteMessage.state, 'deleted');
assert.equal(deleteMessage.operation, 'delete');
assert.equal(deleteMessage.revision, 2);
assert.equal(deleteMessage['previous-version'], revisionOne.version_ref || 'rev-1');
assert.equal(deleteMessage.title, undefined, 'a tombstone carries no metadata');

const deletion = normalizeNativeUploadRevision(deleteMessage, 'rev-2', 'owner-a');
assert.ok(deletion);
assert.equal(isNextNativeUploadRevision(root, revisionOne, deletion), true);
assert.equal(latestNativeUploadRevision(root, [deletion, revisionOne]), deletion);
assert.equal(
  isNextNativeUploadRevision(root, deletion, { ...deletion, hyperbeam_message_id: 'rev-3', revision: 3 }),
  false,
  'nothing may follow a deletion'
);
assert.throws(
  () => nativeUploadRevisionMessage(root, deletion, { title: 'no' }, 'edit'),
  /already been deleted/,
  'a deleted upload cannot be edited'
);

const forkA = { ...revisionOne, hyperbeam_message_id: 'fork-a', version_ref: 'fork-a-ref' };
const forkB = { ...revisionOne, hyperbeam_message_id: 'fork-b', version_ref: 'fork-b-ref' };
assert.equal(latestNativeUploadRevision(root, [forkA, forkB]), root, 'a fork stops at the last unambiguous version');

const tips = collapseNativeUploadRevisions([root, revisionOne, foreignRevision]);
assert.equal(tips.length, 1);
assert.equal(tips[0], revisionOne, 'collapse keeps the legal tip and drops the forged branch');

const deletedTips = collapseNativeUploadRevisions([root, revisionOne, deletion]);
assert.equal(deletedTips.length, 1);
assert.equal(deletedTips[0].state, 'deleted', 'a deleted chain collapses to its tombstone tip');

console.log('native upload revision tests passed');
