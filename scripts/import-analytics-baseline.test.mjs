import assert from 'node:assert/strict';
import { constants, generateKeyPairSync, verify } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  importRecord,
  normalizeRecords,
  walletAddress,
} from './import-analytics-baseline.mjs';

test('normalizes object maps and arrays', () => {
  assert.deepEqual(normalizeRecords({ alpha: 12, beta: 0 }), [
    { 'subject-id': 'alpha', value: 12 },
    { 'subject-id': 'beta', value: 0 },
  ]);
  assert.deepEqual(normalizeRecords([{ subject_id: 'gamma', value: 7 }]), [
    { 'subject-id': 'gamma', value: 7 },
  ]);
  assert.deepEqual(normalizeRecords([{ claim_id: 'delta', view_count: 9 }]), [
    { 'subject-id': 'delta', value: 9 },
  ]);
  assert.throws(() => normalizeRecords([{ value: 1 }]), /subject-id/);
  assert.throws(() => normalizeRecords({ alpha: -1 }), /non-negative integer/);
});

test('signs the nonce and sends the generic baseline contract', async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const wallet = privateKey.export({ format: 'jwk' });
  const owner = walletAddress(wallet);
  const nonce = 'test-nonce';
  const expectedMessage = `analytics@1.0:${owner}:${nonce}`;
  let received;

  const server = createServer(async (request, response) => {
    if (request.url?.startsWith('/~analytics@1.0/nonce')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ nonce, message: expectedMessage }));
      return;
    }

    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();

  await importRecord({
    node: `http://127.0.0.1:${address.port}`,
    key: 'site-key',
    owner,
    wallet,
    version: 'legacy-1',
    cutoverAt: 1234,
    source: 'legacy-export',
    record: { 'subject-id': 'media-id', value: 99 },
  });

  assert.deepEqual(
    { ...received, signature: undefined },
    {
      key: 'site-key',
      'subject-id': 'media-id',
      value: 99,
      version: 'legacy-1',
      'cutover-at': 1234,
      source: 'legacy-export',
      owner,
      'public-key': wallet.n,
      nonce,
      signature: undefined,
    }
  );
  assert.equal(
    verify('sha256', Buffer.from(expectedMessage), {
      key: publicKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }, Buffer.from(received.signature, 'base64url')),
    true
  );
});
