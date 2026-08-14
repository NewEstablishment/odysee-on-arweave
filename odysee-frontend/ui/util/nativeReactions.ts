export const NATIVE_REACTION_SCHEMA = 'odysee-reaction@1.0';
export const NATIVE_REACTION_TYPE = 'reaction';
export const NATIVE_REACTION_SIGNATURE_SCOPE = 'native-reaction-v1';

export type NativeReactionKind = 'like' | 'dislike';
export type NativeReactionSubject = 'content' | 'comment';

export type NativeReaction = {
  schema: string;
  type: string;
  reaction_ref: string;
  target: string;
  subject: NativeReactionSubject;
  reaction: NativeReactionKind;
  state: 'active' | 'removed';
  operation: 'set' | 'remove';
  revision: number;
  version_ref: string;
  revision_of?: string;
  previous_version?: string;
  event_timestamp: number;
  signature_scope: string;
  message_id: string;
  owner: string;
  profile_id?: string;
  profile_name?: string;
  [key: string]: any;
};

export type NativeReactionProjection = {
  current: Array<NativeReaction>;
  my_reactions: Record<string, Record<NativeReactionKind, number>>;
  others_reactions: Record<string, Record<NativeReactionKind, number>>;
};

export function normalizeNativeReaction(source: any): NativeReaction | null {
  const revision = integer(field(source, 'revision'), -1);
  const normalized = {
    ...source,
    schema: String(field(source, 'schema') || ''),
    type: String(field(source, 'type') || ''),
    reaction_ref: String(field(source, 'reaction-ref', 'reaction_ref') || ''),
    target: String(field(source, 'target', 'target-id', 'target_id') || ''),
    subject: String(field(source, 'subject', 'subject-type', 'subject_type') || ''),
    reaction: String(field(source, 'reaction') || ''),
    state: String(field(source, 'state') || ''),
    operation: String(field(source, 'operation') || ''),
    revision,
    version_ref: String(field(source, 'version-ref', 'version_ref') || ''),
    revision_of: optionalString(field(source, 'revision-of', 'revision_of')),
    previous_version: optionalString(field(source, 'previous-version', 'previous_version')),
    event_timestamp: integer(field(source, 'event-timestamp', 'event_timestamp'), 0),
    signature_scope: String(field(source, 'signature-scope', 'signature_scope') || ''),
    message_id: String(field(source, 'message-id', 'message_id', 'hyperbeam_message_id') || '').replace(/^\/+/, ''),
    owner: String(field(source, 'hyperbeam-owner', 'hyperbeam_owner', 'owner') || ''),
    profile_id: optionalString(field(source, 'profile-id', 'profile_id', 'author')),
    profile_name: optionalString(field(source, 'profile-name', 'profile_name')),
  } as NativeReaction;

  return isValidNativeReaction(normalized) ? normalized : null;
}

export function isValidNativeReaction(reaction: NativeReaction): boolean {
  const rootIsValid =
    !reaction.revision_of &&
    !reaction.previous_version &&
    reaction.revision === 0 &&
    reaction.operation === 'set' &&
    reaction.state === 'active';
  const revisionIsValid =
    Boolean(
      reaction.revision_of &&
      reaction.previous_version &&
      validReference(reaction.revision_of) &&
      validReference(reaction.previous_version)
    ) &&
    reaction.revision > 0 &&
    ((reaction.operation === 'set' && reaction.state === 'active') ||
      (reaction.operation === 'remove' && reaction.state === 'removed'));

  return Boolean(
    reaction.schema === NATIVE_REACTION_SCHEMA &&
    reaction.type === NATIVE_REACTION_TYPE &&
    reaction.signature_scope === NATIVE_REACTION_SIGNATURE_SCOPE &&
    validReference(reaction.reaction_ref) &&
    validReference(reaction.version_ref) &&
    validTarget(reaction.target) &&
    (reaction.subject === 'content' || reaction.subject === 'comment') &&
    (reaction.reaction === 'like' || reaction.reaction === 'dislike') &&
    isNativeMessageId(reaction.message_id) &&
    reaction.owner &&
    reaction.owner.length <= 1024 &&
    reaction.event_timestamp > 0 &&
    (rootIsValid || revisionIsValid)
  );
}

export function isNextNativeReactionRevision(
  root: NativeReaction,
  current: NativeReaction,
  candidate: NativeReaction
): boolean {
  return Boolean(
    !root.revision_of &&
    candidate.owner === root.owner &&
    candidate.target === root.target &&
    candidate.subject === root.subject &&
    candidate.reaction_ref === root.reaction_ref &&
    candidate.revision_of === root.reaction_ref &&
    candidate.previous_version === current.version_ref &&
    candidate.revision === current.revision + 1
  );
}

export function collapseNativeReactionStates(reactions: Array<NativeReaction>): Array<NativeReaction> {
  const unique = uniqueReactions(reactions).filter(isValidNativeReaction);
  const roots = unique.filter((reaction) => !reaction.revision_of);
  const revisionsByRoot = new Map<string, Array<NativeReaction>>();

  unique.forEach((reaction) => {
    if (!reaction.revision_of) return;
    const revisions = revisionsByRoot.get(reaction.revision_of) || [];
    revisions.push(reaction);
    revisionsByRoot.set(reaction.revision_of, revisions);
  });

  const tips = roots.map((root) => latestRevision(root, revisionsByRoot.get(root.reaction_ref) || []));
  const byIdentity = new Map<string, NativeReaction>();
  tips.forEach((reaction) => {
    const key = `${reaction.subject}\u0000${reaction.target}\u0000${reaction.owner}`;
    const existing = byIdentity.get(key);
    if (!existing || compareReactionEvents(existing, reaction) < 0) byIdentity.set(key, reaction);
  });
  return Array.from(byIdentity.values());
}

export function projectNativeReactions(
  reactions: Array<NativeReaction>,
  viewerOwner?: string | null
): NativeReactionProjection {
  const current = collapseNativeReactionStates(reactions);
  const myReactions: NativeReactionProjection['my_reactions'] = {};
  const othersReactions: NativeReactionProjection['others_reactions'] = {};

  current.forEach((reaction) => {
    if (reaction.state !== 'active') return;
    const destination = viewerOwner && reaction.owner === viewerOwner ? myReactions : othersReactions;
    const counts = destination[reaction.target] || { like: 0, dislike: 0 };
    counts[reaction.reaction] += 1;
    destination[reaction.target] = counts;
  });

  return { current, my_reactions: myReactions, others_reactions: othersReactions };
}

export function validNativeReactionTarget(target: any): target is string {
  return validTarget(String(target || ''));
}

export function nativeReactionToggleRemoves(
  current: NativeReaction | null | undefined,
  reaction: NativeReactionKind
): boolean {
  return current?.state === 'active' && current.reaction === reaction;
}

function latestRevision(root: NativeReaction, revisions: Array<NativeReaction>): NativeReaction {
  let current = root;
  while (true) {
    const candidates = revisions
      .filter((candidate) => isNextNativeReactionRevision(root, current, candidate))
      .sort(compareReactionEvents);
    if (!candidates.length) return current;
    current = candidates[candidates.length - 1];
  }
}

function compareReactionEvents(left: NativeReaction, right: NativeReaction): number {
  const timestampDifference = left.event_timestamp - right.event_timestamp;
  if (timestampDifference) return timestampDifference;
  const revisionDifference = left.revision - right.revision;
  if (revisionDifference) return revisionDifference;
  return left.message_id.localeCompare(right.message_id);
}

function uniqueReactions(reactions: Array<NativeReaction>): Array<NativeReaction> {
  const seen = new Set<string>();
  return reactions.filter((reaction) => {
    const identity = `${reaction.subject}\u0000${reaction.target}\u0000${reaction.owner}\u0000${reaction.reaction_ref}\u0000${reaction.version_ref}`;
    if (!reaction.message_id || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function validReference(reference: string): boolean {
  return reference.length >= 16 && reference.length <= 128 && !hasControlCharacters(reference);
}

function validTarget(target: string): boolean {
  return target.length > 0 && target.length <= 1024 && !hasControlCharacters(target);
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

function integer(source: any, fallback: number): number {
  const parsed = Math.floor(Number(source));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isNativeMessageId(messageId: any): boolean {
  return /^[0-9A-Za-z_-]{41,128}$/.test(String(messageId || ''));
}
