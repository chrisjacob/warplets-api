export interface TrustConnectWalletDescriptor {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  currentSession?: unknown;
}

export function isWalletConnectWallet(wallet: TrustConnectWalletDescriptor): boolean {
  if (wallet.currentSession && typeof wallet.currentSession === "object") return true;
  if (typeof wallet.type === "string" && wallet.type.toLowerCase() === "caip") return true;
  const label = `${typeof wallet.id === "string" ? wallet.id : ""} ${typeof wallet.name === "string" ? wallet.name : ""}`.toLowerCase();
  return label.replace(/[^a-z0-9]/g, "").includes("walletconnect");
}

export function normalizeTrustConnectChainReference(value: unknown, fallback = "8453"): string {
  const raw = value && typeof value === "object" && "reference" in value
    ? (value as { reference?: unknown }).reference
    : value;
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  const reference = text.includes(":") ? text.slice(text.lastIndexOf(":") + 1) : text;
  const parsed = /^0x[0-9a-f]+$/i.test(reference)
    ? Number.parseInt(reference, 16)
    : /^\d+$/.test(reference)
      ? Number.parseInt(reference, 10)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : fallback;
}

export function toEip1193ChainId(value: unknown, fallback = "8453"): `0x${string}` {
  return `0x${Number.parseInt(normalizeTrustConnectChainReference(value, fallback), 10).toString(16)}`;
}

export function normalizeTrustConnectAccounts(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((account): account is string => typeof account === "string" && Boolean(account.trim()));
}
