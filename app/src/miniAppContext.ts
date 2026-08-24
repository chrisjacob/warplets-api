const DEFAULT_CONTEXT_TIMEOUT_MS = 2_000;

export async function detectMiniAppContext(
  detector: (() => Promise<boolean>) | undefined,
  timeoutMs = DEFAULT_CONTEXT_TIMEOUT_MS,
): Promise<boolean> {
  if (!detector) return false;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      detector().catch(() => false),
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      }),
    ]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}
