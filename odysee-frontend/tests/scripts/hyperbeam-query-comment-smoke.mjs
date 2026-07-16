const webBase = (process.env.BASE_URL || 'http://localhost:9090').replace(/\/+$/, '');
const hyperbeamBase = (process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18785').replace(/\/+$/, '');
const webOrigin = new URL(webBase).origin;
const authToken = process.env.AUTH_TOKEN || `native-comment-smoke-${Date.now()}`;
const target = `native-comment-target-${Date.now()}`;
const comment = `native query smoke ${Date.now()}`;
const message = {
  schema: 'odysee-comment@1.0',
  type: 'comment',
  target,
  parent: 'root',
  state: 'active',
  author: 'native-comment-smoke-channel',
  comment,
  'claim-id': target,
  'channel-id': 'native-comment-smoke-channel',
  'channel-name': '@native-comment-smoke',
  'channel-signature': 'channel-signature-smoke',
  'signing-ts': String(Date.now()),
  timestamp: Math.floor(Date.now() / 1000),
  'is-pinned': false,
  replies: 0,
  sticker: false,
};

const writeResponse = await fetch(`${webBase}/$/api/hyperbeam-upload/v1/write`, {
  method: 'POST',
  headers: {
    accept: 'application/json',
    cookie: `auth_token=${authToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify(message),
});
const writeText = await writeResponse.text();
const writeBody = parseJson(writeText) || { body: writeText };
const id = responseId(writeResponse, writeBody);

if (!writeResponse.ok || !id) {
  throw new Error(`Native comment write failed: ${writeResponse.status} ${writeText.slice(0, 500)}`);
}

const replyComment = `${comment} reply`;
const replyResponse = await fetch(`${webBase}/$/api/hyperbeam-upload/v1/write`, {
  method: 'POST',
  headers: {
    accept: 'application/json',
    cookie: `auth_token=${authToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    ...message,
    parent: id,
    'parent-id': id,
    comment: replyComment,
    timestamp: message.timestamp + 1,
  }),
});
const replyText = await replyResponse.text();
const replyBody = parseJson(replyText) || { body: replyText };
const replyId = responseId(replyResponse, replyBody);

if (!replyResponse.ok || !replyId) {
  throw new Error(`Native reply write failed: ${replyResponse.status} ${replyText.slice(0, 500)}`);
}

const selectors = {
  schema: 'odysee-comment@1.0',
  type: 'comment',
  target,
  state: 'active',
};
const paths = await queryPathsFor(selectors);
const missingPaths = await queryPathsFor({ ...selectors, target: `${target}-missing` });
const missing = (await Promise.all(missingPaths.map((path) => readMessage(path, false)))).filter(({ stored }) =>
  isNativeComment(stored)
);

if (!paths.length) throw new Error(`Query did not discover the written comment: ${JSON.stringify(paths)}`);
if (missing.length !== 0) {
  throw new Error(`Missing-target query was not empty: ${JSON.stringify(missing)}`);
}

const written = await readMessage(id);
const discovered = dedupeDiscovered(
  (await Promise.all(paths.map((path) => readMessage(path, false)))).filter(({ stored }) => isNativeComment(stored))
);
const matching = discovered.find(({ stored }) => isExpectedComment(stored));
const reply = discovered.find(({ id: resultId }) => resultId === replyId) || (await readMessage(replyId));
const rootPaths = discovered.filter(({ stored }) => stored?.parent === 'root').map(({ id: resultId }) => resultId);
const replyPaths = discovered.filter(({ stored }) => stored?.parent === id).map(({ id: resultId }) => resultId);
const leafPaths = discovered.filter(({ stored }) => stored?.parent === replyId).map(({ id: resultId }) => resultId);

assertExpectedComment(written.stored, `write ID ${id}`);
if (!matching) throw new Error(`No discovered ID resolved to the written comment: ${JSON.stringify(paths)}`);
if (reply.stored?.comment !== replyComment || reply.stored?.parent !== id) {
  throw new Error(`Native reply did not preserve its parent relation: ${JSON.stringify(reply.stored).slice(0, 1000)}`);
}
if (!rootPaths.includes(id) || !replyPaths.includes(replyId)) {
  throw new Error(`Resolved comments did not preserve their hierarchy: ${JSON.stringify({ rootPaths, replyPaths })}`);
}
if (leafPaths.length !== 0) {
  throw new Error(`Leaf reply incorrectly reported children: ${JSON.stringify({ leafPaths })}`);
}

console.log(
  JSON.stringify(
    {
      write: { status: writeResponse.status, id },
      query: { paths, resolvedId: matching.id, count: rootPaths.length, missing },
      reply: {
        status: replyResponse.status,
        id: replyId,
        paths: replyPaths,
        count: replyPaths.length,
        parent: id,
        childPaths: leafPaths,
        childCount: leafPaths.length,
      },
      read: {
        writeIdStatus: written.status,
        queryIdStatus: matching.status,
        type: matching.stored.type,
        target: matching.stored.target,
        signerMetadata: matching.signerMetadata,
        exposedCommentHeaders: matching.exposedCommentHeaders,
      },
    },
    null,
    2
  )
);

async function queryPathsFor(selectors) {
  const response = await fetch(`${hyperbeamBase}/~query@1.0/only`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ only: selectors, return: 'paths' }),
  });
  const text = await response.text();
  if (response.status === 404 || (response.status === 500 && text.includes('not_found'))) return [];
  if (!response.ok) throw new Error(`Query failed: ${response.status} ${text.slice(0, 500)}`);
  return queryPaths(payload(parseJson(text) || { body: text }));
}

function dedupeDiscovered(records) {
  const seen = new Set();
  return records.filter(({ id: resultId }) => {
    const key = resultId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readMessage(id, expectComment = true) {
  const response = await fetch(`${hyperbeamBase}/~cache@1.0/read?read=${encodeURIComponent(id)}`, {
    headers: { accept: 'application/json', origin: webOrigin },
  });
  const text = await response.text();
  const body = { ...responseHeaders(response), ...(parseJson(text) || (text ? { body: text } : {})) };
  const stored = payload(body);
  const serialized = JSON.stringify(stored);
  const signatureInput = response.headers.get('signature-input') || '';
  const signers = response.headers.get('signers') || response.headers.get('signers+link') || '';
  const signerMetadata = Boolean(signatureInput || signers || stored?.commitments);
  const exposedHeaders = response.headers.get('access-control-expose-headers') || '';
  const exposedCommentHeaders = ['schema', 'type', 'comment', 'channel-name', 'is-pinned'].every((header) =>
    exposedHeaders
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .includes(header)
  );

  if (!response.ok) throw new Error(`Generic read ${id} failed: ${response.status} ${text.slice(0, 500)}`);
  if (containsPrivateAuth(stored)) {
    throw new Error(`Stored message ${id} contains private authentication material: ${serialized.slice(0, 1000)}`);
  }
  if (!signerMetadata) throw new Error(`Generic read ${id} did not expose signer or commitment metadata`);
  if (expectComment && !exposedCommentHeaders) {
    throw new Error(`Generic read ${id} did not expose native comment headers to browsers: ${exposedHeaders}`);
  }
  if (expectComment && response.headers.get('is-pinned') !== 'false') {
    throw new Error(`Generic read ${id} did not preserve the false is-pinned value`);
  }

  return {
    id: nativeMessageId(stored) || id,
    queryPath: id,
    status: response.status,
    stored,
    signerMetadata,
    exposedCommentHeaders,
  };
}

function nativeMessageId(message) {
  const commitments = message?.commitments;
  if (commitments && typeof commitments === 'object') {
    for (const [id, commitment] of Object.entries(commitments)) {
      if (commitment?.type !== 'hmac-sha256') continue;
      return normalizeMessageId(typeof commitment.signature === 'string' ? commitment.signature : id);
    }
  }

  const signatureInput = String(message?.['signature-input'] || '');
  const hmacInput = signatureInput.split(/,\s+(?=[^=,\s]+=\()/).find((part) => part.includes('alg="hmac-sha256"'));
  const label = hmacInput?.match(/^([^=]+)=/)?.[1];
  if (!label) return undefined;

  const signature = String(message?.signature || '');
  const match = signature.match(new RegExp(`(?:^|,\\s*)${escapeRegExp(label)}=:([^:]+):`));
  return match?.[1] ? normalizeMessageId(match[1]) : undefined;
}

function normalizeMessageId(id) {
  return id.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function escapeRegExp(source) {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function queryPaths(source) {
  if (Array.isArray(source)) return source.map(String).filter(Boolean);
  if (!source || typeof source !== 'object') return [];
  const paths = source.paths || source.items;
  if (Array.isArray(paths)) return paths.map(String).filter(Boolean);
  return Object.keys(source)
    .filter((key) => /^[1-9]\d*$/.test(key))
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => String(source[key]))
    .filter(Boolean);
}

function isExpectedComment(stored) {
  return stored?.type === 'comment' && stored?.target === target && stored?.comment === comment;
}

function isNativeComment(stored) {
  return (
    stored?.type === 'comment' &&
    stored?.schema === 'odysee-comment@1.0' &&
    stored?.device !== 'cacheviz@1.0' &&
    String(stored?.method || '').toUpperCase() !== 'GET' &&
    typeof stored?.comment === 'string'
  );
}

function assertExpectedComment(stored, source) {
  if (!isExpectedComment(stored)) {
    throw new Error(`${source} returned the wrong message: ${JSON.stringify(stored).slice(0, 1000)}`);
  }
  if (stored['channel-signature'] !== 'channel-signature-smoke') {
    throw new Error(`${source} did not preserve the LBRY channel signature`);
  }
}

function containsPrivateAuth(value) {
  if (typeof value === 'string') return value.includes(authToken);
  if (Array.isArray(value)) return value.some(containsPrivateAuth);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, item]) => /^(auth[_-]?token|x-odysee-auth-token|x-lbry-auth-token)$/i.test(key) || containsPrivateAuth(item)
  );
}

function payload(source) {
  let current = source;
  for (let index = 0; index < 4; index += 1) {
    if (typeof current === 'string') {
      const parsed = parseJson(current);
      if (parsed === null) return current;
      current = parsed;
      continue;
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
    if (current.result !== undefined) {
      current = current.result;
      continue;
    }
    if (current.data !== undefined) {
      current = current.data;
      continue;
    }
    if (current.body !== undefined) {
      const parsed = typeof current.body === 'string' ? parseJson(current.body) : current.body;
      if (parsed !== null && parsed !== undefined) {
        current = parsed;
        continue;
      }
    }
    return current;
  }
  return current;
}

function responseId(response, body) {
  const bodyPayload = payload(body);
  const candidate =
    response.headers.get('path') ||
    response.headers.get('id') ||
    response.headers.get('read-path') ||
    response.headers.get('url') ||
    body.path ||
    body.id ||
    body['read-path'] ||
    body.read_path ||
    body.url ||
    body.body ||
    (typeof bodyPayload === 'string' ? bodyPayload : '');
  return String(candidate || '')
    .trim()
    .replace(/^\/+/, '');
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function responseHeaders(response) {
  return Object.fromEntries(response.headers.entries());
}

function encodePath(id) {
  return id
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}
