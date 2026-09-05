export type PerksShareId = "memes" | "rwas" | "nfts" | "ai" | "attention" | "alpha";

export type PerksShareContent = {
  id: PerksShareId; label: string; eyebrow: string; summary: string;
  callout: string; cta: string; modalTitle: string;
  tokenId: number; secondImageUrl?: string;
};

type PerksShareDefinition = Omit<PerksShareContent, "cta" | "modalTitle">;

function definePerksShareContent(content: PerksShareDefinition): PerksShareContent {
  const shareTitle = `Share 10X ${content.label}`;
  return { ...content, cta: shareTitle, modalTitle: shareTitle };
}

export const PERKS_SHARE_CONTENT: Record<PerksShareId, PerksShareContent> = {
  memes: definePerksShareContent({
    id: "memes", label: "Memes", eyebrow: "Attention Tokens",
    summary: "One market-proven memecoin. One community decision. One focused launch at a time... 10X Airdrops!",
    callout: "With 10X you can be EARLY to every launch!",
    tokenId: 3258,
  }),
  rwas: definePerksShareContent({
    id: "rwas", label: "RWAs", eyebrow: "Gen Z's Stonk Market",
    summary: "Major real-world assets, relaunched as meme stonks. Paper hands feed diamond hands... Compounding memetic aura!",
    callout: "Reset the market. Be early. Win.",
    tokenId: 9736,
  }),
  nfts: definePerksShareContent({
    id: "nfts", label: "NFTs", eyebrow: "10X Seasons",
    summary: "Mint, reveal, upgrade and rally your token tribe across a new NFT season every month... Level up your perks!",
    callout: "Every month, crypto's hottest tokens are minted into history.",
    tokenId: 3786, secondImageUrl: "/perks/s12_ansem.jpg",
  }),
  ai: definePerksShareContent({
    id: "ai", label: "AI", eyebrow: "AI for Builders",
    summary: "Turning ecosystem revenue into practical AI compute, tools and longer runway for people who ship... Accelerate!",
    callout: "Intelligence is the ultimate engine for progress.",
    tokenId: 234,
  }),
  attention: definePerksShareContent({
    id: "attention", label: "Attention", eyebrow: "#1 Feed for Crypto",
    summary: "One focused daily feed where posts receive a real chance to be seen and go viral... Join the content cabal!",
    callout: "D.R.E.A.M: Distribution rules everything around me... attention is KING.",
    tokenId: 4318,
  }),
  alpha: definePerksShareContent({
    id: "alpha", label: "Alpha", eyebrow: "The 10X Network",
    summary: "Where builders, creators, traders, bag workers, whales, and KOLs, all share alpha... it's 10X vs The Market!",
    callout: "10X your crypto crew!",
    tokenId: 4334,
  }),
};

export function getPerksShareImageUrl(content: PerksShareContent): string {
  return `https://warplets.10x.meme/${content.tokenId}.gif`;
}

export function getPerksShareContentFromPath(pathname: string): PerksShareContent | null {
  const match = pathname.match(/(?:^|\/)(?:warplets\/)?perks(?:\/(memes|rwas|nfts|ai|attention|alpha))?\/?$/i);
  const id = (match?.[1]?.toLowerCase() || (match ? "memes" : "")) as PerksShareId;
  return id ? PERKS_SHARE_CONTENT[id] ?? null : null;
}
