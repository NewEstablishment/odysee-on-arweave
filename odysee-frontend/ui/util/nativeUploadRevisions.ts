// Upload edit/delete without any app device: like comments, an upload edit
// is an append-only revision message written through the generic `/id` path,
// and a delete is an empty tombstone revision. The original upload message id
// stays the claim id, so URLs never change; readers collapse each chain to
// its tip and hide deleted tips. Chain legality is enforced client-side
// against the verified committer, mirroring `nativeCommentRevisions`.
import { nativeMessageVersionRef } from './nativeMessageVerification.ts';

export const NATIVE_UPLOAD_SCHEMA = 'odysee-upload@1.0';

export type NativeUploadRevision = {
  record_id?: string;
  hyperbeam_message_id?: string;
  hyperbeam_owner?: string;
  revision_of?: string;
  previous_version?: string;
  version_ref?: string;
  revision?: number;
  revision_timestamp?: number;
  operation?: string;
  state?: string;
  data_id?: string;
  channel_id?: string;
  channel_name?: string;
  name?: string;
  timestamp?: number;
  title?: string;
  description?: string;
  thumbnail_url?: string;
  license?: string;
  license_url?: string;
  release_time?: number;
  [key: string]: any;
};

export type NativeUploadMetadata = {
  title?: string;
  description?: string;
  thumbnail_url?: string;
  license?: string;
  license_url?: string;
  release_time?: number | string;
  tags?: Array<string>;
  languages?: Array<string>;
};

export function normalizeNativeUploadRevision(
  payload: Record<string, any>,
  messageId: string,
  owner: string | undefined
): NativeUploadRevision | null {
  if (field(payload, 'schema') !== NATIVE_UPLOAD_SCHEMA || field(payload, 'type') !== 'upload') return null;
  const revisionOf = stringField(payload, 'revision-of', 'revision_of');
  return {
    record_id: revisionOf || messageId,
    hyperbeam_message_id: messageId,
    hyperbeam_owner: owner,
    revision_of: revisionOf,
    previous_version: stringField(payload, 'previous-version', 'previous_version'),
    version_ref: stringField(payload, 'version-ref', 'version_ref'),
    revision: numberField(payload, 'revision') ?? 0,
    revision_timestamp: numberField(payload, 'revision-timestamp', 'revision_timestamp'),
    operation: stringField(payload, 'operation'),
    state: stringField(payload, 'state') || 'active',
    data_id: stringField(payload, 'data-id', 'data_id'),
    channel_id: stringField(payload, 'channel-id', 'channel_id'),
    channel_name: stringField(payload, 'channel-name', 'channel_name'),
    name: stringField(payload, 'name'),
    timestamp: numberField(payload, 'timestamp') ?? 0,
    title: stringField(payload, 'title'),
    description: stringField(payload, 'description'),
    thumbnail_url: stringField(payload, 'thumbnail-url', 'thumbnail_url'),
    license: stringField(payload, 'license'),
    license_url: stringField(payload, 'license-url', 'license_url'),
    release_time: numberField(payload, 'release-time', 'release_time'),
    tags: listField(payload, 'tags'),
    languages: listField(payload, 'languages'),
  };
}

export function nativeUploadRevisionMessage(
  root: NativeUploadRevision,
  current: NativeUploadRevision,
  metadata: NativeUploadMetadata,
  operation: 'edit' | 'delete'
): Record<string, any> {
  if (!root.record_id || !root.hyperbeam_owner) throw new Error('Upload root is not verifiable');
  if (current.state === 'deleted') throw new Error('This upload has already been deleted');
  const currentId = current.hyperbeam_message_id || current.version_ref;
  if (!currentId) throw new Error('Current upload version is missing an ID');

  const snapshot = {
    ...nativeUploadTipMetadata(root),
    ...defined(nativeUploadTipMetadata(current)),
    ...defined(metadata),
  };
  const message: Record<string, any> = {
    schema: NATIVE_UPLOAD_SCHEMA,
    type: 'upload',
    name: root.name,
    'data-id': root.data_id,
    'streaming-url': root.data_id ? `/${root.data_id}` : undefined,
    'channel-id': root.channel_id,
    'channel-name': root.channel_name,
    timestamp: root.timestamp,
    'revision-of': root.record_id,
    'previous-version': currentId,
    'version-ref': nativeMessageVersionRef(),
    revision: revisionNumber(current) + 1,
    'revision-timestamp': Math.floor(Date.now() / 1000),
    operation,
    state: operation === 'delete' ? 'deleted' : 'active',
    ...(operation === 'edit'
      ? {
          'metadata-mode': 'snapshot',
          title: snapshot.title ?? '',
          description: snapshot.description ?? '',
          'thumbnail-url': snapshot.thumbnail_url ?? '',
          license: snapshot.license ?? '',
          'license-url': snapshot.license_url ?? '',
          'release-time': snapshot.release_time ?? root.timestamp ?? 0,
          tags: snapshot.tags ?? [],
          languages: snapshot.languages ?? [],
        }
      : {}),
  };
  return Object.fromEntries(Object.entries(message).filter(([, value]) => value !== undefined && value !== null));
}

export function collapseNativeUploadRevisions(uploads: Array<NativeUploadRevision>): Array<NativeUploadRevision> {
  return uploads
    .filter((item) => !item.revision_of && item.hyperbeam_owner)
    .map((root) => latestNativeUploadRevision(root, uploads))
    .filter((tip, index, tips) => tips.findIndex((item) => item.record_id === tip.record_id) === index);
}

export function latestNativeUploadRevision(
  root: NativeUploadRevision,
  revisions: Array<NativeUploadRevision>
): NativeUploadRevision {
  let current = root;
  while (true) {
    const candidates = uniqueNativeUploadVersions(
      revisions.filter((revision) => isNextNativeUploadRevision(root, current, revision))
    );
    if (candidates.length !== 1) return current;
    // Old revisions were sparse patches. New revisions carry full snapshots;
    // merging defined values also gives old chains consistent read semantics.
    current = {
      ...candidates[0],
      ...defined(nativeUploadTipMetadata(current)),
      ...defined(nativeUploadTipMetadata(candidates[0])),
    } as NativeUploadRevision;
  }
}

export function isNextNativeUploadRevision(
  root: NativeUploadRevision,
  current: NativeUploadRevision,
  candidate: NativeUploadRevision
): boolean {
  const rootId = root.record_id;
  const currentId = current.version_ref || current.hyperbeam_message_id;
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
    [currentId, current.hyperbeam_message_id, ...(current.message_aliases || [])].includes(
      candidate.previous_version
    ) &&
    revisionNumber(candidate) === revisionNumber(current) + 1 &&
    operationIsValid &&
    candidate.data_id === root.data_id &&
    candidate.channel_id === root.channel_id &&
    candidate.name === root.name &&
    Number(candidate.timestamp) === Number(root.timestamp) &&
    Number.isSafeInteger(Number(candidate.revision))
  );
}

// The metadata an edited tip contributes over the root claim.
export function nativeUploadTipMetadata(tip: NativeUploadRevision): NativeUploadMetadata {
  return {
    title: tip.title,
    description: tip.description,
    thumbnail_url: tip.thumbnail_url,
    license: tip.license,
    license_url: tip.license_url,
    release_time: tip.release_time,
    tags: tip.tags,
    languages: tip.languages,
  };
}

function revisionNumber(upload: NativeUploadRevision): number {
  const revision = Math.floor(Number(upload.revision || 0));
  return Number.isFinite(revision) && revision >= 0 ? revision : 0;
}

export function uniqueNativeUploadVersions(items: Array<NativeUploadRevision>): Array<NativeUploadRevision> {
  const bySemantics = new Map<string, NativeUploadRevision>();
  for (const item of items) {
    const { hyperbeam_message_id: _id, message_aliases: _aliases, ...semantic } = item;
    const key = JSON.stringify(
      Object.keys(semantic)
        .sort()
        .map((field) => [field, semantic[field]])
    );
    const existing = bySemantics.get(key);
    if (!existing) bySemantics.set(key, item);
    else
      bySemantics.set(key, {
        ...existing,
        message_aliases: [
          ...new Set(
            [
              existing.hyperbeam_message_id,
              item.hyperbeam_message_id,
              ...(existing.message_aliases || []),
              ...(item.message_aliases || []),
            ].filter(Boolean)
          ),
        ],
      });
  }
  return [...bySemantics.values()];
}

function defined<T extends Record<string, any>>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function listField(source: Record<string, any>, key: string): Array<string> | undefined {
  const raw = source[key];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && typeof raw === 'object')
    return Object.keys(raw)
      .filter((key) => /^[1-9]\d*$/.test(key))
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => String(raw[key]));
  return raw === '' ? [] : [String(raw)];
}

function field(source: Record<string, any>, ...keys: Array<string>): any {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function stringField(source: Record<string, any>, ...keys: Array<string>): string | undefined {
  const raw = field(source, ...keys);
  return raw === undefined ? undefined : String(raw);
}

function numberField(source: Record<string, any>, ...keys: Array<string>): number | undefined {
  const raw = field(source, ...keys);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}
