interface ClickTrackingUrlOptions {
  notificationId: string;
  targetUrl: string;
  trackingBaseUrl: string;
  appSlug: string;
  fid?: number;
}

export function buildClickTrackingUrl(options: ClickTrackingUrlOptions): string {
  const target = new URL(options.targetUrl);
  const trackingUrl = new URL(
    `/n/${encodeURIComponent(options.notificationId)}`,
    options.trackingBaseUrl,
  );

  trackingUrl.searchParams.set("t", target.toString());
  trackingUrl.searchParams.set("app", options.appSlug);
  if (Number.isInteger(options.fid) && (options.fid ?? 0) > 0) {
    trackingUrl.searchParams.set("fid", String(options.fid));
  }

  return trackingUrl.toString();
}
