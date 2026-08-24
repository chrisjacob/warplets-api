import { outboundFetch } from "../_lib/outbound.js";
import { jsonSecure } from "../_lib/security.js";

interface Env {
  WARPLETS_KV?: KVNamespace;
}

const CACHE_KEY = "market:eth-usd:v1";
const CACHE_SECONDS = 300;
let memoryCache: { ethUsd: number; asOf: string; expiresAt: number } | null = null;
let activeRequest: Promise<{ ethUsd: number; asOf: string }> | null = null;

async function fetchPrice(): Promise<number> {
  const coinbase = await outboundFetch(
    "https://api.coinbase.com/v2/prices/ETH-USD/spot",
    { headers: { accept: "application/json" } },
    { allowHosts: ["api.coinbase.com"], timeoutMs: 5000, retries: 0 },
  ).then(async (response) => {
    if (!response.ok) return null;
    const payload = await response.json() as { data?: { amount?: unknown } };
    const amount = Number(payload.data?.amount);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }).catch(() => null);
  if (coinbase != null) return coinbase;

  const response = await outboundFetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    { headers: { accept: "application/json" } },
    { allowHosts: ["api.coingecko.com"], timeoutMs: 5000, retries: 0 },
  );
  if (!response.ok) throw new Error(`CoinGecko ETH price failed (${response.status})`);
  const payload = await response.json() as { ethereum?: { usd?: unknown } };
  const amount = Number(payload.ethereum?.usd);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("ETH/USD providers returned invalid data");
  return amount;
}

async function loadPrice(env: Env): Promise<{ ethUsd: number; asOf: string }> {
  if (memoryCache && memoryCache.expiresAt > Date.now()) return memoryCache;
  const cached = await env.WARPLETS_KV?.get(CACHE_KEY, "json") as { ethUsd?: unknown; asOf?: unknown } | null;
  const cachedPrice = Number(cached?.ethUsd);
  if (Number.isFinite(cachedPrice) && cachedPrice > 0 && typeof cached?.asOf === "string") {
    memoryCache = { ethUsd: cachedPrice, asOf: cached.asOf, expiresAt: Date.now() + CACHE_SECONDS * 1000 };
    return memoryCache;
  }
  if (!activeRequest) {
    activeRequest = (async () => {
      const value = { ethUsd: await fetchPrice(), asOf: new Date().toISOString() };
      memoryCache = { ...value, expiresAt: Date.now() + CACHE_SECONDS * 1000 };
      await env.WARPLETS_KV?.put(CACHE_KEY, JSON.stringify(value), { expirationTtl: CACHE_SECONDS });
      return value;
    })().finally(() => {
      activeRequest = null;
    });
  }
  return activeRequest;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const value = await loadPrice(context.env);
    return jsonSecure(value, {
      headers: { "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=300" },
    });
  } catch (error) {
    return jsonSecure(
      { error: "eth_usd_unavailable", message: error instanceof Error ? error.message : String(error) },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
};
