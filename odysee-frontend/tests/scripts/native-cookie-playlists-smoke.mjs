import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  NATIVE_PLAYLIST_SCHEMA,
  NATIVE_PLAYLIST_SIGNATURE_SCOPE,
  activeNativePlaylists,
  collapseNativePlaylistStates,
  normalizeNativePlaylist,
} from '../../ui/util/nativePlaylists.ts';

const nodeBase = String(process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18801').replace(/\/+$/, '');
const now = Date.now();
const profileA = await write({ type: 'channel', name: `playlist-a-${now}` });
const profileB = await write({ type: 'channel', name: `playlist-b-${now}` });
const ownerA = await committer(profileA.id);
const ownerB = await committer(profileB.id);
assert.notEqual(ownerA, ownerB);

const playlistRefA = `${ownerA}.${randomUUID()}`;
const rootVersion = randomUUID();
const root = await write(
  playlistMessage({
    ref: playlistRefA,
    profile: profileA.id,
    profileName: `playlist-a-${now}`,
    version: rootVersion,
    items: [profileA.id, profileB.id],
    createdAt: now,
    updatedAt: now,
  }),
  profileA.cookie
);
assert.equal(await verified(root.id), true);
assert.equal(await committer(root.id), ownerA);

const updateVersion = randomUUID();
const update = await write(
  playlistMessage({
    ref: playlistRefA,
    profile: profileA.id,
    profileName: `playlist-a-${now}`,
    version: updateVersion,
    items: [profileB.id, profileA.id],
    revision: 1,
    previous: rootVersion,
    createdAt: now,
    updatedAt: now + 1,
  }),
  profileA.cookie
);
assert.equal(await committer(update.id), ownerA);

const duplicate = await write(
  playlistMessage({
    ref: playlistRefA,
    profile: profileA.id,
    profileName: `playlist-a-${now}`,
    version: updateVersion,
    items: [profileB.id, profileA.id],
    revision: 1,
    previous: rootVersion,
    createdAt: now,
    updatedAt: now + 1,
  }),
  profileA.cookie
);
assert.equal(await committer(duplicate.id), ownerA);

const forgedVersion = randomUUID();
const forged = await write(
  playlistMessage({
    ref: playlistRefA,
    profile: profileA.id,
    profileName: `playlist-a-${now}`,
    version: forgedVersion,
    items: [profileB.id],
    revision: 2,
    previous: updateVersion,
    createdAt: now,
    updatedAt: now + 2,
  }),
  profileB.cookie
);
assert.equal(await committer(forged.id), ownerB);

const playlistRefB = `${ownerB}.${randomUUID()}`;
const otherVersion = randomUUID();
const other = await write(
  playlistMessage({
    ref: playlistRefB,
    profile: profileB.id,
    profileName: `playlist-b-${now}`,
    version: otherVersion,
    items: [profileB.id],
    createdAt: now,
    updatedAt: now,
  }),
  profileB.cookie
);

const pathsA = await queryUntilVersions(
  { schema: NATIVE_PLAYLIST_SCHEMA, type: 'playlist', 'profile-id': profileA.id },
  [rootVersion, updateVersion, forgedVersion]
);
const recordsA = (await Promise.all(pathsA.map(hydrate))).filter(Boolean);
const versionsA = new Set(recordsA.map((playlist) => playlist.version_ref));
assert.ok(versionsA.has(rootVersion));
assert.ok(versionsA.has(updateVersion));
assert.equal(
  recordsA.some((playlist) => playlist.version_ref === forgedVersion),
  false
);
assert.deepEqual(
  activeNativePlaylists(recordsA).map((playlist) => playlist.playlist_ref),
  [playlistRefA]
);
assert.deepEqual(activeNativePlaylists(recordsA)[0].items, [profileB.id, profileA.id]);
assert.equal(activeNativePlaylists(recordsA)[0].owner, ownerA);

const pathsB = await queryUntilVersions(
  { schema: NATIVE_PLAYLIST_SCHEMA, type: 'playlist', 'profile-id': profileB.id },
  [otherVersion]
);
const recordsB = (await Promise.all(pathsB.map(hydrate))).filter(Boolean);
assert.deepEqual(
  activeNativePlaylists(recordsB).map((playlist) => playlist.playlist_ref),
  [playlistRefB]
);
assert.equal(activeNativePlaylists(recordsB)[0].version_ref, otherVersion);

const deleteVersion = randomUUID();
const deletion = await write(
  playlistMessage({
    ref: playlistRefA,
    profile: profileA.id,
    profileName: `playlist-a-${now}`,
    version: deleteVersion,
    items: [profileB.id, profileA.id],
    revision: 2,
    previous: updateVersion,
    createdAt: now,
    updatedAt: now + 3,
    state: 'deleted',
    operation: 'delete',
  }),
  profileA.cookie
);
assert.equal(await verified(deletion.id), true);
const finalPaths = await queryUntilVersions(
  { schema: NATIVE_PLAYLIST_SCHEMA, type: 'playlist', 'playlist-ref': playlistRefA },
  [rootVersion, updateVersion, forgedVersion, deleteVersion]
);
const finalRecords = (await Promise.all(finalPaths.map(hydrate))).filter(Boolean);
const [head] = collapseNativePlaylistStates(finalRecords);
assert.equal(head.version_ref, deleteVersion);
assert.equal(head.state, 'deleted');
assert.deepEqual(activeNativePlaylists(finalRecords), []);

console.log(
  JSON.stringify({
    playlist_ref: playlistRefA,
    owner_a: ownerA,
    owner_b: ownerB,
    root_message_id: root.id,
    update_message_id: update.id,
    duplicate_message_id: duplicate.id,
    forged_message_id: forged.id,
    delete_message_id: deletion.id,
    list_isolation_verified: true,
  })
);

function playlistMessage({
  ref,
  profile,
  profileName,
  version,
  items,
  revision = 0,
  previous,
  createdAt,
  updatedAt,
  state = 'active',
  operation = revision ? 'update' : 'create',
}) {
  return {
    schema: NATIVE_PLAYLIST_SCHEMA,
    type: 'playlist',
    'playlist-ref': ref,
    'profile-id': profile,
    'profile-name': profileName,
    title: 'Native smoke playlist',
    description: 'Generic signed message path',
    'tags-json': JSON.stringify(['native']),
    'languages-json': JSON.stringify(['en']),
    'items-json': JSON.stringify(items),
    'item-count': items.length,
    state,
    operation,
    revision,
    'version-ref': version,
    ...(revision ? { 'revision-of': ref, 'previous-version': previous } : {}),
    'created-at': createdAt,
    'updated-at': updatedAt,
    'signature-scope': NATIVE_PLAYLIST_SIGNATURE_SCOPE,
  };
}

async function hydrate(id) {
  const payload = unwrap(await read(id));
  return normalizeNativePlaylist({
    ...payload,
    'message-id': id,
    'hyperbeam-owner': await committer(id),
  });
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
  const response = await fetch(`${nodeBase}/~cache@1.0/read?read=${encodeURIComponent(id)}`, {
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

async function queryUntilVersions(selectors, expectedVersions) {
  let paths = [];
  let versions = [];
  for (let attempt = 0; attempt < 24; attempt += 1) {
    paths = await query(selectors);
    versions = (
      await Promise.all(
        paths.map(async (id) => {
          const payload = unwrap(await read(id));
          return payload?.['version-ref'];
        })
      )
    ).filter(Boolean);
    if (expectedVersions.every((version) => versions.includes(version))) return paths;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(
    `query did not discover every version: ${JSON.stringify({ selectors, expectedVersions, versions, paths })}`
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
