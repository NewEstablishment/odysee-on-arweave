export function hasLbryOutpointCommitment(payload: any, immutableId: string): boolean {
  const commitments = payload?.commitments;
  if (!commitments || typeof commitments !== 'object' || Array.isArray(commitments)) return false;

  const commitment = commitments[immutableId];
  return (
    commitment?.['commitment-device'] === 'lbry@1.0' &&
    commitment?.['native-id-type'] === 'outpoint' &&
    typeof commitment?.['native-id'] === 'string'
  );
}

export function lbryEvidenceCommitmentId(payload: any, evidence: 'claim' | 'channel'): string | null {
  const commitments = payload?.commitments;
  if (!commitments || typeof commitments !== 'object' || Array.isArray(commitments)) return null;

  for (const [id, commitment] of Object.entries(commitments)) {
    const fields = commitment as Record<string, any>;
    if (
      /^[0-9A-Za-z_-]{41,128}$/.test(id) &&
      commitment &&
      typeof commitment === 'object' &&
      !Array.isArray(commitment) &&
      fields['commitment-device'] === 'lbry@1.0' &&
      fields['native-id-type'] === 'outpoint' &&
      fields.evidence === evidence
    ) {
      return id;
    }
  }

  return null;
}
