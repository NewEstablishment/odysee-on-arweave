export type NativeReadCache<T> = Map<string, { expiresAt: number; promise: Promise<T> }>;

// Share in-flight reads and cache successful values, never unavailable evidence.
// Empty lists and false are valid results; null/undefined are retryable misses.
export function cachedNativeRead<T>(
  cache: NativeReadCache<T>,
  key: string,
  load: () => Promise<T>,
  ttl: number
): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  let promise: Promise<T>;
  promise = Promise.resolve()
    .then(load)
    .then((result) => {
      if (cache.get(key)?.promise === promise) {
        if (result === null || result === undefined) cache.delete(key);
        else cache.set(key, { expiresAt: Date.now() + ttl, promise });
      }
      return result;
    })
    .catch((error) => {
      if (cache.get(key)?.promise === promise) cache.delete(key);
      throw error;
    });
  cache.set(key, { expiresAt: Number.POSITIVE_INFINITY, promise });
  return promise;
}
