import assert from 'node:assert/strict';

import {
  NATIVE_SUBSCRIPTION_SCHEMA,
  NATIVE_SUBSCRIPTION_SIGNATURE_SCOPE,
  NATIVE_SUBSCRIPTION_TYPE,
  activeNativeSubscriptions,
  collapseNativeSubscriptionStates,
  isNextNativeSubscriptionRevision,
  nativeSubscriptionChannelRef,
  nativeSubscriptionNotificationsDisabled,
  nativeSubscriptionRef,
  normalizeNativeSubscription,
} from '../../ui/util/nativeSubscriptions.ts';

const owner = id('o');
const attacker = id('a');
const profileId = id('p');
const channelId = 'b'.repeat(40);
const channelRef = nativeSubscriptionChannelRef(channelId);
const subscriptionRef = nativeSubscriptionRef(owner, channelRef);
const root = subscription({ id: id('r'), owner, version: 'version-root-0001', updatedAt: 100 });
const notificationUpdate = subscription({
  id: id('n'),
  owner,
  version: 'version-update-01',
  revision: 1,
  previous: root.version_ref,
  notificationsDisabled: false,
  operation: 'update',
  updatedAt: 110,
});
const unfollow = subscription({
  id: id('u'),
  owner,
  version: 'version-remove-01',
  revision: 2,
  previous: notificationUpdate.version_ref,
  notificationsDisabled: false,
  operation: 'unfollow',
  state: 'removed',
  updatedAt: 120,
});
const refollow = subscription({
  id: id('f'),
  owner,
  version: 'version-refollow-1',
  revision: 3,
  previous: unfollow.version_ref,
  notificationsDisabled: true,
  operation: 'follow',
  updatedAt: 130,
});
const foreignRevision = subscription({
  id: id('x'),
  owner: attacker,
  ref: subscriptionRef,
  version: 'version-foreign-01',
  revision: 1,
  previous: root.version_ref,
  operation: 'update',
  updatedAt: 115,
  allowInvalid: true,
});

assert.equal(isNextNativeSubscriptionRevision(root, root, notificationUpdate), true);
assert.equal(foreignRevision, null, 'a foreign committer cannot revise another owner relationship');
assert.deepEqual(
  collapseNativeSubscriptionStates([refollow, unfollow, notificationUpdate, root]),
  [refollow],
  'unfollow and re-follow remain one contiguous relationship chain'
);
assert.deepEqual(activeNativeSubscriptions([unfollow, notificationUpdate, root]), []);
assert.deepEqual(activeNativeSubscriptions([refollow, unfollow, notificationUpdate, root]), [refollow]);

const fork = subscription({
  id: id('k'),
  owner,
  version: 'version-fork-0001',
  revision: 1,
  previous: root.version_ref,
  operation: 'update',
  updatedAt: 111,
});
assert.deepEqual(
  collapseNativeSubscriptionStates([fork, notificationUpdate, root]),
  [root],
  'ambiguous same-owner revisions fail closed at the last unambiguous state'
);

const duplicateRoot = { ...root, message_id: id('d') };
assert.deepEqual(collapseNativeSubscriptionStates([duplicateRoot, root]), [duplicateRoot]);
assert.deepEqual(
  collapseNativeSubscriptionStates([{ ...root, channel_name: '@forged', message_id: id('c') }, root]),
  [],
  'conflicting physical representations of one semantic version fail closed'
);

const imported = subscription({
  id: id('i'),
  owner,
  ref: nativeSubscriptionRef(owner, `native:${id('t')}`),
  channelRef: `native:${id('t')}`,
  channelUri: `lbry://@imported#${id('t')}`,
  version: 'version-import-001',
  origin: 'legacy-import',
  importedAt: 90,
  updatedAt: 100,
});
assert.equal(imported.origin, 'legacy-import');
assert.equal(
  normalizeNativeSubscription({ ...imported, 'imported-at': undefined, imported_at: undefined }),
  null,
  'legacy imports require explicit provenance time'
);
assert.equal(
  normalizeNativeSubscription({ ...root, 'channel-uri': 'https://example.com', channel_uri: undefined }),
  null,
  'only canonical lbry channel URIs are accepted for UI hydration'
);
assert.throws(() => nativeSubscriptionChannelRef('short-id'), /stable native profile ID/);
assert.equal(nativeSubscriptionNotificationsDisabled(undefined), true, 'omitted preferences default notifications off');
assert.equal(nativeSubscriptionNotificationsDisabled(true), true);
assert.equal(nativeSubscriptionNotificationsDisabled(false), false, 'an explicit bell opt-in must be preserved');

console.log('native subscription projection tests passed');

function subscription({
  id: messageId,
  owner: messageOwner,
  ref = subscriptionRef,
  channelRef: targetRef = channelRef,
  channelUri = `lbry://@channel#${channelId}`,
  version,
  revision = 0,
  previous,
  notificationsDisabled = true,
  operation = revision ? 'update' : 'follow',
  state = 'active',
  origin = 'native',
  importedAt,
  updatedAt,
  allowInvalid = false,
}) {
  const normalized = normalizeNativeSubscription({
    schema: NATIVE_SUBSCRIPTION_SCHEMA,
    type: NATIVE_SUBSCRIPTION_TYPE,
    'subscription-ref': ref,
    'channel-ref': targetRef,
    'channel-uri': channelUri,
    'channel-name': '@channel',
    'profile-id': profileId,
    'profile-name': 'Follower',
    'notifications-disabled': notificationsDisabled,
    state,
    operation,
    origin,
    'imported-at': importedAt,
    revision,
    'version-ref': version,
    'revision-of': revision ? ref : undefined,
    'previous-version': previous,
    'created-at': 100,
    'updated-at': updatedAt,
    'signature-scope': NATIVE_SUBSCRIPTION_SIGNATURE_SCOPE,
    'message-id': messageId,
    'hyperbeam-owner': messageOwner,
  });
  if (!allowInvalid) assert.ok(normalized);
  return normalized;
}

function id(character) {
  return character.repeat(43);
}
