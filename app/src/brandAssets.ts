import { WARPLETS_APP_HOSTS, WARPLETS_APP_PATH } from "../shared/warpletsApp";

export function isWarpletsSurface(location: Pick<Location, "hostname" | "pathname"> = window.location): boolean {
  const hostname = location.hostname.toLowerCase();
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  return (WARPLETS_APP_HOSTS as readonly string[]).includes(hostname)
    || pathname === WARPLETS_APP_PATH
    || pathname.startsWith(`${WARPLETS_APP_PATH}/`);
}

export function getRuntimeAppIconPath(): string {
  return isWarpletsSurface() ? "/icon_search.png" : "/icon.png";
}

export function getRuntimeAppName(): string {
  return isWarpletsSurface() ? "10X Warplets" : "10X.MEME";
}
