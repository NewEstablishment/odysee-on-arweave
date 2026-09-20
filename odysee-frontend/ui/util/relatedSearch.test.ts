import { describe, expect, it } from '@voidzero-dev/vite-plus-test';
import { getRecommendationSearchQuery } from './relatedSearch';

describe('HyperBEAM related search query', () => {
  it('uses bounded, unique topical tags followed by the title', () => {
    expect(
      getRecommendationSearchQuery('  Stop   Using Your Default Terminal  ', [
        'technology',
        'linux',
        'linux',
        'terminal',
        'desktop environment',
        'tutorial',
        'command line',
        'ignored after the limit',
      ])
    ).toBe('technology linux terminal desktop environment tutorial Stop Using Your Default Terminal');
  });

  it('bounds the generated query', () => {
    expect(getRecommendationSearchQuery('x'.repeat(600), ['linux'])).toHaveLength(512);
  });

  it('falls back to the normalized title when tags are unavailable', () => {
    expect(getRecommendationSearchQuery('  Terminal   setup  ', null)).toBe('Terminal setup');
  });
});
