import assert from 'node:assert/strict';

import {
  earliestReleaseTime,
  hyperbeamClaimSearchRequest,
  hyperbeamChannelSearchRequest,
  hyperbeamSearchRequest,
} from '../../ui/util/hyperbeamSearch.ts';

assert.deepEqual(
  hyperbeamSearchRequest(
    {
      claimType: 'file',
      video: true,
      nsfw: false,
      free_only: true,
      language: 'en',
      time_filter: 'thisweek',
      min_duration: 2,
      max_duration: 10,
      sort_by: '^release_time',
    },
    20,
    20,
    1_000_000
  ),
  {
    limit: 20,
    offset: 20,
    filter: [
      'claim_type IN ["stream", "repost"]',
      'media_type IN ["video"]',
      'nsfw = 0',
      'fee = 0',
      'language = "en"',
      'release_time >= 395200',
      'duration >= 120',
      'duration <= 600',
    ],
    sort: ['release_time:asc'],
  }
);

assert.deepEqual(
  hyperbeamChannelSearchRequest({
    channelId: 'a'.repeat(40),
    showMature: false,
    mediaType: 'audio',
    earliestReleaseTime: 100,
    minDuration: 30,
    maxDuration: 300,
    sortField: 'effective_amount',
    offset: 0,
    limit: 24,
  }),
  {
    limit: 24,
    filter: [
      `channel_claim_id = "${'a'.repeat(40)}"`,
      'nsfw = 0',
      'media_type = "audio"',
      'release_time >= 100',
      'duration >= 30',
      'duration <= 300',
    ],
    sort: ['effective_amount:desc'],
  }
);

assert.deepEqual(
  hyperbeamClaimSearchRequest(
    {
      claim_type: ['stream', 'repost'],
      any_languages: ['en', 'es'],
      release_time: '>1787600000',
      order_by: ['release_time'],
    },
    8,
    8
  ),
  {
    limit: 8,
    offset: 8,
    filter: ['claim_type IN ["stream", "repost"]', 'nsfw = 0', 'language IN ["en", "es"]', 'release_time > 1787600000'],
    sort: ['release_time:desc'],
  }
);

assert.deepEqual(hyperbeamClaimSearchRequest({ claim_type: 'channel', order_by: ['^release_time'] }, 0, 20), {
  limit: 20,
  filter: ['claim_type IN ["channel"]', 'nsfw = 0'],
  sort: ['release_time:asc'],
});

assert.deepEqual(hyperbeamClaimSearchRequest({ claim_type: 'stream', nsfw: true }, 0, 8), {
  limit: 8,
  filter: ['claim_type IN ["stream"]'],
  sort: ['release_time:desc'],
});

assert.equal(earliestReleaseTime('today', 200_000), 113_600);
assert.equal(earliestReleaseTime('', 200_000), null);

const following = hyperbeamClaimSearchRequest(
  {
    channel_ids: ['native-channel', 'legacy-channel'],
    any_tags: ['science'],
    all_tags: ['tutorial'],
    not_tags: ['mature'],
    stream_types: ['video'],
    order_by: ['^release_time'],
  },
  24,
  12
);
assert.equal(following.offset, 24);
assert.equal(following.limit, 12);
assert.deepEqual(following.sort, ['release_time:asc']);
assert.ok(following.filter.includes('channel_claim_id IN ["native-channel", "legacy-channel"]'));
assert.ok(following.filter.includes('tags IN ["science"]'));
assert.ok(following.filter.includes('tags = "tutorial"'));
assert.ok(following.filter.includes('tags NOT IN ["mature"]'));
assert.ok(following.filter.includes('media_type IN ["video"]'));

console.log('HyperBEAM search option tests passed');
