import { isWarpletsAppHostname } from "./warpletsApp.js";
import { isStonkletsAppHostname } from "./stonkletsApp.js";

export type AppFaviconKey = "app" | "warplets" | "stonklets" | "drop";

export const APP_FAVICONS: Readonly<Record<AppFaviconKey, { png: string; ico: string }>> = {
  app: { png: "/favicon-10x-v2.png", ico: "/favicon-10x-v2.ico" },
  warplets: { png: "/favicon-warplets-v2.png", ico: "/favicon-warplets-v2.ico" },
  stonklets: { png: "/stonklets/chip.png", ico: "/favicon-warplets-v2.ico" },
  drop: { png: "/favicon-drop-v2.png", ico: "/favicon-drop-v2.ico" },
};

export function getHostnameFaviconKey(hostname: string): AppFaviconKey {
  const normalized = hostname.toLowerCase();
  if (normalized === "drop.10x.meme" || normalized === "drop-dev.10x.meme" || normalized === "drop-local.10x.meme") {
    return "drop";
  }
  if (isWarpletsAppHostname(normalized)) return "warplets";
  return isStonkletsAppHostname(normalized) ? "stonklets" : "app";
}

export function buildFaviconLinks(key: AppFaviconKey): string {
  const favicon = APP_FAVICONS[key];
  return [
    `<link rel="icon" type="image/png" sizes="256x256" href="${favicon.png}" />`,
    `<link rel="shortcut icon" type="image/x-icon" href="${favicon.ico}" />`,
  ].join("\n    ");
}
