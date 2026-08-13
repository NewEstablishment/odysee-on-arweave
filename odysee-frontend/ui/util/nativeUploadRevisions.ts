export type NativeUploadVersion = {
  schema?: string;
  type?: string;
  state?: string;
  operation?: string;
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
  'data-id'?: string;
  data_id?: string;
  name?: string;
  timestamp?: number | string;
  [key: string]: any;
};

export function latestNativeUploadRevision(
  root: NativeUploadVersion,
  revisions: Array<NativeUploadVersion>
): NativeUploadVersion {
  let current = root;

  while (field(current, 'state') !== 'deleted') {
    const candidates = revisions
      .filter((candidate) => isNextNativeUploadRevision(root, current, candidate))
      .sort(compareRevisionCandidates);
    if (!candidates.length) return current;
    current = candidates[candidates.length - 1];
  }

  return current;
}

export function isNextNativeUploadRevision(
  root: NativeUploadVersion,
  current: NativeUploadVersion,
  candidate: NativeUploadVersion
): boolean {
  const rootId = physicalMessageId(root);
  const currentId = chainVersionId(current);
  const rootOwner = field(root, 'owner');
  const operation = field(candidate, 'operation');
  const state = field(candidate, 'state');

  return Boolean(
    rootId &&
    currentId &&
    rootOwner &&
    isNativeUploadMessage(root) &&
    isNativeUploadMessage(candidate) &&
    field(candidate, 'owner') === rootOwner &&
    field(candidate, 'revision-of', 'revision_of') === rootId &&
    field(candidate, 'previous-version', 'previous_version') === currentId &&
    revisionNumber(candidate) === revisionNumber(current) + 1 &&
    field(candidate, 'data-id', 'data_id') === field(root, 'data-id', 'data_id') &&
    field(candidate, 'name') === field(root, 'name') &&
    Number(field(candidate, 'timestamp')) === Number(field(root, 'timestamp')) &&
    ((operation === 'update' && state === 'active') || (operation === 'delete' && state === 'deleted'))
  );
}

export function isNativeUploadMessage(message: NativeUploadVersion): boolean {
  return field(message, 'schema') === 'odysee-upload@1.0' && field(message, 'type') === 'upload';
}

export function nativeUploadMessageId(message: NativeUploadVersion): string {
  return physicalMessageId(message);
}

export function nativeUploadRevisionNumber(message: NativeUploadVersion): number {
  return revisionNumber(message);
}

function compareRevisionCandidates(left: NativeUploadVersion, right: NativeUploadVersion): number {
  const timestampDifference =
    numberField(left, 'revision-timestamp', 'revision_timestamp') -
    numberField(right, 'revision-timestamp', 'revision_timestamp');
  if (timestampDifference) return timestampDifference;
  return physicalMessageId(left).localeCompare(physicalMessageId(right));
}

function physicalMessageId(message: NativeUploadVersion): string {
  return String(field(message, 'message-id', 'message_id') || '');
}

function chainVersionId(message: NativeUploadVersion): string {
  // RSA-PSS commitment IDs can change when a query locator is served and
  // signed again. The signed application version-ref stays stable across
  // direct-ID and query-locator reads, so it is the revision-chain key.
  return String(field(message, 'version-ref', 'version_ref', 'message-id', 'message_id') || '');
}

function revisionNumber(message: NativeUploadVersion): number {
  const revision = Math.floor(numberField(message, 'revision'));
  return Number.isFinite(revision) && revision >= 0 ? revision : 0;
}

function numberField(message: NativeUploadVersion, ...keys: Array<string>): number {
  const value = Number(field(message, ...keys) || 0);
  return Number.isFinite(value) ? value : 0;
}

function field(message: NativeUploadVersion, ...keys: Array<string>): any {
  for (const key of keys) {
    if (message?.[key] !== undefined && message[key] !== null) return message[key];
  }
  return undefined;
}
