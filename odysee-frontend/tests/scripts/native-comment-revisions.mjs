import assert from 'node:assert/strict';
import {
  collapseNativeCommentRevisions,
  isNextNativeCommentRevision,
  latestNativeCommentRevision,
  nativeCommentSignatureData,
} from '../../ui/util/nativeCommentRevisions.ts';

const root = {
  comment_id: 'root-id',
  comment_ref: 'root-id',
  hyperbeam_message_id: 'root-id',
  version_ref: 'root-version',
  hyperbeam_owner: 'owner-a',
  channel_id: 'channel-a',
  claim_id: 'claim-a',
  timestamp: 100,
  state: 'active',
  comment: 'original',
};
const revisionOne = revision(root, root, 'revision-1', 1, 200, 'first edit');
const revisionTwo = revision(root, revisionOne, 'revision-2', 2, 300, 'second edit');
const deletion = {
  ...revision(root, revisionTwo, 'deletion', 3, 400, ''),
  operation: 'delete',
  state: 'deleted',
};
const foreignRevision = { ...revisionOne, hyperbeam_message_id: 'foreign', hyperbeam_owner: 'owner-b' };
const skippedRevision = { ...revisionTwo, hyperbeam_message_id: 'skipped', revision: 3 };
const forkA = revision(root, root, 'fork-a', 1, 400, 'fork A');
const forkB = revision(root, root, 'fork-b', 1, 500, 'fork B');

assert.equal(isNextNativeCommentRevision(root, root, revisionOne), true);
assert.equal(isNextNativeCommentRevision(root, root, foreignRevision), false);
assert.equal(isNextNativeCommentRevision(root, root, skippedRevision), false);
assert.equal(latestNativeCommentRevision(root, [revisionTwo, revisionOne]), revisionTwo);
assert.equal(isNextNativeCommentRevision(root, revisionTwo, deletion), true);
assert.equal(isNextNativeCommentRevision(root, deletion, { ...deletion, revision: 4 }), false);
assert.equal(latestNativeCommentRevision(root, [deletion, revisionTwo, revisionOne]), deletion);
assert.equal(
  latestNativeCommentRevision(root, [forkB, forkA]),
  root,
  'a fork must stop at the last unambiguous version'
);
assert.deepEqual(collapseNativeCommentRevisions([revisionTwo, foreignRevision, root, revisionOne, revisionOne]), [
  revisionTwo,
]);
assert.deepEqual(collapseNativeCommentRevisions([foreignRevision]), []);

const signedRawRevision = {
  schema: 'odysee-comment@1.0',
  type: 'comment',
  'comment-ref': 'root-id',
  target: 'claim-a',
  parent: 'root',
  state: 'active',
  author: 'channel-a',
  comment: 'first edit',
  timestamp: 100,
  'revision-of': 'root-id',
  'previous-version': 'root-id',
  'version-ref': 'revision-version',
  revision: 1,
  'revision-timestamp': 200,
  operation: 'edit',
  'signature-scope': 'native-comment-v1',
};
const signedNormalizedRevision = {
  schema: 'odysee-comment@1.0',
  type: 'comment',
  comment_ref: 'root-id',
  claim_id: 'claim-a',
  parent_id: undefined,
  state: 'active',
  channel_id: 'channel-a',
  comment: 'first edit',
  timestamp: 100,
  revision_of: 'root-id',
  previous_version: 'root-id',
  version_ref: 'revision-version',
  revision: 1,
  revision_timestamp: 200,
  operation: 'edit',
  signature_scope: 'native-comment-v1',
};
assert.equal(nativeCommentSignatureData(signedRawRevision), nativeCommentSignatureData(signedNormalizedRevision));
assert.notEqual(
  nativeCommentSignatureData(signedRawRevision),
  nativeCommentSignatureData({ ...signedRawRevision, 'previous-version': 'other-version' })
);
const signedRawRoot = {
  schema: 'odysee-comment@1.0',
  type: 'comment',
  'comment-ref': 'root-id',
  target: 'claim-a',
  parent: 'root',
  state: 'active',
  author: 'channel-a',
  comment: 'original',
  timestamp: 100,
  'signature-scope': 'native-comment-v1',
};
const signedNormalizedRoot = {
  schema: 'odysee-comment@1.0',
  type: 'comment',
  comment_ref: 'root-id',
  claim_id: 'claim-a',
  parent_id: undefined,
  state: 'active',
  channel_id: 'channel-a',
  comment: 'original',
  timestamp: 100,
  signature_scope: 'native-comment-v1',
};
assert.equal(nativeCommentSignatureData(signedRawRoot), nativeCommentSignatureData(signedNormalizedRoot));
assert.notEqual(
  nativeCommentSignatureData(signedRawRoot),
  nativeCommentSignatureData({ ...signedRawRoot, target: 'other' })
);
assert.equal(nativeCommentSignatureData({ comment: 'legacy text' }), 'legacy text');

console.log('native comment revision tests passed');

function revision(rootComment, previous, id, number, timestamp, comment) {
  return {
    ...rootComment,
    comment_id: rootComment.comment_id,
    hyperbeam_message_id: id,
    revision_of: rootComment.comment_id,
    previous_version: previous.version_ref || previous.hyperbeam_message_id,
    version_ref: `${id}-version`,
    revision: number,
    revision_timestamp: timestamp,
    operation: 'edit',
    comment,
  };
}
