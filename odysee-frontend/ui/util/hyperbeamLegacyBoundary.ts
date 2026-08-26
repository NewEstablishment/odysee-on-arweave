const BLOCKED_HYPERBEAM_SDK_METHODS = new Set(['channel_sign']);

export function hyperbeamSdkMethodBlocked(method: string, hyperbeamEnabled: boolean): boolean {
  return hyperbeamEnabled && BLOCKED_HYPERBEAM_SDK_METHODS.has(method);
}

export function hyperbeamLegacyUrlBlocked(url: string, legacyBases: Array<string>, hyperbeamEnabled: boolean): boolean {
  return hyperbeamEnabled && legacyBases.some((base) => Boolean(base) && url.startsWith(base));
}
