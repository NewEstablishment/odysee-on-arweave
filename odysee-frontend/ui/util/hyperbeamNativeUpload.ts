import { HYPERBEAM_DEVICE, hyperbeamDeviceUrl } from 'util/hyperbeamDevices';

export function isHyperbeamUploadClaim(claim?: any) {
  return Boolean(
    claim?.is_hyperbeam_upload ||
    claim?.hyperbeam_upload_id ||
    claim?.value?.source?.hyperbeam_upload_id ||
    claim?.value?.source?.hyperbeam_body_path
  );
}

export function hyperbeamUploadIdFromClaim(claim?: any) {
  return claim?.hyperbeam_upload_id || claim?.value?.source?.hyperbeam_upload_id || claim?.claim_id || '';
}

export function hyperbeamUploadOutpointFromClaim(claim?: any) {
  if (!claim) return claim;
  const uploadId = hyperbeamUploadIdFromClaim(claim);
  return `${claim.txid || uploadId}:${claim.nout || 0}`;
}

export function hyperbeamUploadReadUrlFromClaim(claim?: any) {
  const uploadId = hyperbeamUploadIdFromClaim(claim);
  return uploadId ? hyperbeamDeviceUrl(HYPERBEAM_DEVICE.uploadDemo, 'read', { id: uploadId }) : '';
}

export function hyperbeamUploadFileInfoFromClaim(claim?: any) {
  if (!isHyperbeamUploadClaim(claim)) return undefined;

  const source = claim?.value?.source || {};
  const streamingUrl = hyperbeamUploadReadUrlFromClaim(claim);
  if (!streamingUrl) return undefined;

  const size = Number(source.size) || 0;
  const outpoint = hyperbeamUploadOutpointFromClaim(claim);
  const contentType = source.media_type || 'application/octet-stream';
  const channel = claim?.signing_channel;

  return {
    outpoint,
    claim_id: claim.claim_id,
    txid: claim.txid || hyperbeamUploadIdFromClaim(claim),
    nout: claim.nout || 0,
    claim_name: claim.name,
    channel_name: channel?.name,
    channel_claim_id: channel?.claim_id,
    streaming_url: streamingUrl,
    download_path: streamingUrl,
    file_name: source.name || claim.name || 'hyperbeam-upload-demo.bin',
    content_type: contentType,
    mime_type: contentType,
    total_bytes: size,
    written_bytes: size,
    completed: true,
    status: 'finished',
    metadata: claim.value || {},
    hyperbeam_upload_id: hyperbeamUploadIdFromClaim(claim),
    hyperbeam_body_path: source.hyperbeam_body_path,
    is_hyperbeam_upload: true,
  };
}
