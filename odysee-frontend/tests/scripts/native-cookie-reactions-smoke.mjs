import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  NATIVE_REACTION_SCHEMA,
  NATIVE_REACTION_SIGNATURE_SCOPE,
  collapseNativeReactionStates,
  normalizeNativeReaction,
  projectNativeReactions,
} from '../../ui/util/nativeReactions.ts';

const nodeBase = String(process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18801').replace(/\/+$/, '');
const target = `reaction-smoke-${Date.now()}`;

const profileA = await write({ type: 'channel', name: `reaction-a-${Date.now()}` });
const ownerA = await committer(profileA.id);
const rootRef = randomUUID();
const rootVersion = randomUUID();
const rootA = await write(
  reactionMessage({ ref: rootRef, version: rootVersion, target, reaction: 'like' }),
  profileA.cookie
);
assert.equal(await verified(rootA.id), true);
assert.equal(await committer(rootA.id), ownerA);

const switchA = await write(
  reactionMessage({
    ref: rootRef,
    version: randomUUID(),
    target,
    reaction: 'dislike',
    revision: 1,
    root: rootRef,
    previous: rootVersion,
  }),
  profileA.cookie
);
assert.equal(await committer(switchA.id), ownerA);
const switchPayload = unwrap(await read(switchA.id));
const switchVersion = switchPayload['version-ref'];

const removeA = await write(
  reactionMessage({
    ref: rootRef,
    version: randomUUID(),
    target,
    reaction: 'dislike',
    state: 'removed',
    operation: 'remove',
    revision: 2,
    root: rootRef,
    previous: switchVersion,
  }),
  profileA.cookie
);
assert.equal(await committer(removeA.id), ownerA);
const removePayload = unwrap(await read(removeA.id));
const removeVersion = removePayload['version-ref'];

const profileB = await write({ type: 'channel', name: `reaction-b-${Date.now()}` });
const ownerB = await committer(profileB.id);
const rootB = await write(
  reactionMessage({ ref: randomUUID(), version: randomUUID(), target, reaction: 'like', timestamp: Date.now() + 1 }),
  profileB.cookie
);
assert.equal(await committer(rootB.id), ownerB);

const forgedA = await write(
  reactionMessage({
    ref: rootRef,
    version: randomUUID(),
    target,
    reaction: 'like',
    revision: 3,
    root: rootRef,
    previous: removeVersion,
    timestamp: Date.now() + 2,
  }),
  profileB.cookie
);
assert.equal(await committer(forgedA.id), ownerB);

const paths = await query({ schema: NATIVE_REACTION_SCHEMA, type: 'reaction', target, subject: 'content' });
const hydrated = await Promise.all(
  paths.map(async (id) => {
    const payload = unwrap(await read(id));
    return normalizeNativeReaction({
      ...payload,
      'message-id': id,
      'hyperbeam-owner': await committer(id),
    });
  })
);
const reactions = hydrated.filter(Boolean);
for (const id of paths) assert.equal(await verified(id), true);
const versionRefs = new Set(reactions.map((reaction) => reaction.version_ref));
const expectedVersions = [
  rootVersion,
  switchVersion,
  removeVersion,
  unwrap(await read(rootB.id))['version-ref'],
  unwrap(await read(forgedA.id))['version-ref'],
];
const discoveryDetails = JSON.stringify({ target, paths, version_refs: [...versionRefs], expectedVersions });
expectedVersions.forEach((version) => assert.ok(versionRefs.has(version), discoveryDetails));

const current = collapseNativeReactionStates(reactions);
assert.equal(current.find((reaction) => reaction.owner === ownerA)?.state, 'removed');
assert.equal(current.find((reaction) => reaction.owner === ownerB)?.version_ref, expectedVersions[3]);

const projection = projectNativeReactions(reactions, ownerA);
assert.deepEqual(projection.my_reactions, {});
assert.deepEqual(projection.others_reactions, { [target]: { like: 1, dislike: 0 } });

console.log(
  JSON.stringify({
    target,
    owner_a: ownerA,
    owner_b: ownerB,
    like_message_id: rootA.id,
    switch_message_id: switchA.id,
    remove_message_id: removeA.id,
    other_like_message_id: rootB.id,
    forged_revision_ignored: true,
  })
);

function reactionMessage({
  ref,
  version,
  target: reactionTarget,
  reaction,
  state = 'active',
  operation = 'set',
  revision = 0,
  root,
  previous,
  timestamp = Date.now(),
}) {
  return {
    schema: NATIVE_REACTION_SCHEMA,
    type: 'reaction',
    'reaction-ref': ref,
    target: reactionTarget,
    subject: 'content',
    reaction,
    state,
    operation,
    revision,
    'version-ref': version,
    ...(root ? { 'revision-of': root } : {}),
    ...(previous ? { 'previous-version': previous } : {}),
    'event-timestamp': timestamp,
    'signature-scope': NATIVE_REACTION_SIGNATURE_SCOPE,
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
