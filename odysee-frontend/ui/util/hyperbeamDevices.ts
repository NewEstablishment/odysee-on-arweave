import { HYPERBEAM_BASE_URL, ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { isHyperbeamDeviceEnabled } from 'util/hyperbeamRouting';
import { isServedFromManifest } from 'util/manifest-prefix';
import { resolveHyperbeamNodeBase } from 'util/hyperbeamNode';

export const HYPERBEAM_DEVICE = {
  account: '~odysee-account@1.0',
  analytics: '~analytics@1.0',
  cache: '~cache@1.0',
  claim: '~odysee-claim@1.0',
  channel: '~odysee-channel@1.0',
  comment: '~odysee-comment@1.0',
  file: '~odysee-file@1.0',
  fileReaction: '~odysee-file-reaction@1.0',
  preference: '~odysee-preference@1.0',
  reaction: '~odysee-reaction@1.0',
  query: '~query@1.0',
  search: '~search@1.0',
  stream: '~odysee-stream@1.0',
  streamDescriptor: '~odysee-stream-descriptor@1.0',
  upload: '~odysee-upload@1.0',
};

export function hyperbeamNodeBase() {
  return resolveHyperbeamNodeBase({
    manifestOrigin: typeof window !== 'undefined' && isServedFromManifest() ? window.location.origin : '',
    baseUrl: HYPERBEAM_BASE_URL,
    nodeApi: ODYSEE_HYPERBEAM_NODE_API,
  });
}

export function hyperbeamNodeEnabled() {
  return Boolean(hyperbeamNodeBase());
}

// On a HyperBEAM node the write API is a cookie-authed commit, not the legacy
// verified-email account. Uploads work without that account, so treat the node
// being present as upload being available. Scoped to the upload path only; do
// NOT fold this into the app-wide verified-email gate.
export function hyperbeamUploadEnabled() {
  return hyperbeamNodeEnabled();
}

export function hyperbeamDeviceBase(device: string) {
  const base = hyperbeamNodeBase();
  return base && isHyperbeamDeviceEnabled(device) ? `${base}/${device}` : '';
}
