export type AppSlug = "app" | "drop" | "find" | "million";

const VALID_APP_SLUGS = new Set<AppSlug>(["app", "drop", "find", "million"]);

export function normalizeAppSlug(value: unknown, fallback: AppSlug = "app"): AppSlug {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return VALID_APP_SLUGS.has(normalized as AppSlug) ? (normalized as AppSlug) : fallback;
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
