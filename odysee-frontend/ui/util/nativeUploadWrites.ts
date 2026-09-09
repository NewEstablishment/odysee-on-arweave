// These are locator hints, never authority. Every hint is exact-read and
// verified by the integration layer before it participates in a chain.
const queues = new Map<string, Promise<unknown>>();
const hints = new Map<string, string[]>();

export function uploadVersionHints(key: string): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    return [
      ...new Set([
        ...(hints.get(key) || []),
        ...(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : []),
      ]),
    ];
  } catch {
    return hints.get(key) || [];
  }
}

export function rememberUploadVersion(key: string, id: string): void {
  const ids = [...new Set([...uploadVersionHints(key), id])];
  hints.set(key, ids);
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* Memory hints still cover this tab. */
  }
}

export async function serializeUploadWrite<T>(key: string, write: () => Promise<T>): Promise<T> {
  const pending = (queues.get(key) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      // Web Locks covers other tabs; the queue also supports environments without it.
      if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(key, write);
      return write();
    });
  queues.set(key, pending);
  try {
    return await pending;
  } finally {
    if (queues.get(key) === pending) queues.delete(key);
  }
}
