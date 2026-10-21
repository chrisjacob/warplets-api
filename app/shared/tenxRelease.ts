/** Product exposure only. This never enables evidence, voting or launch gates. */
export interface TenxReleaseEnv {
  TENX_APP_ENABLED?: string;
}

export const tenxAppEnabled = (value: unknown): boolean => value === "true";

export function isTenxAppPath(path: string): boolean {
  const clean = path.replace(/\/+$/, "");
  return ["/discover", "/attention", "/submit", "/backing", "/rewards", "/launch-lab", "/launch-recovery", "/wallets", "/research", "/transparency", "/status", "/admin/10x"].includes(clean)
    || /^\/campaign\/[0-9a-f-]{36}$/i.test(clean)
    || /^\/elections(?:\/[^/]+)?$/.test(clean)
    || /^\/token\/solana\/[^/]+$/.test(clean);
}

export function tenxPage(path: string, enabled: boolean): "home" | "thesis" | "discovery" {
  if (!enabled || path.replace(/\/+$/, "") === "/thesis") return "thesis";
  return isTenxAppPath(path) ? "discovery" : "home";
}

/** Match whole namespaces, including invalid/deeper routes, before downstream IO. */
export function tenxReleaseSurface(path: string): "api" | "page" | null {
  let clean: string;
  try { clean = decodeURIComponent(path).replace(/\/+/g, "/").toLowerCase(); }
  catch { return null; }
  if (/^\/api\/10x(?:\/|$)/.test(clean)) return "api";
  return /^\/(?:discover|attention|submit|backing|rewards|launch-lab|launch-recovery|wallets|research|transparency|status|campaign|elections|token)(?:\/|$)/.test(clean)
    || /^\/admin\/10x(?:\/|$)/.test(clean) ? "page" : null;
}
