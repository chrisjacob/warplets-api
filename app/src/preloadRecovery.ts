export interface PreloadRecoveryContext {
  appMounted: boolean;
  embedded: boolean;
  recoveryAttempted: boolean;
}

/**
 * A stale entry chunk can prevent the app from booting at all, in which case
 * one reload is useful. Once React has mounted, reloading in response to
 * a deferred chunk failure tears down a working SPA and replays the host's
 * splash screen on the user's first interaction. React can become interactive
 * before the browser's window.load event, especially in an image-heavy iOS
 * WebView, so document load is too late to be the recovery boundary.
 */
export function shouldReloadForPreloadError({
  appMounted,
  embedded,
  recoveryAttempted,
}: PreloadRecoveryContext): boolean {
  return !appMounted && !embedded && !recoveryAttempted;
}
