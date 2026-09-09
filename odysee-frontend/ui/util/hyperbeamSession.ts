// Boot-time session policy, free of app aliases so node scripts can test it.
// A 401/403 from the owner lookup is the node's final answer that this
// browser holds no session; other failures are transient unless they are
// another deterministic 4xx.
export function sessionRejected(error: any): boolean {
  return error?.status === 401 || error?.status === 403;
}

export function retryable(error: any): boolean {
  const status = Number(error?.status);
  return !status || status >= 500;
}

export async function recoverOnce<T>(recover: () => Promise<T>, delayMs = 2000): Promise<T> {
  try {
    return await recover();
  } catch (error) {
    if (!retryable(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return recover();
  }
}
