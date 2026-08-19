const assert = require('node:assert/strict');
const test = require('node:test');

const { isCurrentHomepageSnapshot } = require('./getHomepageJSON');

test('current homepage snapshots include category channel mappings and immutable banner targets', () => {
  const current = {
    en: {
      categories: {
        featured: {
          immutableIds: ['media:0'],
          immutableSigningChannelIds: { 'media:0': 'channel:0' },
        },
      },
      featured: {
        items: [{ url: 'https://odysee.com/@channel:9', immutableId: 'channel:0' }],
      },
    },
  };

  assert.equal(isCurrentHomepageSnapshot(current), true);
  delete current.en.featured.items[0].immutableId;
  assert.equal(isCurrentHomepageSnapshot(current), false);
  assert.equal(isCurrentHomepageSnapshot({}), false);
});
