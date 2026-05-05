export type AppSlug = "app" | "drop" | "find" | "million";
export type NotificationAudienceSlug = AppSlug | "all";

const VALID_APP_SLUGS = new Set<AppSlug>(["app", "drop", "find", "million"]);
const VALID_AUDIENCE_SLUGS = new Set<NotificationAudienceSlug>([
  "all",
  "app",
  "drop",
  "find",
  "million",
]);

export function normalizeAppSlug(value: unknown, fallback: AppSlug = "app"): AppSlug {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return VALID_APP_SLUGS.has(normalized as AppSlug) ? (normalized as AppSlug) : fallback;
}

export function normalizeNotificationAudienceSlug(
  value: unknown,
  fallback: NotificationAudienceSlug = "app"
): NotificationAudienceSlug {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return VALID_AUDIENCE_SLUGS.has(normalized as NotificationAudienceSlug)
    ? (normalized as NotificationAudienceSlug)
    : fallback;
}

export function resolveAppSlugFromUrl(url: URL): AppSlug {
  const hostname = url.hostname.toLowerCase();
  const cleanPath = url.pathname.replace(/\/+$/, "") || "/";

  if (hostname === "drop.10x.meme") return "drop";
  if (hostname === "find.10x.meme") return "find";
  if (hostname === "million.10x.meme") return "million";

  if (cleanPath === "/drop" || cleanPath.startsWith("/drop/")) return "drop";
  if (cleanPath === "/find" || cleanPath.startsWith("/find/")) return "find";
  if (cleanPath === "/million" || cleanPath.startsWith("/million/")) return "million";

  return "app";
}

export function getDefaultLaunchUrl(appSlug: AppSlug): string {
  if (appSlug === "drop") return "https://drop.10x.meme/";
  if (appSlug === "find") return "https://find.10x.meme/";
  if (appSlug === "million") return "https://million.10x.meme/";
  return "https://app.10x.meme/";
}

export function resolveAppSlugFromAppFid(
  appFid: number | null | undefined,
  mapping: Partial<Record<AppSlug, number>> = {}
): AppSlug | null {
  if (typeof appFid !== "number") return null;

  if (mapping.app != null && appFid === mapping.app) return "app";
  if (mapping.drop != null && appFid === mapping.drop) return "drop";
  if (mapping.find != null && appFid === mapping.find) return "find";
  if (mapping.million != null && appFid === mapping.million) return "million";

  // Current observed app_fid in production webhook events.
  if (appFid === 9152) return "app";

  return null;
}
