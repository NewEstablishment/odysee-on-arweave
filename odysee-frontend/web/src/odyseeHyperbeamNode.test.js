const assert = require('node:assert/strict');
const test = require('node:test');

const { isHydratedChannelEvidence } = require('./odyseeHyperbeamNode');

test('raw verified channel claims are hydrated without a stream value', () => {
  assert.equal(
    isHydratedChannelEvidence({
      'channel-id': 'channel-id',
      'claim-id': 'claim-id',
      'public-key': 'public-key',
      claim: 'encoded-claim-evidence',
    }),
    true
  );
});

test('channel locators without exact claim evidence are not hydrated', () => {
  assert.equal(
    isHydratedChannelEvidence({
      'channel-id': 'channel-id',
      'public-key': 'public-key',
    }),
    false
  );
});
