const LEGACY_ONLY_SDK_METHODS = new Set([
  'account_list',
  'address_is_mine',
  'address_list',
  'address_unused',
  'blob_list',
  'channel_sign',
  'channel_list',
  'claim_list',
  'file_list',
  'preference_get',
  'preference_set',
  'purchase_list',
  'settings_clear',
  'settings_get',
  'settings_set',
  'stream_list',
  'sync_get',
  'sync_set',
  'sync_apply',
  'sync_hash',
  'transaction_list',
  'txo_list',
  'wallet_balance',
  'wallet_decrypt',
  'wallet_encrypt',
  'wallet_list',
  'wallet_lock',
  'wallet_status',
  'wallet_unlock',
]);

type LegacyFetchEndpoints = {
  lbryApiUrl?: string;
  proxyUrl?: string;
  proxyUrlNoCf?: string;
  recsysEndpoint?: string;
  recsysFypEndpoint?: string;
};

export function hyperbeamLegacyFetchBases(endpoints: LegacyFetchEndpoints): Array<string> {
  return [
    endpoints.lbryApiUrl,
    endpoints.proxyUrl,
    endpoints.proxyUrlNoCf,
    endpoints.recsysEndpoint,
    endpoints.recsysFypEndpoint,
    'https://api.lbry.com',
  ].filter((base): base is string => typeof base === 'string' && base.length > 0);
}

export function legacyOnlySdkMethod(method: string): boolean {
  return LEGACY_ONLY_SDK_METHODS.has(method);
}

export function hyperbeamSdkMethodBlocked(method: string, hyperbeamEnabled: boolean): boolean {
  return hyperbeamEnabled && legacyOnlySdkMethod(method);
}

export function hyperbeamLegacyRealtimeBlocked(hyperbeamEnabled: boolean): boolean {
  return hyperbeamEnabled;
}

export function hyperbeamLegacyUrlBlocked(url: string, legacyBases: Array<string>, hyperbeamEnabled: boolean): boolean {
  return hyperbeamEnabled && legacyBases.some((base) => Boolean(base) && url.startsWith(base));
}
