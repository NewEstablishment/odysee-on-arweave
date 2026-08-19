import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  NATIVE_SUBSCRIPTION_SCHEMA,
  NATIVE_SUBSCRIPTION_SIGNATURE_SCOPE,
  activeNativeSubscriptions,
  collapseNativeSubscriptionStates,
  nativeSubscriptionChannelRef,
  nativeSubscriptionRef,
  normalizeNativeSubscription,
} from '../../ui/util/nativeSubscriptions.ts';

const nodeBase = String(process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18801').replace(/\/+$/, '');
const channelId = randomUUID().replace(/-/g, '').padEnd(40, '0').slice(0, 40);
const channelRef = nativeSubscriptionChannelRef(channelId);
const channelUri = `lbry://@subscription-smoke#${channelId}`;
const relationshipCreatedAt = Date.now();

const profileAName = `subscriber-a-${Date.now()}`;
const profileA = await write({ type: 'channel', name: profileAName });
const ownerA = await committer(profileA.id);
const subscriptionRef = nativeSubscriptionRef(ownerA, channelRef);
const rootVersion = randomUUID();
const root = await write(
  subscriptionMessage({
    subscriptionRef,
    profileId: profileA.id,
    version: rootVersion,
  }),
  profileA.cookie
);
assert.equal(await verified(root.id), true);
assert.equal(await committer(root.id), ownerA);

const notificationUpdate = await write(
  subscriptionMessage({
    subscriptionRef,
    profileId: profileA.id,
    version: randomUUID(),
    revision: 1,
    previous: rootVersion,
    notificationsDisabled: false,
    operation: 'update',
  }),
  profileA.cookie
);
const notificationVersion = unwrap(await read(notificationUpdate.id))['version-ref'];

const unfollow = await write(
  subscriptionMessage({
    subscriptionRef,
    profileId: profileA.id,
    version: randomUUID(),
    revision: 2,
    previous: notificationVersion,
    notificationsDisabled: false,
    operation: 'unfollow',
    state: 'removed',
  }),
  profileA.cookie
);
const unfollowVersion = unwrap(await read(unfollow.id))['version-ref'];

const refollow = await write(
  subscriptionMessage({
    subscriptionRef,
    profileId: profileA.id,
    version: randomUUID(),
    revision: 3,
    previous: unfollowVersion,
    operation: 'follow',
  }),
  profileA.cookie
);
const refollowVersion = unwrap(await read(refollow.id))['version-ref'];

const profileB = await write({ type: 'channel', name: `subscriber-b-${Date.now()}` });
const ownerB = await committer(profileB.id);
assert.notEqual(ownerA, ownerB);
const forged = await write(
  subscriptionMessage({
    subscriptionRef,
    profileId: profileA.id,
    version: randomUUID(),
    revision: 4,
    previous: refollowVersion,
    operation: 'unfollow',
    state: 'removed',
  }),
  profileB.cookie
);
assert.equal(await committer(forged.id), ownerB);

const paths = await query({
  schema: NATIVE_SUBSCRIPTION_SCHEMA,
  type: 'subscription',
  'subscription-ref': subscriptionRef,
});
const hydrated = await Promise.all(
  paths.map(async (id) => {
    const payload = unwrap(await read(id));
    return normalizeNativeSubscription({
      ...payload,
      'message-id': id,
      'hyperbeam-owner': await committer(id),
    });
  })
);
for (const id of paths) assert.equal(await verified(id), true);
const subscriptions = hydrated.filter(Boolean);
assert.equal(subscriptions.length, 4, 'the foreign revision must fail owner-bound normalization');
const current = collapseNativeSubscriptionStates(subscriptions);
assert.equal(current.length, 1);
assert.equal(current[0].version_ref, refollowVersion);
assert.equal(current[0].state, 'active');
assert.equal(current[0].notifications_disabled, true);
assert.deepEqual(activeNativeSubscriptions(subscriptions), current);

console.log(
  JSON.stringify({
    channel_ref: channelRef,
    owner_a: ownerA,
    owner_b: ownerB,
    follow_message_id: root.id,
    notification_message_id: notificationUpdate.id,
    unfollow_message_id: unfollow.id,
    refollow_message_id: refollow.id,
    forged_revision_ignored: true,
  })
);

function subscriptionMessage({
  subscriptionRef,
  profileId,
  version,
  revision = 0,
  previous,
  notificationsDisabled = true,
  operation = revision ? 'update' : 'follow',
  state = 'active',
}) {
  const timestamp = Date.now();
  return {
    schema: NATIVE_SUBSCRIPTION_SCHEMA,
    type: 'subscription',
    'subscription-ref': subscriptionRef,
    'channel-ref': channelRef,
    'channel-uri': channelUri,
    'channel-name': '@subscription-smoke',
    'profile-id': profileId,
    'profile-name': profileAName,
    'notifications-disabled': notificationsDisabled,
    state,
    operation,
    origin: 'native',
    revision,
    'version-ref': version,
    ...(revision ? { 'revision-of': subscriptionRef } : {}),
    ...(previous ? { 'previous-version': previous } : {}),
    'created-at': relationshipCreatedAt,
    'updated-at': timestamp,
    'signature-scope': NATIVE_SUBSCRIPTION_SIGNATURE_SCOPE,
  };
}

async function write(message, cookie) {
  const response = await fetch(`${nodeBase}/id?!=true&committers=all`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(message),
  });
  const body = await response.text();
  assert.equal(response.ok, true, `write failed: ${response.status} ${body.slice(0, 500)}`);
  const id = response.headers.get('message-id') || scalar(body);
  assert.match(id, /^[0-9A-Za-z_-]{41,128}$/);
  return { id, cookie: cookie || cookiePair(response.headers.get('set-cookie')) };
}

async function read(id) {
  const response = await fetch(`${nodeBase}/${encodeURIComponent(id)}?accept-bundle=true`, {
    headers: { accept: 'application/json' },
  });
  const text = await response.text();
  assert.equal(response.ok, true, `read failed: ${response.status} ${text.slice(0, 500)}`);
  const parsed = parse(text);
  return parsed && typeof parsed === 'object'
    ? { ...Object.fromEntries(response.headers.entries()), ...parsed }
    : { ...Object.fromEntries(response.headers.entries()), body: parsed };
}

async function verified(id) {
  const response = await fetch(`${nodeBase}/${id}/verify?commitment-ids=${id}`);
  return response.ok && String(scalar(await response.text())).toLowerCase() === 'true';
}

async function committer(id) {
  const response = await fetch(`${nodeBase}/${id}/commitments/${id}/committer`);
  assert.equal(response.ok, true, `committer lookup failed for ${id}`);
  return String(scalar(await response.text()))
    .replace(/^"|"$/g, '')
    .trim();
}

async function query(selectors) {
  const response = await fetch(`${nodeBase}/~query@1.0/only`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ ...selectors, only: [...Object.keys(selectors), 'accept'], return: 'paths' }),
  });
  const text = await response.text();
  assert.equal(response.ok, true, `query failed: ${response.status} ${text.slice(0, 500)}`);
  const payload = unwrap(parse(text));
  if (Array.isArray(payload)) return payload.map(String);
  return Object.keys(payload || {})
    .filter((key) => /^\d+$/.test(key))
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => String(payload[key]).replace(/^\/+/, ''));
}

function cookiePair(setCookie) {
  return String(setCookie || '').split(';', 1)[0];
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function unwrap(value) {
  if (value && typeof value === 'object' && value['ao-result'] === 'body') return unwrap(value.body);
  if (value && typeof value === 'object' && value.body !== undefined && Object.keys(value).length === 1) {
    return unwrap(value.body);
  }
  return typeof value === 'string' ? parse(value) : value;
}

function scalar(text) {
  const value = unwrap(parse(text));
  if (value && typeof value === 'object') return value.body ?? value.result ?? value.value ?? '';
  return value;
}
