export interface PreloadRecoveryContext {
  appLoaded: boolean;
  embedded: boolean;
  recoveryAttempted: boolean;
}

/**
 * A stale entry chunk can prevent the app from booting at all, in which case
 * one reload is useful. Once the document has loaded, reloading in response to
 * a deferred chunk failure tears down a working SPA and replays the host's
 * splash screen on the user's first interaction.
 */
export function shouldReloadForPreloadError({
  appLoaded,
  embedded,
  recoveryAttempted,
}: PreloadRecoveryContext): boolean {
  return !appLoaded && !embedded && !recoveryAttempted;
}
