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

// A committed write resolves `commitments`, so the reply itself carries the
// stored message's addresses: a map keyed by commitment id, each key a
// servable alias of the message. The commit flag is scoped to stage 0 (the
// posted message); a global `!` would also commit resolver stages, producing
// multiple locators for one semantic write. `accept-bundle` keeps the map in
// the JSON body instead of linkifying it.
export const HYPERBEAM_COMMITTED_WRITE_PATH = 'commitments?0.%21=true&committers=all&accept-bundle=true';

// Pick the stored message's id out of a committed-write reply. Prefer a
// commitment naming a committer (the user's signature) over an hmac entry.
export function committedWriteId(json: any): string {
  if (!json || typeof json !== 'object') return '';
  const entries = Object.entries(json).filter(
    ([key, val]) => /^[A-Za-z0-9_-]{43}$/.test(key) && val && typeof val === 'object'
  );
  if (!entries.length) return '';
  const signed = entries.find(([, val]) => typeof (val as any).committer === 'string');
  return (signed || entries[0])[0];
}

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
