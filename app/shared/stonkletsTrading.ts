import type { StonkletCatalogEntry } from "./stonkletsCatalog";
import { VERIFIED_STOCK_CONTRACTS } from "./stonkletsStockContracts";

// User-provided BNB contracts for launched Stonklet Trade and Share links.
export const STONKLET_TRADE_DESTINATIONS: Readonly<Record<string, string>> = {
  "direxion-soxl": "0x21d68a77b309a0835a2ee52378d2fd2e12e97777",
  "direxion-soxs": "0x10cdfce1effe43e912dace17fe925cf87e987777",
  "spacex": "0xe7bb667c3586673a84ea1ecce3e5aa85cb787777",
  "sk-hynix": "0x9d882a32f27219d2d34029224c61f46afe667777",
  "spy": "0xaa921db02032bede5235186c35c41c8978d27777",
  "tether-gold": "0x84641baebccfd02e53a26fd93600022a9ee47777",
  "invesco-qqq": "0xbc5da03c9859d2e1823b98bd8d1bda7a1df87777",
  "nvidia": "0x71cefb8249021a2e4046d7e3fe81442acff07777",
  "apple": "0x938f73711d3aba320b734845f1a9887a0c647777",
  "tesla": "0xce415a2b7472a82deff15c6e32a978a1f0827777",
  "microsoft": "0xd5ab31b15110fe322a06f9d69a9b31b881767777",
  "alphabet": "0xf8e6eaac6b2037a124947095ec8de94a559e7777",
  "robinhood": "0xc1fa7d4de285f66e7363f95e08a7b0a576317777",
  "alibaba": "0xdb5d4cdba657eb6023bb764ea706082cd5457777",
  "gamestop": "0x1990713913916bf3efd5be4c6f328f1fc92f7777",
  "netflix": "0xdb6a4c2fe0523a25a7815ef185e8cfed78f77777",
  "strategy": "0x75b721bf91e2e92e452422ff45ec24cd697c7777",
  "trump-media": "0x913ed0ba971874ab2d281846f3f3846e26227777",
  "fluence": "0xa7a7458da73425425fc1b07c98a8407ff2b77777",
  "moderna": "0x6c39e14b7a54096cbdf896849497ca767cb17777",
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
