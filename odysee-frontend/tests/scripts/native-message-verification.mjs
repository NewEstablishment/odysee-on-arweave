import assert from 'node:assert/strict';

import {
  isNativeMessageId,
  nativeMessageVersionRef,
  verifyNativeMessage,
} from '../../ui/util/nativeMessageVerification.ts';

const messageId = 'a'.repeat(43);
const payload = { schema: 'example@1.0', type: 'example' };
const calls = [];
const dependencies = {
  loadPayload: async (id) => {
    calls.push(['payload', id]);
    return payload;
  },
  verifyCommitment: async (id) => {
    calls.push(['verify', id]);
    return true;
  },
  loadCommitter: async (id) => {
    calls.push(['committer', id]);
    return 'owner-a';
  },
};

assert.equal(isNativeMessageId(messageId), true);
assert.equal(isNativeMessageId('short'), false);
assert.deepEqual(await verifyNativeMessage(`/${messageId}`, dependencies), {
  messageId,
  payload,
  owner: 'owner-a',
  committers: ['owner-a'],
});
assert.deepEqual(calls.map(([operation]) => operation).sort(), ['committer', 'payload', 'verify']);

let knownPayloadRead = false;
assert.equal(
  (
    await verifyNativeMessage(
      messageId,
      { ...dependencies, loadPayload: async () => ((knownPayloadRead = true), payload) },
      payload
    )
  )?.payload,
  payload
);
assert.equal(knownPayloadRead, false);

assert.equal(await verifyNativeMessage(messageId, { ...dependencies, verifyCommitment: async () => false }), null);
assert.equal(await verifyNativeMessage(messageId, { ...dependencies, loadCommitter: async () => null }), null);
assert.equal(
  await verifyNativeMessage(messageId, {
    ...dependencies,
    verifyCommitment: async () => {
      throw new Error('verification transport failed');
    },
  }),
  null
);

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

const versionRefA = nativeMessageVersionRef();
const versionRefB = nativeMessageVersionRef();
assert.ok(versionRefA.length >= 32);
assert.notEqual(versionRefA, versionRefB);

console.log('native message verification tests passed');
