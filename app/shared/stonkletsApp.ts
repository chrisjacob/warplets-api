export const STONKLETS_APP_SLUG = "stonklets" as const;
export const STONKLETS_PUBLIC_NAME = "10X Stonklets";
export const STONKLETS_APP_PATH = "/stonklets";

export const STONKLETS_APP_ORIGINS = {
  local: "https://stonklet-local.10x.meme",
  dev: "https://stonklet-dev.10x.meme",
  prod: "https://stonklet.10x.meme",
} as const;

export const STONKLETS_APP_HOSTS = [
  "stonklet-local.10x.meme",
  "stonklet-dev.10x.meme",
  "stonklet.10x.meme",
] as const;

export function isStonkletsAppHostname(hostname: string): boolean {
  return (STONKLETS_APP_HOSTS as readonly string[]).includes(hostname.toLowerCase());
}
