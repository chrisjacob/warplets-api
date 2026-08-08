export const WARPLETS_APP_SLUG = "warplets" as const;
export const WARPLETS_PUBLIC_NAME = "10X Warplets";
export const WARPLETS_APP_PATH = "/warplets";

export const WARPLETS_APP_ORIGINS = {
  local: "https://warplet-local.10x.meme",
  dev: "https://warplet-dev.10x.meme",
  prod: "https://warplet.10x.meme",
} as const;

export const WARPLETS_APP_HOSTS = [
  "warplet-local.10x.meme",
  "warplet-dev.10x.meme",
  "warplet.10x.meme",
] as const;

export function isWarpletsAppHostname(hostname: string): boolean {
  return (WARPLETS_APP_HOSTS as readonly string[]).includes(hostname.toLowerCase());
}
