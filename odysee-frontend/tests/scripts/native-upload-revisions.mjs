import assert from 'node:assert/strict';
import {
  collapseNativeUploadRevisions,
  isNextNativeUploadRevision,
  latestNativeUploadRevision,
  nativeUploadRevisionMessage,
  normalizeNativeUploadRevision,
  nativeUploadTipMetadata,
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
assert.equal(deleteMessage['previous-version'], 'rev-1', 'new revisions link exact immutable predecessors');
assert.equal(deleteMessage.title, undefined, 'a tombstone carries no metadata');

const deletion = normalizeNativeUploadRevision(deleteMessage, 'rev-2', 'owner-a');
assert.ok(deletion);
assert.equal(isNextNativeUploadRevision(root, revisionOne, deletion), true);
assert.equal(
  latestNativeUploadRevision(root, [deletion, revisionOne]).hyperbeam_message_id,
  deletion.hyperbeam_message_id
);
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
assert.equal(
  tips[0].hyperbeam_message_id,
  revisionOne.hyperbeam_message_id,
  'collapse keeps the legal tip and drops the forged branch'
);

const deletedTips = collapseNativeUploadRevisions([root, revisionOne, deletion]);
assert.equal(deletedTips.length, 1);
assert.equal(deletedTips[0].state, 'deleted', 'a deleted chain collapses to its tombstone tip');

console.log('native upload revision tests passed');

const clearedMessage = nativeUploadRevisionMessage(
  root,
  revisionOne,
  { description: '', thumbnail_url: '', tags: ['new'], languages: ['fr'] },
  'edit'
);
assert.equal(clearedMessage.title, 'Edited title', 'partial edits retain previously edited values');
assert.equal(clearedMessage.description, '');
assert.equal(clearedMessage['thumbnail-url'], '');
assert.deepEqual(clearedMessage.tags, ['new']);
assert.deepEqual(clearedMessage.languages, ['fr']);
const cleared = normalizeNativeUploadRevision(clearedMessage, 'cleared', 'owner-a');
assert.deepEqual(nativeUploadTipMetadata(cleared).tags, ['new']);
const emptyLists = nativeUploadRevisionMessage(root, cleared, { tags: [], languages: [] }, 'edit');
assert.deepEqual(emptyLists.tags, []);
assert.deepEqual(emptyLists.languages, []);
assert.equal(emptyLists.description, '');
assert.equal(
  latestNativeUploadRevision(root, [revisionOne, { ...revisionOne, hyperbeam_message_id: 'alias' }]).revision,
  1,
  'equivalent commitment locators are not a fork'
);
assert.equal(
  latestNativeUploadRevision(root, [
    revisionOne,
    { ...revisionOne, title: 'equivocation', hyperbeam_message_id: 'conflict' },
  ]).revision,
  0,
  'same version ref with different content is a conflict'
);

const { serializeUploadWrite, rememberUploadVersion, uploadVersionHints } =
  await import('../../ui/util/nativeUploadWrites.ts');
const stored = new Map([['root-id', root]]);
const key = 'test-owner-upload';
await Promise.all(
  ['first', 'second'].map((title) =>
    serializeUploadWrite(key, async () => {
      // The simulated query index deliberately returns only the root.
      const acknowledged = uploadVersionHints(key).map((id) => stored.get(id));
      const current = latestNativeUploadRevision(root, acknowledged);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const message = nativeUploadRevisionMessage(root, current, { title }, 'edit');
      const next = normalizeNativeUploadRevision(message, title, 'owner-a');
      stored.set(title, next);
      rememberUploadVersion(key, title);
    })
  )
);
assert.equal(latestNativeUploadRevision(root, [...stored.values()]).revision, 2);
assert.equal(latestNativeUploadRevision(root, [...stored.values()]).title, 'second');
assert.deepEqual(uploadVersionHints('different-owner'), []);
