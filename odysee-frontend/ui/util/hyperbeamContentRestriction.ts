function field(source: any, ...keys: Array<string>): any {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

function payload(source: any): any {
  if (Array.isArray(source)) return source[0] || {};
  const body = field(source, 'body');
  if (Array.isArray(body)) return body[0] || {};
  if (body && typeof body === 'object') return body;
  return source || {};
}

export function normalizeContentRestrictionResponse(response: any, status: number): any | null {
  const restriction = payload(response);
  const reason = field(restriction, 'reason');
  if (status !== 451 && !(status === 503 && reason === 'location-unavailable')) return null;

  return {
    ...(response && typeof response === 'object' && !Array.isArray(response) ? response : {}),
    ...(restriction && typeof restriction === 'object' && !Array.isArray(restriction) ? restriction : {}),
    status,
    'content-restriction': true,
  };
}
