export type NativePlaylistVersion = {
  schema?: string;
  type?: string;
  state?: string;
  revision?: number | string;
  'revision-of'?: string;
  revision_of?: string;
  'previous-version'?: string;
  previous_version?: string;
  'revision-timestamp'?: number | string;
  revision_timestamp?: number | string;
  'message-id'?: string;
  message_id?: string;
  'version-ref'?: string;
  version_ref?: string;
  owner?: string;
  [key: string]: any;
};

export function latestNativePlaylistRevision(
  root: NativePlaylistVersion,
  revisions: Array<NativePlaylistVersion>
): NativePlaylistVersion {
  let current = root;

  while (true) {
    const candidates = revisions
      .filter((candidate) => isNextNativePlaylistRevision(root, current, candidate))
      .sort(compareRevisionCandidates);
    if (!candidates.length) return current;
    current = candidates[candidates.length - 1];
  }
}

export function isNextNativePlaylistRevision(
  root: NativePlaylistVersion,
  current: NativePlaylistVersion,
  candidate: NativePlaylistVersion
): boolean {
  const rootId = nativePlaylistMessageId(root);
  const currentVersion = chainVersionId(current);
  const rootOwner = field(root, 'owner');

  return Boolean(
    rootId &&
    currentVersion &&
    rootOwner &&
    isNativePlaylistMessage(root) &&
    isNativePlaylistMessage(candidate) &&
    field(candidate, 'owner') === rootOwner &&
    field(candidate, 'revision-of', 'revision_of') === rootId &&
    field(candidate, 'previous-version', 'previous_version') === currentVersion &&
    revisionNumber(candidate) === revisionNumber(current) + 1 &&
    field(candidate, 'state') === 'active'
  );
}

export function isNativePlaylistMessage(message: NativePlaylistVersion): boolean {
  return field(message, 'schema') === 'odysee-playlist@1' && field(message, 'type') === 'playlist';
}

export function nativePlaylistMessageId(message: NativePlaylistVersion): string {
  return String(field(message, 'message-id', 'message_id') || '');
}

function compareRevisionCandidates(left: NativePlaylistVersion, right: NativePlaylistVersion): number {
  const timestampDifference =
    numberField(left, 'revision-timestamp', 'revision_timestamp') -
    numberField(right, 'revision-timestamp', 'revision_timestamp');
  if (timestampDifference) return timestampDifference;
  return nativePlaylistMessageId(left).localeCompare(nativePlaylistMessageId(right));
}

function chainVersionId(message: NativePlaylistVersion): string {
  return String(field(message, 'version-ref', 'version_ref', 'message-id', 'message_id') || '');
}

function revisionNumber(message: NativePlaylistVersion): number {
  const revision = Math.floor(numberField(message, 'revision'));
  return Number.isFinite(revision) && revision >= 0 ? revision : 0;
}

function numberField(message: NativePlaylistVersion, ...keys: Array<string>): number {
  const result = Number(field(message, ...keys) || 0);
  return Number.isFinite(result) ? result : 0;
}

function field(message: NativePlaylistVersion, ...keys: Array<string>): any {
  for (const key of keys) {
    if (message?.[key] !== undefined && message[key] !== null) return message[key];
  }
  return undefined;
}
