import assert from 'node:assert/strict';

import { latestNativeUploadRevision } from '../../ui/util/nativeUploadRevisions.ts';

const frontendBase = (process.env.BASE_URL || 'http://localhost:9090').replace(/\/+$/, '');
const hyperbeamBase = (process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18800').replace(/\/+$/, '');
const authToken = process.env.AUTH_TOKEN || 'odysee-upload-smoke-owner';
const attackerToken = process.env.ATTACKER_AUTH_TOKEN || 'odysee-upload-smoke-attacker';
const writeUrl = `${frontendBase}/$/api/hyperbeam-upload/v1/write`;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#111827"/><circle cx="64" cy="60" r="32" fill="#22c55e"/><text x="112" y="68" font-family="Arial" font-size="22" fill="white">HB upload</text></svg>';

const dataId = await write(svg, authToken, 'image/svg+xml');
const timestamp = Math.floor(Date.now() / 1000);
const rootId = await write(
  {
    schema: 'odysee-upload@1.0',
    type: 'upload',
    state: 'active',
    revision: 0,
    'version-ref': `root-${crypto.randomUUID()}`,
    name: 'hb-upload-smoke',
    filename: 'hb-upload-smoke.svg',
    'content-type': 'image/svg+xml',
    'source-size': String(svg.length),
    'data-id': dataId,
    'streaming-url': `/${dataId}`,
    title: 'Original upload title',
    timestamp,
  },
  authToken
);
const root = await readUpload(rootId);
assert.equal(
  Object.keys(root).some((key) => key.includes('private-smoke-cookie')),
  false
);
assert.equal(JSON.stringify(root).includes('must-not-persist'), false);

const updateId = await write(
  revisionMessage(root, rootId, {
    operation: 'update',
    state: 'active',
    revision: 1,
    title: 'Updated upload title',
  }),
  authToken
);
const update = await readUpload(updateId);

const attackerId = await write(
  revisionMessage(root, rootId, {
    operation: 'delete',
    state: 'deleted',
    revision: 1,
    title: 'Attacker tombstone',
  }),
  attackerToken
);
const attacker = await readUpload(attackerId);

const discoveredBeforeDelete = await queryRevisionIds(rootId);
const discoveredVersions = (
  await Promise.all(discoveredBeforeDelete.map((id) => readUpload(id).catch(() => null)))
).filter(Boolean);
const projectedUpdate = latestNativeUploadRevision(root, discoveredVersions);
assert.equal(projectedUpdate.title, 'Updated upload title');
assert.equal(projectedUpdate.owner, root.owner);
assert.notEqual(projectedUpdate.owner, attacker.owner);

const deleteId = await write(
  revisionMessage(update, rootId, {
    operation: 'delete',
    state: 'deleted',
    revision: 2,
  }),
  authToken
);
const deletion = await readUpload(deleteId);
const discoveredAfterDelete = await queryRevisionIds(rootId);
const projected = latestNativeUploadRevision(
  root,
  (await Promise.all(discoveredAfterDelete.map((id) => readUpload(id).catch(() => null)))).filter(Boolean)
);
assert.equal(projected.state, 'deleted');
assert.equal(projected['data-id'], dataId);

const mediaResponse = await fetch(`${hyperbeamBase}/${encodeURIComponent(dataId)}`);
const mediaBody = await mediaResponse.text();
assert.equal(mediaResponse.status, 200);
assert.equal(mediaBody, svg);

console.log(
  JSON.stringify(
    {
      dataId,
      rootId,
      updateId,
      ignoredAttackerRevision: attackerId,
      deleteId,
      projectedDeleteLocator: projected['message-id'],
      owner: root.owner,
      mediaBytes: mediaBody.length,
    },
    null,
    2
  )
);

async function write(body, token, contentType = 'application/json') {
  const response = await fetch(writeUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': contentType,
      'x-lbry-auth-token': token,
      cookie: `auth_token=${encodeURIComponent(token)}; private_smoke_cookie=must-not-persist`,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Write failed: ${response.status} ${text.slice(0, 500)}`);
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
  if (!normalized) throw new Error(`Write returned no message ID: ${text.slice(0, 500)}`);
  return normalized;
}

async function readUpload(id) {
  const response = await fetch(`${hyperbeamBase}/~cache@1.0/read?read=${encodeURIComponent(id)}`, {
    headers: { accept: 'application/json' },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Read ${id} failed: ${response.status} ${text.slice(0, 500)}`);
  const stored = { ...responseHeaders(response), ...(parseJson(text) || {}) };
  const ownerResponse = await fetch(
    `${hyperbeamBase}/${encodeURIComponent(id)}/commitments/${encodeURIComponent(id)}/committer`,
    { headers: { accept: 'application/json' } }
  );
  const ownerText = await ownerResponse.text();
  if (!ownerResponse.ok) {
    throw new Error(`Committer read ${id} failed: ${ownerResponse.status} ${ownerText.slice(0, 500)}`);
  }
  const ownerPayload = parseJson(ownerText);
  const owner = String(ownerPayload?.body || ownerPayload?.committer || ownerPayload || ownerText)
    .replace(/^"|"$/g, '')
    .trim();
  return {
    ...stored,
    'message-id': id,
    owner,
    state: stored.state || 'active',
    revision: Number(stored.revision || 0),
  };
}

function revisionMessage(current, rootId, changes) {
  const snapshot = Object.fromEntries(
    [
      'schema',
      'type',
      'name',
      'filename',
      'content-type',
      'source-size',
      'data-id',
      'streaming-url',
      'title',
      'description',
      'thumbnail-url',
      'timestamp',
      'version-ref',
    ]
      .map((key) => [key, current[key]])
      .filter(([, value]) => value !== undefined)
  );
  return {
    ...snapshot,
    ...changes,
    'revision-of': rootId,
    'previous-version': current['version-ref'] || current['message-id'],
    'version-ref': `revision-${crypto.randomUUID()}`,
    'revision-timestamp': Date.now(),
  };
}

async function queryRevisionIds(rootId) {
  const selectors = {
    schema: 'odysee-upload@1.0',
    type: 'upload',
    'revision-of': rootId,
  };
  const response = await fetch(`${hyperbeamBase}/~query@1.0/only`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      only: selectors,
      return: 'paths',
      'cache-control': ['no-store', 'no-cache'],
    }),
  });
  const text = await response.text();
  if (response.status === 404 || (response.status === 500 && text.includes('not_found'))) return [];
  if (!response.ok) throw new Error(`Revision query failed: ${response.status} ${text.slice(0, 500)}`);
  const payload = parseJson(text) || {};
  const paths = Array.isArray(payload)
    ? payload
    : Object.keys(payload)
        .filter((key) => /^\d+$/.test(key))
        .sort((left, right) => Number(left) - Number(right))
        .map((key) => payload[key]);
  return paths.map((path) => String(path).replace(/^\/+/, ''));
}

function responseHeaders(response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return text ? { body: text } : {};
  }
}
