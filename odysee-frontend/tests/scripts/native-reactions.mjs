import assert from 'node:assert/strict';

import {
  NATIVE_REACTION_SCHEMA,
  NATIVE_REACTION_SIGNATURE_SCOPE,
  NATIVE_REACTION_TYPE,
  collapseNativeReactionStates,
  isNextNativeReactionRevision,
  nativeReactionToggleRemoves,
  normalizeNativeReaction,
  projectNativeReactions,
} from '../../ui/util/nativeReactions.ts';

const target = 'content-target';
const ownerA = 'owner-a';
const ownerB = 'owner-b';
const rootA = reaction({ id: id('a'), owner: ownerA, ref: 'reaction-owner-a', timestamp: 100 });
const likeB = reaction({ id: id('b'), owner: ownerB, ref: 'reaction-owner-b', timestamp: 110 });
const dislikeA = reaction({
  id: id('c'),
  owner: ownerA,
  ref: rootA.reaction_ref,
  reaction: 'dislike',
  timestamp: 120,
  revision: 1,
  root: rootA.reaction_ref,
  previous: rootA.version_ref,
});
const removeA = reaction({
  id: id('d'),
  owner: ownerA,
  ref: rootA.reaction_ref,
  reaction: 'dislike',
  state: 'removed',
  operation: 'remove',
  timestamp: 130,
  revision: 2,
  root: rootA.reaction_ref,
  previous: dislikeA.version_ref,
});
const forgedRevision = reaction({
  id: id('e'),
  owner: ownerB,
  ref: rootA.reaction_ref,
  timestamp: 140,
  revision: 1,
  root: rootA.reaction_ref,
  previous: rootA.version_ref,
});
const skippedRevision = reaction({
  id: id('f'),
  owner: ownerA,
  ref: rootA.reaction_ref,
  timestamp: 150,
  revision: 3,
  root: rootA.reaction_ref,
  previous: rootA.version_ref,
});
const duplicateRootA = { ...rootA, message_id: id('g') };

assert.equal(isNextNativeReactionRevision(rootA, rootA, dislikeA), true);
assert.equal(isNextNativeReactionRevision(rootA, rootA, forgedRevision), false);
assert.equal(isNextNativeReactionRevision(rootA, rootA, skippedRevision), false);
assert.deepEqual(collapseNativeReactionStates([removeA, forgedRevision, duplicateRootA, rootA, dislikeA, likeB]), [
  removeA,
  likeB,
]);

const projectedForA = projectNativeReactions([removeA, forgedRevision, rootA, dislikeA, likeB], ownerA);
assert.deepEqual(projectedForA.my_reactions, {});
assert.deepEqual(projectedForA.others_reactions, { [target]: { like: 1, dislike: 0 } });

const projectedForB = projectNativeReactions([rootA, likeB], ownerB);
assert.deepEqual(projectedForB.my_reactions, { [target]: { like: 1, dislike: 0 } });
assert.deepEqual(projectedForB.others_reactions, { [target]: { like: 1, dislike: 0 } });
assert.equal(nativeReactionToggleRemoves(rootA, 'like'), true);
assert.equal(nativeReactionToggleRemoves(rootA, 'dislike'), false);
assert.equal(nativeReactionToggleRemoves(removeA, 'dislike'), false);

assert.equal(
  normalizeNativeReaction({ ...rootA, schema: 'forged-schema' }),
  null,
  'unknown schemas must not be counted'
);
assert.equal(
  normalizeNativeReaction({ ...rootA, 'message-id': 'short', message_id: undefined }),
  null,
  'invalid immutable IDs must not be counted'
);

console.log('native reaction projection tests passed');

function reaction({
  id: messageId,
  owner,
  ref,
  reaction: kind = 'like',
  state = 'active',
  operation = 'set',
  timestamp,
  revision = 0,
  root,
  previous,
}) {
  const normalized = normalizeNativeReaction({
    schema: NATIVE_REACTION_SCHEMA,
    type: NATIVE_REACTION_TYPE,
    'reaction-ref': ref,
    target,
    subject: 'content',
    reaction: kind,
    state,
    operation,
    revision,
    'version-ref': `version-${messageId}`,
    'revision-of': root,
    'previous-version': previous,
    'event-timestamp': timestamp,
    'signature-scope': NATIVE_REACTION_SIGNATURE_SCOPE,
    'message-id': messageId,
    'hyperbeam-owner': owner,
  });
  assert.ok(normalized);
  return normalized;
}

function id(character) {
  return character.repeat(43);
}
