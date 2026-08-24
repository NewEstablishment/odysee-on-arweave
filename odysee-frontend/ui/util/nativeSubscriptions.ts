export const NATIVE_SUBSCRIPTION_SCHEMA = 'odysee-subscription@1.0';
export const NATIVE_SUBSCRIPTION_TYPE = 'subscription';
export const NATIVE_SUBSCRIPTION_SIGNATURE_SCOPE = 'native-subscription-v1';

export type NativeSubscriptionState = 'active' | 'removed';
export type NativeSubscriptionOperation = 'follow' | 'update' | 'unfollow';
export type NativeSubscriptionOrigin = 'native' | 'legacy-import';

export type NativeSubscription = {
  schema: string;
  type: string;
  subscription_ref: string;
  channel_ref: string;
  channel_uri: string;
  channel_name: string;
  profile_id: string;
  profile_name?: string;
  notifications_disabled: boolean;
  state: NativeSubscriptionState;
  operation: NativeSubscriptionOperation;
  origin: NativeSubscriptionOrigin;
  imported_at?: number;
  revision: number;
  version_ref: string;
  revision_of?: string;
  previous_version?: string;
  created_at: number;
  updated_at: number;
  signature_scope: string;
  message_id: string;
  owner: string;
  [key: string]: any;
};

export function normalizeNativeSubscription(source: any): NativeSubscription | null {
  const notificationsDisabled = boolean(field(source, 'notifications-disabled', 'notifications_disabled'));
  if (notificationsDisabled === null) return null;

  const normalized = {
    ...source,
    schema: String(field(source, 'schema') || ''),
    type: String(field(source, 'type') || ''),
    subscription_ref: String(field(source, 'subscription-ref', 'subscription_ref') || ''),
    channel_ref: String(field(source, 'channel-ref', 'channel_ref') || ''),
    channel_uri: String(field(source, 'channel-uri', 'channel_uri') || ''),
    channel_name: String(field(source, 'channel-name', 'channel_name') || ''),
    profile_id: String(field(source, 'profile-id', 'profile_id') || ''),
    profile_name: optionalString(field(source, 'profile-name', 'profile_name')),
    notifications_disabled: notificationsDisabled,
    state: String(field(source, 'state') || ''),
    operation: String(field(source, 'operation') || ''),
    // `origin` is an HTTP transport header and is intentionally excluded
    // from committed application messages. New writes use `source-system`;
    // retain `origin` last for records created before that separation.
    origin: String(field(source, 'source-system', 'source_system', 'subscription-origin', 'origin') || ''),
    imported_at: optionalInteger(field(source, 'imported-at', 'imported_at')),
    revision: integer(field(source, 'revision'), -1),
    version_ref: String(field(source, 'version-ref', 'version_ref') || ''),
    revision_of: optionalString(field(source, 'revision-of', 'revision_of')),
    previous_version: optionalString(field(source, 'previous-version', 'previous_version')),
    created_at: integer(field(source, 'created-at', 'created_at'), 0),
    updated_at: integer(field(source, 'updated-at', 'updated_at'), 0),
    signature_scope: String(field(source, 'signature-scope', 'signature_scope') || ''),
    message_id: String(field(source, 'message-id', 'message_id', 'hyperbeam_message_id') || '').replace(/^\/+/, ''),
    owner: String(field(source, 'hyperbeam-owner', 'hyperbeam_owner', 'owner') || ''),
  } as NativeSubscription;

  return isValidNativeSubscription(normalized) ? normalized : null;
}

export function isValidNativeSubscription(subscription: NativeSubscription): boolean {
  const rootIsValid =
    !subscription.revision_of &&
    !subscription.previous_version &&
    subscription.revision === 0 &&
    subscription.operation === 'follow' &&
    subscription.state === 'active';
  const revisionIsValid =
    subscription.revision > 0 &&
    subscription.revision_of === subscription.subscription_ref &&
    validReference(subscription.previous_version || '') &&
    ((subscription.operation === 'follow' && subscription.state === 'active') ||
      (subscription.operation === 'update' && subscription.state === 'active') ||
      (subscription.operation === 'unfollow' && subscription.state === 'removed'));
  const importIsValid =
    (subscription.origin === 'native' && subscription.imported_at === undefined) ||
    (subscription.origin === 'legacy-import' && Boolean(subscription.imported_at && subscription.imported_at > 0));

  return Boolean(
    subscription.schema === NATIVE_SUBSCRIPTION_SCHEMA &&
    subscription.type === NATIVE_SUBSCRIPTION_TYPE &&
    subscription.signature_scope === NATIVE_SUBSCRIPTION_SIGNATURE_SCOPE &&
    validSubscriptionRef(subscription.subscription_ref, subscription.owner, subscription.channel_ref) &&
    validChannelRef(subscription.channel_ref) &&
    validChannelUri(subscription.channel_uri) &&
    boundedText(subscription.channel_name, 200) &&
    isNativeMessageId(subscription.profile_id) &&
    (!subscription.profile_name || boundedText(subscription.profile_name, 200)) &&
    validReference(subscription.version_ref) &&
    subscription.created_at > 0 &&
    subscription.updated_at >= subscription.created_at &&
    isNativeMessageId(subscription.message_id) &&
    importIsValid &&
    (rootIsValid || revisionIsValid)
  );
}

export function isNextNativeSubscriptionRevision(
  root: NativeSubscription,
  current: NativeSubscription,
  candidate: NativeSubscription
): boolean {
  return Boolean(
    !root.revision_of &&
    candidate.owner === root.owner &&
    candidate.subscription_ref === root.subscription_ref &&
    candidate.channel_ref === root.channel_ref &&
    candidate.profile_id === root.profile_id &&
    candidate.origin === root.origin &&
    candidate.imported_at === root.imported_at &&
    candidate.created_at === root.created_at &&
    candidate.revision_of === root.subscription_ref &&
    candidate.previous_version === current.version_ref &&
    candidate.revision === current.revision + 1 &&
    candidate.updated_at >= current.updated_at
  );
}

export function collapseNativeSubscriptionStates(subscriptions: Array<NativeSubscription>): Array<NativeSubscription> {
  const valid = subscriptions.filter(isValidNativeSubscription);
  const conflictingRefs = conflictingSubscriptionRefs(valid);
  const unique = uniqueSemanticVersions(valid);
  const bySubscriptionRef = new Map<string, Array<NativeSubscription>>();

  unique.forEach((subscription) => {
    const versions = bySubscriptionRef.get(subscription.subscription_ref) || [];
    versions.push(subscription);
    bySubscriptionRef.set(subscription.subscription_ref, versions);
  });

  const current: Array<NativeSubscription> = [];
  bySubscriptionRef.forEach((versions, subscriptionRef) => {
    if (conflictingRefs.has(subscriptionRef)) return;
    const roots = versions.filter((subscription) => !subscription.revision_of);
    if (roots.length !== 1) return;
    current.push(
      latestRevision(
        roots[0],
        versions.filter((subscription) => Boolean(subscription.revision_of))
      )
    );
  });

  return current.sort(compareSubscriptionHeads);
}

export function activeNativeSubscriptions(subscriptions: Array<NativeSubscription>): Array<NativeSubscription> {
  return collapseNativeSubscriptionStates(subscriptions).filter((subscription) => subscription.state === 'active');
}

export function nativeSubscriptionOwner(subscriptionRef: string): string | null {
  const separator = subscriptionRef.indexOf('.');
  if (separator <= 0) return null;
  const owner = subscriptionRef.slice(0, separator);
  return isNativeMessageId(owner) ? owner : null;
}

export function nativeSubscriptionRef(owner: string, channelRef: string): string {
  if (!isNativeMessageId(owner) || !validChannelRef(channelRef)) {
    throw new Error('A verified owner and stable channel reference are required');
  }
  return `${owner}.${channelRef}`;
}

export function nativeSubscriptionChannelRef(channelId: string): string {
  if (isNativeMessageId(channelId)) return `native:${channelId}`;
  if (/^[0-9a-f]{40}$/i.test(channelId)) return `lbry:${channelId.toLowerCase()}`;
  throw new Error('Subscriptions require a stable native profile ID or full legacy channel claim ID');
}

export function nativeSubscriptionNotificationsDisabled(value?: boolean): boolean {
  return value ?? true;
}

function latestRevision(root: NativeSubscription, revisions: Array<NativeSubscription>): NativeSubscription {
  let current = root;
  while (true) {
    const candidates = revisions.filter((candidate) => isNextNativeSubscriptionRevision(root, current, candidate));
    if (!candidates.length) return current;
    if (candidates.length > 1) return current;
    current = candidates[0];
  }
}

function uniqueSemanticVersions(subscriptions: Array<NativeSubscription>): Array<NativeSubscription> {
  const byVersion = new Map<string, NativeSubscription>();
  subscriptions.forEach((subscription) => {
    const identity = `${subscription.owner}\u0000${subscription.subscription_ref}\u0000${subscription.version_ref}`;
    const existing = byVersion.get(identity);
    if (!existing || subscription.message_id.localeCompare(existing.message_id) < 0) {
      byVersion.set(identity, subscription);
    }
  });
  return Array.from(byVersion.values());
}

function conflictingSubscriptionRefs(subscriptions: Array<NativeSubscription>): Set<string> {
  const semanticByVersion = new Map<string, string>();
  const conflicts = new Set<string>();
  subscriptions.forEach((subscription) => {
    const identity = `${subscription.owner}\u0000${subscription.subscription_ref}\u0000${subscription.version_ref}`;
    const semantic = JSON.stringify({
      channel_ref: subscription.channel_ref,
      channel_uri: subscription.channel_uri,
      channel_name: subscription.channel_name,
      profile_id: subscription.profile_id,
      profile_name: subscription.profile_name,
      notifications_disabled: subscription.notifications_disabled,
      state: subscription.state,
      operation: subscription.operation,
      origin: subscription.origin,
      imported_at: subscription.imported_at,
      revision: subscription.revision,
      revision_of: subscription.revision_of,
      previous_version: subscription.previous_version,
      created_at: subscription.created_at,
      updated_at: subscription.updated_at,
    });
    const existing = semanticByVersion.get(identity);
    if (existing !== undefined && existing !== semantic) conflicts.add(subscription.subscription_ref);
    semanticByVersion.set(identity, semantic);
  });
  return conflicts;
}

function compareSubscriptionHeads(left: NativeSubscription, right: NativeSubscription): number {
  const nameDifference = left.channel_name.localeCompare(right.channel_name);
  if (nameDifference) return nameDifference;
  return left.channel_ref.localeCompare(right.channel_ref);
}

function validSubscriptionRef(subscriptionRef: string, owner: string, channelRef: string): boolean {
  return nativeSubscriptionOwner(subscriptionRef) === owner && subscriptionRef === `${owner}.${channelRef}`;
}

function validChannelRef(channelRef: string): boolean {
  const [kind, id, extra] = channelRef.split(':');
  if (extra !== undefined) return false;
  if (kind === 'native') return isNativeMessageId(id);
  if (kind === 'lbry') return /^[0-9a-f]{40}$/.test(id);
  return false;
}

function validChannelUri(channelUri: string): boolean {
  return channelUri.startsWith('lbry://') && channelUri.length <= 4096 && !hasControlCharacters(channelUri);
}

function validReference(reference: string): boolean {
  return reference.length >= 16 && reference.length <= 193 && !hasControlCharacters(reference);
}

function boundedText(value: string, maxLength: number): boolean {
  return value.trim().length > 0 && value.length <= maxLength && !hasControlCharacters(value);
}

function hasControlCharacters(source: string): boolean {
  return Array.from(source).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function field(source: any, ...keys: Array<string>): any {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) return source[key];
  }
}

function optionalString(source: any): string | undefined {
  return typeof source === 'string' && source ? source : undefined;
}

function boolean(source: any): boolean | null {
  if (source === true || source === 'true' || source === 1 || source === '1') return true;
  if (source === false || source === 'false' || source === 0 || source === '0') return false;
  return null;
}

function optionalInteger(source: any): number | undefined {
  if (source === undefined || source === null || source === '') return undefined;
  const parsed = Math.floor(Number(source));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function integer(source: any, fallback: number): number {
  const parsed = Math.floor(Number(source));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isNativeMessageId(messageId: any): boolean {
  return /^[0-9A-Za-z_-]{41,128}$/.test(String(messageId || ''));
}
