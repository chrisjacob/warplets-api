import type { StonkletCatalogEntry } from "./stonkletsCatalog";
import { VERIFIED_STOCK_CONTRACTS } from "./stonkletsStockContracts";

// User-selected temporary destinations, separate from official Stonklet contracts.
export const STONKLET_TRADE_DESTINATIONS: Readonly<Record<string, string>> = {
  "direxion-soxl": "0xfe189e97832da1573e4e4ff034f4ffc3a15c7777",
  "direxion-soxs": "0x90f62f81307ebf4ccd0a0510e3391c67b1d17777",
};

export function stonkletTradeUrl(entry: StonkletCatalogEntry, asset: "stock" | "stonklet"): string | null {
  // Never use a provider's symbol-only contract mapping for a trading destination.
  const address = asset === "stock" ? VERIFIED_STOCK_CONTRACTS[entry.stock.symbol]?.address
    : entry.launchStatus === "launched" ? STONKLET_TRADE_DESTINATIONS[entry.id] ?? entry.stonklet.contractAddress ?? entry.demoToken?.contractAddress : null;
  return address && /^0x[0-9a-f]{40}$/i.test(address) ? `https://fomo.family/tokens/bnb/${address.toLowerCase()}?r=10XMemeX` : null;
}
