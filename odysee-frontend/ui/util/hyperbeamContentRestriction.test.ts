import { describe, expect, it } from '@voidzero-dev/vite-plus-test';
import { normalizeContentRestrictionResponse } from './hyperbeamContentRestriction';

describe('normalizeContentRestrictionResponse', () => {
  it('normalizes a response-hook denial', () => {
    expect(
      normalizeContentRestrictionResponse(
        {
          status: 451,
          reason: 'content-policy',
          'policy-reason': 'distribution-rights',
          'blocked-subject': { type: 'lbry-channel', value: 'channel-id' },
        },
        451
      )
    ).toMatchObject({
      status: 451,
      reason: 'content-policy',
      'policy-reason': 'distribution-rights',
      'content-restriction': true,
      'blocked-subject': { type: 'lbry-channel', value: 'channel-id' },
    });
  });

  it('normalizes a request-hook unavailable response', () => {
    expect(
      normalizeContentRestrictionResponse(
        {
          body: [
            {
              status: 503,
              reason: 'location-unavailable',
              'blocked-subject': { type: 'lbry-claim', value: 'claim-id' },
            },
          ],
        },
        503
      )
    ).toMatchObject({
      status: 503,
      reason: 'location-unavailable',
      'content-restriction': true,
    });
  });

  it('does not reinterpret unrelated failures as policy decisions', () => {
    expect(normalizeContentRestrictionResponse({ reason: 'store-unavailable' }, 503)).toBeNull();
    expect(normalizeContentRestrictionResponse({ reason: 'not-found' }, 404)).toBeNull();
  });
});
