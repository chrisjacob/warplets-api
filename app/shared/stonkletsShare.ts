import { STONKLETS_CATALOG, type StonkletCatalogEntry } from "./stonkletsCatalog";
import { STONKLETS_APP_ORIGINS } from "./stonkletsApp";
import { stonkletTradeUrl } from "./stonkletsTrading";
import { DEFAULT_STONKLET_CHANGE_RANGE, type StonkletChangeRange } from "./stonkletsTime";

export function stonkletFromSharePath(path: string): StonkletCatalogEntry | undefined {
  try {
    const symbol = decodeURIComponent(path.replace(/^\//, "").replace(/\/$/, "")).toLowerCase();
    const currentSymbol = ({ bull: "bull10x", bear: "bear10x" } as Record<string, string>)[symbol] ?? symbol;
    return STONKLETS_CATALOG.find((entry) => entry.stonklet.symbol.toLowerCase() === currentSymbol);
  } catch { return undefined; }
}
export function stonkletShareOrigin(hostname: string): string {
  return ["localhost", "127.0.0.1", "stonklet-local.10x.meme"].includes(hostname)
    ? STONKLETS_APP_ORIGINS.local : STONKLETS_APP_ORIGINS.prod;
}
export function stonkletShare(entry: StonkletCatalogEntry, hostname: string, range: StonkletChangeRange = DEFAULT_STONKLET_CHANGE_RANGE) {
  const origin = stonkletShareOrigin(hostname);
  const url = new URL(`/${encodeURIComponent(entry.stonklet.symbol.toLowerCase())}`, origin);
  if (range !== DEFAULT_STONKLET_CHANGE_RANGE) url.searchParams.set("change", range);
  const launched = entry.launchStatus === "launched";
  const tradeUrl = launched ? stonkletTradeUrl(entry, "stonklet") : null;
  const title = `${launched ? "👀 Check out" : "✅ Vote for"} Stonklet: ${entry.stonklet.name} ( $${entry.stonklet.symbol} ).`;
  const description = `Memecoin paired with Stock: ${entry.stock.name} ( $${entry.stock.symbol} ).`;
  const image = `${origin}/api/stonklets/share-image?id=${encodeURIComponent(entry.id)}&range=${range}`;
  return { title, description, url: url.href, text: `${title}\n\n${description}\n\n${url.href}${tradeUrl ? `\n\n${tradeUrl}` : ""}`, image, ogImage: `${image}&variant=og`, artwork: new URL(entry.stonklet.image, origin).href };
}
