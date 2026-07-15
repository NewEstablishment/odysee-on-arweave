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
  type: 'comment',
  target,
  parent: 'root',
  state: 'active',
};
const [pathsResult, count, missingResult] = await queryBatch([
  {
    ...selectors,
    only: Object.keys(selectors),
    return: 'paths',
    'sort-by': 'timestamp',
    'sort-order': 'desc',
    offset: 0,
    limit: 10,
  },
  { ...selectors, only: Object.keys(selectors), return: 'count' },
  {
    ...selectors,
    target: `${target}-missing`,
    only: Object.keys(selectors),
    return: 'paths',
  },
]);
const paths = queryPaths(pathsResult);
const missing = queryPaths(missingResult);

if (!paths.length) throw new Error(`Query did not discover the written comment: ${JSON.stringify(paths)}`);
if (!paths.includes(id)) {
  throw new Error(`Query did not return the canonical write ID ${id}: ${JSON.stringify(paths)}`);
}
if (Number(count) < 1) throw new Error(`Query count was not positive: ${JSON.stringify(count)}`);
if (missing.length !== 0) {
  throw new Error(`Missing-target query was not empty: ${JSON.stringify(missing)}`);
}

const replySelectors = {
  type: 'comment',
  target,
  parent: id,
  state: 'active',
};
const [replyPathsResult, replyCount] = await queryBatch([
  {
    ...replySelectors,
    only: Object.keys(replySelectors),
    return: 'paths',
    'sort-by': 'timestamp',
    'sort-order': 'asc',
    offset: 0,
    limit: 10,
  },
  { ...replySelectors, only: Object.keys(replySelectors), return: 'count' },
]);
const replyPaths = queryPaths(replyPathsResult);

if (!replyPaths.includes(replyId)) {
  throw new Error(`Query did not return the native reply ${replyId}: ${JSON.stringify(replyPaths)}`);
}
if (Number(replyCount) < 1) throw new Error(`Reply query count was not positive: ${JSON.stringify(replyCount)}`);

const leafSelectors = {
  type: 'comment',
  target,
  parent: replyId,
  state: 'active',
};
const [leafPathsResult, leafCount] = await queryBatch([
  { ...leafSelectors, only: Object.keys(leafSelectors), return: 'paths' },
  { ...leafSelectors, only: Object.keys(leafSelectors), return: 'count' },
]);
const leafPaths = queryPaths(leafPathsResult);

if (leafPaths.length !== 0 || Number(leafCount) !== 0) {
  throw new Error(`Leaf reply incorrectly reported children: ${JSON.stringify({ leafPaths, leafCount })}`);
}

const written = await readMessage(id);
const discovered = await Promise.all(paths.map(readMessage));
const matching = discovered.find(({ stored }) => isExpectedComment(stored));
const reply = await readMessage(replyId);

assertExpectedComment(written.stored, `write ID ${id}`);
if (!matching) throw new Error(`No discovered ID resolved to the written comment: ${JSON.stringify(paths)}`);
if (reply.stored?.comment !== replyComment || reply.stored?.parent !== id) {
  throw new Error(`Native reply did not preserve its parent relation: ${JSON.stringify(reply.stored).slice(0, 1000)}`);
}

console.log(
  JSON.stringify(
    {
      write: { status: writeResponse.status, id },
      query: { paths, resolvedId: matching.id, count: Number(count), missing },
      reply: {
        status: replyResponse.status,
        id: replyId,
        paths: replyPaths,
        count: Number(replyCount),
        parent: id,
        childPaths: leafPaths,
        childCount: Number(leafCount),
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

async function queryBatch(queries) {
  const response = await fetch(`${hyperbeamBase}/~query@1.0/batch`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ queries }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Query batch failed: ${response.status} ${text.slice(0, 500)}`);
  const result = payload(parseJson(text) || { body: text });
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];
  return Object.keys(result)
    .filter((key) => /^[1-9]\d*$/.test(key))
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => result[key]);
}

async function readMessage(id) {
  const response = await fetch(`${hyperbeamBase}/${encodePath(id)}?accept-bundle=true`, {
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
  if (!exposedCommentHeaders) {
    throw new Error(`Generic read ${id} did not expose native comment headers to browsers: ${exposedHeaders}`);
  }
  if (response.headers.get('is-pinned') !== 'false') {
    throw new Error(`Generic read ${id} did not preserve the false is-pinned value`);
  }

  return { id, status: response.status, stored, signerMetadata, exposedCommentHeaders };
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
