import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { nativeCommentControlSignatureData } from '../../ui/util/nativeCommentControls.ts';
import { collapseNativeCommentRevisions, nativeCommentSignatureData } from '../../ui/util/nativeCommentRevisions.ts';

const webBase = (process.env.BASE_URL || 'http://localhost:9090').replace(/\/+$/, '');
const hyperbeamBase = (process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18785').replace(/\/+$/, '');
const webOrigin = new URL(webBase).origin;
const authToken = process.env.AUTH_TOKEN || `native-comment-smoke-${Date.now()}`;
const target = `native-comment-target-${Date.now()}`;
const comment = `native query smoke ${Date.now()}`;
const commentRef = `comment-${crypto.randomUUID()}`;
const replyRef = `comment-${crypto.randomUUID()}`;
const rootVersionRef = `version-${crypto.randomUUID()}`;
const revisionVersionRef = `version-${crypto.randomUUID()}`;
const secondRevisionVersionRef = `version-${crypto.randomUUID()}`;
const message = {
  schema: 'odysee-comment@1.0',
  type: 'comment',
  'comment-ref': commentRef,
  'version-ref': rootVersionRef,
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
    'comment-ref': replyRef,
    'version-ref': `version-${crypto.randomUUID()}`,
    parent: commentRef,
    'parent-id': commentRef,
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

const revisionComment = `${comment} edited`;
const revisionResponse = await fetch(`${webBase}/$/api/hyperbeam-upload/v1/write`, {
  method: 'POST',
  headers: {
    accept: 'application/json',
    cookie: `auth_token=${authToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    ...message,
    comment: revisionComment,
    'updated-at': message.timestamp + 2,
    'revision-of': commentRef,
    'previous-version': rootVersionRef,
    'version-ref': revisionVersionRef,
    revision: 1,
    'revision-timestamp': Date.now(),
    operation: 'edit',
  }),
});
const revisionText = await revisionResponse.text();
const revisionBody = parseJson(revisionText) || { body: revisionText };
const revisionId = responseId(revisionResponse, revisionBody);

if (!revisionResponse.ok || !revisionId) {
  throw new Error(`Native revision write failed: ${revisionResponse.status} ${revisionText.slice(0, 500)}`);
}

const secondRevisionComment = `${comment} edited twice`;
const secondRevisionResponse = await fetch(`${webBase}/$/api/hyperbeam-upload/v1/write`, {
  method: 'POST',
  headers: {
    accept: 'application/json',
    cookie: `auth_token=${authToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    ...message,
    comment: secondRevisionComment,
    'updated-at': message.timestamp + 3,
    'revision-of': commentRef,
    'previous-version': revisionVersionRef,
    'version-ref': secondRevisionVersionRef,
    revision: 2,
    'revision-timestamp': Date.now() + 1,
    operation: 'edit',
  }),
});
const secondRevisionText = await secondRevisionResponse.text();
const secondRevisionBody = parseJson(secondRevisionText) || { body: secondRevisionText };
const secondRevisionId = responseId(secondRevisionResponse, secondRevisionBody);

if (!secondRevisionResponse.ok || !secondRevisionId) {
  throw new Error(
    `Second native revision write failed: ${secondRevisionResponse.status} ${secondRevisionText.slice(0, 500)}`
  );
}

const selectors = {
  schema: 'odysee-comment@1.0',
  type: 'comment',
  target,
  state: 'active',
};
const paths = await queryPathsFor(selectors);
const revisionPaths = await queryPathsFor({ ...selectors, target: undefined, 'revision-of': commentRef });
const missingPaths = await queryPathsFor({ ...selectors, target: `${target}-missing` });
const missing = (await Promise.all(missingPaths.map((path) => readMessage(path, false)))).filter(
  ({ stored, committer }) => isNativeComment(stored) && committer
);

if (!paths.length) throw new Error(`Query did not discover the written comment: ${JSON.stringify(paths)}`);
if (missing.length !== 0) {
  throw new Error(`Missing-target query was not empty: ${JSON.stringify(missing)}`);
}

const written = await readMessage(id);
const discovered = dedupeDiscovered(
  (await Promise.all(paths.map((path) => readMessage(path, false)))).filter(
    ({ stored, committer }) => isNativeComment(stored) && committer
  )
);
const matching = discovered.find(({ stored }) => isExpectedComment(stored));
const reply = discovered.find(({ id: resultId }) => resultId === replyId) || (await readMessage(replyId));
const revision = discovered.find(({ id: resultId }) => resultId === revisionId) || (await readMessage(revisionId));
const secondRevision =
  discovered.find(({ id: resultId }) => resultId === secondRevisionId) || (await readMessage(secondRevisionId));
const discoveredRevisions = dedupeDiscovered(
  (await Promise.all(revisionPaths.map((path) => readMessage(path, false)))).filter(
    ({ stored, committer }) => isNativeComment(stored) && committer
  )
);
const rootRefs = discovered
  .filter(({ stored }) => stored?.parent === 'root' && !stored?.['revision-of'])
  .map(({ stored }) => stored?.['comment-ref']);
const replyRefs = discovered
  .filter(({ stored }) => stored?.parent === commentRef && !stored?.['revision-of'])
  .map(({ stored }) => stored?.['comment-ref']);
const leafRefs = discovered
  .filter(({ stored }) => stored?.parent === replyRef && !stored?.['revision-of'])
  .map(({ stored }) => stored?.['comment-ref']);

assertExpectedComment(written.stored, `write ID ${id}`);
if (!matching) throw new Error(`No discovered ID resolved to the written comment: ${JSON.stringify(paths)}`);
if (reply.stored?.comment !== replyComment || reply.stored?.parent !== commentRef) {
  throw new Error(`Native reply did not preserve its parent relation: ${JSON.stringify(reply.stored).slice(0, 1000)}`);
}
if (!rootRefs.includes(commentRef) || !replyRefs.includes(replyRef)) {
  throw new Error(`Resolved comments did not preserve their hierarchy: ${JSON.stringify({ rootRefs, replyRefs })}`);
}
if (leafRefs.length !== 0) {
  throw new Error(`Leaf reply incorrectly reported children: ${JSON.stringify({ leafRefs })}`);
}
if (
  revision.stored?.comment !== revisionComment ||
  revision.stored?.['revision-of'] !== commentRef ||
  revision.stored?.['previous-version'] !== rootVersionRef ||
  Number(revision.stored?.revision) !== 1 ||
  revision.stored?.operation !== 'edit'
) {
  throw new Error(
    `Native revision did not preserve its chain: ${JSON.stringify({
      id,
      revisionId,
      comment: revision.stored?.comment,
      revisionOf: revision.stored?.['revision-of'],
      previousVersion: revision.stored?.['previous-version'],
      revision: revision.stored?.revision,
      operation: revision.stored?.operation,
    })}`
  );
}
if (
  secondRevision.stored?.comment !== secondRevisionComment ||
  secondRevision.stored?.['revision-of'] !== commentRef ||
  secondRevision.stored?.['previous-version'] !== revisionVersionRef ||
  Number(secondRevision.stored?.revision) !== 2 ||
  secondRevision.stored?.operation !== 'edit'
) {
  throw new Error(
    `Second native revision did not preserve its chain: ${JSON.stringify({
      id,
      revisionId,
      secondRevisionId,
      comment: secondRevision.stored?.comment,
      revisionOf: secondRevision.stored?.['revision-of'],
      previousVersion: secondRevision.stored?.['previous-version'],
      revision: secondRevision.stored?.revision,
      operation: secondRevision.stored?.operation,
    })}`
  );
}
if (
  ![revisionVersionRef, secondRevisionVersionRef].every((versionRef) =>
    discoveredRevisions.some(({ stored }) => stored?.['version-ref'] === versionRef)
  )
) {
  throw new Error(`Exact revision query missed a stored revision: ${JSON.stringify(revisionPaths)}`);
}
const rootOwner = written.committer;
if (!rootOwner || [revision, secondRevision].some(({ committer }) => committer !== rootOwner)) {
  throw new Error('Native revision chain did not preserve its verified transport owner');
}
const collapsed = collapseNativeCommentRevisions(discovered.map(nativeRevisionRecord));
const latest = collapsed.find((item) => item.comment_id === commentRef);
if (
  collapsed.length !== 2 ||
  latest?.comment !== secondRevisionComment ||
  latest?.version_ref !== secondRevisionVersionRef
) {
  throw new Error(
    `Frontend revision collapse did not select the latest logical comment: ${JSON.stringify({ collapsed, latest })}`
  );
}
const signatureVerification = await verifyCanonicalSignature();
const ownerControls = await verifyNativeOwnerControls(commentRef, rootOwner);

console.log(
  JSON.stringify(
    {
      write: { status: writeResponse.status, id },
      query: { paths, resolvedId: matching.id, count: rootRefs.length, missing },
      reply: {
        status: replyResponse.status,
        id: replyId,
        refs: replyRefs,
        count: replyRefs.length,
        parent: commentRef,
        childRefs: leafRefs,
        childCount: leafRefs.length,
      },
      revision: {
        status: revisionResponse.status,
        id: revisionId,
        root: revision.stored['revision-of'],
        previous: revision.stored['previous-version'],
        number: revision.stored.revision,
        secondId: secondRevisionId,
        secondPrevious: secondRevision.stored['previous-version'],
        secondNumber: secondRevision.stored.revision,
        discoveredPaths: discoveredRevisions.map(({ id: resultId }) => resultId),
        sameOwner: true,
        collapsedCount: collapsed.length,
        latestVersionRef: latest.version_ref,
      },
      read: {
        writeIdStatus: written.status,
        queryIdStatus: matching.status,
        type: matching.stored.type,
        target: matching.stored.target,
        signerMetadata: matching.signerMetadata,
        exposedCommentHeaders: matching.exposedCommentHeaders,
      },
      signatureVerification,
      ownerControls,
    },
    null,
    2
  )
);

async function verifyNativeOwnerControls(commentId, rootCommitter) {
  const owner = 'fedcba9876543210fedcba9876543210fedcba98';
  const subject = '0123456789abcdef0123456789abcdef01234567';
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const base = {
    schema: 'odysee-comment-control@1.0',
    type: 'comment-control',
    authority: 'owner',
    owner,
    actor: owner,
    'actor-name': '@native-owner-smoke',
    'channel-id': owner,
    'channel-name': '@native-owner-smoke',
    'signature-scope': 'native-comment-control-v1',
  };
  const controls = [
    { ...base, control: 'visibility', action: 'hidden', target, 'comment-id': commentId },
    { ...base, control: 'pin', action: 'pinned', target, 'comment-id': commentId },
    { ...base, control: 'creator-like', action: 'liked', target, 'comment-id': commentId },
    { ...base, control: 'block', action: 'blocked', target: owner, subject },
  ];
  const written = [];
  for (let index = 0; index < controls.length; index += 1) {
    const control = {
      ...controls[index],
      'control-ref': `control-${crypto.randomUUID()}`,
      'event-timestamp': Date.now() + index,
    };
    const signingTs = String(Math.floor(Date.now() / 1000));
    const data = nativeCommentControlSignatureData(control);
    const signatureData = Buffer.concat([
      Buffer.from(signingTs),
      Buffer.from(owner, 'hex').reverse(),
      Buffer.from(data),
    ]);
    const signature = sign('sha256', signatureData, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('hex');
    const response = await fetch(`${webBase}/$/api/hyperbeam-upload/v1/write`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        cookie: `auth_token=${authToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...control, 'channel-signature': signature, 'signing-ts': signingTs }),
    });
    const text = await response.text();
    const controlId = responseId(response, parseJson(text) || { body: text });
    if (!response.ok || !controlId) {
      throw new Error(`Native owner control write failed: ${response.status} ${text.slice(0, 500)}`);
    }
    const stored = await readMessage(controlId, false);
    if (stored.committer !== rootCommitter) {
      throw new Error(`Native owner control ${control.control} changed its verified transport owner`);
    }
    const valid = await verifySignature({
      channelId: owner,
      data: nativeCommentControlSignatureData(stored.stored),
      signature,
      signingTs,
      publicKey,
    });
    if (!valid) throw new Error(`Native owner control signature failed for ${control.control}`);
    written.push({ id: controlId, ref: control['control-ref'], control: control.control, target: control.target });
  }

  const targetPaths = await queryPathsFor({
    schema: 'odysee-comment-control@1.0',
    type: 'comment-control',
    target,
  });
  const blockPaths = await queryPathsFor({
    schema: 'odysee-comment-control@1.0',
    type: 'comment-control',
    target: owner,
    control: 'block',
  });
  const targetControls = (await Promise.all(targetPaths.map((path) => readMessage(path, false)))).filter(
    ({ committer }) => committer
  );
  const blockControls = (await Promise.all(blockPaths.map((path) => readMessage(path, false)))).filter(
    ({ committer }) => committer
  );
  const targetRefs = targetControls.map(({ stored }) => stored?.['control-ref']).filter(Boolean);
  const blockRefs = blockControls.map(({ stored }) => stored?.['control-ref']).filter(Boolean);
  const expectedTargetRefs = written.filter((item) => item.target === target).map((item) => item.ref);
  const blockRef = written.find((item) => item.control === 'block')?.ref;
  if (
    !expectedTargetRefs.every((controlRef) => targetRefs.includes(controlRef)) ||
    !blockRef ||
    !blockRefs.includes(blockRef)
  ) {
    throw new Error(`Stock query missed native owner controls: ${JSON.stringify({ written, targetRefs, blockRefs })}`);
  }
  return { written, targetPaths, blockPaths, targetRefs, blockRefs };
}

async function verifyCanonicalSignature() {
  const channelId = '0123456789abcdef0123456789abcdef01234567';
  const signingTs = String(Math.floor(Date.now() / 1000));
  const signedMessage = {
    schema: 'odysee-comment@1.0',
    type: 'comment',
    'comment-ref': commentRef,
    'version-ref': `version-${crypto.randomUUID()}`,
    target: `${target}-signed`,
    parent: 'root',
    state: 'active',
    author: channelId,
    comment: revisionComment,
    'claim-id': `${target}-signed`,
    'channel-id': channelId,
    'channel-name': '@native-comment-signature-smoke',
    timestamp: message.timestamp,
    'revision-of': commentRef,
    'previous-version': rootVersionRef,
    revision: 1,
    'revision-timestamp': Number(revision.stored['revision-timestamp']),
    operation: 'edit',
    'signature-scope': 'native-comment-v1',
    'is-pinned': false,
    replies: 0,
    sticker: false,
  };
  const data = nativeCommentSignatureData(signedMessage);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const signatureData = Buffer.concat([
    Buffer.from(signingTs),
    Buffer.from(channelId, 'hex').reverse(),
    Buffer.from(data),
  ]);
  const signature = sign('sha256', signatureData, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('hex');
  const signedWrite = await fetch(`${webBase}/$/api/hyperbeam-upload/v1/write`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      cookie: `auth_token=${authToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ...signedMessage, 'channel-signature': signature, 'signing-ts': signingTs }),
  });
  const signedWriteText = await signedWrite.text();
  const signedId = responseId(signedWrite, parseJson(signedWriteText) || { body: signedWriteText });
  if (!signedWrite.ok || !signedId) {
    throw new Error(`Signed native revision write failed: ${signedWrite.status} ${signedWriteText.slice(0, 500)}`);
  }
  const stored = await readMessage(signedId);
  const storedData = nativeCommentSignatureData(stored.stored);
  const valid = verifySignature({ channelId, data: storedData, signature, signingTs, publicKey });
  const tampered = verifySignature({
    channelId,
    data: nativeCommentSignatureData({ ...signedMessage, 'previous-version': `${id}-tampered` }),
    signature,
    signingTs,
    publicKey,
  });
  if (!valid || tampered)
    throw new Error(`Native canonical signature verification failed: ${JSON.stringify({ valid, tampered })}`);
  return { id: signedId, valid, tampered, survivedStorage: storedData === data };
}

function verifySignature({ channelId, data, signature, signingTs, publicKey }) {
  const signatureData = Buffer.concat([
    Buffer.from(signingTs),
    Buffer.from(channelId, 'hex').reverse(),
    Buffer.from(data),
  ]);
  return verify('sha256', signatureData, { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'hex'));
}

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
  const responseSignerMetadata = Boolean(signatureInput || signers || stored?.commitments);
  const exposedHeaders = response.headers.get('access-control-expose-headers') || '';
  const exposedCommentHeaders =
    exposedHeaders.trim() === '*' ||
    ['schema', 'type', 'comment', 'channel-name', 'is-pinned'].every((header) =>
      exposedHeaders
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .includes(header)
    );

  if (!response.ok) throw new Error(`Generic read ${id} failed: ${response.status} ${text.slice(0, 500)}`);
  const nativeRecord = isNativeComment(stored) || stored?.type === 'comment-control';
  let committer = null;
  if (nativeRecord) {
    try {
      committer = await verifiedCommitter(id);
    } catch (error) {
      if (expectComment) throw error;
    }
  }
  const signerMetadata = Boolean(responseSignerMetadata || committer);
  if (containsPrivateAuth(stored)) {
    throw new Error(`Stored message ${id} contains private authentication material: ${serialized.slice(0, 1000)}`);
  }
  if (nativeRecord && expectComment && !signerMetadata) {
    throw new Error(`Generic read ${id} did not expose or resolve verified signer metadata`);
  }
  if (expectComment && !exposedCommentHeaders) {
    throw new Error(`Generic read ${id} did not expose native comment headers to browsers: ${exposedHeaders}`);
  }
  if (expectComment && response.headers.get('is-pinned') !== 'false') {
    throw new Error(`Generic read ${id} did not preserve the false is-pinned value`);
  }

  return {
    id,
    queryPath: id,
    status: response.status,
    stored,
    committer,
    signerMetadata,
    exposedCommentHeaders,
  };
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

function nativeRevisionRecord({ id: messageId, stored, committer }) {
  const revisionOf = stored?.['revision-of'];
  const commentReference = stored?.['comment-ref'];
  const parent = stored?.['parent-id'] || stored?.parent;
  return {
    ...stored,
    comment_id: revisionOf || commentReference || messageId,
    comment_ref: commentReference,
    hyperbeam_message_id: messageId,
    hyperbeam_owner: committer,
    revision_of: revisionOf,
    previous_version: stored?.['previous-version'],
    version_ref: stored?.['version-ref'],
    revision: Number(stored?.revision || 0),
    revision_timestamp: Number(stored?.['revision-timestamp'] || 0),
    channel_id: stored?.['channel-id'] || stored?.author,
    claim_id: stored?.['claim-id'] || stored?.target,
    parent_id: parent === 'root' ? undefined : parent,
    timestamp: Number(stored?.timestamp || 0),
  };
}

async function verifiedCommitter(id) {
  const encodedId = encodeURIComponent(id);
  const verifyResponse = await fetch(`${hyperbeamBase}/${encodedId}/verify?commitment-ids=${encodedId}`, {
    headers: { accept: 'application/json' },
  });
  const verifyText = await verifyResponse.text();
  if (!verifyResponse.ok || String(payload(parseJson(verifyText) ?? verifyText)).toLowerCase() !== 'true') {
    throw new Error(
      `Exact commitment verification failed for ${id}: ${verifyResponse.status} ${verifyText.slice(0, 500)}`
    );
  }

  const committerResponse = await fetch(`${hyperbeamBase}/${encodedId}/commitments/${encodedId}/committer`, {
    headers: { accept: 'application/json' },
  });
  const committerText = await committerResponse.text();
  if (!committerResponse.ok) {
    throw new Error(
      `Exact committer read failed for ${id}: ${committerResponse.status} ${committerText.slice(0, 500)}`
    );
  }
  const parsed = parseJson(committerText);
  const committer = String(payload(parsed ?? committerText) || '').trim();
  if (!committer) throw new Error(`Exact committer read returned no owner for ${id}`);
  return committer;
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
