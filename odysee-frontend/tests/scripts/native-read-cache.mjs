import assert from 'node:assert/strict';
import { cachedNativeRead } from '../../ui/util/nativeReadCache.ts';
import { verifyNativeMessage } from '../../ui/util/nativeMessageVerification.ts';

const realNow = Date.now;
let now = 1000;
Date.now = () => now;
try {
  const cache = new Map();
  const read = (load, key = 'owner') => cachedNativeRead(cache, key, load, 30000);
  let online = false;
  let attempts = 0;
  const ownerRead = async () => {
    attempts++;
    const evidence = await verifyNativeMessage('p'.repeat(43), {
      loadPayload: async () => {
        if (!online) throw new Error('offline');
        return { type: 'channel' };
      },
      verifyCommitment: async () => online,
      loadCommitter: async () => (online ? 'o'.repeat(43) : null),
    });
    return evidence?.owner || null;
  };
  assert.equal(await read(ownerRead), null);
  assert.equal(cache.has('owner'), false, 'offline verification must not poison owner cache');
  online = true;
  assert.equal(await read(ownerRead), 'o'.repeat(43), 'immediate online retry rereads with no clock advance');
  assert.equal(attempts, 2);
  await read(ownerRead);
  assert.equal(attempts, 2, 'positive evidence still cached');
  now += 30001;
  await read(ownerRead);
  assert.equal(attempts, 3, 'positive TTL expiry rereads');
  for (const missing of [null, undefined]) {
    assert.equal(await read(async () => missing, 'reference'), missing);
    assert.equal(cache.has('reference'), false, 'missing reference must not be cached');
  }
  const empty = [];
  assert.equal(await read(async () => empty, 'query'), empty);
  assert.equal(await read(async () => ['unexpected'], 'query'), empty, 'empty discovery is valid cache state');
  assert.equal(await read(async () => false, 'boolean'), false);
  assert.equal(cache.has('boolean'), true);
  await assert.rejects(
    read(async () => {
      throw new Error('network');
    }, 'error'),
    /network/
  );
  assert.equal(cache.has('error'), false);
  await assert.rejects(
    read(() => {
      throw new Error('sync');
    }, 'sync'),
    /sync/
  );
  assert.equal(cache.has('sync'), false);
  let resolve;
  const pending = read(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    'shared'
  );
  assert.equal(
    read(async () => 'unexpected', 'shared'),
    pending,
    'in-flight requests deduplicate'
  );
  await Promise.resolve();
  cache.delete('shared');
  assert.equal(await read(async () => 'replacement', 'shared'), 'replacement');
  resolve(null);
  assert.equal(await pending, null);
  assert.equal(await read(async () => 'unexpected', 'shared'), 'replacement', 'old miss cannot evict replacement');
  console.log('Native read-cache offline retry tests passed');
} finally {
  Date.now = realNow;
}
