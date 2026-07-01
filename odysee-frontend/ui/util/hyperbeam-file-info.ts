export function localHyperbeamUploadFileInfo(
  claim: Claim | null | undefined,
  uri: string,
  outpoint: string | null | undefined
) {
  if (!claim || !((claim as any).hyperbeam_upload || (claim as any).hyperbeam?.upload_id)) return null;

  const value = (claim.value || {}) as any;
  const source = value.source || {};
  const mediaUrl = (claim as any).streaming_url || (claim as any).download_url || (claim as any).hyperbeam?.read_path;
  if (!mediaUrl) return null;

  const size = Number(source.size || (claim as any).hyperbeam_upload?.size || 0);
  const uploadId = (claim as any).hyperbeam?.upload_id || (claim as any).immutable_id || (claim as any).outpoint;
  const resolvedOutpoint = uploadId || outpoint || (claim.txid ? `${claim.txid}:${claim.nout || 0}` : claim.claim_id);
  const signingChannel = claim.signing_channel;

  return {
    ...claim,
    uri,
    outpoint: resolvedOutpoint,
    immutable_id: uploadId || (claim as any).immutable_id,
    claim_id: claim.claim_id,
    claim_name: claim.name,
    file_name: source.name || claim.name,
    mime_type: source.media_type || 'application/octet-stream',
    streaming_url: mediaUrl,
    download_url: mediaUrl,
    download_path: mediaUrl,
    completed: true,
    written_bytes: size,
    total_bytes: size,
    blobs_completed: 1,
    blobs_in_stream: 1,
    channel_name: signingChannel?.name,
    channel_claim_id: signingChannel?.claim_id || (claim as any).channel_id,
    metadata: {
      title: value.title,
      description: value.description,
      source,
    },
  } as any;
}
