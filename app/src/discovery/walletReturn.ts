// Return paths are navigation hints, never an authentication or permission grant.
export function safeWalletReturn(value: string | null): string {
  if (!value || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/discover";
  try {
    const url = new URL(value, "https://local.invalid");
    const allowed = ["/", "/thesis", "/discover", "/attention", "/submit", "/backing", "/research", "/status", "/transparency", "/elections", "/launch-lab", "/launch-recovery", "/rewards"].includes(url.pathname) || /^\/elections\/[a-zA-Z0-9-]{1,100}$/.test(url.pathname) || /^\/campaign\/[0-9a-f-]{36}$/i.test(url.pathname) || /^\/token\/solana\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(url.pathname);
    return url.origin === "https://local.invalid" && allowed ? url.pathname + url.search + url.hash : "/discover";
  } catch { return "/discover"; }
}
export function solanaSignInHref(returnTo: string) {
  return `/wallets?returnTo=${encodeURIComponent(safeWalletReturn(returnTo))}`;
}
export function verifiedSignInReturn(intent: string, authenticated: boolean, returnTo: string | null) {
  return intent === "login" && authenticated && returnTo !== null ? safeWalletReturn(returnTo) : null;
}
