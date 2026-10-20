import { getWallets } from "@wallet-standard/app";
import type { StandardConnectFeature, StandardEventsFeature } from "@wallet-standard/features";
import type { SolanaSignMessageFeature } from "@solana/wallet-standard-features";
import { IdentityChallengeResponse, IdentitySessionResponse } from "../../../discovery/src/identity-model";

export type SolanaWallet = ReturnType<ReturnType<typeof getWallets>["get"]>[number];
export type SolanaAccount = SolanaWallet["accounts"][number];
export type SolanaConnection = { wallet: SolanaWallet; account: SolanaAccount };
export { getWallets };
export function supportedWallet(wallet: SolanaWallet) {
  return wallet.chains.includes("solana:mainnet") && "standard:connect" in wallet.features && "standard:events" in wallet.features && "solana:signMessage" in wallet.features;
}
export function supportedAccount(account: SolanaAccount) {
  return account.chains.includes("solana:mainnet") && account.features.includes("solana:signMessage") && account.publicKey.length === 32;
}
export async function connectSolana(wallet: SolanaWallet) {
  if (!supportedWallet(wallet)) throw new Error("This wallet does not support Solana message signing.");
  const feature = wallet.features["standard:connect"] as StandardConnectFeature["standard:connect"];
  const { accounts } = await feature.connect();
  return accounts.filter(supportedAccount);
}
export function onWalletChange(wallet: SolanaWallet, changed: () => void) {
  return (wallet.features["standard:events"] as StandardEventsFeature["standard:events"]).on("change", changed);
}
const equalBytes = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((v, i) => b[i] === v);
function stillSelected({ wallet, account }: SolanaConnection) {
  return wallet.accounts.some(a => a.address === account.address && equalBytes(a.publicKey, account.publicKey) && supportedAccount(a));
}
export async function signOwnership(connection: SolanaConnection, message: string, isCurrent: () => boolean) {
  if (!isCurrent() || !stillSelected(connection)) throw new Error("Wallet changed. Create a new challenge.");
  const bytes = new TextEncoder().encode(message);
  const feature = connection.wallet.features["solana:signMessage"] as SolanaSignMessageFeature["solana:signMessage"];
  const outputs = await feature.signMessage({ account: connection.account, message: bytes });
  const output = outputs[0];
  if (!isCurrent() || !stillSelected(connection)) throw new Error("Wallet changed during signing. The proof was not submitted.");
  if (outputs.length !== 1 || !output || (output.signatureType && output.signatureType !== "ed25519") || output.signature.length !== 64 || !equalBytes(bytes, output.signedMessage)) throw new Error("Wallet returned a modified or unsupported message. The proof was not submitted.");
  return btoa(String.fromCharCode(...output.signature));
}
async function request(path: string, body?: unknown) {
  const result = await fetch(`/api/10x/identity/${path}`, { credentials: "same-origin", cache: "no-store", ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json", "x-tenx-identity": "1" }, body: JSON.stringify(body) }) });
  const value: unknown = await result.json();
  if (!result.ok) {
    const code = value && typeof value === "object" && "error" in value ? String(value.error) : "identity_unavailable";
    const explanations: Record<string, string> = {
      identity_wallet_link_conflict: "This wallet belongs to another local 10X identity. Sign out to use that identity. Accounts are never merged automatically.",
      identity_challenge_expired_or_used: "This challenge expired or was already used. Create a new challenge.",
      identity_session_required: "Your local session expired or was revoked. Reload and create a new sign-in challenge.",
      identity_replay_conflict_or_wallet_limit: "The session or wallet links changed, a proof was reused, or a wallet limit was reached. Reload before trying again.",
      identity_session_intent_mismatch: "Your session changed in another tab. Reload before trying again.",
      identity_challenge_limit_or_session_changed: "The local challenge limit was reached or your session changed. Wait a minute and reload; the shared daily cap is 500.",
    };
    throw new Error(explanations[code] ?? `Wallet proof failed: ${code.replaceAll("_", " ")}.`);
  }
  return value;
}
export const loadSolanaIdentity = async () => IdentitySessionResponse.parse(await request("session"));
export const createSolanaChallenge = async (address: string, intent: "login" | "link" | "unlink") => IdentityChallengeResponse.parse(await request("challenge", { address, intent }));
export const verifySolanaChallenge = async (challenge_id: string, signature: string) => IdentitySessionResponse.parse(await request("verify", { challenge_id, signature }));
export const logoutSolanaIdentity = async () => IdentitySessionResponse.parse(await request("logout", {}));
