import type { EthereumProvider } from "./walletTrade";
import { requestIdentityLinkConfirmation } from "./identityLinkConfirmation";
import { stringToHex } from "viem";

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
  identitiesLinked: boolean;
  expiresAt: string | null;
  actionSessionToken: string | null;
}

interface BaseWalletConnectResult {
  accounts?: Array<{
    address?: unknown;
    capabilities?: {
      signInWithEthereum?: {
        message?: unknown;
        signature?: unknown;
        code?: unknown;
      };
    };
  }>;
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

function profileString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.toLowerCase() !== "undefined" && normalized.toLowerCase() !== "null"
    ? normalized
    : null;
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
      username: profileString(rawProfile.username),
      displayName: profileString(rawProfile.displayName),
      pfpUrl: profileString(rawProfile.pfpUrl),
    } : null,
    walletAddress: typeof payload.walletAddress === "string" ? payload.walletAddress as `0x${string}` : null,
    identitiesLinked: payload.identitiesLinked === true,
    expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : null,
    actionSessionToken: typeof payload.actionSessionToken === "string" ? payload.actionSessionToken : null,
  };
}

async function identityLinkRequest(method: "POST" | "DELETE", confirm?: boolean): Promise<void> {
  await requireOk(await fetch("/api/auth/link", {
    method,
    credentials: "same-origin",
    headers: method === "POST" ? { "content-type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify({ confirm }) : undefined,
  }));
}

export async function linkCurrentWalletAndIdentity(walletAddress: string): Promise<boolean> {
  const confirmed = await requestIdentityLinkConfirmation(walletAddress);
  if (!confirmed) return false;
  await identityLinkRequest("POST", true);
  return true;
}

export async function unlinkCurrentWalletAndIdentity(): Promise<void> {
  await identityLinkRequest("DELETE");
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

async function completeWalletAuthentication(message: string, signature: string, address: `0x${string}`): Promise<void> {
  const verified = await requireOk(await fetch("/api/auth/wallet/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
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
      const confirmed = await requestIdentityLinkConfirmation(address);
      if (confirmed) await requireOk(await link(true));
    } else if (!first.ok) {
      await requireOk(first);
    }
  }
}

/**
 * Base Account supports SIWE as part of wallet_connect. Keeping the account
 * connection and authentication in one native request avoids a second raw
 * personal_sign handoff, which can strand the Base iOS WebView on a blank
 * wallet document after approval.
 */
export async function authenticateBaseWallet(provider: EthereumProvider, chainId: number): Promise<`0x${string}`> {
  const challenge = await requireOk(await fetch("/api/auth/wallet/challenge", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chainId }),
  }));
  const capability = challenge.signInWithEthereum && typeof challenge.signInWithEthereum === "object"
    ? challenge.signInWithEthereum as Record<string, unknown>
    : null;
  if (!capability) throw new Error("Wallet sign-in challenge was unavailable");

  const rawResult = await provider.request({
    method: "wallet_connect",
    params: [{ version: "1", capabilities: { signInWithEthereum: capability } }],
  });
  const result = rawResult && typeof rawResult === "object" ? rawResult as BaseWalletConnectResult : null;
  const account = result?.accounts?.[0];
  const address = typeof account?.address === "string" && /^0x[a-fA-F0-9]{40}$/.test(account.address)
    ? account.address.toLowerCase() as `0x${string}`
    : null;
  const signIn = account?.capabilities?.signInWithEthereum;
  if (!address) throw new Error("Base wallet did not return an account");
  if (!signIn || typeof signIn.message !== "string" || typeof signIn.signature !== "string") {
    throw new Error(typeof signIn?.message === "string" ? signIn.message : "Base wallet did not return a sign-in signature");
  }
  await completeWalletAuthentication(signIn.message, signIn.signature, address);
  return address;
}

export async function authenticateWallet(provider: EthereumProvider, address: `0x${string}`, chainId: number): Promise<void> {
  const challenge = await requireOk(await fetch("/api/auth/wallet/challenge", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, chainId }),
  }));
  if (typeof challenge.message !== "string") throw new Error("Wallet sign-in challenge was unavailable");
  // EIP-1193 personal_sign takes hex-encoded data. Some injected wallets also
  // accept a plain UTF-8 string, but Base Account correctly rejects it as an
  // invalid message. The server still receives and validates the original SIWE
  // text; stringToHex represents the exact same UTF-8 bytes being signed.
  const signature = await provider.request({
    method: "personal_sign",
    params: [stringToHex(challenge.message), address],
  });
  if (typeof signature !== "string") throw new Error("Wallet did not return a sign-in signature");
  await completeWalletAuthentication(challenge.message, signature, address);
}

export async function logoutAppPrincipal(principal: "wallet" | "farcaster" | "all"): Promise<void> {
  await requireOk(await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ principal }),
  }));
}
