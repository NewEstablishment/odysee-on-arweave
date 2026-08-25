import { compact, stableJson } from './nativeMessageFields.ts';
import { collapseChains, type CollapseSpec } from './revisionedMessage.ts';

export type NativeCommentRevision = {
  comment_id?: string;
  comment_ref?: string;
  hyperbeam_message_id?: string;
  hyperbeam_owner?: string;
  revision_of?: string;
  previous_version?: string;
  version_ref?: string;
  revision?: number;
  revision_timestamp?: number;
  channel_id?: string;
  claim_id?: string;
  parent_id?: string;
  timestamp?: number;
  state?: string;
  operation?: string;
  [key: string]: any;
};

export function nativeCommentSignatureData(comment: NativeCommentRevision): string {
  if (field(comment, 'signature-scope', 'signature_scope') !== 'native-comment-v1') {
    return String(field(comment, 'comment', 'body', 'text') || '');
  }

  return `odysee-native-comment-v1:${stableJson(
    compact({
      schema: field(comment, 'schema'),
      type: field(comment, 'type'),
      'comment-ref': field(comment, 'comment-ref', 'comment_ref'),
      target: field(comment, 'target', 'claim-id', 'claim_id'),
      parent: field(comment, 'parent', 'parent-id', 'parent_id') || 'root',
      state: field(comment, 'state'),
      author: field(comment, 'author', 'channel-id', 'channel_id'),
      comment: field(comment, 'comment', 'body', 'text'),
      timestamp: numberField(comment, 'timestamp'),
      'revision-of': field(comment, 'revision-of', 'revision_of'),
      'previous-version': field(comment, 'previous-version', 'previous_version'),
      'version-ref': field(comment, 'version-ref', 'version_ref'),
      revision: numberField(comment, 'revision'),
      'revision-timestamp': numberField(comment, 'revision-timestamp', 'revision_timestamp'),
      operation: field(comment, 'operation'),
    })
  )}`;
}

const commentChainSpec: CollapseSpec<NativeCommentRevision> = {
  rootRef: (comment) => comment.comment_id || '',
  revisionOf: (comment) => comment.revision_of,
  isNext: isNextNativeCommentRevision,
  versionIdentity: (comment) => String(comment.hyperbeam_message_id || comment.comment_id || ''),
  equivocation: 'none',
};

export function collapseNativeCommentRevisions(comments: Array<NativeCommentRevision>): Array<NativeCommentRevision> {
  const identified = comments.filter((comment) => comment.hyperbeam_message_id || comment.comment_id);
  return collapseChains(identified, commentChainSpec);
}

export function latestNativeCommentRevision(
  root: NativeCommentRevision,
  revisions: Array<NativeCommentRevision>
): NativeCommentRevision {
  let current = root;

  while (true) {
    const candidates = revisions.filter((revision) => isNextNativeCommentRevision(root, current, revision));
    if (candidates.length !== 1) return current;
    current = candidates[0];
  }
}

export function isNextNativeCommentRevision(
  root: NativeCommentRevision,
  current: NativeCommentRevision,
  candidate: NativeCommentRevision
): boolean {
  const rootId = root.comment_id;
  const currentId = current.version_ref || current.hyperbeam_message_id || current.comment_id;
  const expectedRevision = revisionNumber(current) + 1;
  const operationIsValid =
    (candidate.operation === 'edit' && candidate.state === 'active') ||
    (candidate.operation === 'delete' && candidate.state === 'deleted');

  return Boolean(
    rootId &&
    currentId &&
    current.state !== 'deleted' &&
    root.hyperbeam_owner &&
    candidate.hyperbeam_owner === root.hyperbeam_owner &&
    candidate.revision_of === rootId &&
    candidate.previous_version === currentId &&
    revisionNumber(candidate) === expectedRevision &&
    operationIsValid &&
    candidate.channel_id === root.channel_id &&
    candidate.claim_id === root.claim_id &&
    normalizedParent(candidate.parent_id) === normalizedParent(root.parent_id) &&
    Number(candidate.timestamp) === Number(root.timestamp)
  );
}

function revisionNumber(comment: NativeCommentRevision): number {
  const revision = Math.floor(Number(comment.revision || 0));
  return Number.isFinite(revision) && revision >= 0 ? revision : 0;
}

function normalizedParent(parentId?: string): string {
  return parentId || 'root';
}

function field(source: NativeCommentRevision, ...keys: Array<string>): any {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function numberField(source: NativeCommentRevision, ...keys: Array<string>): number | undefined {
  const sourceValue = field(source, ...keys);
  if (sourceValue === undefined) return undefined;
  const parsed = Number(sourceValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}

