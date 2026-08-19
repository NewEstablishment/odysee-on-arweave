import assert from 'node:assert/strict';

import {
  NATIVE_PLAYLIST_SCHEMA,
  NATIVE_PLAYLIST_SIGNATURE_SCOPE,
  immutableNativePlaylists,
  normalizeNativePlaylist,
} from '../../ui/util/nativePlaylists.ts';
import {
  NATIVE_PLAYLIST_REFERENCE_TYPE,
  REFERENCE_DEVICE,
  nativePlaylistReferenceInitMessage,
  nativePlaylistReferenceSetMessage,
  normalizeNativePlaylistReference,
  projectNativePlaylistReference,
} from '../../ui/util/nativePlaylistReferences.ts';

const nodeBase = String(process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18801').replace(/\/+$/, '');
const now = Date.now();
const profileNameA = `playlist-a-${now}`;
const profileNameB = `playlist-b-${now}`;
const profileA = await write({ type: 'channel', name: profileNameA });
const profileB = await write({ type: 'channel', name: profileNameB });
const ownerA = await committer(profileA.id);
const ownerB = await committer(profileB.id);
assert.notEqual(ownerA, ownerB);

const first = await write(
  playlistMessage({
    profile: profileA.id,
    profileName: profileNameA,
    title: 'First immutable snapshot',
    items: [profileA.id, profileB.id],
    createdAt: now,
  }),
  profileA.cookie
);
assert.equal(await verified(first.id), true);
assert.equal(await committer(first.id), ownerA);
const playlistReference = await write(
  nativePlaylistReferenceInitMessage({
    profileId: profileA.id,
    profileName: profileNameA,
    snapshotId: first.id,
    timestamp: now,
  }),
  profileA.cookie
);
assert.equal(
  await verified(playlistReference.id),
  true,
  `reference init verification failed for ${playlistReference.id}`
);
assert.equal(await committer(playlistReference.id), ownerA);

const republished = await write(
  playlistMessage({
    profile: profileA.id,
    profileName: profileNameA,
    title: 'Republished immutable snapshot',
    items: [profileB.id, profileA.id],
    createdAt: now + 1,
  }),
  profileA.cookie
);
assert.equal(await verified(republished.id), true);
assert.equal(await committer(republished.id), ownerA);
assert.notEqual(first.id, republished.id, 'republishing must produce a new immutable playlist ID');
const referenceUpdate = await write(
  nativePlaylistReferenceSetMessage({
    profileId: profileA.id,
    profileName: profileNameA,
    referenceId: playlistReference.id,
    snapshotId: republished.id,
    timestamp: now + 1,
  }),
  profileA.cookie
);
assert.equal(await verified(referenceUpdate.id), true);
assert.equal(await committer(referenceUpdate.id), ownerA);

const forgedReferenceUpdate = await write(
  nativePlaylistReferenceSetMessage({
    profileId: profileA.id,
    profileName: profileNameA,
    referenceId: playlistReference.id,
    snapshotId: profileB.id,
    timestamp: now + 999,
  }),
  profileB.cookie
);
assert.equal(await committer(forgedReferenceUpdate.id), ownerB);

const referencePaths = await queryUntilTimestamps(
  {
    device: REFERENCE_DEVICE,
    'reference-type': NATIVE_PLAYLIST_REFERENCE_TYPE,
    'profile-id': profileA.id,
  },
  [now, now + 1, now + 999]
);
const references = (await Promise.all(referencePaths.map(hydrateReference))).filter(Boolean);
const init = references.find((reference) => reference.message_id === playlistReference.id);
assert.ok(init?.is_init);
const referenceHead = projectNativePlaylistReference(init, references);
assert.equal(referenceHead.reference_id, playlistReference.id, 'the playlist URL remains the init message ID');
assert.equal(referenceHead.reference_value, republished.id, 'the valid owner update selects the new snapshot');
assert.equal(referenceHead.owner, ownerA, 'a foreign committer cannot move the reference');

const firstPayload = unwrap(await read(first.id));
const republishedPayload = unwrap(await read(republished.id));
assert.deepEqual(JSON.parse(firstPayload['items-json']), [profileA.id, profileB.id]);
assert.deepEqual(JSON.parse(republishedPayload['items-json']), [profileB.id, profileA.id]);
for (const payload of [firstPayload, republishedPayload]) {
  assert.equal(payload['playlist-ref'], undefined);
  assert.equal(payload['version-ref'], undefined);
  assert.equal(payload['revision-of'], undefined);
  assert.equal(payload['previous-version'], undefined);
}

const forged = await write(
  playlistMessage({
    profile: profileA.id,
    profileName: profileNameA,
    title: 'Foreign signer claiming profile A',
    items: [profileB.id],
    createdAt: now + 2,
  }),
  profileB.cookie
);
assert.equal(await committer(forged.id), ownerB);

const other = await write(
  playlistMessage({
    profile: profileB.id,
    profileName: profileNameB,
    title: 'Owner B snapshot',
    items: [profileB.id],
    createdAt: now + 3,
  }),
  profileB.cookie
);

const pathsA = await queryUntilCreatedAts(
  { schema: NATIVE_PLAYLIST_SCHEMA, type: 'playlist', 'profile-id': profileA.id },
  [now, now + 1, now + 2]
);
const recordsA = (await Promise.all(pathsA.map(hydrateVerified))).filter(Boolean);
const snapshotsA = immutableNativePlaylists(recordsA);
assert.deepEqual(
  snapshotsA.map((playlist) => playlist.created_at),
  [now + 1, now],
  'owner listing keeps both immutable snapshots and rejects a foreign signer claiming the profile'
);
assert.deepEqual(snapshotsA[0].items, [profileB.id, profileA.id]);
assert.deepEqual(snapshotsA[1].items, [profileA.id, profileB.id]);

const pathsB = await queryUntilCreatedAts(
  { schema: NATIVE_PLAYLIST_SCHEMA, type: 'playlist', 'profile-id': profileB.id },
  [now + 3]
);
const recordsB = (await Promise.all(pathsB.map(hydrateVerified))).filter(Boolean);
assert.deepEqual(
  immutableNativePlaylists(recordsB).map((playlist) => playlist.created_at),
  [now + 3]
);

console.log(
  JSON.stringify({
    owner_a: ownerA,
    owner_b: ownerB,
    first_playlist_id: first.id,
    republished_playlist_id: republished.id,
    playlist_reference_id: playlistReference.id,
    reference_update_id: referenceUpdate.id,
    forged_reference_update_id: forgedReferenceUpdate.id,
    forged_playlist_id: forged.id,
    other_playlist_id: other.id,
    owner_a_discovery_locators: pathsA,
    owner_b_discovery_locators: pathsB,
    immutable_exact_reads_verified: true,
    owner_listing_verified: true,
  })
);

function playlistMessage({ profile, profileName, title, items, createdAt }) {
  return {
    schema: NATIVE_PLAYLIST_SCHEMA,
    type: 'playlist',
    'profile-id': profile,
    'profile-name': profileName,
    title,
    description: 'Generic immutable signed message path',
    'tags-json': JSON.stringify(['native']),
    'languages-json': JSON.stringify(['en']),
    'items-json': JSON.stringify(items),
    'item-count': items.length,
    'created-at': createdAt,
    'signature-scope': NATIVE_PLAYLIST_SIGNATURE_SCOPE,
  };
}

async function hydrateReference(id) {
  const payload = unwrap(await read(id));
  return normalizeNativePlaylistReference({
    ...payload,
    'message-id': id,
    'hyperbeam-owner': await committer(id),
  });
}

async function hydrateVerified(id) {
  const payload = unwrap(await read(id));
  const playlist = normalizeNativePlaylist({
    ...payload,
    'message-id': id,
    'hyperbeam-owner': await committer(id),
  });
  if (!playlist) return null;

  const profilePayload = unwrap(await read(playlist.profile_id));
  const profileOwner = await committer(playlist.profile_id);
  if (
    profileOwner !== playlist.owner ||
    profilePayload.type !== 'channel' ||
    profilePayload.name !== playlist.profile_name
  ) {
    return null;
  }
  return playlist;
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
  if (Array.isArray(payload)) return payload.map((path) => String(path).replace(/^\/+/, ''));
  return Object.keys(payload || {})
    .filter((key) => /^\d+$/.test(key))
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => String(payload[key]).replace(/^\/+/, ''));
}

async function queryUntilCreatedAts(selectors, expectedCreatedAts) {
  let paths = [];
  for (let attempt = 0; attempt < 24; attempt += 1) {
    paths = await query(selectors);
    const createdAts = await Promise.all(paths.map(async (id) => Number(unwrap(await read(id))['created-at'])));
    if (expectedCreatedAts.every((createdAt) => createdAts.includes(createdAt))) return paths;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`query did not discover every snapshot: ${JSON.stringify({ selectors, expectedCreatedAts, paths })}`);
}

async function queryUntilTimestamps(selectors, expectedTimestamps) {
  let paths = [];
  for (let attempt = 0; attempt < 24; attempt += 1) {
    paths = await query(selectors);
    const timestamps = await Promise.all(paths.map(async (id) => Number(unwrap(await read(id)).timestamp)));
    if (expectedTimestamps.every((timestamp) => timestamps.includes(timestamp))) return paths;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(
    `query did not discover every reference message: ${JSON.stringify({ selectors, expectedTimestamps, paths })}`
  );
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
