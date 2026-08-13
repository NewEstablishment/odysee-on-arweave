import assert from 'node:assert/strict';

import { latestNativePlaylistRevision } from '../../ui/util/nativePlaylistRevisions.ts';

const frontendBase = (process.env.BASE_URL || 'http://localhost:9090').replace(/\/+$/, '');
const hyperbeamBase = (process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18800').replace(/\/+$/, '');
const authToken = process.env.AUTH_TOKEN || 'odysee-playlist-smoke-owner';
const attackerToken = process.env.ATTACKER_AUTH_TOKEN || 'odysee-playlist-smoke-attacker';
const writeUrl = `${frontendBase}/$/api/hyperbeam-upload/v1/write`;

const root = {
  schema: 'odysee-playlist@1',
  type: 'playlist',
  state: 'active',
  revision: 0,
  'version-ref': `playlist-${crypto.randomUUID()}`,
  title: 'Native playlist',
  description: 'Verified playlist root',
  items: 'claim-a',
};
const rootId = await write(root, authToken);
const storedRoot = await readPlaylist(rootId);

const revision = {
  ...root,
  revision: 1,
  'revision-of': rootId,
  'previous-version': root['version-ref'],
  'version-ref': `playlist-${crypto.randomUUID()}`,
  'revision-timestamp': Date.now(),
  title: 'Native playlist updated',
  items: 'claim-a,claim-b',
};
const revisionId = await write(revision, authToken);
const storedRevision = await readPlaylist(revisionId);

const attackerRevision = {
  ...revision,
  'version-ref': `playlist-${crypto.randomUUID()}`,
  'revision-timestamp': Date.now() + 1,
  title: 'Attacker playlist takeover',
};
const attackerId = await write(attackerRevision, attackerToken);
const storedAttacker = await readPlaylist(attackerId);

assert.equal(storedRoot.owner, storedRevision.owner);
assert.notEqual(storedRoot.owner, storedAttacker.owner);

const paths = await queryPaths({
  schema: 'odysee-playlist@1',
  type: 'playlist',
  'revision-of': rootId,
});
const versions = (await Promise.all(paths.map((path) => readPlaylist(path).catch(() => null)))).filter(Boolean);
const projected = latestNativePlaylistRevision(storedRoot, versions);
assert.equal(projected.title, 'Native playlist updated');
assert.equal(projected['version-ref'], revision['version-ref']);
assert.equal(projected.owner, storedRoot.owner);

console.log(
  JSON.stringify(
    {
      rootId,
      revisionId,
      ignoredAttackerRevision: attackerId,
      discoveredPaths: paths,
      projectedLocator: projected['message-id'],
      projectedVersionRef: projected['version-ref'],
      owner: projected.owner,
    },
    null,
    2
  )
);

async function write(message, token) {
  const response = await fetch(writeUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      cookie: `auth_token=${encodeURIComponent(token)}`,
      'x-lbry-auth-token': token,
    },
    body: JSON.stringify(message),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Playlist write failed: ${response.status} ${text.slice(0, 500)}`);
  const parsed = parseJson(text);
  const id =
    response.headers.get('message-id') ||
    response.headers.get('id') ||
    response.headers.get('path') ||
    response.headers.get('read-path') ||
    parsed?.['message-id'] ||
    parsed?.id ||
    parsed?.path ||
    parsed?.body ||
    (typeof parsed === 'string' ? parsed : '');
  const normalized = String(id || '').replace(/^\/+/, '');
  if (!normalized) throw new Error(`Playlist write returned no ID: ${text.slice(0, 500)}`);
  return normalized;
}

async function readPlaylist(id) {
  const response = await fetch(`${hyperbeamBase}/~cache@1.0/read?read=${encodeURIComponent(id)}`, {
    headers: { accept: 'application/json' },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Playlist read ${id} failed: ${response.status} ${text.slice(0, 500)}`);
  const stored = { ...responseHeaders(response), ...(parseJson(text) || {}) };
  if (stored.schema !== 'odysee-playlist@1' || stored.type !== 'playlist') {
    throw new Error(`Playlist read ${id} returned another record`);
  }

  const encodedId = encodeURIComponent(id);
  const verifyResponse = await fetch(`${hyperbeamBase}/${encodedId}/verify?commitment-ids=${encodedId}`, {
    headers: { accept: 'application/json' },
  });
  const verifyText = await verifyResponse.text();
  if (!verifyResponse.ok || String(parseJson(verifyText)?.body ?? parseJson(verifyText) ?? verifyText) !== 'true') {
    throw new Error(`Playlist commitment ${id} failed: ${verifyResponse.status} ${verifyText.slice(0, 500)}`);
  }

  const ownerResponse = await fetch(`${hyperbeamBase}/${encodedId}/commitments/${encodedId}/committer`, {
    headers: { accept: 'application/json' },
  });
  const ownerText = await ownerResponse.text();
  if (!ownerResponse.ok) {
    throw new Error(`Playlist committer ${id} failed: ${ownerResponse.status} ${ownerText.slice(0, 500)}`);
  }
  const ownerPayload = parseJson(ownerText);
  const owner = String(ownerPayload?.body || ownerPayload?.committer || ownerPayload || ownerText)
    .replace(/^"|"$/g, '')
    .trim();
  if (!owner) throw new Error(`Playlist ${id} has no committer`);

  return {
    ...stored,
    'message-id': id,
    owner,
    revision: Number(stored.revision || 0),
    state: stored.state || 'active',
  };
}

async function queryPaths(selectors) {
  const response = await fetch(`${hyperbeamBase}/~query@1.0/only`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ only: selectors, return: 'paths' }),
  });
  const text = await response.text();
  if (response.status === 404 || (response.status === 500 && text.includes('not_found'))) return [];
  if (!response.ok) throw new Error(`Playlist query failed: ${response.status} ${text.slice(0, 500)}`);
  const payload = parseJson(text) || {};
  return Object.keys(payload)
    .filter((key) => /^\d+$/.test(key))
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => String(payload[key]).replace(/^\/+/, ''));
}

function responseHeaders(response) {
  return Object.fromEntries(response.headers.entries());
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return text ? { body: text } : {};
  }
}
