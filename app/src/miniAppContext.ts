const DEFAULT_CONTEXT_TIMEOUT_MS = 2_000;
const DEFAULT_CONTEXT_RETRY_DELAY_MS = 150;

export async function detectMiniAppContext(
  detector: (() => Promise<boolean>) | undefined,
  timeoutMs = DEFAULT_CONTEXT_TIMEOUT_MS,
  retryDelayMs = DEFAULT_CONTEXT_RETRY_DELAY_MS,
): Promise<boolean> {
  if (!detector) return false;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const detectWithRetry = async () => {
      if (await detector().catch(() => false)) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, retryDelayMs)));
      return detector().catch(() => false);
    };
    return await Promise.race([
      detectWithRetry(),
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      }),
    ]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}
