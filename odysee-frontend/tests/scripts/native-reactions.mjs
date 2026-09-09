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
import {
  LEGACY_REACTION_SUMMARY_SCHEMA,
  LEGACY_REACTION_SUMMARY_SIGNATURE_SCOPE,
  LEGACY_REACTION_SUMMARY_TYPE,
  linkedLegacyReactionForOwner,
  normalizeLegacyReactionSummary,
  projectMergedReactions,
  selectLegacyReactionSummary,
} from '../../ui/util/legacyReactions.ts';

const target = 'content-target';
const ownerA = id('o');
const ownerB = id('p');
const nodeOwner = id('n');
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
const forkA = reaction({
  id: id('h'),
  owner: ownerA,
  ref: rootA.reaction_ref,
  reaction: 'dislike',
  timestamp: 160,
  revision: 1,
  root: rootA.reaction_ref,
  previous: rootA.version_ref,
});
const forkB = reaction({
  id: id('i'),
  owner: ownerA,
  ref: rootA.reaction_ref,
  timestamp: 170,
  revision: 1,
  root: rootA.reaction_ref,
  previous: rootA.version_ref,
});
const conflictingSemanticVersion = {
  ...dislikeA,
  message_id: id('j'),
  reaction: 'like',
};

assert.equal(isNextNativeReactionRevision(rootA, rootA, dislikeA), true);
assert.equal(isNextNativeReactionRevision(rootA, rootA, forgedRevision), false);
assert.equal(isNextNativeReactionRevision(rootA, rootA, skippedRevision), false);
assert.deepEqual(collapseNativeReactionStates([removeA, forgedRevision, duplicateRootA, rootA, dislikeA, likeB]), [
  removeA,
  likeB,
]);
assert.deepEqual(
  collapseNativeReactionStates([rootA, forkA, forkB]),
  [rootA],
  'a revision fork must stop at the last unambiguous version'
);
assert.deepEqual(
  collapseNativeReactionStates([rootA, dislikeA, conflictingSemanticVersion]),
  [rootA],
  'conflicting records for one semantic version must be rejected'
);

const projectedForA = projectNativeReactions([removeA, forgedRevision, rootA, dislikeA, likeB], ownerA);
assert.deepEqual(projectedForA.my_reactions, {});
assert.deepEqual(projectedForA.others_reactions, { [target]: { like: 1, dislike: 0 } });

const projectedForB = projectNativeReactions([rootA, likeB], ownerB);
assert.deepEqual(projectedForB.my_reactions, { [target]: { like: 1, dislike: 0 } });
assert.deepEqual(projectedForB.others_reactions, { [target]: { like: 1, dislike: 0 } });
assert.equal(nativeReactionToggleRemoves(rootA, 'like'), true);
assert.equal(nativeReactionToggleRemoves(rootA, 'dislike'), false);
assert.equal(nativeReactionToggleRemoves(removeA, 'dislike'), false);

const legacySummary = normalizeLegacyReactionSummary({
  schema: LEGACY_REACTION_SUMMARY_SCHEMA,
  type: LEGACY_REACTION_SUMMARY_TYPE,
  target,
  subject: 'content',
  like: 3,
  dislike: 2,
  'linked-reactions': [{ owner: ownerA, reaction: 'like' }],
  'snapshot-at': 200,
  source: 'legacy-odysee-db',
  'signature-scope': LEGACY_REACTION_SUMMARY_SIGNATURE_SCOPE,
  'message-id': id('s'),
  'hyperbeam-owner': nodeOwner,
});
assert.ok(legacySummary);
assert.equal(linkedLegacyReactionForOwner(legacySummary, ownerA), 'like');
assert.deepEqual(projectMergedReactions([], legacySummary, ownerA), {
  current: [],
  my_reactions: { [target]: { like: 1, dislike: 0 } },
  others_reactions: { [target]: { like: 2, dislike: 2 } },
});
assert.deepEqual(projectMergedReactions([rootA, dislikeA], legacySummary, ownerA).my_reactions, {
  [target]: { like: 0, dislike: 1 },
});
assert.deepEqual(projectMergedReactions([rootA, dislikeA], legacySummary, ownerA).others_reactions, {
  [target]: { like: 2, dislike: 2 },
});
assert.deepEqual(projectMergedReactions([rootA, dislikeA, removeA], legacySummary, ownerA).my_reactions, {
  [target]: { like: 0, dislike: 0 },
});
assert.deepEqual(projectMergedReactions([rootA, dislikeA, removeA], legacySummary, ownerA).others_reactions, {
  [target]: { like: 2, dislike: 2 },
});
assert.equal(selectLegacyReactionSummary([legacySummary], nodeOwner, target, 'content'), legacySummary);
assert.equal(selectLegacyReactionSummary([legacySummary], ownerB, target, 'content'), null);
const conflictingSummary = { ...legacySummary, message_id: id('t'), dislike: 3 };
assert.equal(
  selectLegacyReactionSummary([legacySummary, conflictingSummary], nodeOwner, target, 'content'),
  null,
  'conflicting summaries at the same snapshot must fail closed'
);

const removedRoot = reaction({
  id: id('r'),
  owner: ownerA,
  ref: 'reaction-owner-a-removed-root',
  reaction: 'like',
  state: 'removed',
  operation: 'remove',
  timestamp: 210,
});
assert.ok(removedRoot, 'a linked legacy reaction can be removed with the first native event');
assert.deepEqual(projectMergedReactions([removedRoot], legacySummary, ownerA), {
  current: [removedRoot],
  my_reactions: { [target]: { like: 0, dislike: 0 } },
  others_reactions: { [target]: { like: 2, dislike: 2 } },
});

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
assert.equal(
  normalizeLegacyReactionSummary({ ...legacySummary, like: 0 }),
  null,
  'a summary cannot link more likes than its aggregate contains'
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
