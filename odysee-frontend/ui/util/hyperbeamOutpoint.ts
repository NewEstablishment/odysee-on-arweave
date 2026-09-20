type OutpointParts = {
  txid?: string;
  nout?: number | string;
};

export function resolveHyperbeamPayloadOutpoint(
  payloadTxid: unknown,
  payloadNout: unknown,
  fallback?: OutpointParts | null
): OutpointParts {
  return {
    txid: (payloadTxid || fallback?.txid) as string | undefined,
    // Output zero is valid; a truthiness fallback would discard it.
    nout: (payloadNout ?? fallback?.nout) as number | string | undefined,
  };
}
