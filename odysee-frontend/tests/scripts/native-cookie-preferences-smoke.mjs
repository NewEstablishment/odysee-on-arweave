import assert from 'node:assert/strict';

import {
  NATIVE_PREFERENCE_ALGORITHM,
  NATIVE_PREFERENCE_KEY_VERSION,
  NATIVE_PREFERENCE_REFERENCE_TYPE,
  nativePreferencePlaintext,
  nativePreferenceReferenceInitMessage,
  nativePreferenceReferenceSetMessage,
  nativePreferenceSnapshotMessage,
  normalizeNativePreferenceReference,
  normalizeNativePreferenceSnapshot,
  parseNativePreferencePlaintext,
  projectNativePreferenceReference,
} from '../../ui/util/nativePreferences.ts';

const nodeBase = String(process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18801').replace(/\/+$/, '');
const preferenceBridgeBase = String(process.env.HYPERBEAM_PREFERENCE_BRIDGE_BASE || '').replace(/\/+$/, '');
const now = Date.now();
const profileA = await write({ type: 'channel', name: `preference-a-${now}` });
const profileB = await write({ type: 'channel', name: `preference-b-${now}` });
const ownerA = await committer(profileA.id);
const ownerB = await committer(profileB.id);
assert.notEqual(ownerA, ownerB);

const anonymousOwner = await preferenceRequest('owner', {}, '');
assert.equal(anonymousOwner.response.ok, false, 'preference crypto requires an authenticated cookie wallet');

const ownerResponse = await preferenceRequest('owner', {}, profileA.cookie);
assert.equal(ownerResponse.response.ok, true, ownerResponse.text.slice(0, 500));
assert.equal(ownerResponse.response.headers.get('cache-control'), 'no-store, private');
assert.equal(String(ownerResponse.payload.owner || ownerResponse.payload.body), ownerA);

const firstPreferences = {
  shared: {
    type: 'object',
    version: '0.1',
    value: {
      settings: { theme: 'dark', language: 'en' },
      tags: ['science'],
      lastViewedAnnouncement: 7,
    },
  },
  'enable-sync': true,
};
const firstSeal = await seal(firstPreferences, profileA.cookie);
assert.equal(firstSeal.response.headers.get('cache-control'), 'no-store, private');
assert.equal(firstSeal.text.includes('science'), false, 'sealed responses must not echo preference plaintext');

const firstSnapshot = await writePreference(
  nativePreferenceSnapshotMessage(envelope(firstSeal.payload), now),
  profileA.cookie
);
assert.equal(await verified(firstSnapshot.id), true);
assert.equal(await committer(firstSnapshot.id), ownerA);
const firstSnapshotRecord = await hydrateSnapshot(firstSnapshot.id);
assert.equal(firstSnapshotRecord?.owner, ownerA);
const firstSnapshotPayload = unwrap(await read(firstSnapshot.id));
assert.equal(firstSnapshotPayload.plaintext, undefined);
assert.equal(firstSnapshotPayload.shared, undefined);

const referenceInit = await writePreference(
  nativePreferenceReferenceInitMessage(firstSnapshot.id, now),
  profileA.cookie
);
assert.equal(await verified(referenceInit.id), true);
assert.equal(await committer(referenceInit.id), ownerA);

const openedFirst = await open(firstSnapshotRecord, profileA.cookie);
assert.deepEqual(
  parseNativePreferencePlaintext(openedFirst.payload.plaintext || openedFirst.payload.body),
  firstPreferences
);

const foreignOpen = await preferenceRequest('open', openRequest(firstSnapshotRecord), profileB.cookie);
assert.equal(foreignOpen.response.ok, false, 'another authenticated wallet must not decrypt the snapshot');

const tamperedOpen = await preferenceRequest(
  'open',
  { ...openRequest(firstSnapshotRecord), ciphertext: tamper(firstSnapshotRecord.ciphertext) },
  profileA.cookie
);
assert.equal(tamperedOpen.response.ok, false, 'authenticated encryption must reject modified ciphertext');

const secondPreferences = {
  shared: {
    type: 'object',
    version: '0.1',
    value: {
      settings: { theme: 'light', language: 'es' },
      tags: ['science', 'technology'],
      lastViewedAnnouncement: 8,
    },
  },
  'enable-sync': true,
};
const secondSeal = await seal(secondPreferences, profileA.cookie);
const secondSnapshot = await writePreference(
  nativePreferenceSnapshotMessage(envelope(secondSeal.payload), now + 1),
  profileA.cookie
);
const referenceSet = await writePreference(
  nativePreferenceReferenceSetMessage(referenceInit.id, secondSnapshot.id, now + 1),
  profileA.cookie
);
assert.equal(await verified(secondSnapshot.id), true);
assert.equal(await verified(referenceSet.id), true);
assert.equal(await committer(secondSnapshot.id), ownerA);
assert.equal(await committer(referenceSet.id), ownerA);

const referencePaths = await queryUntilTimestamps(
  {
    'reference-type': NATIVE_PREFERENCE_REFERENCE_TYPE,
  },
  [now, now + 1]
);
const references = (await Promise.all(referencePaths.map(hydrateReference))).filter(Boolean);
const init = references.find((reference) => reference.message_id === referenceInit.id);
assert.equal(init?.is_init, true);
const head = projectNativePreferenceReference(init, references);
assert.equal(head.reference_id, referenceInit.id, 'the stable preference identity is the init reference');
assert.equal(head.reference_value, secondSnapshot.id, 'the valid newer set selects the latest snapshot');
assert.equal(head.owner, ownerA);

const secondSnapshotRecord = await hydrateSnapshot(head.reference_value);
const openedSecond = await open(secondSnapshotRecord, profileA.cookie);
assert.deepEqual(
  parseNativePreferencePlaintext(openedSecond.payload.plaintext || openedSecond.payload.body),
  secondPreferences
);
assert.deepEqual(
  parseNativePreferencePlaintext((await open(firstSnapshotRecord, profileA.cookie)).payload.plaintext),
  firstPreferences,
  'the first immutable snapshot remains exactly readable after the head moves'
);

console.log(
  JSON.stringify({
    owner: ownerA,
    foreign_owner: ownerB,
    first_snapshot_id: firstSnapshot.id,
    second_snapshot_id: secondSnapshot.id,
    preference_reference_id: referenceInit.id,
    reference_update_id: referenceSet.id,
    discovered_reference_locators: referencePaths,
    encrypted_at_rest: true,
    authenticated_open_verified: true,
    immutable_history_verified: true,
  })
);

async function seal(preferences, cookie) {
  const result = await preferenceRequest('seal', { plaintext: nativePreferencePlaintext(preferences) }, cookie);
  assert.equal(result.response.ok, true, result.text.slice(0, 500));
  return result;
}

async function open(snapshot, cookie) {
  const result = await preferenceRequest('open', openRequest(snapshot), cookie);
  assert.equal(result.response.ok, true, result.text.slice(0, 500));
  assert.equal(result.response.headers.get('cache-control'), 'no-store, private');
  return result;
}

function envelope(payload) {
  const result = {
    algorithm: String(payload.algorithm || ''),
    key_version: Number(payload['key-version']),
    owner: String(payload.owner || ''),
    iv: String(payload.iv || ''),
    ciphertext: String(payload.ciphertext || ''),
    tag: String(payload.tag || ''),
  };
  assert.equal(result.algorithm, NATIVE_PREFERENCE_ALGORITHM);
  assert.equal(result.key_version, NATIVE_PREFERENCE_KEY_VERSION);
  assert.match(result.owner, /^[0-9A-Za-z_-]{43}$/);
  assert.ok(result.iv && result.ciphertext && result.tag);
  return result;
}

function openRequest(snapshot) {
  return {
    algorithm: snapshot.algorithm,
    'key-version': snapshot.key_version,
    owner: snapshot.encrypted_for,
    iv: snapshot.iv,
    ciphertext: snapshot.ciphertext,
    tag: snapshot.tag,
  };
}

function tamper(value) {
  const first = value[0] === 'A' ? 'B' : 'A';
  return `${first}${value.slice(1)}`;
}

async function hydrateSnapshot(id) {
  const payload = unwrap(await read(id));
  return normalizeNativePreferenceSnapshot({
    ...payload,
    'message-id': id,
    'hyperbeam-owner': await committer(id),
  });
}

async function hydrateReference(id) {
  const payload = unwrap(await read(id));
  return normalizeNativePreferenceReference({
    ...payload,
    'message-id': id,
    'hyperbeam-owner': await committer(id),
  });
}

async function preferenceRequest(method, body, cookie) {
  const url = preferenceBridgeBase
    ? `${preferenceBridgeBase}/$/api/hyperbeam-auth-device/v1/~odysee-preference@1.0/${method}`
    : `${nodeBase}/~odysee-preference@1.0/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = unwrap(parse(text));
  return { response, text, payload: payload && typeof payload === 'object' ? payload : { body: payload } };
}

function writePreference(message, cookie) {
  const url = preferenceBridgeBase
    ? `${preferenceBridgeBase}/$/api/hyperbeam-native-message/v1/write`
    : `${nodeBase}/id?0.%21=true&committers=all`;
  return write(message, cookie, url);
}

async function write(message, cookie, url = `${nodeBase}/id?0.%21=true&committers=all`) {
  const response = await fetch(url, {
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
  assert.match(id, /^[0-9A-Za-z_-]{43}$/);
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
    body: JSON.stringify({ ...selectors, only: Object.keys(selectors), return: 'paths' }),
  });
  const text = await response.text();
  assert.equal(response.ok, true, `query failed: ${response.status} ${text.slice(0, 500)}`);
  const payload = unwrap(parse(text));
  if (Array.isArray(payload)) return payload.map((path) => String(path).replace(/^\/+/, ''));
  return Object.keys(payload || {})
    .filter((key) => /^\d+$/.test(key))
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => String(payload[key]).replace(/^\/+/, ''));
}

async function queryUntilTimestamps(selectors, expectedTimestamps) {
  let paths = [];
  let lastError;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      paths = await query(selectors);
      const timestamps = await Promise.all(paths.map(async (id) => Number(unwrap(await read(id)).timestamp)));
      if (expectedTimestamps.every((timestamp) => timestamps.includes(timestamp))) return paths;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(
    `query did not discover every preference reference: ${JSON.stringify({
      selectors,
      expectedTimestamps,
      paths,
      lastError: lastError instanceof Error ? lastError.message : lastError,
    })}`
  );
}

function cookiePair(setCookie) {
  const cookie = String(setCookie || '').split(';', 1)[0];
  assert.ok(cookie, 'committed write did not mint an authentication cookie');
  return cookie;
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
