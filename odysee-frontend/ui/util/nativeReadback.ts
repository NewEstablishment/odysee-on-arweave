// Only retry unavailable exact evidence, never the committed write itself.
// Callers must still validate the returned owner, schema and expected contents.
export async function readNativeWriteBack<T>(
  read: () => Promise<T | null>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<T | null> {
  for (const delay of [0, 250, 750]) {
    if (delay) await wait(delay);
    const result = await read();
    if (result !== null) return result;
  }
  return null;
}
