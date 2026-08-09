import type { EthereumProvider } from "./walletTrade";

export interface AppSessionState {
  authenticated: boolean;
  farcasterFid: number | null;
  farcasterProfile: {
    fid: number;
    username: string | null;
    displayName: string | null;
    pfpUrl: string | null;
  } | null;
  walletAddress: `0x${string}` | null;
  expiresAt: string | null;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return {}; }
}

async function requireOk(response: Response): Promise<Record<string, unknown>> {
  const payload = await readJson(response);
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`);
  return payload;
}

export async function loadAppSession(): Promise<AppSessionState> {
  const payload = await requireOk(await fetch("/api/auth/session", { credentials: "same-origin" }));
  const rawProfile = payload.farcasterProfile && typeof payload.farcasterProfile === "object"
    ? payload.farcasterProfile as Record<string, unknown>
    : null;
  const profileFid = Number(rawProfile?.fid);
  return {
    authenticated: payload.authenticated === true,
    farcasterFid: Number.isInteger(Number(payload.farcasterFid)) ? Number(payload.farcasterFid) : null,
    farcasterProfile: rawProfile && Number.isInteger(profileFid) && profileFid > 0 ? {
      fid: profileFid,
      username: typeof rawProfile.username === "string" ? rawProfile.username : null,
      displayName: typeof rawProfile.displayName === "string" ? rawProfile.displayName : null,
      pfpUrl: typeof rawProfile.pfpUrl === "string" ? rawProfile.pfpUrl : null,
    } : null,
    walletAddress: typeof payload.walletAddress === "string" ? payload.walletAddress as `0x${string}` : null,
    expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : null,
  };
}

export async function verifyFarcasterQuickAuth(token: string): Promise<Record<string, unknown>> {
  return requireOk(await fetch("/api/auth/farcaster/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: { authorization: `Bearer ${token}` },
  }));
}

export async function verifyFarcasterSiwf(input: {
  nonce: string;
  message: string;
  signature: `0x${string}`;
  fid?: number;
}): Promise<Record<string, unknown>> {
  return requireOk(await fetch("/api/auth/farcaster/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export async function authenticateWallet(provider: EthereumProvider, address: `0x${string}`, chainId: number): Promise<void> {
  const challenge = await requireOk(await fetch("/api/auth/wallet/challenge", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, chainId }),
  }));
  if (typeof challenge.message !== "string") throw new Error("Wallet sign-in challenge was unavailable");
  const signature = await provider.request({ method: "personal_sign", params: [challenge.message, address] });
  if (typeof signature !== "string") throw new Error("Wallet did not return a sign-in signature");
  const verified = await requireOk(await fetch("/api/auth/wallet/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: challenge.message, signature }),
  }));
  if (Number.isInteger(Number(verified.farcasterFid)) && Number(verified.farcasterFid) > 0) {
    const link = async (confirm: boolean) => fetch("/api/auth/link", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm }),
    });
    const first = await link(false);
    if (first.status === 409) {
      const confirmed = window.confirm(
        "This wallet differs from the addresses currently associated with your Farcaster profile. Link the two verified identities?",
      );
      if (confirmed) await requireOk(await link(true));
    } else if (!first.ok) {
      await requireOk(first);
    }
  }
}

export async function logoutAppPrincipal(principal: "wallet" | "farcaster" | "all"): Promise<void> {
  await requireOk(await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ principal }),
  }));
}
