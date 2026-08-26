const HYPERBEAM_DEVICES = new Set([
  '~odysee-account@1.0',
  '~odysee-claim@1.0',
  '~odysee-channel@1.0',
  '~odysee-comment@1.0',
  '~odysee-file@1.0',
  '~odysee-file-reaction@1.0',
  '~odysee-preference@1.0',
  '~odysee-reaction@1.0',
  '~query@1.0',
  '~search@1.0',
  '~odysee-stream@1.0',
  '~odysee-upload@1.0',
]);
const HYPERBEAM_WRITE_DEVICES = new Set(['~cache@1.0', '~odysee-upload@1.0']);

export function isHyperbeamPublicReadDevice(device: string) {
  return HYPERBEAM_DEVICES.has(device);
}

export function isHyperbeamDeviceEnabled(device: string) {
  return isHyperbeamPublicReadDevice(device) || HYPERBEAM_WRITE_DEVICES.has(device);
}
