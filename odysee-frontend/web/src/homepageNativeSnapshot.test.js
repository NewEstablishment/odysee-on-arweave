const assert = require('node:assert/strict');
const test = require('node:test');

const {
  discoverHomepageSnapshot,
  homepageSnapshotMessage,
  isHomepageSnapshot,
  publishHomepageSnapshots,
} = require('./homepageNativeSnapshot');

test('snapshot messages are language-specific, hourly, and content-addressed', () => {
  const homepage = { categories: { featured: { immutableIds: ['id'], omitted: undefined } } };
  const message = homepageSnapshotMessage('en', homepage, 7201);

  assert.equal(message['epoch-hour'], 2);
  assert.equal(message['created-at'], 7201);
  assert.equal(isHomepageSnapshot(message, 'en'), true);
  assert.equal(isHomepageSnapshot({ ...message, language: 'de' }, 'en'), false);
  assert.equal(isHomepageSnapshot({ ...message, homepage: {} }, 'en'), false);
  assert.equal(isHomepageSnapshot({ ...message, homepage: JSON.parse(JSON.stringify(homepage)) }, 'en'), true);
});

test('publishing verifies every language before returning its immutable locator', async () => {
  const messages = [];
  const result = await publishHomepageSnapshots(
    { en: { categories: {} }, de: { categories: {} } },
    {
      authToken: 'token',
      expectedCommitter: 'publisher',
      timestamp: 7201,
      write: async (message) => {
        messages.push(message);
        return `${message.language}-id`;
      },
      readVerified: async ([id], committer) => [
        { id, committer, payload: messages.find((message) => `${message.language}-id` === id) },
      ],
    }
  );

  assert.deepEqual(result, { en: 'en-id', de: 'de-id' });
});

test('discovery walks hourly epochs and selects the latest exactly verified publisher message', async () => {
  const older = homepageSnapshotMessage('en', { categories: { featured: { immutableIds: ['older'] } } }, 7201);
  const latest = homepageSnapshotMessage('en', { categories: { featured: { immutableIds: ['latest'] } } }, 7250);
  const epochs = [];
  const snapshot = await discoverHomepageSnapshot('en', 'publisher', {
    timestamp: 10801,
    lookbackHours: 3,
    queryPaths: async (selectors) => {
      epochs.push(selectors['epoch-hour']);
      return selectors['epoch-hour'] === 2 ? ['older-id', 'latest-id', 'hostile-id'] : [];
    },
    readVerified: async (ids, committer) => [
      { id: ids[0], committer, payload: older },
      { id: ids[1], committer, payload: latest },
    ],
  });

  assert.deepEqual(epochs, [3, 2]);
  assert.equal(snapshot.id, 'latest-id');
});
