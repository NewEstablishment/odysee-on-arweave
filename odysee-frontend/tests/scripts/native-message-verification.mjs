import assert from 'node:assert/strict';

import {
  isNativeMessageId,
  nativeMessageVersionRef,
  verifiedNativeOwnerMatches,
  verifyNativeMessage,
} from '../../ui/util/nativeMessageVerification.ts';

const messageId = 'a'.repeat(43);
const payload = { schema: 'example@1.0', type: 'example' };
const dependencies = {
  loadPayload: async () => payload,
  verifyCommitment: async () => true,
  loadCommitter: async () => 'owner-a',
};

assert.equal(isNativeMessageId(messageId), true);
assert.equal(isNativeMessageId('short'), false);
assert.deepEqual(await verifyNativeMessage(`/${messageId}`, dependencies), {
  messageId,
  payload,
  owner: 'owner-a',
  committers: ['owner-a'],
});
assert.equal(await verifyNativeMessage(messageId, { ...dependencies, verifyCommitment: async () => false }), null);
assert.equal(await verifyNativeMessage(messageId, { ...dependencies, loadCommitter: async () => null }), null);
assert.equal(verifiedNativeOwnerMatches('owner-a', 'owner-a'), true);
assert.equal(verifiedNativeOwnerMatches('owner-b', 'owner-a'), false);
assert.equal(verifiedNativeOwnerMatches('owner-a', null), false);

let invalidCalled = false;
assert.equal(
  await verifyNativeMessage('not-an-id', {
    loadPayload: async () => ((invalidCalled = true), payload),
    verifyCommitment: async () => ((invalidCalled = true), true),
    loadCommitter: async () => ((invalidCalled = true), 'owner-a'),
  }),
  null
);
assert.equal(invalidCalled, false);

const referenceA = nativeMessageVersionRef();
const referenceB = nativeMessageVersionRef();
assert.ok(referenceA.length >= 32);
assert.notEqual(referenceA, referenceB);

console.log('native message verification tests passed');
