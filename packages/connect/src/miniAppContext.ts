/** Shared with existing 10X mini apps; host context is a capability hint, never identity proof. */
export async function detectMiniAppContext(
  detector: (() => Promise<boolean>) | undefined,
  timeoutMs = 2000,
  retryDelayMs = 150,
): Promise<boolean> {
  if (!detector) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        if (await detector().catch(() => false)) return true;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, retryDelayMs)),
        );
        return detector().catch(() => false);
      })(),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function onboardingComplete(
  storage: Pick<Storage, "getItem"> | null,
  key: string,
) {
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}
export function completeOnboarding(
  storage: Pick<Storage, "setItem"> | null,
  key: string,
) {
  try {
    storage?.setItem(key, "1");
  } catch {
    /* Completion still applies to this mount. */
  }
}
