export const NATIVE_COMMENT_CONTROL_SCHEMA = 'odysee-comment-control@1.0';
export const NATIVE_COMMENT_CONTROL_TYPE = 'comment-control';
export const NATIVE_COMMENT_CONTROL_SIGNATURE_SCOPE = 'native-comment-control-v1';

export type NativeCommentControl = {
  hyperbeam_message_id?: string;
  schema?: string;
  type?: string;
  control?: string;
  action?: string;
  authority?: string;
  target?: string;
  comment_id?: string;
  subject?: string;
  owner?: string;
  actor?: string;
  actor_name?: string;
  source_system?: string;
  event_timestamp?: number;
  expires_at?: number;
  signature_scope?: string;
  signature?: string;
  signing_ts?: string;
  [key: string]: any;
};

export type NativeCommentControlContext = {
  target: string;
  owner: string | null;
  comment?: Record<string, any>;
};

export type NativeCommentControlProjection = {
  removed: boolean;
  hidden: boolean;
  blocked: boolean;
  is_pinned: boolean;
  creator_liked: boolean;
};

export type NativeCommentBlockImport = {
  subject: string;
  subject_name: string;
  expires_at?: number;
};

export function nativeCommentControlSignatureData(control: NativeCommentControl): string {
  return `odysee-native-comment-control-v1:${stableJson(
    compact({
      schema: field(control, 'schema'),
      type: field(control, 'type'),
      control: field(control, 'control'),
      action: field(control, 'action'),
      authority: field(control, 'authority'),
      target: field(control, 'target'),
      'comment-id': field(control, 'comment-id', 'comment_id'),
      subject: field(control, 'subject'),
      owner: field(control, 'owner'),
      actor: field(control, 'actor', 'channel-id', 'channel_id'),
      'actor-name': field(control, 'actor-name', 'actor_name', 'channel-name', 'channel_name'),
      'source-system': field(control, 'source-system', 'source_system'),
      'event-timestamp': numberField(control, 'event-timestamp', 'event_timestamp'),
      'expires-at': numberField(control, 'expires-at', 'expires_at'),
      'signature-scope': field(control, 'signature-scope', 'signature_scope'),
    })
  )}`;
}

export function normalizeNativeCommentControl(source: NativeCommentControl): NativeCommentControl {
  return compact({
    ...source,
    hyperbeam_message_id: field(source, 'message-id', 'message_id', 'hyperbeam_message_id', 'id'),
    schema: field(source, 'schema'),
    type: field(source, 'type'),
    control: field(source, 'control'),
    action: field(source, 'action'),
    authority: field(source, 'authority'),
    target: field(source, 'target'),
    comment_id: field(source, 'comment-id', 'comment_id'),
    subject: field(source, 'subject'),
    owner: field(source, 'owner'),
    actor: field(source, 'actor', 'channel-id', 'channel_id'),
    actor_name: field(source, 'actor-name', 'actor_name', 'channel-name', 'channel_name'),
    source_system: field(source, 'source-system', 'source_system'),
    event_timestamp: numberField(source, 'event-timestamp', 'event_timestamp'),
    expires_at: numberField(source, 'expires-at', 'expires_at'),
    signature_scope: field(source, 'signature-scope', 'signature_scope'),
    signature: field(source, 'channel-signature', 'signature'),
    signing_ts: field(source, 'signing-ts', 'signing_ts'),
  });
}

export function latestNativeCommentControls(controls: Array<NativeCommentControl>): Map<string, NativeCommentControl> {
  const latest = new Map<string, NativeCommentControl>();
  controls.map(normalizeNativeCommentControl).forEach((control) => {
    const key = nativeCommentControlKey(control);
    if (!key) return;
    const current = latest.get(key);
    if (!current || compareNativeCommentControls(current, control) < 0) latest.set(key, control);
  });
  return latest;
}

export function nativeCommentControlKey(control: NativeCommentControl): string | null {
  const normalized = normalizeNativeCommentControl(control);
  if (normalized.control === 'visibility' && normalized.comment_id && normalized.authority) {
    return `visibility:${normalized.authority}:${normalized.comment_id}`;
  }
  if ((normalized.control === 'pin' || normalized.control === 'creator-like') && normalized.comment_id) {
    return `${normalized.control}:${normalized.comment_id}`;
  }
  if (normalized.control === 'block' && normalized.owner && normalized.subject) {
    return `block:${normalized.owner}:${normalized.subject}`;
  }
  return null;
}

export function isNativeCommentControlEnabled(control: NativeCommentControl | undefined, now = Date.now()): boolean {
  if (!control) return false;
  const normalized = normalizeNativeCommentControl(control);
  if (normalized.control === 'visibility') return normalized.action === 'hidden';
  if (normalized.control === 'pin') return normalized.action === 'pinned';
  if (normalized.control === 'creator-like') return normalized.action === 'liked';
  if (normalized.control !== 'block' || normalized.action !== 'blocked') return false;
  return !normalized.expires_at || normalized.expires_at * 1000 > now;
}

export function hasNativeCommentControlAuthority(
  control: NativeCommentControl,
  context: NativeCommentControlContext
): boolean {
  const normalized = normalizeNativeCommentControl(control);
  const { target, owner, comment } = context;
  if (normalized.control === 'block') {
    return Boolean(
      owner &&
      normalized.target === owner &&
      normalized.owner === owner &&
      normalized.actor === owner &&
      normalized.authority === 'owner' &&
      normalized.subject &&
      ['blocked', 'unblocked'].includes(String(normalized.action))
    );
  }

  const commentId = field(comment, 'comment-id', 'comment_id');
  const commentTarget = field(comment, 'claim-id', 'claim_id', 'target');
  const commentAuthor = field(comment, 'channel-id', 'channel_id', 'author');
  if (!comment || normalized.comment_id !== commentId || normalized.target !== target || commentTarget !== target) {
    return false;
  }
  if (normalized.control === 'visibility') {
    if (!['hidden', 'visible'].includes(String(normalized.action))) return false;
    if (normalized.authority === 'author') return normalized.actor === commentAuthor;
    return Boolean(
      owner && normalized.owner === owner && normalized.authority === 'owner' && normalized.actor === owner
    );
  }
  if (normalized.control === 'pin') {
    const parent = field(comment, 'parent-id', 'parent_id', 'parent');
    return Boolean(
      owner &&
      normalized.owner === owner &&
      normalized.authority === 'owner' &&
      normalized.actor === owner &&
      (!parent || parent === 'root') &&
      ['pinned', 'unpinned'].includes(String(normalized.action))
    );
  }
  if (normalized.control === 'creator-like') {
    return Boolean(
      owner &&
      normalized.owner === owner &&
      normalized.authority === 'owner' &&
      normalized.actor === owner &&
      ['liked', 'unliked'].includes(String(normalized.action))
    );
  }
  return false;
}

export function projectNativeCommentControlState(
  comment: Record<string, any>,
  owner: string | null,
  controls: Map<string, NativeCommentControl>
): NativeCommentControlProjection {
  const commentId = String(field(comment, 'comment-id', 'comment_id') || '');
  const author = String(field(comment, 'channel-id', 'channel_id', 'author') || '');
  const removed = isNativeCommentControlEnabled(controls.get(`visibility:author:${commentId}`));
  const hidden = isNativeCommentControlEnabled(controls.get(`visibility:owner:${commentId}`));
  const blocked = Boolean(owner && author && isNativeCommentControlEnabled(controls.get(`block:${owner}:${author}`)));
  const suppressed = removed || hidden || blocked;
  return {
    removed,
    hidden,
    blocked,
    is_pinned: !suppressed && isNativeCommentControlEnabled(controls.get(`pin:${commentId}`)),
    creator_liked: isNativeCommentControlEnabled(controls.get(`creator-like:${commentId}`)),
  };
}

export function legacyBlockControlsToImport(
  legacyChannels: Array<Record<string, any>>,
  nativeStates: Array<Record<string, any>>,
  now = Date.now()
): Array<NativeCommentBlockImport> {
  const nativeSubjects = new Set(nativeStates.map((entry) => String(entry?.blocked_channel_id || '')).filter(Boolean));
  return legacyChannels.flatMap((entry) => {
    const subject = String(entry?.blocked_channel_id || '');
    if (!subject || entry?.blocked === false || nativeSubjects.has(subject)) return [];
    nativeSubjects.add(subject);
    return [
      compact({
        subject,
        subject_name: String(entry?.blocked_channel_name || subject),
        expires_at: legacyBlockExpiresAt(entry, now),
      }),
    ];
  });
}

function compareNativeCommentControls(left: NativeCommentControl, right: NativeCommentControl): number {
  const timestampDifference = Number(left.event_timestamp || 0) - Number(right.event_timestamp || 0);
  if (timestampDifference) return timestampDifference;
  return String(left.hyperbeam_message_id || '').localeCompare(String(right.hyperbeam_message_id || ''));
}

function field(source: Record<string, any> | undefined, ...keys: Array<string>): any {
  if (!source) return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function numberField(source: NativeCommentControl, ...keys: Array<string>): number | undefined {
  const sourceValue = field(source, ...keys);
  if (sourceValue === undefined) return undefined;
  const parsed = Number(sourceValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function legacyBlockExpiresAt(entry: Record<string, any>, now: number): number | undefined {
  const nowSeconds = Math.floor(now / 1000);
  const remaining = Number(entry?.ban_remaining);
  if (Number.isFinite(remaining) && remaining > 0) return nowSeconds + Math.ceil(remaining);

  const duration = Number(entry?.banned_for);
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  const source = entry?.blocked_at;
  const numeric = Number(source);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric > 1e12 ? numeric / 1000 : numeric) + duration;
  }
  const parsed = Date.parse(String(source || ''));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) + duration : undefined;
}

function compact<T extends Record<string, any>>(source: T): T {
  return Object.fromEntries(Object.entries(source).filter(([, sourceValue]) => sourceValue !== undefined)) as T;
}

function stableJson(source: any): string {
  if (!source || typeof source !== 'object') return JSON.stringify(source);
  if (Array.isArray(source)) return `[${source.map(stableJson).join(',')}]`;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`)
    .join(',')}}`;
}
