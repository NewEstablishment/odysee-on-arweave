import assert from 'node:assert/strict';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { test } from 'node:test';
import {
  createNativeNotificationInbox,
  enabledNotificationSubscriptions,
  nativeReplyNotifications,
  notificationReceiptMessage,
  notificationReceiptEnvelope,
  parseNotificationReceipt,
  NATIVE_NOTIFICATION_RECEIPT_SCHEMA,
} from '../../ui/util/nativeNotifications.ts';

const id = (letter) => letter.repeat(43);
const viewer = { id: id('p'), owner: id('o') };
const creator = { id: id('c'), owner: id('a') };
const now = Date.now() - 5000;
const root = {
  schema: 'odysee-subscription@1.0',
  type: 'subscription',
  owner: viewer.owner,
  profile_id: viewer.id,
  signature_scope: 'native-subscription-v1',
  subscription_ref: `${viewer.owner}.native:${creator.id}`,
  channel_ref: `native:${creator.id}`,
  channel_name: 'creator',
  channel_uri: `lbry://@creator#${creator.id}`,
  notifications_disabled: true,
  state: 'active',
  operation: 'follow',
  origin: 'native',
  revision: 0,
  version_ref: 'initial-version-0001',
  created_at: now - 20000,
  updated_at: now - 20000,
  message_id: id('s'),
};
const enabled = {
  ...root,
  revision: 1,
  version_ref: 'enabled-version-0001',
  previous_version: root.version_ref,
  revision_of: root.subscription_ref,
  notifications_disabled: false,
  operation: 'update',
  updated_at: now - 10000,
  message_id: id('e'),
};
const parent = {
  comment_id: '92c3bb5e-28b0-40ed-bc97-72ff5bbfd49c',
  comment_ref: 'root-reference',
  hyperbeam_message_id: id('m'),
  hyperbeam_owner: viewer.owner,
  channel_id: viewer.id,
  claim_id: id('v'),
  timestamp: Math.floor(now / 1000) - 20,
  state: 'active',
  comment: 'Parent',
};
const reply = {
  ...parent,
  comment_id: 'b8c58de8-e3c2-448f-949c-87b369b03218',
  comment_ref: 'reply-reference',
  hyperbeam_message_id: id('r'),
  hyperbeam_owner: creator.owner,
  channel_id: creator.id,
  channel_url: `lbry://@creator#${creator.id}`,
  parent_id: parent.comment_id,
  timestamp: Math.floor(now / 1000),
  comment: 'Reply',
};
const claim = {
  permanent_url: `lbry://immutable_${id('v')}`,
  value_type: 'stream',
  value: { title: 'Video', source: { media_type: 'video/mp4' } },
};

function fixture() {
  let identity = viewer;
  const records = new Map();
  const indexed = new Set();
  const keys = new Map([
    [viewer.owner, randomBytes(32)],
    [creator.owner, randomBytes(32)],
  ]);
  const writes = [];
  const controls = {
    subscriptions: [root, enabled],
    comments: [parent, reply],
    queryFailure: false,
    delayReceipts: false,
    writeFailure: false,
    claim,
    indexJunk: [],
  };
  const readRecord = (messageId, payload, owner) => ({ messageId, payload, owner, committers: [owner] });
  records.set(creator.id, readRecord(creator.id, { type: 'channel', name: 'creator' }, creator.owner));
  records.set(
    id('u'),
    readRecord(
      id('u'),
      { schema: 'odysee-upload@1.0', 'channel-id': creator.id, timestamp: Math.floor(now / 1000), 'data-id': id('v') },
      creator.owner
    )
  );
  indexed.add(id('u'));
  const ports = {
    account: () => identity?.id,
    identity: async () => identity,
    subscriptions: async () => controls.subscriptions,
    ownComments: async () => [parent],
    comments: async () => controls.comments,
    claim: async () => controls.claim,
    channelUri: (channelId, name) => `lbry://@${name}#${channelId}`,
    query: async (selectors) => {
      if (controls.queryFailure) throw Error('Query unavailable');
      return [...indexed]
        .filter((key) =>
          Object.entries(selectors).every(([field, value]) => records.get(key)?.payload[field] === value)
        )
        .concat(controls.indexJunk);
    },
    read: async (key) => records.get(key) || null,
    seal: async (plaintext) => {
      const owner = identity.owner;
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', keys.get(owner), iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        algorithm: 'aes-256-gcm',
        key_version: 1,
        owner,
        iv: iv.toString('base64url'),
        ciphertext: ciphertext.toString('base64url'),
        tag: cipher.getAuthTag().toString('base64url'),
      };
    },
    open: async (envelope) => {
      assert.equal(envelope.owner, identity.owner);
      const cipher = createDecipheriv('aes-256-gcm', keys.get(identity.owner), Buffer.from(envelope.iv, 'base64url'));
      cipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
      return Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, 'base64url')), cipher.final()]).toString();
    },
    write: async (payload) => {
      if (controls.writeFailure) throw Error('Write unavailable');
      const messageId = randomBytes(32).toString('base64url');
      records.set(messageId, readRecord(messageId, payload, identity.owner));
      writes.push(payload);
      if (!controls.delayReceipts) indexed.add(messageId);
      return messageId;
    },
  };
  return {
    ports,
    records,
    indexed,
    writes,
    controls,
    inbox: createNativeNotificationInbox(ports),
    setIdentity: (value) => {
      identity = value;
    },
  };
}

test('bell opt-in uses the verified contiguous relationship and its current enabled interval', () => {
  assert.equal(enabledNotificationSubscriptions([root], viewer).length, 0);
  assert.equal(enabledNotificationSubscriptions([enabled, root], viewer)[0].enabled_at, enabled.updated_at);
  const metadata = {
    ...enabled,
    revision: 2,
    version_ref: 'metadata-version',
    previous_version: enabled.version_ref,
    updated_at: now - 5000,
    message_id: id('t'),
  };
  assert.equal(enabledNotificationSubscriptions([metadata, enabled, root], viewer)[0].enabled_at, enabled.updated_at);
  const off = { ...metadata, notifications_disabled: true };
  assert.equal(enabledNotificationSubscriptions([root, enabled, off], viewer).length, 0);
  const on = {
    ...enabled,
    revision: 3,
    previous_version: off.version_ref,
    version_ref: 'enabled-again-0001',
    updated_at: now,
    message_id: id('n'),
  };
  assert.equal(enabledNotificationSubscriptions([root, enabled, off, on], viewer)[0].enabled_at, now);
  assert.equal(enabledNotificationSubscriptions([enabled], viewer).length, 0, 'gapped revision');
  assert.equal(enabledNotificationSubscriptions([root, enabled], creator).length, 0, 'foreign relationship');
});

test('reply IDs survive edits; self, hidden, deleted, unrelated and cyclic threads do not notify', () => {
  const project = (comments) => nativeReplyNotifications(comments, viewer, claim);
  assert.equal(project([parent, reply])[0].id, `reply:${reply.comment_id}`);
  const edit = {
    ...reply,
    comment_id: id('x'),
    hyperbeam_message_id: id('x'),
    revision_of: reply.comment_id,
    comment: 'Edited',
  };
  assert.equal(project([parent, edit])[0].id, `reply:${reply.comment_id}`);
  for (const patch of [
    { hidden: true },
    { state: 'deleted' },
    { blocked: true },
    { hyperbeam_owner: viewer.owner },
    { parent_id: id('z') },
    { claim_id: id('z') },
  ]) {
    assert.equal(project([parent, { ...reply, ...patch }]).length, 0);
  }
  assert.equal(project([{ ...parent, hidden: true }, reply]).length, 0);
  assert.equal(project([{ ...parent, parent_id: reply.comment_id }, reply]).length, 0);
  assert.equal(project([parent, { ...reply, parent_id: parent.comment_ref }]).length, 1);
});

test('inbox joins sources and persists private monotonic receipts across reload, tabs and index lag', async () => {
  const f = fixture();
  const list = await f.inbox.list();
  assert.equal(list.length, 2);
  assert.equal(
    list.every((item) => !item.is_read && !item.is_seen),
    true
  );
  f.controls.delayReceipts = true;
  await Promise.all([
    f.inbox.update([`reply:${reply.comment_id}`], 'read'),
    f.inbox.update([`upload:${id('u')}`], 'seen'),
  ]);
  assert.equal(
    (await f.inbox.list()).filter((item) => item.is_read).length,
    1,
    'acknowledged write survives query lag'
  );
  for (const payload of f.writes) {
    const publicText = JSON.stringify(payload);
    assert.equal(publicText.includes(reply.comment_id), false);
    assert.equal(publicText.includes('plaintext'), false);
    assert.equal(publicText.includes(viewer.id), false);
    assert.equal(publicText.includes('cookie'), false);
    assert.equal(publicText.includes('operation'), false);
  }
  for (const [key, record] of f.records)
    if (record.payload.schema === NATIVE_NOTIFICATION_RECEIPT_SCHEMA) f.indexed.add(key);
  const reloaded = createNativeNotificationInbox(f.ports);
  assert.equal((await reloaded.list()).filter((item) => item.is_read).length, 1);
  assert.equal(
    (await reloaded.list()).every((item) => item.is_seen),
    true
  );
  f.controls.delayReceipts = false;
  await reloaded.update([`upload:${id('u')}`], 'dismiss');
  assert.equal((await f.inbox.list()).length, 1, 'another tab dismissal joins without losing read state');
  assert.equal((await f.inbox.list())[0].is_read, true);
});

test('discovery cannot forge channel ownership, recipient or upload time', async () => {
  const f = fixture();
  const record = f.records.get(id('u'));
  record.owner = viewer.owner;
  assert.equal((await f.inbox.list()).length, 1);
  record.owner = creator.owner;
  record.payload.timestamp = Math.floor((root.created_at - 1000) / 1000);
  assert.equal((await f.inbox.list()).length, 1);
  record.payload.timestamp = Math.floor((Date.now() + 60000) / 1000);
  assert.equal((await f.inbox.list()).length, 1);
  record.payload.timestamp = Math.floor(enabled.updated_at / 1000);
  assert.equal((await f.inbox.list()).length, 2, 'upload and opt-in have second-granularity compatibility');
  f.controls.indexJunk = [id('u')];
  assert.equal((await f.inbox.list()).length, 2, 'a wrong-family receipt candidate is not decrypted');
});

test('failures remain failures and cannot acknowledge an unpersisted read', async () => {
  const f = fixture();
  f.controls.queryFailure = true;
  await assert.rejects(f.inbox.list(), /Query unavailable/);
  f.controls.queryFailure = false;
  f.controls.writeFailure = true;
  await assert.rejects(f.inbox.update([`reply:${reply.comment_id}`], 'read'), /Write unavailable/);
  assert.equal(
    (await f.inbox.list()).every((item) => !item.is_read),
    true
  );
  await assert.rejects(f.inbox.update(['invalid'], 'read'), /Invalid/);
});

test('receipt envelope and plaintext bind the verified owner, family and profile', async () => {
  const f = fixture();
  const plaintext = JSON.stringify({
    schema: NATIVE_NOTIFICATION_RECEIPT_SCHEMA,
    profile: viewer.id,
    operation: 'read',
    ids: [`reply:${reply.comment_id}`],
  });
  const payload = notificationReceiptMessage(await f.ports.seal(plaintext), Date.now());
  const verified = { payload, messageId: id('b'), owner: viewer.owner, committers: [viewer.owner] };
  assert.ok(notificationReceiptEnvelope(verified, viewer.owner));
  assert.equal(notificationReceiptEnvelope({ ...verified, owner: creator.owner }, viewer.owner), null);
  assert.equal(
    notificationReceiptEnvelope(
      { ...verified, payload: { ...payload, schema: 'odysee-preferences@1.0' } },
      viewer.owner
    ),
    null
  );
  assert.equal(parseNotificationReceipt(plaintext, creator.id), null);
  assert.equal(parseNotificationReceipt('{}', viewer.id), null);
});

test('concurrent refreshes share discovery, including the first account load', async () => {
  const f = fixture();
  let release;
  let started;
  const loading = new Promise((resolve) => {
    started = resolve;
  });
  f.ports.ownComments = () =>
    new Promise((resolve) => {
      release = () => resolve([parent]);
      started();
    });
  const first = f.inbox.list();
  await loading;
  const second = f.inbox.list();
  assert.equal(first, second);
  release();
  assert.equal((await first).length, 2);
});

test('wrong exact receipt readback never acknowledges a save, and missing indexed receipts fail closed', async () => {
  const f = fixture();
  f.controls.delayReceipts = true;
  const write = f.ports.write;
  f.ports.write = async () =>
    write(
      notificationReceiptMessage(
        await f.ports.seal(
          JSON.stringify({
            schema: NATIVE_NOTIFICATION_RECEIPT_SCHEMA,
            profile: viewer.id,
            operation: 'seen',
            ids: [`reply:${reply.comment_id}`],
          })
        ),
        Date.now()
      )
    );
  await assert.rejects(f.inbox.update([`reply:${reply.comment_id}`], 'read'), /readback failed/);
  assert.equal(
    (await f.inbox.list()).every((item) => !item.is_read && !item.is_seen),
    true
  );
  f.controls.indexJunk = [id('z')];
  await assert.rejects(f.inbox.list(), /could not be verified/);
});

test('large read operations persist every ID in bounded encrypted receipt batches', async () => {
  const f = fixture();
  const ids = Array.from({ length: 201 }, (_, index) => `reply:batch-reference-${index}`);
  await f.inbox.update(ids, 'read');
  assert.equal(f.writes.length, 2);
  const stored = await Promise.all(f.writes.map((payload) => f.ports.open({ ...payload, owner: viewer.owner })));
  assert.deepEqual(
    stored.flatMap((plaintext) => JSON.parse(plaintext).ids),
    ids
  );
});

test('account changes discard cached plaintext and reject an in-flight private write', async () => {
  const f = fixture();
  await f.inbox.update([`reply:${reply.comment_id}`], 'read');
  f.setIdentity(creator);
  assert.equal((await f.inbox.list()).length, 0);
  f.setIdentity(viewer);
  const originalSeal = f.ports.seal;
  f.ports.seal = async (plaintext) => {
    const envelope = await originalSeal(plaintext);
    f.setIdentity(creator);
    return envelope;
  };
  await assert.rejects(f.inbox.update([`upload:${id('u')}`], 'read'), /account changed/);
  assert.equal(f.writes.length, 1);
  f.setIdentity(null);
  await assert.rejects(f.inbox.list(), /Sign in/);
});
