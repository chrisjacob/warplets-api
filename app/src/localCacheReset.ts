type ClearableStorage = Pick<Storage, "clear" | "setItem">;

export const SERVER_CACHE_RESET_PENDING_KEY = "warplets:server-cache-reset-pending";

type CacheResetBrowser = {
  location: Pick<Location, "href">;
  history: Pick<History, "replaceState" | "state">;
  localStorage: ClearableStorage;
  sessionStorage: ClearableStorage;
};

/**
 * Consumes ?clearcache=1 before application state initializes.
 * Secure cookies, IndexedDB/OPFS data, and server-side records are untouched.
 */
export function clearLocalCacheIfRequested(browser: CacheResetBrowser): boolean {
  const url = new URL(browser.location.href);
  if (url.searchParams.get("clearcache") !== "1") return false;

  try { browser.localStorage.clear(); } catch { /* best effort */ }
  try {
    browser.sessionStorage.clear();
    browser.sessionStorage.setItem(SERVER_CACHE_RESET_PENDING_KEY, "1");
  } catch { /* best effort */ }

  url.searchParams.delete("clearcache");
  browser.history.replaceState(
    browser.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  return true;
}
