// Upload edit/delete without any app device: like comments, an upload edit
// is an append-only revision message written through the generic `/id` path,
// and a delete is an empty tombstone revision. The original upload message id
// stays the claim id, so URLs never change; readers collapse each chain to
// its tip and hide deleted tips. Chain legality is enforced client-side
// against the verified committer, mirroring `nativeCommentRevisions`.
import { collapseChains, type CollapseSpec } from './revisionedMessage.ts';

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
  const currentId = current.version_ref || current.hyperbeam_message_id;
  if (!currentId) throw new Error('Current upload version is missing an ID');

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
    'version-ref': nativeUploadVersionRef(),
    revision: revisionNumber(current) + 1,
    'revision-timestamp': Math.floor(Date.now() / 1000),
    operation,
    state: operation === 'delete' ? 'deleted' : 'active',
    ...(operation === 'edit'
      ? {
          title: metadata.title,
          description: metadata.description,
          'thumbnail-url': metadata.thumbnail_url,
          license: metadata.license,
          'license-url': metadata.license_url,
          'release-time': metadata.release_time,
        }
      : {}),
  };
  return Object.fromEntries(
    Object.entries(message).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

const uploadChainSpec: CollapseSpec<NativeUploadRevision> = {
  rootRef: (upload) => upload.record_id || '',
  revisionOf: (upload) => upload.revision_of,
  isNext: isNextNativeUploadRevision,
  versionIdentity: (upload) => String(upload.hyperbeam_message_id || upload.record_id || ''),
  equivocation: 'none',
};

export function collapseNativeUploadRevisions(uploads: Array<NativeUploadRevision>): Array<NativeUploadRevision> {
  const identified = uploads.filter((upload) => upload.hyperbeam_message_id || upload.record_id);
  return collapseChains(identified, uploadChainSpec);
}

export function latestNativeUploadRevision(
  root: NativeUploadRevision,
  revisions: Array<NativeUploadRevision>
): NativeUploadRevision {
  let current = root;
  while (true) {
    const candidates = revisions.filter((revision) => isNextNativeUploadRevision(root, current, revision));
    if (candidates.length !== 1) return current;
    current = candidates[0];
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
    candidate.previous_version === currentId &&
    revisionNumber(candidate) === revisionNumber(current) + 1 &&
    operationIsValid &&
    candidate.data_id === root.data_id &&
    candidate.channel_id === root.channel_id &&
    candidate.name === root.name &&
    Number(candidate.timestamp) === Number(root.timestamp)
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
  };
}

function revisionNumber(upload: NativeUploadRevision): number {
  const revision = Math.floor(Number(upload.revision || 0));
  return Number.isFinite(revision) && revision >= 0 ? revision : 0;
}

function nativeUploadVersionRef(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
