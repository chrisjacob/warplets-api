export type PerksShareId = "memes" | "nfts" | "ai" | "attention" | "access";

export type PerksShareContent = {
  id: PerksShareId; label: string; eyebrow: string; summary: string;
  callout: string; cta: string; modalTitle: string;
  tokenId: number; secondImageUrl?: string;
};

export const PERKS_SHARE_CONTENT: Record<PerksShareId, PerksShareContent> = {
  memes: {
    id: "memes", label: "Memes", eyebrow: "Attention Tokens",
    summary: "One market-proven memecoin. One community decision. One focused launch at a time... 10X Airdrops!",
    callout: "With 10X you can be EARLY to every launch!", cta: "Share this... create some buzz!", modalTitle: "Share Future Memes Perk",
    tokenId: 3258,
  },
  nfts: {
    id: "nfts", label: "NFTs", eyebrow: "10X Seasons",
    summary: "Mint, reveal, upgrade and rally your token tribe across a new NFT season every month... Level up your perks!",
    callout: "Every month, crypto's hottest tokens are minted into history.", cta: "Share this... sparking FOMO!", modalTitle: "Share Future NFTs Perk",
    tokenId: 3786, secondImageUrl: "/perks/s12_ansem.jpg",
  },
  ai: {
    id: "ai", label: "AI", eyebrow: "AI for Builders",
    summary: "Turning ecosystem revenue into practical AI compute, tools and longer runway for people who ship... Accelerate!",
    callout: "Intelligence is the ultimate engine for progress.", cta: "Share this... building anticipation!", modalTitle: "Share Future AI Perk",
    tokenId: 234,
  },
  attention: {
    id: "attention", label: "Attention", eyebrow: "#1 Feed for Crypto",
    summary: "One focused daily feed where posts receive a real chance to be seen and go viral... Join the content cabal!",
    callout: "D.R.E.A.M: Distribution rules everything around me... attention is KING.", cta: "Share this... more eyeballs!", modalTitle: "Share Future Attention Perk",
    tokenId: 4318,
  },
  access: {
    id: "access", label: "Access", eyebrow: "The 10X Network",
    summary: "Builders, traders, collectors, whales, degens, creators, KOLs, all sharing alpha across chains... 10X vs The Market!",
    callout: "10X your crypto crew!", cta: "Share this... drop some alpha!", modalTitle: "Share Future Access Perk",
    tokenId: 4334,
  },
};

export function getPerksShareImageUrl(content: PerksShareContent): string {
  return `https://warplets.10x.meme/${content.tokenId}.gif`;
}

export function getPerksShareContentFromPath(pathname: string): PerksShareContent | null {
  const match = pathname.match(/(?:^|\/)(?:search\/)?perks(?:\/(memes|nfts|ai|attention|access))?\/?$/i);
  const id = (match?.[1]?.toLowerCase() || (match ? "memes" : "")) as PerksShareId;
  return id ? PERKS_SHARE_CONTENT[id] ?? null : null;
}
