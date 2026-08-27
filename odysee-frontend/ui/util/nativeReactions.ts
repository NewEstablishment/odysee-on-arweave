import {
  field,
  integer,
  isNativeMessageId,
  normalizeMessageId,
  optionalString,
  validReference,
  validTarget,
} from './nativeMessageFields.ts';
import { collapseChains, compareByEvent, latestByKey, type CollapseSpec } from './revisionedMessage.ts';

export const NATIVE_REACTION_SCHEMA = 'odysee-reaction@1.0';
export const NATIVE_REACTION_TYPE = 'reaction';
export const NATIVE_REACTION_SIGNATURE_SCOPE = 'native-reaction-v1';

const MAX_REACTION_REFERENCE_LENGTH = 128;

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
    revision: integer(field(source, 'revision'), -1),
    version_ref: String(field(source, 'version-ref', 'version_ref') || ''),
    revision_of: optionalString(field(source, 'revision-of', 'revision_of')),
    previous_version: optionalString(field(source, 'previous-version', 'previous_version')),
    event_timestamp: integer(field(source, 'event-timestamp', 'event_timestamp'), 0),
    signature_scope: String(field(source, 'signature-scope', 'signature_scope') || ''),
    message_id: normalizeMessageId(field(source, 'message-id', 'message_id', 'hyperbeam_message_id')),
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
      validRef(reaction.revision_of) &&
      validRef(reaction.previous_version)
    ) &&
    reaction.revision > 0 &&
    ((reaction.operation === 'set' && reaction.state === 'active') ||
      (reaction.operation === 'remove' && reaction.state === 'removed'));

  return Boolean(
    reaction.schema === NATIVE_REACTION_SCHEMA &&
    reaction.type === NATIVE_REACTION_TYPE &&
    reaction.signature_scope === NATIVE_REACTION_SIGNATURE_SCOPE &&
    validRef(reaction.reaction_ref) &&
    validRef(reaction.version_ref) &&
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

const compareReactionEvents = compareByEvent<NativeReaction>(
  (reaction) => reaction.event_timestamp,
  (reaction) => reaction.revision,
  (reaction) => reaction.message_id
);

const reactionChainSpec: CollapseSpec<NativeReaction> = {
  rootRef: (reaction) => reaction.reaction_ref,
  revisionOf: (reaction) => reaction.revision_of,
  isNext: isNextNativeReactionRevision,
  versionIdentity: (reaction) =>
    `${reaction.subject}\u0000${reaction.target}\u0000${reaction.owner}\u0000${reaction.reaction_ref}\u0000${reaction.version_ref}`,
  versionSemantics: (reaction) =>
    JSON.stringify({
      reaction: reaction.reaction,
      state: reaction.state,
      operation: reaction.operation,
      revision: reaction.revision,
      revision_of: reaction.revision_of,
      previous_version: reaction.previous_version,
      event_timestamp: reaction.event_timestamp,
      profile_id: reaction.profile_id,
      profile_name: reaction.profile_name,
    }),
  equivocation: 'drop-version',
  compare: compareReactionEvents,
};

export function collapseNativeReactionStates(reactions: Array<NativeReaction>): Array<NativeReaction> {
  const tips = collapseChains(reactions.filter(isValidNativeReaction), reactionChainSpec);
  return latestByKey(
    tips,
    (reaction) => `${reaction.subject}\u0000${reaction.target}\u0000${reaction.owner}`,
    compareReactionEvents
  );
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

function validRef(reference: string): boolean {
  return validReference(reference, MAX_REACTION_REFERENCE_LENGTH);
}
