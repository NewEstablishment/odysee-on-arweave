const webBase = (process.env.BASE_URL || 'http://localhost:9090').replace(/\/+$/, '');
const hyperbeamBase = (process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18785').replace(/\/+$/, '');
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

const selectors = {
  type: 'comment',
  target,
  parent: 'root',
  state: 'active',
};
const paths = queryPaths(
  await query({
    ...selectors,
    only: Object.keys(selectors),
    return: 'paths',
    'sort-by': 'timestamp',
    'sort-order': 'desc',
    offset: 0,
    limit: 10,
  })
);
const count = await query({ ...selectors, only: Object.keys(selectors), return: 'count' });
const missing = queryPaths(
  await query({
    ...selectors,
    target: `${target}-missing`,
    only: Object.keys(selectors),
    return: 'paths',
  })
);

if (!paths.length) throw new Error(`Query did not discover the written comment: ${JSON.stringify(paths)}`);
if (!paths.includes(id)) {
  throw new Error(`Query did not return the canonical write ID ${id}: ${JSON.stringify(paths)}`);
}
if (Number(count) < 1) throw new Error(`Query count was not positive: ${JSON.stringify(count)}`);
if (missing.length !== 0) {
  throw new Error(`Missing-target query was not empty: ${JSON.stringify(missing)}`);
}

const written = await readMessage(id);
const discovered = await Promise.all(paths.map(readMessage));
const matching = discovered.find(({ stored }) => isExpectedComment(stored));

assertExpectedComment(written.stored, `write ID ${id}`);
if (!matching) throw new Error(`No discovered ID resolved to the written comment: ${JSON.stringify(paths)}`);

console.log(
  JSON.stringify(
    {
      write: { status: writeResponse.status, id },
      query: { paths, resolvedId: matching.id, count: Number(count), missing },
      read: {
        writeIdStatus: written.status,
        queryIdStatus: matching.status,
        type: matching.stored.type,
        target: matching.stored.target,
        signerMetadata: matching.signerMetadata,
      },
    },
    null,
    2
  )
);

async function query(body) {
  const response = await fetch(`${hyperbeamBase}/~query@1.0/only`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Query failed: ${response.status} ${text.slice(0, 500)}`);
  return payload(parseJson(text) || { body: text });
}

async function readMessage(id) {
  const response = await fetch(`${hyperbeamBase}/${encodePath(id)}?accept-bundle=true`, {
    headers: { accept: 'application/json' },
  });
  const text = await response.text();
  const body = { ...responseHeaders(response), ...(parseJson(text) || (text ? { body: text } : {})) };
  const stored = payload(body);
  const serialized = JSON.stringify(stored);
  const signatureInput = response.headers.get('signature-input') || '';
  const signers = response.headers.get('signers') || response.headers.get('signers+link') || '';
  const signerMetadata = Boolean(signatureInput || signers || stored?.commitments);

  if (!response.ok) throw new Error(`Generic read ${id} failed: ${response.status} ${text.slice(0, 500)}`);
  if (containsPrivateAuth(stored)) {
    throw new Error(`Stored message ${id} contains private authentication material: ${serialized.slice(0, 1000)}`);
  }
  if (!signerMetadata) throw new Error(`Generic read ${id} did not expose signer or commitment metadata`);

  return { id, status: response.status, stored, signerMetadata };
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
