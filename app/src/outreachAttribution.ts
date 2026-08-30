const TRACKED_KEY_PREFIX = "warplets-holder-outreach-open:";

export function getHolderOutreachTrackingCode(url: URL): string | null {
  const value = url.searchParams.get("outreach")?.trim().toLowerCase() ?? "";
  return /^[a-f0-9]{32}$/.test(value) ? value : null;
}

export function captureHolderOutreachAttribution(
  currentWindow: Pick<Window, "location" | "sessionStorage" | "fetch"> = window,
): void {
  const trackingCode = getHolderOutreachTrackingCode(new URL(currentWindow.location.href));
  if (!trackingCode) return;
  const storageKey = `${TRACKED_KEY_PREFIX}${trackingCode}`;
  if (currentWindow.sessionStorage.getItem(storageKey) === "1") return;
  currentWindow.sessionStorage.setItem(storageKey, "1");

  void currentWindow.fetch("/api/outreach/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trackingCode }),
    keepalive: true,
  }).catch(() => {
    currentWindow.sessionStorage.removeItem(storageKey);
  });
}
