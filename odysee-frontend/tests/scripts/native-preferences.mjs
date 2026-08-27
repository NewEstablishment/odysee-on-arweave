import assert from 'node:assert/strict';

import {
  NATIVE_PREFERENCE_ALGORITHM,
  NATIVE_PREFERENCE_KEY_VERSION,
  NATIVE_PREFERENCE_REFERENCE_TYPE,
  canonicalNativePreferenceReference,
  nativePreferencePlaintext,
  nativePreferenceReferenceInitMessage,
  nativePreferenceReferenceSetMessage,
  nativePreferenceSnapshotMessage,
  normalizeNativePreferenceReference,
  normalizeNativePreferenceSnapshot,
  normalizeNativePreferenceValue,
  parseNativePreferencePlaintext,
  projectNativePreferenceReference,
} from '../../ui/util/nativePreferences.ts';

const owner = id('o');
const snapshotId = id('s');
const nextSnapshotId = id('n');
const envelope = {
  algorithm: NATIVE_PREFERENCE_ALGORITHM,
  key_version: NATIVE_PREFERENCE_KEY_VERSION,
  owner,
  iv: encoded('123456789012'),
  ciphertext: encoded('encrypted preferences'),
  tag: encoded('1234567890123456'),
};

const snapshotMessage = nativePreferenceSnapshotMessage(envelope, 100);
const snapshot = normalizeNativePreferenceSnapshot({
  ...snapshotMessage,
  'message-id': snapshotId,
  'hyperbeam-owner': owner,
});
assert.ok(snapshot);
assert.equal(snapshot.encrypted_for, owner);
assert.equal(JSON.stringify(snapshotMessage).includes('theme'), false, 'public snapshots carry ciphertext only');
assert.throws(() => nativePreferenceSnapshotMessage({ ...envelope, tag: 'invalid' }, 100), /envelope is invalid/);
assert.equal(
  normalizeNativePreferenceSnapshot({ ...snapshotMessage, 'message-id': snapshotId, 'hyperbeam-owner': id('x') }),
  null,
  'the encrypted recipient must be the verified committer'
);

const shared = normalizeNativePreferenceValue(
  'shared',
  JSON.stringify({
    type: 'object',
    version: '0.1',
    value: {
      settings: { theme: 'dark', show_mature: true },
      tags: ['science'],
      sharing_3P: false,
      subscriptions: ['lbry://@must-not-shadow-native'],
      blocked: ['private-block'],
      unpublishedCollections: { private: { title: 'must stay local' } },
    },
  })
);
assert.deepEqual(shared.value.settings, { theme: 'dark', show_mature: true });
assert.deepEqual(shared.value.tags, ['science']);
assert.equal(shared.value.sharing_3P, false);
assert.equal(shared.value.subscriptions, undefined, 'native follows remain authoritative outside preferences');
assert.equal(shared.value.blocked, undefined, 'unsupported moderation state is not synced as a preference');
assert.equal(shared.value.unpublishedCollections, undefined, 'private drafts remain local');

const plaintext = nativePreferencePlaintext({ shared, 'enable-sync': true });
assert.deepEqual(parseNativePreferencePlaintext(plaintext), { shared, 'enable-sync': true });
assert.throws(() => nativePreferencePlaintext({ arbitrary: true }), /Unsupported native preference key/);
assert.throws(() => normalizeNativePreferenceValue('enable-sync', 'yes'), /must be boolean/);
assert.throws(
  () =>
    normalizeNativePreferenceValue('shared', {
      type: 'object',
      version: '0.1',
      value: { settings: undefined },
    }),
  /JSON-compatible/
);

const initMessage = nativePreferenceReferenceInitMessage(snapshotId, 100);
assert.deepEqual(initMessage, {
  device: 'reference@1.0',
  'reference-type': NATIVE_PREFERENCE_REFERENCE_TYPE,
  'reference-value': snapshotId,
  timestamp: 100,
});
assert.throws(() => nativePreferenceReferenceInitMessage('invalid', 100), /reference fields are invalid/);
assert.throws(() => nativePreferenceReferenceSetMessage('invalid', snapshotId, 101), /reference ID is invalid/);
const init = reference(initMessage, id('r'), owner);
const update = reference(nativePreferenceReferenceSetMessage(init.reference_id, nextSnapshotId, 101), id('u'), owner);
assert.equal(projectNativePreferenceReference(init, [update]).reference_value, nextSnapshotId);

const foreign = reference(nativePreferenceReferenceSetMessage(init.reference_id, id('f'), 999), id('a'), id('x'));
assert.equal(projectNativePreferenceReference(init, [update, foreign]).reference_value, nextSnapshotId);

const conflict = reference(nativePreferenceReferenceSetMessage(init.reference_id, id('c'), 101), id('b'), owner);
assert.equal(
  projectNativePreferenceReference(init, [update, conflict]).reference_value,
  snapshotId,
  'equal-timestamp preference conflicts fail closed'
);

const laterDuplicateInit = reference(nativePreferenceReferenceInitMessage(id('d'), 200), id('z'), owner);
assert.equal(
  canonicalNativePreferenceReference([laterDuplicateInit, init], owner)?.message_id,
  init.message_id,
  'the oldest same-owner init is the deterministic canonical preference reference'
);

console.log('native preference contract tests passed');

function reference(message, messageId, messageOwner) {
  const normalized = normalizeNativePreferenceReference({
    ...message,
    'message-id': messageId,
    'hyperbeam-owner': messageOwner,
  });
  assert.ok(normalized);
  return normalized;
}

function encoded(value) {
  return Buffer.from(value).toString('base64url');
}

function id(character) {
  return character.repeat(43);
}
