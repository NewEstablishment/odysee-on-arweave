import { field, integer, isNativeMessageId, normalizeMessageId } from './nativeMessageFields.ts';
import {
  collapseNativeReactionStates,
  type NativeReaction,
  type NativeReactionKind,
  type NativeReactionProjection,
  type NativeReactionSubject,
} from './nativeReactions.ts';

export const LEGACY_REACTION_SUMMARY_SCHEMA = 'odysee-legacy-reaction-summary@1.0';
export const LEGACY_REACTION_SUMMARY_TYPE = 'legacy-reaction-summary';
export const LEGACY_REACTION_SUMMARY_SIGNATURE_SCOPE = 'legacy-reaction-summary-v1';

export type LegacyReactionSummary = {
  schema: string;
  type: string;
  target: string;
  subject: NativeReactionSubject;
  like: number;
  dislike: number;
  linked_reactions: Record<string, NativeReactionKind>;
  snapshot_at: number;
  source: string;
  signature_scope: string;
  message_id: string;
  owner: string;
};

export function normalizeLegacyReactionSummary(source: any): LegacyReactionSummary | null {
  const linkedReactions = normalizeLinkedReactions(field(source, 'linked-reactions', 'linked_reactions'));
  if (!linkedReactions) return null;

  const normalized: LegacyReactionSummary = {
    schema: String(field(source, 'schema') || ''),
    type: String(field(source, 'type') || ''),
    target: String(field(source, 'target', 'target-id', 'target_id') || ''),
    subject: String(field(source, 'subject', 'subject-type', 'subject_type') || '') as NativeReactionSubject,
    like: integer(field(source, 'like'), -1),
    dislike: integer(field(source, 'dislike'), -1),
    linked_reactions: linkedReactions,
    snapshot_at: integer(field(source, 'snapshot-at', 'snapshot_at'), 0),
    source: String(field(source, 'source', 'source-system', 'source_system') || ''),
    signature_scope: String(field(source, 'signature-scope', 'signature_scope') || ''),
    message_id: normalizeMessageId(field(source, 'message-id', 'message_id', 'hyperbeam_message_id')),
    owner: String(field(source, 'hyperbeam-owner', 'hyperbeam_owner', 'owner') || ''),
  };

  return isValidLegacyReactionSummary(normalized) ? normalized : null;
}

export function selectLegacyReactionSummary(
  summaries: Array<LegacyReactionSummary>,
  trustedOwner: string | null | undefined,
  target: string,
  subject: NativeReactionSubject
): LegacyReactionSummary | null {
  if (!trustedOwner) return null;
  const candidates = summaries.filter(
    (summary) =>
      isValidLegacyReactionSummary(summary) &&
      summary.owner === trustedOwner &&
      summary.target === target &&
      summary.subject === subject
  );
  if (!candidates.length) return null;

  const latestAt = Math.max(...candidates.map((summary) => summary.snapshot_at));
  const latest = candidates.filter((summary) => summary.snapshot_at === latestAt);
  const semantics = new Set(
    latest.map((summary) =>
      JSON.stringify({
        like: summary.like,
        dislike: summary.dislike,
        linked_reactions: sortedRecord(summary.linked_reactions),
        source: summary.source,
      })
    )
  );
  if (semantics.size !== 1) return null;
  return latest.sort((a, b) => a.message_id.localeCompare(b.message_id)).at(-1) || null;
}

export function projectMergedReactions(
  reactions: Array<NativeReaction>,
  summary: LegacyReactionSummary | null | undefined,
  viewerOwner?: string | null
): NativeReactionProjection {
  const current = collapseNativeReactionStates(reactions);
  const myReactions: NativeReactionProjection['my_reactions'] = {};
  const othersReactions: NativeReactionProjection['others_reactions'] = {};
  const target = summary?.target || current[0]?.target;
  if (!target) return { current, my_reactions: myReactions, others_reactions: othersReactions };

  const mine = { like: 0, dislike: 0 };
  const others = { like: summary?.like || 0, dislike: summary?.dislike || 0 };
  const nativeByOwner = new Map(current.map((reaction) => [reaction.owner, reaction]));

  Object.entries(summary?.linked_reactions || {}).forEach(([owner, reaction]) => {
    if (nativeByOwner.has(owner)) {
      others[reaction] = Math.max(0, others[reaction] - 1);
    } else if (viewerOwner === owner) {
      others[reaction] = Math.max(0, others[reaction] - 1);
      mine[reaction] += 1;
    }
  });

  current.forEach((reaction) => {
    if (reaction.state !== 'active') return;
    (viewerOwner && reaction.owner === viewerOwner ? mine : others)[reaction.reaction] += 1;
  });

  myReactions[target] = mine;
  othersReactions[target] = others;
  return { current, my_reactions: myReactions, others_reactions: othersReactions };
}

export function linkedLegacyReactionForOwner(
  summary: LegacyReactionSummary | null | undefined,
  owner: string | null | undefined
): NativeReactionKind | null {
  if (!summary || !owner) return null;
  return summary.linked_reactions[owner] || null;
}

function isValidLegacyReactionSummary(summary: LegacyReactionSummary): boolean {
  const linkedCounts = Object.values(summary.linked_reactions).reduce(
    (counts, reaction) => ({ ...counts, [reaction]: counts[reaction] + 1 }),
    { like: 0, dislike: 0 }
  );
  return Boolean(
    summary.schema === LEGACY_REACTION_SUMMARY_SCHEMA &&
    summary.type === LEGACY_REACTION_SUMMARY_TYPE &&
    summary.target &&
    summary.target.length <= 1024 &&
    (summary.subject === 'content' || summary.subject === 'comment') &&
    summary.like >= 0 &&
    summary.dislike >= 0 &&
    linkedCounts.like <= summary.like &&
    linkedCounts.dislike <= summary.dislike &&
    summary.snapshot_at > 0 &&
    summary.source &&
    summary.source.length <= 128 &&
    summary.signature_scope === LEGACY_REACTION_SUMMARY_SIGNATURE_SCOPE &&
    isNativeMessageId(summary.message_id) &&
    validOwner(summary.owner)
  );
}

function normalizeLinkedReactions(source: any): Record<string, NativeReactionKind> | null {
  if (source === undefined || source === null || source === '') return {};
  if (typeof source === 'string') {
    try {
      return normalizeLinkedReactions(JSON.parse(source));
    } catch {
      return null;
    }
  }
  if (Array.isArray(source)) {
    const normalized: Record<string, NativeReactionKind> = {};
    for (const entry of source) {
      const owner = String(field(entry, 'owner', 'native-owner', 'native_owner') || '');
      const reaction = field(entry, 'reaction');
      if (!validOwner(owner) || (reaction !== 'like' && reaction !== 'dislike') || normalized[owner]) return null;
      normalized[owner] = reaction;
    }
    return normalized;
  }
  if (typeof source !== 'object') return null;

  const normalized: Record<string, NativeReactionKind> = {};
  for (const [owner, reaction] of Object.entries(source)) {
    if (!validOwner(owner) || (reaction !== 'like' && reaction !== 'dislike')) return null;
    normalized[owner] = reaction;
  }
  return normalized;
}

function validOwner(owner: string): boolean {
  return /^[0-9A-Za-z_-]{43}$/.test(owner);
}

function sortedRecord(source: Record<string, NativeReactionKind>): Record<string, NativeReactionKind> {
  return Object.fromEntries(Object.entries(source).sort(([a], [b]) => a.localeCompare(b)));
}
