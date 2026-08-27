export interface OptimismRpcEnv {
  /** Full Optimism Mainnet provider URL, including any API key. */
  OPTIMISM_RPC_URL?: string;
  /** Existing Base Alchemy URLs can supply the same key to Optimism. */
  BASE_RPC_URL?: string;
}

const PUBLIC_OPTIMISM_RPC_URLS = [
  "https://optimism-rpc.publicnode.com",
  "https://mainnet.optimism.io",
] as const;

function normalizeRpcUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function deriveAlchemyOptimismRpcUrl(baseRpcUrl: unknown): string | null {
  const normalized = normalizeRpcUrl(baseRpcUrl);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (url.hostname !== "base-mainnet.g.alchemy.com") return null;
  url.hostname = "opt-mainnet.g.alchemy.com";
  return url.toString();
}

export function getOptimismRpcUrls(env?: OptimismRpcEnv): string[] {
  const configured = normalizeRpcUrl(env?.OPTIMISM_RPC_URL);
  const derivedAlchemy = deriveAlchemyOptimismRpcUrl(env?.BASE_RPC_URL);
  return [...new Set(
    [configured, derivedAlchemy, ...PUBLIC_OPTIMISM_RPC_URLS]
      .filter((value): value is string => Boolean(value)),
  )];
}
