import { describe, expect, it } from '@voidzero-dev/vite-plus-test';
import { resolveHyperbeamPayloadOutpoint } from './hyperbeamOutpoint';

describe('resolveHyperbeamPayloadOutpoint', () => {
  it('preserves the common zero output index', () => {
    expect(resolveHyperbeamPayloadOutpoint('txid', 0, null)).toEqual({ txid: 'txid', nout: 0 });
  });

  it('uses immutable-route parts only when evidence omits them', () => {
    expect(resolveHyperbeamPayloadOutpoint(undefined, undefined, { txid: 'fallback', nout: 2 })).toEqual({
      txid: 'fallback',
      nout: 2,
    });
  });
});
