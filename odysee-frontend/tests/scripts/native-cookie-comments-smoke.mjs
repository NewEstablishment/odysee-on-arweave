import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { collapseNativeCommentRevisions } from '../../ui/util/nativeCommentRevisions.ts';

const nodeBase = String(process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18802').replace(/\/+$/, '');
const schema = 'odysee-comment@1.0';
const profileName = `comment-smoke-${Date.now()}`;

const profile = await write({ type: 'channel', name: profileName });
assert.ok(profile.cookie, 'the first committed write must mint an identity cookie');
assert.equal(await verified(profile.id), true);
const owner = await committer(profile.id);
assert.ok(owner);

const rootRef = randomUUID();
const rootVersion = randomUUID();
const root = await write(
  {
    schema,
    type: 'comment',
    'comment-ref': rootRef,
    'version-ref': rootVersion,
    target: profile.id,
    parent: profile.id,
    state: 'active',
    author: profile.id,
    'profile-id': profile.id,
    'profile-name': profileName,
    body: 'root comment',
    'claim-id': profile.id,
    timestamp: Math.floor(Date.now() / 1000),
  },
  profile.cookie
);
assert.equal(await verified(root.id), true);
assert.equal(await committer(root.id), owner);

const reply = await write(
  {
    schema,
    type: 'comment',
    'comment-ref': randomUUID(),
    'version-ref': randomUUID(),
    target: profile.id,
    parent: rootRef,
    'parent-id': rootRef,
    state: 'active',
    body: 'reply comment',
    'claim-id': profile.id,
    timestamp: Math.floor(Date.now() / 1000),
  },
  profile.cookie
);
assert.equal(await committer(reply.id), owner);

const revisionVersion = randomUUID();
const revision = await write(
  {
    schema,
    type: 'comment',
    'comment-ref': rootRef,
    'version-ref': revisionVersion,
    target: profile.id,
    parent: profile.id,
    state: 'active',
    body: 'edited root comment',
    'claim-id': profile.id,
    timestamp: 1,
    'revision-of': rootRef,
    'previous-version': rootVersion,
    revision: 1,
    'revision-timestamp': Date.now(),
    operation: 'edit',
  },
  profile.cookie
);
assert.equal(await committer(revision.id), owner);

const attacker = await write({ type: 'channel', name: 'comment-smoke-attacker' });
const forged = await write(
  {
    schema,
    type: 'comment',
    'comment-ref': rootRef,
    'version-ref': randomUUID(),
    target: profile.id,
    parent: profile.id,
    state: 'active',
    body: 'forged edit',
    'claim-id': profile.id,
    timestamp: 1,
    'revision-of': rootRef,
    'previous-version': revisionVersion,
    revision: 2,
    'revision-timestamp': Date.now(),
    operation: 'edit',
  },
  attacker.cookie
);
assert.notEqual(await committer(forged.id), owner);

const deletion = await write(
  {
    schema,
    type: 'comment',
    'comment-ref': rootRef,
    'version-ref': randomUUID(),
    target: profile.id,
    parent: profile.id,
    state: 'deleted',
    body: '',
    'claim-id': profile.id,
    timestamp: 1,
    'revision-of': rootRef,
    'previous-version': revisionVersion,
    revision: 2,
    'revision-timestamp': Date.now(),
    operation: 'delete',
  },
  profile.cookie
);
assert.equal(await committer(deletion.id), owner);

const paths = await query({ schema, type: 'comment', 'claim-id': profile.id });
const hydrated = await Promise.all(paths.map(async (id) => ({ id, payload: unwrap(await read(id)) })));
const discovered = await Promise.all(
  hydrated
    .filter(
      ({ payload }) =>
        payload?.schema === schema &&
        payload?.['claim-id'] === profile.id &&
        typeof payload?.body === 'string' &&
        typeof payload?.['version-ref'] === 'string'
    )
    .map(async (entry) => ({ ...entry, owner: await committer(entry.id) }))
);
const rootEntry = discovered.find(({ payload }) => payload['comment-ref'] === rootRef && !payload['revision-of']);
const replyEntry = discovered.find(({ payload }) => payload.body === 'reply comment');
const revisionEntry = discovered.find(({ payload }) => payload['version-ref'] === revisionVersion);
const forgedEntry = discovered.find(({ payload }) => payload.body === 'forged edit');
const deletionEntry = discovered.find(({ payload }) => payload.operation === 'delete');
for (const entry of [rootEntry, replyEntry, revisionEntry, forgedEntry, deletionEntry]) {
  assert.ok(
    entry,
    `missing discovered comment version: ${JSON.stringify(
      hydrated.map(({ id, payload }) => ({
        id,
        schema: payload?.schema,
        claim: payload?.['claim-id'],
        body: payload?.body,
        operation: payload?.operation,
        kind: typeof payload,
        sample: typeof payload === 'string' ? payload.slice(0, 160) : undefined,
        keys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
      }))
    )}`
  );
}
for (const { id } of discovered) assert.equal(await verified(id), true);
assert.equal(rootEntry.owner, owner);
assert.equal(replyEntry.owner, owner);
assert.equal(revisionEntry.owner, owner);
assert.notEqual(forgedEntry.owner, owner);
assert.equal(deletionEntry.owner, owner);

const rootRecord = record(rootEntry.payload, rootEntry.id, owner, rootRef);
rootRecord.timestamp = 1;
const revisionRecord = record(revisionEntry.payload, revisionEntry.id, owner, rootRef);
const forgedRecord = record(forgedEntry.payload, forgedEntry.id, forgedEntry.owner, rootRef);
const deletionRecord = record(deletionEntry.payload, deletionEntry.id, owner, rootRef);
const [projected] = collapseNativeCommentRevisions([rootRecord, revisionRecord, forgedRecord, deletionRecord]);
assert.equal(projected.operation, 'delete');
assert.equal(projected.hyperbeam_message_id, deletionEntry.id);

console.log(
  JSON.stringify({
    profile_id: profile.id,
    owner,
    root_ref: rootRef,
    root_message_id: root.id,
    reply_message_id: reply.id,
    edit_message_id: revision.id,
    delete_message_id: deletion.id,
    forged_revision_ignored: true,
  })
);

async function write(message, cookie) {
  const response = await fetch(`${nodeBase}/id?0.%21=true&committers=all`, {
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
  const headers = Object.fromEntries(response.headers.entries());
  const parsed = parse(text);
  return parsed && typeof parsed === 'object' ? { ...headers, ...parsed } : { ...headers, body: parsed };
}

async function verified(id) {
  const response = await fetch(`${nodeBase}/${id}/verify?commitment-ids=${id}`, {
    headers: { accept: 'application/json' },
  });
  return response.ok && String(scalar(await response.text())).toLowerCase() === 'true';
}

async function committer(id) {
  const response = await fetch(`${nodeBase}/${id}/commitments/${id}/committer`, {
    headers: { accept: 'application/json' },
  });
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
  if (Array.isArray(payload)) return payload.map(String);
  return Object.keys(payload || {})
    .filter((key) => /^\d+$/.test(key))
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => String(payload[key]).replace(/^\/+/, ''));
}

function record(payload, id, messageOwner, rootId) {
  const source = unwrap(payload);
  return {
    ...source,
    comment_id: source['revision-of'] || source['comment-ref'] || rootId,
    comment_ref: source['comment-ref'],
    hyperbeam_message_id: id,
    hyperbeam_owner: messageOwner,
    revision_of: source['revision-of'],
    previous_version: source['previous-version'],
    version_ref: source['version-ref'],
    revision: source.revision,
    revision_timestamp: source['revision-timestamp'],
    channel_id: undefined,
    claim_id: source['claim-id'],
    parent_id: source['parent-id'],
    timestamp: source.timestamp,
    state: source.state,
    operation: source.operation,
  };
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
