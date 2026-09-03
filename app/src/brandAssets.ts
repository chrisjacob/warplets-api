import { WARPLETS_APP_HOSTS, WARPLETS_APP_PATH } from "../shared/warpletsApp";
import { STONKLETS_APP_HOSTS, STONKLETS_APP_PATH } from "../shared/stonkletsApp";

export function isWarpletsSurface(location: Pick<Location, "hostname" | "pathname"> = window.location): boolean {
  const hostname = location.hostname.toLowerCase();
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  return (WARPLETS_APP_HOSTS as readonly string[]).includes(hostname)
    || pathname === WARPLETS_APP_PATH
    || pathname.startsWith(`${WARPLETS_APP_PATH}/`);
}

export function isStonkletsSurface(location: Pick<Location, "hostname" | "pathname"> = window.location): boolean {
  const hostname = location.hostname.toLowerCase();
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  return (STONKLETS_APP_HOSTS as readonly string[]).includes(hostname)
    || pathname === STONKLETS_APP_PATH
    || pathname.startsWith(`${STONKLETS_APP_PATH}/`);
}

export function getRuntimeAppIconPath(): string {
  if (isStonkletsSurface()) return "/stonklets/chip.png";
  return isWarpletsSurface() ? "/icon_search.png" : "/icon.png";
}

export function getRuntimeAppName(): string {
  if (isStonkletsSurface()) return "10X Stonklets";
  return isWarpletsSurface() ? "10X Warplets" : "10X.MEME";
}
