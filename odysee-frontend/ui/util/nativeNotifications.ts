import { field, isNativeMessageId } from './nativeMessageFields.ts';
import { collapseNativeSubscriptionStates, type NativeSubscription } from './nativeSubscriptions.ts';
import {
  nativePreferenceSnapshotMessage,
  normalizeNativePreferenceSnapshot,
  type NativePreferenceEnvelope,
} from './nativePreferences.ts';
import type { VerifiedNativeMessage } from './nativeMessageVerification.ts';

export const NATIVE_NOTIFICATION_RECEIPT_SCHEMA = 'odysee-notification-receipt@1.0';
const RECEIPT_SCOPE = 'native-notification-receipt-v1';
const MAX_RECEIPT_IDS = 200;
const MAX_QUERY_PATHS = 10000;

export type NotificationReceiptOperation = 'read' | 'seen' | 'dismiss';
export type NotificationIdentity = { id: string; owner: string };
export type NotificationReceipt = {
  schema: string;
  profile: string;
  operation: NotificationReceiptOperation;
  ids: Array<string>;
};
type NotificationPorts = {
  account: () => string | undefined;
  identity: () => Promise<NotificationIdentity | null>;
  query: (selectors: Record<string, any>) => Promise<Array<string>>;
  read: (id: string) => Promise<VerifiedNativeMessage | null>;
  subscriptions: (profile: string) => Promise<Array<NativeSubscription>>;
  ownComments: (profile: string) => Promise<Array<any>>;
  comments: (target: string) => Promise<Array<any>>;
  claim: (id: string) => Promise<any | null>;
  channelUri: (id: string, name: string) => string;
  seal: (plaintext: string) => Promise<NativePreferenceEnvelope>;
  open: (envelope: Record<string, any>) => Promise<string>;
  write: (message: Record<string, any>) => Promise<string>;
};

export function notificationReceiptMessage(envelope: NativePreferenceEnvelope, timestamp: number) {
  return {
    ...nativePreferenceSnapshotMessage(envelope, timestamp),
    schema: NATIVE_NOTIFICATION_RECEIPT_SCHEMA,
    type: 'notification-receipt',
    'signature-scope': RECEIPT_SCOPE,
  };
}

export function notificationReceiptEnvelope(verified: VerifiedNativeMessage, owner: string) {
  const payload = verified.payload;
  if (
    verified.owner !== owner ||
    field(payload, 'schema') !== NATIVE_NOTIFICATION_RECEIPT_SCHEMA ||
    field(payload, 'type') !== 'notification-receipt' ||
    field(payload, 'signature-scope', 'signature_scope') !== RECEIPT_SCOPE
  )
    return null;
  return normalizeNativePreferenceSnapshot({
    ...payload,
    schema: 'odysee-preferences@1.0',
    type: 'preferences',
    'signature-scope': 'native-preferences-v1',
    'message-id': verified.messageId,
    'hyperbeam-owner': verified.owner,
  });
}

export function parseNotificationReceipt(plaintext: string, profile: string): NotificationReceipt | null {
  try {
    const receipt = JSON.parse(plaintext);
    if (
      receipt.schema !== NATIVE_NOTIFICATION_RECEIPT_SCHEMA ||
      receipt.profile !== profile ||
      !['read', 'seen', 'dismiss'].includes(receipt.operation) ||
      !Array.isArray(receipt.ids) ||
      !receipt.ids.length ||
      receipt.ids.length > MAX_RECEIPT_IDS ||
      !receipt.ids.every(validNotificationId)
    )
      return null;
    return { schema: receipt.schema, profile, operation: receipt.operation, ids: [...new Set<string>(receipt.ids)] };
  } catch {
    return null;
  }
}

function validNotificationId(id: any): id is string {
  return typeof id === 'string' && /^(?:reply:[A-Za-z0-9_-]{16,128}|upload:[A-Za-z0-9_-]{43})$/.test(id);
}

export function applyNotificationReceipts(notifications: Array<WebNotification>, receipts: Array<NotificationReceipt>) {
  const read = new Set<string>();
  const seen = new Set<string>();
  const dismissed = new Set<string>();
  for (const receipt of receipts) {
    for (const id of receipt.ids) {
      seen.add(id);
      if (receipt.operation === 'read' || receipt.operation === 'dismiss') read.add(id);
      if (receipt.operation === 'dismiss') dismissed.add(id);
    }
  }
  return notifications
    .filter((item) => !dismissed.has(String(item.id)))
    .map((item) => ({
      ...item,
      is_read: read.has(String(item.id)),
      is_seen: seen.has(String(item.id)),
    }));
}

export function enabledNotificationSubscriptions(versions: Array<NativeSubscription>, identity: NotificationIdentity) {
  const owned = versions.filter((item) => item.owner === identity.owner && item.profile_id === identity.id);
  return collapseNativeSubscriptionStates(owned)
    .filter(
      (head) =>
        head.state === 'active' &&
        !head.notifications_disabled &&
        head.channel_ref.startsWith('native:') &&
        isNativeMessageId(head.channel_ref.slice(7))
    )
    .map((head) => {
      let current = head;
      while (current.previous_version) {
        const previous = owned.find(
          (item) =>
            item.subscription_ref === head.subscription_ref &&
            item.version_ref === current.previous_version &&
            item.revision === current.revision - 1
        );
        if (!previous || previous.state !== 'active' || previous.notifications_disabled) break;
        current = previous;
      }
      return { ...head, channel_id: head.channel_ref.slice(7), enabled_at: current.updated_at };
    });
}

function visibleComment(comment: any) {
  return (
    comment &&
    !comment.removed &&
    !comment.hidden &&
    !comment.blocked &&
    comment.state !== 'deleted' &&
    comment.operation !== 'delete'
  );
}

export function nativeReplyNotifications(comments: Array<any>, identity: NotificationIdentity, target: any) {
  const byAlias = new Map<string, any>();
  for (const comment of comments) {
    for (const alias of [
      comment.comment_id,
      comment.revision_of,
      comment.comment_ref,
      comment.hyperbeam_message_id,
      comment.version_ref,
    ]) {
      if (alias) byAlias.set(alias, comment);
    }
  }
  const notifications: Array<WebNotification> = [];
  for (const comment of comments) {
    const rootId = comment.revision_of || comment.comment_id;
    const parent = byAlias.get(comment.parent_id);
    if (
      !validNotificationId(`reply:${rootId}`) ||
      !visibleComment(comment) ||
      !visibleComment(parent) ||
      parent.hyperbeam_owner !== identity.owner ||
      parent.channel_id !== identity.id ||
      comment.hyperbeam_owner === identity.owner ||
      !comment.hyperbeam_owner ||
      comment.claim_id !== parent.claim_id ||
      !target?.permanent_url ||
      target?.hyperbeam?.content_restriction
    )
      continue;
    let ancestor = parent;
    const visited = new Set<any>();
    while (ancestor && visibleComment(ancestor) && !visited.has(ancestor)) {
      visited.add(ancestor);
      ancestor = byAlias.get(ancestor.parent_id);
    }
    if (ancestor) continue;
    const timestamp = Number(comment.timestamp) * 1000;
    if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now()) continue;
    notifications.push(
      notification(`reply:${rootId}`, 'comment-reply', timestamp, {
        device: { target: target.permanent_url, title: 'New reply', text: comment.comment || '' },
        dynamic: {
          hash: rootId,
          comment_id: rootId,
          claim_id: comment.claim_id,
          comment: comment.comment || '',
          reply_author: comment.channel_url,
          comment_author: comment.channel_url,
          claim_title: target.value?.title || target.name || '',
        },
      })
    );
  }
  return notifications;
}

function notification(
  id: string,
  rule: string,
  timestamp: number,
  parameters: WebNotification['notification_parameters']
): WebNotification {
  const date = new Date(timestamp).toISOString();
  return {
    id,
    notification_rule: rule,
    notification_parameters: parameters,
    active_at: date,
    created_at: date,
    is_read: false,
    is_seen: false,
    type: rule === 'comment-reply' ? 'comments' : 'new_content',
  };
}

async function mapBounded<T, R>(items: Array<T>, read: (item: T) => Promise<R>): Promise<Array<R>> {
  if (items.length > MAX_QUERY_PATHS) throw new Error('This inbox exceeds the current query limit.');
  const results: Array<R> = Array.from({ length: items.length });
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await read(items[index]);
      }
    })
  );
  return results;
}

export function createNativeNotificationInbox(ports: NotificationPorts) {
  let session = '';
  let generation = 0;
  const receipts = new Map<string, NotificationReceipt>();
  let inFlight: Promise<Array<WebNotification>> | undefined;

  function reset() {
    session = '';
    generation++;
    receipts.clear();
    inFlight = undefined;
  }

  async function context() {
    const profile = ports.account();
    if (session && !session.startsWith(`${profile}:`)) reset();
    const identity = await ports.identity();
    if (!identity || identity.id !== ports.account()) throw new Error('Sign in to view notifications.');
    const key = `${identity.id}:${identity.owner}`;
    if (key !== session) {
      generation++;
      receipts.clear();
      session = key;
    }
    const version = generation;
    const check = () => {
      if (version !== generation || session !== key || ports.account() !== identity.id) {
        throw new Error('The notification account changed. Please retry.');
      }
    };
    return { identity, check };
  }

  async function readReceipt(id: string, identity: NotificationIdentity, check: () => void, retain = true) {
    if (retain && receipts.has(id)) return receipts.get(id);
    const verified = await ports.read(id);
    check();
    if (!verified) throw new Error('A notification receipt could not be verified. Please retry.');
    const envelope = notificationReceiptEnvelope(verified, identity.owner);
    if (!envelope) return null;
    const plaintext = await ports.open({
      algorithm: envelope.algorithm,
      'key-version': envelope.key_version,
      owner: envelope.encrypted_for,
      iv: envelope.iv,
      ciphertext: envelope.ciphertext,
      tag: envelope.tag,
    });
    check();
    const receipt = parseNotificationReceipt(plaintext, identity.id);
    if (receipt && retain) receipts.set(id, receipt);
    return receipt;
  }

  async function load() {
    const { identity, check } = await context();
    const [subscriptions, ownComments, receiptPaths] = await Promise.all([
      ports.subscriptions(identity.id),
      ports.ownComments(identity.id),
      ports.query({ schema: NATIVE_NOTIFICATION_RECEIPT_SCHEMA, 'encrypted-for': identity.owner }),
    ]);
    check();
    await mapBounded([...new Set(receiptPaths)], (id) => readReceipt(id, identity, check));
    const targets = [
      ...new Set<string>(
        ownComments
          .filter(
            (item) => item.hyperbeam_owner === identity.owner && item.channel_id === identity.id && visibleComment(item)
          )
          .map((item) => item.claim_id)
      ),
    ];
    const replies = await mapBounded(targets, async (id) => {
      check();
      const [comments, target] = await Promise.all([ports.comments(id), ports.claim(id)]);
      return nativeReplyNotifications(comments, identity, target);
    });
    const uploads = await mapBounded(
      enabledNotificationSubscriptions(subscriptions, identity),
      async (subscription) => {
        check();
        const channel = await ports.read(subscription.channel_id);
        if (!channel || field(channel.payload, 'type') !== 'channel' || channel.owner === identity.owner) return [];
        const paths = await ports.query({ schema: 'odysee-upload@1.0', 'channel-id': subscription.channel_id });
        return mapBounded([...new Set(paths)], async (id) => {
          check();
          const upload = await ports.read(id);
          if (
            !upload ||
            upload.owner !== channel.owner ||
            field(upload.payload, 'schema') !== 'odysee-upload@1.0' ||
            field(upload.payload, 'channel-id', 'channel_id') !== subscription.channel_id ||
            field(upload.payload, 'revision-of', 'revision_of') ||
            field(upload.payload, 'state') === 'deleted'
          )
            return null;
          const timestamp = Number(field(upload.payload, 'timestamp')) * 1000;
          if (
            !Number.isFinite(timestamp) ||
            timestamp < Math.floor(subscription.enabled_at / 1000) * 1000 ||
            timestamp > Date.now()
          )
            return null;
          const claim = await ports.claim(id);
          if (!claim?.permanent_url || claim.value_type !== 'stream' || !claim.value?.source) return null;
          const channelName = String(field(channel.payload, 'name') || '');
          return notification(`upload:${id}`, 'new_content', timestamp, {
            device: { target: claim.permanent_url, title: 'New upload', text: claim.value?.title || claim.name || '' },
            dynamic: {
              claim_id: id,
              channel_url: ports.channelUri(subscription.channel_id, channelName),
              claim_thumbnail: claim.value?.thumbnail?.url,
            },
          });
        });
      }
    );
    check();
    const byId = new Map<string | number, WebNotification>();
    for (const item of [...replies.flat(), ...uploads.flat()]) if (item) byId.set(item.id, item);
    return applyNotificationReceipts([...byId.values()], [...receipts.values()]).sort(
      (a, b) => b.active_at.localeCompare(a.active_at) || String(a.id).localeCompare(String(b.id))
    );
  }

  function list() {
    if (session && !session.startsWith(`${ports.account()}:`)) reset();
    if (!inFlight) {
      const request = load().finally(() => {
        if (inFlight === request) inFlight = undefined;
      });
      inFlight = request;
    }
    return inFlight;
  }

  async function update(ids: Array<string | number>, operation: NotificationReceiptOperation) {
    const { identity, check } = await context();
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.every(validNotificationId) || !['read', 'seen', 'dismiss'].includes(operation)) {
      throw new Error('Invalid notification receipt.');
    }
    for (let offset = 0; offset < uniqueIds.length; offset += MAX_RECEIPT_IDS) {
      const receipt: NotificationReceipt = {
        schema: NATIVE_NOTIFICATION_RECEIPT_SCHEMA,
        profile: identity.id,
        operation,
        ids: uniqueIds.slice(offset, offset + MAX_RECEIPT_IDS),
      };
      check();
      const envelope = await ports.seal(JSON.stringify(receipt));
      check();
      if (envelope.owner !== identity.owner) throw new Error('Notification encryption owner mismatch.');
      const id = await ports.write(notificationReceiptMessage(envelope, Date.now()));
      check();
      const written = await readReceipt(id, identity, check, false);
      if (JSON.stringify(written) !== JSON.stringify(receipt)) throw new Error('Notification receipt readback failed.');
      receipts.set(id, written);
    }
  }

  return { list, update, reset };
}
