export type NativeCommentRevision = {
  comment_id?: string;
  hyperbeam_message_id?: string;
  hyperbeam_owner?: string;
  revision_of?: string;
  previous_version?: string;
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
      target: field(comment, 'target', 'claim-id', 'claim_id'),
      parent: field(comment, 'parent', 'parent-id', 'parent_id') || 'root',
      state: field(comment, 'state'),
      author: field(comment, 'author', 'channel-id', 'channel_id'),
      comment: field(comment, 'comment', 'body', 'text'),
      timestamp: numberField(comment, 'timestamp'),
      'revision-of': field(comment, 'revision-of', 'revision_of'),
      'previous-version': field(comment, 'previous-version', 'previous_version'),
      revision: numberField(comment, 'revision'),
      'revision-timestamp': numberField(comment, 'revision-timestamp', 'revision_timestamp'),
      operation: field(comment, 'operation'),
    })
  )}`;
}

export function collapseNativeCommentRevisions(comments: Array<NativeCommentRevision>): Array<NativeCommentRevision> {
  const unique = uniquePhysicalComments(comments);
  const roots = unique.filter((comment) => !comment.revision_of);
  const revisionsByRoot = new Map<string, Array<NativeCommentRevision>>();

  unique.forEach((comment) => {
    if (!comment.revision_of) return;
    const revisions = revisionsByRoot.get(comment.revision_of) || [];
    revisions.push(comment);
    revisionsByRoot.set(comment.revision_of, revisions);
  });

  return roots.map((root) => latestNativeCommentRevision(root, revisionsByRoot.get(root.comment_id || '') || []));
}

export function latestNativeCommentRevision(
  root: NativeCommentRevision,
  revisions: Array<NativeCommentRevision>
): NativeCommentRevision {
  let current = root;

  while (true) {
    const candidates = revisions
      .filter((revision) => isNextNativeCommentRevision(root, current, revision))
      .sort(compareRevisionCandidates);
    if (!candidates.length) return current;
    current = candidates[candidates.length - 1];
  }
}

export function isNextNativeCommentRevision(
  root: NativeCommentRevision,
  current: NativeCommentRevision,
  candidate: NativeCommentRevision
): boolean {
  const rootId = root.comment_id;
  const currentId = current.hyperbeam_message_id || current.comment_id;
  const expectedRevision = revisionNumber(current) + 1;

  return Boolean(
    rootId &&
    currentId &&
    root.hyperbeam_owner &&
    candidate.hyperbeam_owner === root.hyperbeam_owner &&
    candidate.revision_of === rootId &&
    candidate.previous_version === currentId &&
    revisionNumber(candidate) === expectedRevision &&
    candidate.operation === 'edit' &&
    candidate.state === 'active' &&
    candidate.channel_id === root.channel_id &&
    candidate.claim_id === root.claim_id &&
    normalizedParent(candidate.parent_id) === normalizedParent(root.parent_id) &&
    Number(candidate.timestamp) === Number(root.timestamp)
  );
}

function uniquePhysicalComments(comments: Array<NativeCommentRevision>): Array<NativeCommentRevision> {
  const seen = new Set<string>();
  return comments.filter((comment) => {
    const id = comment.hyperbeam_message_id || comment.comment_id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function compareRevisionCandidates(left: NativeCommentRevision, right: NativeCommentRevision): number {
  const timestampDifference = Number(left.revision_timestamp || 0) - Number(right.revision_timestamp || 0);
  if (timestampDifference) return timestampDifference;
  return String(left.hyperbeam_message_id || '').localeCompare(String(right.hyperbeam_message_id || ''));
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

function compact(source: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(source).filter(([, sourceValue]) => sourceValue !== undefined));
}

function stableJson(source: any): string {
  if (!source || typeof source !== 'object') return JSON.stringify(source);
  if (Array.isArray(source)) return `[${source.map(stableJson).join(',')}]`;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`)
    .join(',')}}`;
}
