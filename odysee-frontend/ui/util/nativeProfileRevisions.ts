export const NATIVE_PROFILE_SCHEMA = 'odysee-profile-revision@1.0';
const idPattern = /^[A-Za-z0-9_-]{43}$/;

export type ProfileMetadata = {
  title: string;
  description: string;
  avatar_id: string;
  banner_id: string;
};
export type ProfileVersion = ProfileMetadata & {
  id: string;
  owner: string;
  profile_id: string;
  previous_version: string;
  revision: number;
};

export function validProfileMetadata(input: any): input is ProfileMetadata {
  return Boolean(
    input &&
    typeof input.title === 'string' &&
    input.title.trim() &&
    input.title.length <= 200 &&
    typeof input.description === 'string' &&
    input.description.length <= 5000 &&
    [input.avatar_id, input.banner_id].every((id) => typeof id === 'string' && (id === '' || idPattern.test(id)))
  );
}

// Inputs must already have exact commitment verification. Claimed owners are never read.
export function normalizeProfileVersion(payload: any, id: string, owner: string): ProfileVersion | null {
  const metadata = {
    title: payload.title,
    description: payload.description,
    avatar_id: payload['avatar-id'],
    banner_id: payload['banner-id'],
  };
  const revision = Number(payload.revision);
  if (
    payload.schema !== NATIVE_PROFILE_SCHEMA ||
    payload.type !== 'profile-revision' ||
    !validProfileMetadata(metadata) ||
    !idPattern.test(id) ||
    !idPattern.test(owner) ||
    !idPattern.test(payload['profile-id']) ||
    !idPattern.test(payload['previous-version']) ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  )
    return null;
  return {
    ...metadata,
    id,
    owner,
    profile_id: payload['profile-id'],
    previous_version: payload['previous-version'],
    revision,
  };
}

export function profileRevisionMessage(head: ProfileVersion, metadata: ProfileMetadata) {
  if (!validProfileMetadata(metadata))
    throw new Error('Enter a display name (up to 200 characters), bio (up to 5000), and valid image IDs.');
  return {
    schema: NATIVE_PROFILE_SCHEMA,
    type: 'profile-revision',
    'profile-id': head.profile_id,
    'previous-version': head.id,
    revision: head.revision + 1,
    title: metadata.title.trim(),
    description: metadata.description,
    'avatar-id': metadata.avatar_id,
    'banner-id': metadata.banner_id,
  };
}

export function projectProfileVersion(root: ProfileVersion, candidates: ProfileVersion[]): ProfileVersion {
  let head = root;
  let aliases = new Set([root.id]);
  while (true) {
    const next = candidates.filter(
      (entry) =>
        entry.owner === root.owner &&
        entry.profile_id === root.profile_id &&
        entry.revision === head.revision + 1 &&
        aliases.has(entry.previous_version)
    );
    if (!next.length) return head;
    const semantics = new Set(
      next.map((entry) => JSON.stringify([entry.title, entry.description, entry.avatar_id, entry.banner_id]))
    );
    if (semantics.size !== 1) return head;
    head = next.slice().sort((a, b) => a.id.localeCompare(b.id))[0];
    aliases = new Set(next.map((entry) => entry.id));
  }
}
