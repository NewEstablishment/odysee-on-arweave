import { HYPERBEAM_DEVICE, hyperbeamDeviceUrl } from 'util/hyperbeamDevices';

const TXID_PATTERN = /^[a-f0-9]{64}$/i;
const UINT_PATTERN = /^\d+$/;

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

export function hyperbeamClaimOutpointFromClaim(claim?: any) {
  const txid = claim?.txid || claim?.tx_id || claim?.['tx-id'];
  const nout = claim?.nout ?? claim?.n_out ?? claim?.['n-out'];

  if (typeof txid !== 'string' || !TXID_PATTERN.test(txid)) return '';
  if (typeof nout === 'number' && nout >= 0) return `${txid.toLowerCase()}:${nout}`;
  if (typeof nout === 'string' && UINT_PATTERN.test(nout)) return `${txid.toLowerCase()}:${nout}`;

  return '';
}

export function hyperbeamUploadOutpointFromClaim(claim?: any) {
  if (!claim) return claim;
  const claimOutpoint = hyperbeamClaimOutpointFromClaim(claim);
  if (claimOutpoint) return claimOutpoint;

  const uploadId = hyperbeamUploadIdFromClaim(claim);
  return `${claim.txid || uploadId}:${claim.nout || 0}`;
}

export function hyperbeamClaimMediaUrlFromClaim(claim?: any, fallbackUri?: string) {
  const outpoint = hyperbeamClaimOutpointFromClaim(claim);
  if (outpoint) return hyperbeamDeviceUrl(HYPERBEAM_DEVICE.odysee, 'media', { target: outpoint });
  if (!isHyperbeamUploadClaim(claim)) return '';

  const uploadId = hyperbeamUploadIdFromClaim(claim);
  const uri = fallbackUri || claim?.canonical_url || claim?.permanent_url || claim?.short_url || '';

  if (uri) return hyperbeamDeviceUrl(HYPERBEAM_DEVICE.odysee, 'media', { target: uri });
  return uploadId ? hyperbeamDeviceUrl(HYPERBEAM_DEVICE.odysee, 'media', { claim_id: uploadId }) : '';
}

export function hyperbeamUploadMediaUrlFromClaim(claim?: any, fallbackUri?: string) {
  return hyperbeamClaimMediaUrlFromClaim(claim, fallbackUri);
}

export function hyperbeamUploadReadUrlFromClaim(claim?: any) {
  const mediaUrl = hyperbeamUploadMediaUrlFromClaim(claim);
  if (mediaUrl) return mediaUrl;

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

export function hyperbeamReferenceUrlFromTarget(target?: string) {
  return target ? hyperbeamDeviceUrl(HYPERBEAM_DEVICE.odysee, 'reference', { target }) : '';
}

export function hyperbeamQueryUrl(params: Record<string, string>) {
  return hyperbeamDeviceUrl(HYPERBEAM_DEVICE.odysee, 'query', params);
}

export function hyperbeamDemoUrl(params: Record<string, string> = {}) {
  return hyperbeamDeviceUrl(HYPERBEAM_DEVICE.odysee, 'demo', params);
}
