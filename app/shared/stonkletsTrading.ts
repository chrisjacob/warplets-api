import type { StonkletCatalogEntry } from "./stonkletsCatalog";
import { VERIFIED_STOCK_CONTRACTS } from "./stonkletsStockContracts";

// User-provided BNB contracts for launched Stonklet Trade and Share links.
export const STONKLET_TRADE_DESTINATIONS: Readonly<Record<string, string>> = {
  "direxion-soxl": "0x21d68a77b309a0835a2ee52378d2fd2e12e97777",
  "direxion-soxs": "0x10cdfce1effe43e912dace17fe925cf87e987777",
};

export function stonkletTradeUrl(entry: StonkletCatalogEntry, asset: "stock" | "stonklet"): string | null {
  // Never use a provider's symbol-only contract mapping for a trading destination.
  const address = asset === "stock" ? VERIFIED_STOCK_CONTRACTS[entry.stock.symbol]?.address
    : entry.launchStatus === "launched" ? STONKLET_TRADE_DESTINATIONS[entry.id] ?? entry.stonklet.contractAddress ?? entry.demoToken?.contractAddress : null;
  if (asset === "stonklet" && address && STONKLET_TRADE_DESTINATIONS[entry.id]) {
    return `https://flap.sh/bnb/${address.toLowerCase()}?lang=en`;
  }
  return address && /^0x[0-9a-f]{40}$/i.test(address) ? `https://fomo.family/tokens/bnb/${address.toLowerCase()}?r=10XMemeX` : null;
}
