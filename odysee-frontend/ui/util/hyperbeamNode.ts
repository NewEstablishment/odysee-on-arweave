export function resolveHyperbeamNodeBase(params: {
  manifestOrigin?: string;
  baseUrl?: string;
  nodeApi?: string;
}): string {
  const manifestOrigin = normalizeBase(params.manifestOrigin);
  if (manifestOrigin) return manifestOrigin;
  return normalizeBase(params.baseUrl) || normalizeBase(params.nodeApi);
}

function normalizeBase(value: any): string {
  return typeof value === 'string' ? value.replace(/\/+$/, '') : '';
}
