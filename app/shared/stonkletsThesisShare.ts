import type { StonkletCatalogEntry } from "./stonkletsCatalog";
import { stonkletShare } from "./stonkletsShare";
import type { ShareNews } from "./stonkletsNews";

// Conservative X weighting: overcounts complex emoji rather than risking oversized posts.
// URLs always consume 23 weighted characters; Farcaster is bounded by UTF-8 bytes.
export function thesisPostLength(text: string, platform: "twitter" | "farcaster"): number {
  if (platform === "farcaster") return new TextEncoder().encode(text).length;
  return [...text.normalize("NFC").replace(/https:\/\/[^\s]+/g, "x".repeat(23))].reduce((length, char) => {
    const code = char.codePointAt(0)!;
    return length + (code <= 4351 || (code >= 8192 && code <= 8205) || (code >= 8208 && code <= 8223) || (code >= 8242 && code <= 8247) ? 1 : 2);
  }, 0);
}

export function stonkletThesisShare(entry: StonkletCatalogEntry, hostname: string, thesis: ShareNews) {
  const base = stonkletShare(entry, hostname, "1h");
  const url = new URL(base.url);
  url.searchParams.delete("thesis");
  url.searchParams.set("news", thesis.id);
  const source = thesis.sources.find(item => item.id === thesis.leadSourceId) ?? thesis.sources[0];
  const title = (thesis.headline ?? source?.title ?? entry.stonklet.name).replace(/[\r\n]+/g, " ");
  const links = `${source?.url ?? base.url}\n\n${url.href}`;
  // A single preview works for both composers; preserve both URLs and shorten only the title.
  const chars = [...title];
  let headline = chars.join("");
  const format = () => `${headline}\n\n${links}`;
  while (chars.length && (thesisPostLength(format(), "twitter") > 280 || thesisPostLength(format(), "farcaster") > 1024)) {
    chars.pop(); headline = chars.length ? `${chars.join("").trimEnd()}...` : "";
  }
  const text = format();
  return { ...base, title: headline, url: url.href, text, farcasterText: text, twitterText: text };
}
