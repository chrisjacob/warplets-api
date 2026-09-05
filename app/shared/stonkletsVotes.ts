import { STONKLETS_CATALOG } from "./stonkletsCatalog";

export interface StonkletVoter { wallet: string; username: string | null; image: string | null; votedAt: string }
export interface StonkletVotersPage { total: number; voters: StonkletVoter[]; nextCursor: string | null }

export function isStonkletsVotesPreview(url: URL): boolean {
  return url.searchParams.get("votes") === "1" && ["localhost", "127.0.0.1", "[::1]", "stonklet-local.10x.meme", "app-local.10x.meme"].includes(url.hostname.toLowerCase());
}

export function mockVoteCount(id: string): number {
  const index = STONKLETS_CATALOG.findIndex((entry) => entry.id === id);
  return index < 0 ? 0 : [1234, 0, 1, 11, 43, 25][index % 6];
}

export function mockWalletOnly(id: string): boolean {
  return STONKLETS_CATALOG.findIndex((entry) => entry.id === id) % 6 === 5;
}
