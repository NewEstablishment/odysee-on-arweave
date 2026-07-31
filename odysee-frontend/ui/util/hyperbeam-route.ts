const OUTPOINT_PATTERN = /^([0-9a-f]{64}):([0-9]+)$/i;
const OUTPOINT_TOKEN_PATTERN = /^out_([0-9a-f]{64})_([0-9]+)$/i;
const IMMUTABLE_TOKEN_PATTERN = /^immutable_([0-9A-Za-z_-]{41,128})$/;
const IMMUTABLE_ID_PATTERN = /^[0-9A-Za-z_-]{41,128}$/;

export const HYPERBEAM_IMMUTABLE_WEB_PREFIX = '/$/id/';

export function normalizeHyperbeamImmutableId(value?: string | null): string | undefined {
  if (!value) return undefined;

  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  const outpoint = decoded.match(OUTPOINT_PATTERN);
  if (outpoint) return `${outpoint[1]}:${outpoint[2]}`;

  const outpointToken = decoded.match(OUTPOINT_TOKEN_PATTERN);
  if (outpointToken) return `${outpointToken[1]}:${outpointToken[2]}`;

  const immutableToken = decoded.match(IMMUTABLE_TOKEN_PATTERN);
  if (immutableToken) return immutableToken[1];

  return IMMUTABLE_ID_PATTERN.test(decoded) ? decoded : undefined;
}

export function hyperbeamImmutableIdFromClaim(claim?: Claim | null): string | undefined {
  const source = claim as any;
  const explicitId =
    source?.hyperbeam?.immutable_id ||
    source?.hyperbeam?.['immutable-id'] ||
    source?.immutable_id ||
    source?.['immutable-id'] ||
    source?.legacy_outpoint ||
    source?.['legacy-outpoint'] ||
    source?.outpoint ||
    source?.doc_id ||
    source?.search_id;
  const normalizedExplicitId = normalizeHyperbeamImmutableId(explicitId);
  if (normalizedExplicitId) return normalizedExplicitId;

  const txid = String(source?.txid || source?.hyperbeam?.txid || '');
  const nout = source?.nout ?? source?.hyperbeam?.nout;
  return normalizeHyperbeamImmutableId(`${txid}:${nout}`);
}

export function hyperbeamImmutableUri(immutableId?: string | null): string | undefined {
  const normalized = normalizeHyperbeamImmutableId(immutableId);
  if (!normalized) return undefined;

  const outpoint = normalized.match(OUTPOINT_PATTERN);
  return outpoint ? `lbry://out_${outpoint[1]}_${outpoint[2]}` : `lbry://immutable_${normalized}`;
}

export function hyperbeamImmutableUriFromClaim(claim?: Claim | null): string | undefined {
  return hyperbeamImmutableUri(hyperbeamImmutableIdFromClaim(claim));
}

export function hyperbeamImmutableIdFromUri(uri?: string | null): string | undefined {
  if (!uri) return undefined;

  const token = uri
    .replace(/^lbry:\/\//, '')
    .split('/')
    .pop();
  if (!token || (!OUTPOINT_TOKEN_PATTERN.test(token) && !IMMUTABLE_TOKEN_PATTERN.test(token))) {
    return undefined;
  }

  return normalizeHyperbeamImmutableId(token);
}

export function hyperbeamImmutableWebPath(immutableId?: string | null): string | undefined {
  const normalized = normalizeHyperbeamImmutableId(immutableId);
  return normalized
    ? `${HYPERBEAM_IMMUTABLE_WEB_PREFIX}${encodeURIComponent(normalized).replace('%3A', ':')}`
    : undefined;
}

export function isHyperbeamImmutableWebPath(pathname?: string | null): boolean {
  return Boolean(pathname?.startsWith(HYPERBEAM_IMMUTABLE_WEB_PREFIX));
}
