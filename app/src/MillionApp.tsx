import { useEffect, useMemo, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { Text } from "@neynar/ui/typography";
import {
  MiniAppHeader,
  MiniAppMenuPage,
  getHeaderTitle,
  useMiniAppChrome,
} from "./miniAppChrome.tsx";
import MiniAppShell from "./MiniAppShell";
import { hapticError, hapticPrimaryTap, hapticSuccess, hapticTap } from "./haptics";

type MillionAction = {
  id: number;
  slug: string;
  name: string;
  description: string;
  appAction: string | null;
  url: string | null;
  verificationMethod: string;
  entryValue: number;
  completed: boolean;
  verification: string | null;
  previouslyCompleted?: boolean;
};

type AttentionAction = {
  key: string;
  label: string;
  points: number;
  kind: "external" | "x" | "farcaster" | "profile" | "add-app" | "modal";
  url?: string;
  fid?: number;
  channelKey?: string;
  auctionDay?: number;
  collection?: string;
  completed?: boolean;
  payload?: unknown;
};

type DailyCollection = {
  day: number;
  sale: string;
  budget: string;
  collection: string;
  opensea: string;
  twitter: string;
  slug: string;
  extension: string;
};

type AttentionSection = {
  id: "once" | "daily" | "tenx";
  title: string;
  dailyCollection?: DailyCollection;
  actions: AttentionAction[];
};

type EntryAvatar = {
  fid: number;
  username: string;
  pfpUrl: string;
};

type TopReferrer = EntryAvatar & {
  referrals: number;
};

type GrantTopReferrer = {
  id: number;
  fid: number | null;
  username: string;
  pfpUrl: string | null;
  referrals: number;
  hasProfile: boolean;
};

type MillionStatus = {
  giveawayMonth: string;
  hasEntry: boolean;
  email: string | null;
  userEntries: number;
  totalEntries: number;
  daysLeft: number;
  referralCount: number;
  referralBonusEntries: number;
  entryAvatars: EntryAvatar[];
  topReferrers: TopReferrer[];
  actionSessionToken: string | null;
  actions: MillionAction[];
  attentionSections?: AttentionSection[];
};

type WarpletStatus = {
  actionSessionToken?: string | null;
  rarityValue?: number | null;
  matchedTokenId?: number | null;
};

type WatchersResponse = {
  watchers?: unknown;
};

type FollowersResponse = {
  followers?: unknown;
};

type RecentBuysResponse = {
  buyers?: unknown;
};

type GrantApplication = {
  id: number;
  status: string;
  fullName: string;
  email: string;
  buildAnswer: string;
  xPostUrl: string | null;
  emailVerified: boolean;
  referrals?: number;
};

type AppliedSource = "none" | "fid" | "localStorage" | "restore" | "submit";

type StoredGrantApplication = Omit<GrantApplication, "id"> & {
  id?: number;
  restoredOn?: string;
  submittedOn?: string;
};

type GrantStatus = {
  grantMonth: string;
  application: GrantApplication | null;
  applicants: EntryAvatar[];
  actionSessionToken: string | null;
  recaptchaSiteKey: string;
  topReferrers: GrantTopReferrer[];
  config: {
    xQuoteUrl: string;
  };
};

type PromoCard = {
  id: "rare" | "builders" | "airdrop";
  title: string;
  subtitle: string;
  imageUrl: string;
  urgency: string;
  ctas: Array<{
    label: string;
    kind: "external" | "enter" | "x" | "farcaster";
    href?: string;
  }>;
};

const grantSchedule = [
  { day: "1", sale: "$1,000,000", grants: "$500,000 x 1" },
  { day: "2", sale: "$1,000,000", grants: "$50,000 x 10" },
  { day: "3", sale: "$900,000", grants: "$10,000 x 45" },
  { day: "4", sale: "$800,000", grants: "$10,000 x 40" },
  { day: "5", sale: "$700,000", grants: "$10,000 x 35" },
  { day: "6", sale: "$600,000", grants: "$10,000 x 30" },
  { day: "7", sale: "$500,000", grants: "$10,000 x 25" },
  { day: "8", sale: "$400,000", grants: "$10,000 x 20" },
  { day: "9", sale: "$300,000", grants: "$10,000 x 15" },
  { day: "10", sale: "$200,000", grants: "$10,000 x 10" },
  { day: "11", sale: "$100,000", grants: "$50,000 x 1" },
  { day: "12", sale: "$90,000", grants: "$1,000 x 45" },
  { day: "13", sale: "$80,000", grants: "$1,000 x 40" },
  { day: "14", sale: "$70,000", grants: "$1,000 x 35" },
  { day: "15", sale: "$60,000", grants: "$1,000 x 30" },
  { day: "16", sale: "$50,000", grants: "$1,000 x 25" },
  { day: "17", sale: "$40,000", grants: "$1,000 x 20" },
  { day: "18", sale: "$30,000", grants: "$1,000 x 15" },
  { day: "19", sale: "$20,000", grants: "$1,000 x 10" },
  { day: "20", sale: "$10,000", grants: "$5,000 x 1" },
  { day: "21", sale: "$10,000 - $9,000", grants: "$100 x 50-45" },
  { day: "22", sale: "$9,000 - $8,000", grants: "$100 x 45-40" },
  { day: "23", sale: "$8,000 - $7,000", grants: "$100 x 40-35" },
  { day: "24", sale: "$7,000 - $6,000", grants: "$100 x 35-30" },
  { day: "25", sale: "$6,000 - $5,000", grants: "$100 x 30-25" },
  { day: "26", sale: "$5,000 - $4,000", grants: "$100 x 25-20" },
  { day: "27", sale: "$4,000 - $3,000", grants: "$100 x 20-15" },
  { day: "28", sale: "$3,000 - $2,000", grants: "$100 x 15-10" },
  { day: "29", sale: "$2,000 - $1,000", grants: "$100 x 10-5" },
  { day: "30", sale: "$1,000 - $100", grants: "$10 x 50-5" },
];

const airdropSchedule = [
  { day: "1", sale: "$1M", budget: "$100,000", collection: "The Warplets", opensea: "https://opensea.io/collection/the-warplets-farcaster", slug: "the-warplets-farcaster", extension: "avif", twitter: "WarpletsAI" },
  { day: "2", sale: "$1M", budget: "$100,000", collection: "VeeFriends", opensea: "https://opensea.io/collection/veefriends", slug: "veefriends", extension: "avif", twitter: "veefriends" },
  { day: "3", sale: "$900K", budget: "$90,000", collection: "Mutant Ape Yacht Club", opensea: "https://opensea.io/collection/mutant-ape-yacht-club", slug: "mutant-ape-yacht-club", extension: "avif", twitter: "BoredApeYC" },
  { day: "4", sale: "$800K", budget: "$80,000", collection: "Azuki", opensea: "https://opensea.io/collection/azuki", slug: "azuki", extension: "avif", twitter: "Azuki" },
  { day: "5", sale: "$700K", budget: "$70,000", collection: "MAX PAIN AND FRENS", opensea: "https://opensea.io/collection/max-pain-and-frens-by-xcopy", slug: "max-pain-and-frens-by-xcopy", extension: "webp", twitter: "XCOPYART" },
  { day: "6", sale: "$600K", budget: "$60,000", collection: "Doodles", opensea: "https://opensea.io/collection/doodles-official", slug: "doodles-official", extension: "avif", twitter: "doodles" },
  { day: "7", sale: "$500K", budget: "$50,000", collection: "Good Vibes Club", opensea: "https://opensea.io/collection/good-vibes-club", slug: "good-vibes-club", extension: "avif", twitter: "goodvibesclub" },
  { day: "8", sale: "$400K", budget: "$40,000", collection: "Lil Pudgys", opensea: "https://opensea.io/collection/lilpudgys", slug: "lilpudgys", extension: "avif", twitter: "pudgypenguins" },
  { day: "9", sale: "$300K", budget: "$30,000", collection: "Bankr Club", opensea: "https://opensea.io/collection/bankr-club", slug: "bankr-club", extension: "jpg", twitter: "bankrbot" },
  { day: "10", sale: "$200K", budget: "$20,000", collection: "CLONE X", opensea: "https://opensea.io/collection/clonex", slug: "clonex", extension: "avif", twitter: "RTFKT" },
  { day: "11", sale: "$100K", budget: "$10,000", collection: "mfers", opensea: "https://opensea.io/collection/mfers", slug: "mfers", extension: "avif", twitter: "unofficialmfers" },
  { day: "12", sale: "$90K", budget: "$9,000", collection: "Redacted Remilio Babies", opensea: "https://opensea.io/collection/remilio-babies", slug: "remilio-babies", extension: "avif", twitter: "RemilioBaby" },
  { day: "13", sale: "$80K", budget: "$8,000", collection: "Checks - VV Originals", opensea: "https://opensea.io/collection/vv-checks-originals", slug: "vv-checks-originals", extension: "png", twitter: "jackbutcher" },
  { day: "14", sale: "$70K", budget: "$7,000", collection: "Cool Cats", opensea: "https://opensea.io/collection/cool-cats-nft", slug: "cool-cats-nft", extension: "avif", twitter: "coolcats" },
  { day: "15", sale: "$60K", budget: "$6,000", collection: "Mocaverse", opensea: "https://opensea.io/collection/mocaverse", slug: "mocaverse", extension: "avif", twitter: "Moca_Network" },
  { day: "16", sale: "$50K", budget: "$5,000", collection: "Memeland Potatoz", opensea: "https://opensea.io/collection/memelandpotatoz", slug: "memelandpotatoz", extension: "webp", twitter: "memeland" },
  { day: "17", sale: "$40K", budget: "$4,000", collection: "World of Women", opensea: "https://opensea.io/collection/world-of-women-nft", slug: "world-of-women-nft", extension: "avif", twitter: "worldofwomenxyz" },
  { day: "18", sale: "$30K", budget: "$3,000", collection: "Yapybaras - Kaito Genesis", opensea: "https://opensea.io/collection/kaito-genesis", slug: "kaito-genesis", extension: "avif", twitter: "KaitoAI" },
  { day: "19", sale: "$20K", budget: "$2,000", collection: "Otherdeed for Otherside", opensea: "https://opensea.io/collection/otherdeed", slug: "otherdeed", extension: "avif", twitter: "othersidemeta" },
  { day: "20", sale: "$10K", budget: "$1,000", collection: "BEANZ Official", opensea: "https://opensea.io/collection/beanzofficial", slug: "beanzofficial", extension: "avif", twitter: "Azuki" },
  { day: "21", sale: "$10K - $9K", budget: "$1,000 - $900", collection: "Degens", opensea: "https://opensea.io/collection/degens-base", slug: "degens-base", extension: "png", twitter: "degentokenbase" },
  { day: "22", sale: "$9K - $8K", budget: "$900 - $800", collection: "based punks", opensea: "https://opensea.io/collection/basedpunks", slug: "basedpunks", extension: "avif", twitter: "based" },
  { day: "23", sale: "$8K- $7K", budget: "$800 - $700", collection: "OK COMPUTERS", opensea: "https://opensea.io/collection/okcomputers", slug: "okcomputers", extension: "png", twitter: "dailofrog" },
  { day: "24", sale: "$7K - $6K", budget: "$700 - $600", collection: "Farcaster Pro OG", opensea: "https://opensea.io/collection/farcaster-pro-og", slug: "farcaster-pro-og", extension: "png", twitter: "farcaster_xyz" },
  { day: "25", sale: "$6K - $5K", budget: "$600 - $500", collection: "VRNouns", opensea: "https://opensea.io/collection/vrnouns", slug: "vrnouns", extension: "png", twitter: "vrnouns" },
  { day: "26", sale: "$5K - $4K", budget: "$500 - $400", collection: "AXIOM Tool Pass", opensea: "https://opensea.io/collection/axiom-tool-pass", slug: "axiom-tool-pass", extension: "png", twitter: "AxiomBot" },
  { day: "27", sale: "$4K - $3K", budget: "$400 - $300", collection: "BasePaint", opensea: "https://opensea.io/collection/basepaint", slug: "basepaint", extension: "avif", twitter: "basepaint_xyz" },
  { day: "28", sale: "$3K - $2K", budget: "$300 - $200", collection: "Base Colors", opensea: "https://opensea.io/collection/base-colors-nft", slug: "base-colors-nft", extension: "png", twitter: "0fjake" },
  { day: "29", sale: "$2K - $1K", budget: "$200 - $100", collection: "BETRMINT Rounds Art", opensea: "https://opensea.io/collection/0x145b4ea581924882e854f34630a2544b4c2fe4bd", slug: "betrmint", extension: "avif", twitter: "betrmint" },
  { day: "30", sale: "$1K - $100", budget: "$100 - $10", collection: "The Warplets", opensea: "https://opensea.io/collection/the-warplets-farcaster", slug: "the-warplets-farcaster", extension: "avif", twitter: "WarpletsAI" },
];

const FARCASTER_JOIN_URL = "https://farcaster.xyz/~/code/RUZLHN";
const FARCASTER_AIRDROPS_JOIN_URL = "https://farcaster.xyz/~/code/1Y7636";
const DEFAULT_BUILDERS_IMAGE_URL = "https://warplets.10x.meme/1409.avif";
const ONE_M_WARPLET_OPENSEA_URL = "https://opensea.io/collection/1m-warplet-1-the-one/overview";
const TEN_X_WARPLETS_OPENSEA_URL = "https://opensea.io/collection/10xwarplets/overview";
const DROP_APP_URL = "https://drop.10x.meme/";
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type PriceDrop = {
  at: number;
  price: number;
};

const LOCAL_TEST_GRANT_APPLICATION: StoredGrantApplication = {
  id: 123,
  fullName: "Chris Jacob",
  email: "chris@10x.meme",
  buildAnswer: "10X is an attention machine. Builders, capital and signal - aligned. Innovating with NFTs and Memecoins.",
  xPostUrl: "https://x.com/10XChrisX/status/2053490361264382330",
  status: "accepted",
  emailVerified: true,
  referrals: 7,
};

const LOCAL_TEST_GRANT_REFERRERS: GrantTopReferrer[] = [
  { id: 123, fid: 1129138, username: "10XChris", pfpUrl: "https://warplets.10x.meme/1409.avif", referrals: 9, hasProfile: true },
  { id: 124, fid: 1313340, username: "10XMeme", pfpUrl: "https://warplets.10x.meme/7840.avif", referrals: 8, hasProfile: true },
  { id: 125, fid: 3, username: "dwr", pfpUrl: "https://warplets.10x.meme/760.avif", referrals: 7, hasProfile: true },
  { id: 126, fid: 5650, username: "v", pfpUrl: "https://warplets.10x.meme/1000.avif", referrals: 6, hasProfile: true },
  { id: 127, fid: null, username: "Builder One", pfpUrl: null, referrals: 5, hasProfile: false },
  { id: 128, fid: null, username: "Grant Hacker", pfpUrl: null, referrals: 4, hasProfile: false },
  { id: 129, fid: 99, username: "ted", pfpUrl: "https://warplets.10x.meme/2024.avif", referrals: 3, hasProfile: true },
  { id: 130, fid: null, username: "NFT Builder", pfpUrl: null, referrals: 2, hasProfile: false },
  { id: 131, fid: 239, username: "linda", pfpUrl: "https://warplets.10x.meme/3333.avif", referrals: 2, hasProfile: true },
  { id: 132, fid: null, username: "Signal Seeker", pfpUrl: null, referrals: 1, hasProfile: false },
];

function isMillionLocalHost(): boolean {
  const hostname = window.location.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes("local");
}

function isMillionHost(): boolean {
  return window.location.hostname.includes("million");
}

function getMillionRootPath(): string {
  return isMillionHost() ? "/" : "/million";
}

function getRouteMode(): "landing" | "enter" {
  const cleanPath = window.location.pathname.replace(/\/+$/, "") || "/";
  if (cleanPath === "/entry") {
    window.history.replaceState(window.history.state, "", "/enter");
    return "enter";
  }
  if (cleanPath === "/million/entry") {
    window.history.replaceState(window.history.state, "", "/million/enter");
    return "enter";
  }
  return cleanPath === "/enter" || cleanPath === "/million/enter" ? "enter" : "landing";
}

function buildMillionUrl(fid: number | null): string {
  const base = "https://million.10x.meme/";
  return fid ? `${base}?fid=${fid}` : base;
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US")}`;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getGrantMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getStoredGrantApplicationKey(grantMonth: string): string {
  return `millionGrantApplication:${grantMonth}`;
}

function normalizeStoredGrantApplication(raw: unknown): StoredGrantApplication | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<StoredGrantApplication>;
  if (
    typeof value.fullName !== "string" ||
    typeof value.email !== "string" ||
    typeof value.buildAnswer !== "string" ||
    typeof value.status !== "string" ||
    typeof value.emailVerified !== "boolean"
  ) {
    return null;
  }
  return {
    id: typeof value.id === "number" ? value.id : undefined,
    fullName: value.fullName,
    email: value.email,
    buildAnswer: value.buildAnswer,
    xPostUrl: typeof value.xPostUrl === "string" ? value.xPostUrl : null,
    status: value.status,
    emailVerified: value.emailVerified,
    referrals: typeof value.referrals === "number" ? value.referrals : undefined,
    restoredOn: typeof value.restoredOn === "string" ? value.restoredOn : undefined,
    submittedOn: typeof value.submittedOn === "string" ? value.submittedOn : undefined,
  };
}

function getMonthlyAuctionStart(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
}

function getCurrentAuctionDay(now: Date): number {
  const cycleStart = getMonthlyAuctionStart(now);
  const rawDay = Math.floor((now.getTime() - cycleStart) / DAY_MS) + 1;
  return Math.min(grantSchedule.length, Math.max(1, rawDay));
}

function buildPriceDropSchedule(cycleStart: number): PriceDrop[] {
  const drops: PriceDrop[] = [];

  for (let day = 3; day <= 11; day += 1) {
    drops.push({
      at: cycleStart + (day - 1) * DAY_MS,
      price: 1_000_000 - (day - 2) * 100_000,
    });
  }

  for (let day = 12; day <= 20; day += 1) {
    drops.push({
      at: cycleStart + (day - 1) * DAY_MS,
      price: (21 - day) * 10_000,
    });
  }

  for (let day = 22; day <= 30; day += 1) {
    drops.push({
      at: cycleStart + (day - 1) * DAY_MS,
      price: (31 - day) * 1_000,
    });
  }

  for (let day = 21; day <= 30; day += 1) {
    const dayStart = cycleStart + (day - 1) * DAY_MS;
    const dayStartPrice = (31 - day) * 1_000;
    const maxIntervals = day === 30 ? 90 : 95;
    for (let interval = 1; interval <= maxIntervals; interval += 1) {
      drops.push({
        at: dayStart + interval * 15 * MINUTE_MS,
        price: Math.max(100, dayStartPrice - interval * 10),
      });
    }
  }

  return drops.sort((a, b) => a.at - b.at);
}

function getNextPriceDrop(now: Date): PriceDrop {
  const nowMs = now.getTime();
  const cycleStart = getMonthlyAuctionStart(now);
  const currentCycleDrop = buildPriceDropSchedule(cycleStart).find((drop) => drop.at > nowMs);
  if (currentCycleDrop) return currentCycleDrop;

  const nextCycleStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  return buildPriceDropSchedule(nextCycleStart)[0];
}

function buildRareUrgency(now: Date): string {
  const nextDrop = getNextPriceDrop(now);
  const totalMinutes = Math.max(0, Math.ceil((nextDrop.at - now.getTime()) / MINUTE_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourLabel = hours === 1 ? "Hour" : "Hours";
  const minuteLabel = minutes === 1 ? "Minute" : "Minutes";
  const duration = hours > 0
    ? `${hours} ${hourLabel} ${minutes} ${minuteLabel}`
    : `${minutes} ${minuteLabel}`;

  return `⚠️ Price drops to ${formatUsd(nextDrop.price)} in ${duration}.`;
}

function buildPromoCards(rareUrgency: string): PromoCard[] {
  return [
    {
      id: "rare",
      title: "Attention for Projects\nFunding for Builders\nAirdrops for NFTs\n$1M Warplet",
      subtitle: "30 Day Auction: $1,000,000 → $100",
      imageUrl: "https://millions.10x.meme/WPLTX1_1000x1000.jpg",
      urgency: rareUrgency,
      ctas: [
        {
          label: "About $1M Warplet + 1 Year of Attention",
          kind: "external",
          href: "https://link.10x.meme/1mwarplet",
        },
      ],
    },
    {
      id: "builders",
      title: "10X Builders",
      subtitle: "50% of Sale = Free Grants: $500,000 → $10",
      imageUrl: DEFAULT_BUILDERS_IMAGE_URL,
      urgency: "🤝 Zero Equity. No Strings Attached. Free Money.",
      ctas: [
        {
          label: "Apply Now (Fund Your BIG Idea!)",
          kind: "enter",
        },
      ],
    },
    {
      id: "airdrop",
      title: "10X Warplets",
      subtitle: "10% of Sale = Buys NFTs: $100,000 → $10",
      imageUrl: "https://warplets.10x.meme/760.avif",
      urgency: "🟢 Take the Green Pill. Don't miss out...",
      ctas: [
        {
          label: "Buy 10X Warplets on OpenSea",
          kind: "external",
          href: "https://opensea.io/collection/10xwarplets/overview",
        },
      ],
    },
  ];
}

function ActionCheckIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5L10 17L19 8"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AvatarStack({ avatars, label }: { avatars: EntryAvatar[]; label: string }) {
  return (
    <div className="mt-4 flex items-center justify-center gap-2">
      <Text className="text-sm font-semibold whitespace-nowrap" style={{ color: "#b7ffb7" }}>{label}</Text>
      <div className="flex flex-nowrap overflow-x-auto pb-1">
        {avatars.slice(0, 10).map((avatar) => (
          <button
            key={`${avatar.fid}-${avatar.pfpUrl}`}
            type="button"
            className="h-8 w-8 min-h-8 min-w-8 shrink-0 overflow-hidden rounded-full bg-black -ml-2 first:ml-0"
            style={{ border: "2px solid #00FF00" }}
            onClick={() => sdk.actions.viewProfile({ fid: avatar.fid }).catch(() => {})}
            title={avatar.username}
          >
            <img src={avatar.pfpUrl} alt={avatar.username} className="h-full w-full object-cover" style={{ color: "#0F0" }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function GrantScheduleTable({ currentAuctionDay }: { currentAuctionDay: number }) {
  return (
    <div className="mt-6 rounded-2xl overflow-hidden border border-[#00FF00]/35 bg-[#041204]/85 p-0">
      <table className="w-full table-fixed border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            <th className="w-[22%] border-b border-r border-[#00FF00]/25 px-2 py-2 text-sm text-center" style={{ color: "#00FF00" }}>Day</th>
            <th className="w-[38%] border-b border-r border-[#00FF00]/25 px-2 py-2 text-sm text-center" style={{ color: "#00FF00" }}>Auction Price</th>
            <th className="w-[40%] border-b border-[#00FF00]/25 px-2 py-2 text-sm text-center" style={{ color: "#00FF00" }}>Grants (if sold)</th>
          </tr>
        </thead>
        <tbody>
          {grantSchedule.map((row) => {
            const rowDay = Number(row.day);
            const isPassed = rowDay < currentAuctionDay;
            const isToday = rowDay === currentAuctionDay;
            const passedClass = isPassed ? " line-through decoration-[#b7ffb7]/80 decoration-2" : "";
            const rowColor = isToday ? "rgb(0, 80, 0)" : "#b7ffb7";
            const rowBackground = isToday ? "#0F0" : rowDay % 2 === 0 ? "rgba(0, 255, 0, 0.05)" : "transparent";
            const weightClass = isToday ? "font-black" : "font-semibold";
            return (
              <tr key={row.day} style={{ backgroundColor: rowBackground }}>
                <td className={`border-b border-r border-[#00FF00]/20 px-2 py-2 text-sm ${weightClass} text-center align-middle${passedClass}`} style={{ color: rowColor }}>{isToday ? "TODAY" : row.day}</td>
                <td className={`border-b border-r border-[#00FF00]/20 px-2 py-2 text-sm ${isToday ? "font-black" : ""} text-center${passedClass}`} style={{ color: rowColor }}>{row.sale}</td>
                <td className={`border-b border-[#00FF00]/20 px-2 py-2 text-sm ${weightClass} text-center${passedClass}`} style={{ color: rowColor }}>{row.grants}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type AirdropScheduleRow = typeof airdropSchedule[number];

function AirdropImageSlideshow({ row }: { row: AirdropScheduleRow }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadedSlides, setLoadedSlides] = useState<Record<number, boolean>>({ 0: true });
  const imageSources = useMemo(
    () => [
      `/nfts-logos/${row.slug}.png`,
      ...[1, 2, 3, 4, 5].map((index) => `/nfts-examples/${row.slug}-${index}.${row.extension}`),
    ],
    [row.slug, row.extension]
  );
  const nextIndex = (activeIndex + 1) % imageSources.length;

  useEffect(() => {
    setActiveIndex(0);
    setLoadedSlides({ 0: true });
  }, [row.slug, row.extension]);

  useEffect(() => {
    if (loadedSlides[nextIndex]) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        setLoadedSlides((prev) => ({ ...prev, [nextIndex]: true }));
      }
    };
    image.src = imageSources[nextIndex];
    return () => {
      cancelled = true;
    };
  }, [imageSources, loadedSlides, nextIndex]);

  useEffect(() => {
    if (!loadedSlides[nextIndex]) return;
    const timeout = window.setTimeout(() => setActiveIndex(nextIndex), 3000);
    return () => window.clearTimeout(timeout);
  }, [loadedSlides, nextIndex]);

  return (
    <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-black/35">
      {imageSources.map((src, index) => loadedSlides[index] && (
        <img
          key={src}
          src={src}
          alt={index === 0 ? `${row.collection} logo` : `${row.collection} example ${index}`}
          loading={index === 0 ? "eager" : "lazy"}
          className={`absolute h-full w-full object-contain transition-opacity duration-500 ${index === activeIndex ? "opacity-100" : "opacity-0"}`}
          style={{ color: "#0F0" }}
        />
      ))}
    </div>
  );
}

function AttentionDailySlideshow({ collection }: { collection: DailyCollection }) {
  return (
    <div className="w-full rounded-[20px] border border-[#00FF00]/45 bg-[#00FF00]/20 p-[2px]">
      <div className="overflow-hidden rounded-[18px]">
        <AirdropImageSlideshow row={{
          day: String(collection.day),
          sale: collection.sale,
          budget: collection.budget,
          collection: collection.collection,
          opensea: collection.opensea,
          slug: collection.slug,
          extension: collection.extension,
          twitter: collection.twitter,
        }} />
      </div>
    </div>
  );
}

function AirdropCard({ row, currentAuctionDay, inMiniAppContext }: { row: AirdropScheduleRow; currentAuctionDay: number; inMiniAppContext: boolean }) {
  const rowDay = Number(row.day);
  const isPassed = rowDay < currentAuctionDay;
  const isToday = rowDay === currentAuctionDay;
  const passedClass = isPassed ? " line-through decoration-[#b7ffb7]/80 decoration-2" : "";
  const rowColor = isToday ? "#0F0" : "#b7ffb7";
  const shareText = `${row.budget} NFT sweep and airdrop for ${row.collection} by @${row.twitter}...\n\nBut only if the $1M Warplet by @10XMemeX sells for ${row.sale} on Day ${row.day}.\n\nWatching this 30 day dutch auction \u{1F440}\n\nhttps://opensea.io/collection/1m-warplet-1-the-one/overview`;
  const shareUrl = `https://x.com/intent/post?${new URLSearchParams({ text: shareText }).toString()}`;

  const openShare = async () => {
    void hapticPrimaryTap();
    const text = `${row.budget} NFT sweep and airdrop for ${row.collection} by @${row.twitter}...\n\nBut only if the $1M Warplet by @10XMemeX sells for ${row.sale} on Day ${row.day}.\n\nWatching this 30 day dutch auction 👀\n\nhttps://opensea.io/collection/1m-warplet-1-the-one/overview`;
    try {
      await sdk.actions.openUrl(shareUrl);
    } catch {
      window.location.assign(shareUrl);
    }
  };

  return (
    <a
      href={shareUrl}
      target="_blank"
      rel="noreferrer"
      className="menu-card cursor-pointer"
      title={`Share ${row.collection} airdrop on X`}
      onClick={(event) => {
        if (!inMiniAppContext) return;
        event.preventDefault();
        openShare().catch(() => {});
      }}
    >
      <div className={isToday ? "flex min-h-[50px] items-center justify-center bg-[#0F0] px-1.5 py-2 text-center" : "flex min-h-[50px] items-center justify-center px-1.5 py-2 text-center"}>
        <Text className={`text-sm font-black leading-snug${passedClass}`} style={{ color: isToday ? "rgb(0, 80, 0)" : rowColor }}>
          {isToday ? (
            <>
              <span className="text-base">TODAY (if sold)</span>
              <br />
              {row.budget}
            </>
          ) : (
            <>
              <span className="text-base" style={{ color: "#0F0" }}>Day {row.day}</span>
              <br />
              {row.budget}
            </>
          )}
        </Text>
      </div>
      <AirdropImageSlideshow row={row} />
      <div className="menu-card__cta min-h-[42px] whitespace-nowrap px-2 text-[10px] leading-tight">
        {row.collection}
      </div>
    </a>
  );
}

function AirdropScheduleGrid({ currentAuctionDay, inMiniAppContext }: { currentAuctionDay: number; inMiniAppContext: boolean }) {
  return (
    <div className="grid w-full grid-cols-2 gap-3 pb-2">
      {airdropSchedule.map((row) => (
        <AirdropCard
          key={`${row.day}-${row.slug}`}
          row={row}
          currentAuctionDay={currentAuctionDay}
          inMiniAppContext={inMiniAppContext}
        />
      ))}
    </div>
  );
}

function PromoSection({
  card,
  referralMillionUrl,
  entryAvatars,
  onEnter,
  watchers,
  applicants,
  followers,
  buyers,
  onRareCtaClick,
  currentAuctionDay,
  inMiniAppContext,
}: {
  card: PromoCard;
  referralMillionUrl: string;
  entryAvatars: EntryAvatar[];
  onEnter: () => void;
  watchers?: EntryAvatar[];
  applicants?: EntryAvatar[];
  followers?: EntryAvatar[];
  buyers?: EntryAvatar[];
  onRareCtaClick?: () => Promise<void>;
  currentAuctionDay: number;
  inMiniAppContext: boolean;
}) {
  const getCtaHref = (cta: PromoCard["ctas"][number]): string | null => {
    if (cta.kind === "external" && cta.href) return cta.href;
    if (cta.kind === "x") {
      const text = `\u{1F7E2} $1M Warplet\n\nDon't miss out.\n\n1\uFE0F\u20E3 Join Farcaster: ${FARCASTER_JOIN_URL}\n2\uFE0F\u20E3 Visit mini-app: ${referralMillionUrl}`;
      return `https://x.com/intent/post?${new URLSearchParams({
        text,
        url: "",
        hashtags: "1MWarplet",
        via: "10XMemeX",
      }).toString()}`;
    }
    return null;
  };

  const runCta = async (cta: PromoCard["ctas"][number]) => {
    await hapticPrimaryTap();
    if (cta.kind === "external" && cta.href) {
      if (card.id === "rare" && onRareCtaClick) {
        await onRareCtaClick().catch(() => {});
      }
      await sdk.actions.openUrl(cta.href);
      return;
    }
    if (cta.kind === "enter") {
      onEnter();
      return;
    }
    if (cta.kind === "x") {
      const text = `🟢 $1M Warplet\n\nDon't miss out.\n\n1️⃣ Join Farcaster: ${FARCASTER_JOIN_URL}\n2️⃣ Visit mini-app: ${referralMillionUrl}`;
      const intentUrl = `https://x.com/intent/post?${new URLSearchParams({
        text,
        url: "",
        hashtags: "1MWarplet",
        via: "10XMemeX",
      }).toString()}`;
      await sdk.actions.openUrl(getCtaHref(cta) ?? intentUrl);
      return;
    }
    if (cta.kind === "farcaster") {
      await sdk.actions.composeCast({
        text: `🟢 $1M Warplet\n\nDon't miss out.\n\nVisit mini-app: ${referralMillionUrl}`,
        embeds: [referralMillionUrl],
        channelKey: "10xmeme",
      } as Parameters<typeof sdk.actions.composeCast>[0] & { channelKey: string });
    }
  };

  const renderTitle = () => {
    if (card.id !== "rare") {
      return (
        <Text className="text-[clamp(1.6rem,5vw,1.6rem)] font-bold leading-tight text-center whitespace-pre-line" style={{ color: "#00FF00" }}>
          {card.title}
        </Text>
      );
    }

    const [attention, funding, airdrops, warplet] = card.title.split("\n");
    return (
      <div className="text-center text-[#0F0]" style={{ color: "#0F0" }}>
        <Text className="text-[2.2rem] font-bold leading-[1.45] text-[#0F0]" style={{ color: "#0F0" }}>{attention}</Text>
        <Text className="text-[2rem] font-bold leading-[1.45] text-[#0F0]" style={{ color: "#0F0" }}>{funding}</Text>
        <Text className="text-[1.85rem] font-bold leading-[1.45] text-[#0F0]" style={{ color: "#0F0" }}>{airdrops}</Text>
        <Text className="mt-3 text-[clamp(1.6rem,5vw,1.6rem)] font-bold leading-tight text-[#0F0]" style={{ color: "#0F0" }}>{warplet}</Text>
      </div>
    );
  };

  return (
    <section className="space-y-3 pb-4">
      {renderTitle()}
      <Text className="text-lg font-semibold leading-snug text-center" style={{ color: "#00FF00" }}>{card.subtitle}</Text>
      <div className="w-full rounded-[20px] p-[2px] bg-[#00FF00]/20 border border-[#00FF00]/45">
        <img
          src={card.imageUrl}
          alt={card.id === "rare" ? "$1M Warplet" : card.title}
          className="aspect-square w-full rounded-[18px] object-cover"
          style={{ color: "#0F0" }}
        />
      </div>
      <div className="space-y-3">
        {card.ctas.map((cta) => {
          const href = getCtaHref(cta);
          const className = "block w-full rounded-[20px] border border-[#009900] bg-[#00FF00] px-5 py-3 text-base font-bold shadow-[3px_6px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] cursor-pointer";
          if (href) {
            return (
              <a
                key={`${card.id}-${cta.label}`}
                href={href}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  if (!inMiniAppContext) return;
                  event.preventDefault();
                  runCta(cta).catch(() => {});
                }}
                className={className}
                style={{ color: "rgb(0, 80, 0)" }}
              >
                {cta.label}
              </a>
            );
          }
          return (
            <button
              key={`${card.id}-${cta.label}`}
              type="button"
              onClick={() => runCta(cta).catch(() => {})}
              className={className}
              style={{ color: "rgb(0, 80, 0)" }}
            >
              {cta.label}
            </button>
          );
        })}
      </div>
      <Text className="text-sm font-semibold leading-relaxed text-center whitespace-pre-line" style={{ color: "#b7ffb7" }}>{card.urgency}</Text>
      {card.id === "builders" && applicants && applicants.length > 0 && (
        <AvatarStack avatars={applicants} label="Applied:" />
      )}
      {card.id === "builders" && (
        <>
          <GrantScheduleTable currentAuctionDay={currentAuctionDay} />
          <div className="space-y-2 pt-3">
            <Text className="text-[clamp(1.6rem,5vw,1.6rem)] font-bold leading-tight text-center" style={{ color: "#00FF00" }}>
              10X Airdrop
            </Text>
            <Text className="pb-2 text-lg font-semibold leading-snug text-center" style={{ color: "#00FF00" }}>
              10% of Sale = Airdrop NFTs: $100,000 → $10
            </Text>
            <AirdropScheduleGrid currentAuctionDay={currentAuctionDay} inMiniAppContext={inMiniAppContext} />
            <a
              href={FARCASTER_AIRDROPS_JOIN_URL}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (!inMiniAppContext) return;
                event.preventDefault();
                hapticPrimaryTap().catch(() => {});
                sdk.actions.openUrl(FARCASTER_AIRDROPS_JOIN_URL).catch(() => {
                  window.location.assign(FARCASTER_AIRDROPS_JOIN_URL);
                });
              }}
              className="mb-4 mt-4 block w-full rounded-[20px] border border-[#009900] bg-[#00FF00] px-5 py-3 text-base font-bold shadow-[3px_6px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] cursor-pointer"
              style={{ color: "rgb(0, 80, 0)" }}
            >
              Follow @10XMeme.eth for Airdrops
            </a>
            <Text className="mt-1 text-sm font-semibold leading-relaxed text-center" style={{ color: "#b7ffb7" }}>
              💜 Join Farcaster & follow us (referral is optional)
            </Text>
            {followers && followers.length > 0 && (
              <AvatarStack avatars={followers} label="Followers:" />
            )}
          </div>
        </>
      )}
      {card.id === "rare" && watchers && watchers.length > 0 && (
        <AvatarStack avatars={watchers} label="Watchers:" />
      )}
      {card.id === "airdrop" && buyers && buyers.length > 0 && (
        <AvatarStack avatars={buyers} label="Buyers:" />
      )}
    </section>
  );
}

function StatBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-[#0F0]/30 bg-black/60 px-3 py-4 text-center">
      <Text className="text-2xl font-black text-[#0F0]">{value}</Text>
      <Text className="mt-1 text-[11px] font-bold uppercase tracking-wide text-[#0F0]/70">{label}</Text>
    </div>
  );
}

export default function MillionApp() {
  const [routeMode, setRouteMode] = useState<"landing" | "enter">(() => getRouteMode());
  const [inMiniAppContext, setInMiniAppContext] = useState(false);
  const [showOpenInFarcaster, setShowOpenInFarcaster] = useState(false);
  const [showAddAppPrompt, setShowAddAppPrompt] = useState(false);
  const [notificationsOnlyPrompt, setNotificationsOnlyPrompt] = useState(false);
  const [fid, setFid] = useState<number | null>(null);
  const [username, setUsername] = useState<string>("");
  const [actionSessionToken, setActionSessionToken] = useState("");
  const [status, setStatus] = useState<MillionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [pendingVerify, setPendingVerify] = useState<Record<string, boolean>>({});
  const [rejectedVerify, setRejectedVerify] = useState<Record<string, boolean>>({});
  const [watchers, setWatchers] = useState<EntryAvatar[]>([]);
  const [followers, setFollowers] = useState<EntryAvatar[]>([]);
  const [buyers, setBuyers] = useState<EntryAvatar[]>([]);
  const [grantStatus, setGrantStatus] = useState<GrantStatus | null>(null);
  const [grantFullName, setGrantFullName] = useState("");
  const [grantEmail, setGrantEmail] = useState("");
  const [grantAnswer, setGrantAnswer] = useState("");
  const [grantXPostUrl, setGrantXPostUrl] = useState("");
  const [grantSubmitting, setGrantSubmitting] = useState(false);
  const [grantMessage, setGrantMessage] = useState("");
  const [grantApplicationImageUrl, setGrantApplicationImageUrl] = useState(DEFAULT_BUILDERS_IMAGE_URL);
  const [appliedSource, setAppliedSource] = useState<AppliedSource>("none");
  const [appliedApplication, setAppliedApplication] = useState<StoredGrantApplication | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreEmail, setRestoreEmail] = useState("");
  const [restoreCode, setRestoreCode] = useState("");
  const [restoreNonce, setRestoreNonce] = useState("");
  const [restoreMessage, setRestoreMessage] = useState("");
  const [restoreSubmitting, setRestoreSubmitting] = useState(false);
  const [copyToastVisible, setCopyToastVisible] = useState(false);
  const [showTenXModal, setShowTenXModal] = useState(false);
  const [tenXModalMode, setTenXModalMode] = useState<"list" | "post">("list");
  const [tenXPath, setTenXPath] = useState<"own" | "buy" | "alternative">("own");
  const [tenXXPostUrl, setTenXXPostUrl] = useState("");
  const [tenXAnswer2, setTenXAnswer2] = useState("");
  const [tenXMessage, setTenXMessage] = useState("");
  const [tenXSubmitting, setTenXSubmitting] = useState(false);
  const [auctionClock, setAuctionClock] = useState(() => new Date());
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome("million");

  const rareUrgency = useMemo(() => buildRareUrgency(auctionClock), [auctionClock]);
  const currentAuctionDay = useMemo(() => getCurrentAuctionDay(auctionClock), [auctionClock]);
  const promoCards = useMemo(() => buildPromoCards(rareUrgency), [rareUrgency]);
  const referralMillionUrl = useMemo(() => buildMillionUrl(fid), [fid]);
  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const forceEntryAvatars = searchParams.get("entries") === "1";
  const forceAppliedTest = isMillionLocalHost() && searchParams.get("applied") === "1";
  const referrerFid = searchParams.get("fid");
  const referrerGrant = searchParams.get("grant");

  const enterPath = `${getMillionRootPath().replace(/\/$/, "")}/enter`.replace(/^\/enter$/, "/enter");
  const goToEnter = () => {
    window.history.pushState(window.history.state, "", enterPath);
    setRouteMode("enter");
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  };

  const storeGrantApplication = (grantMonth: string, application: StoredGrantApplication) => {
    try {
      window.localStorage.setItem(getStoredGrantApplicationKey(grantMonth), JSON.stringify(application));
    } catch {
      return;
    }
  };

  const applyGrantApplicationToForm = (
    application: GrantApplication | StoredGrantApplication,
    source: AppliedSource,
    options: { persist?: boolean; grantMonth?: string } = {}
  ) => {
    const storedApplication: StoredGrantApplication = {
      id: application.id,
      fullName: application.fullName,
      email: application.email,
      buildAnswer: application.buildAnswer,
      xPostUrl: application.xPostUrl ?? null,
      status: application.status,
      emailVerified: application.emailVerified,
      referrals: typeof application.referrals === "number" ? application.referrals : undefined,
      restoredOn: source === "restore" ? new Date().toISOString() : undefined,
      submittedOn: source === "submit" ? new Date().toISOString() : undefined,
    };
    setGrantFullName(application.fullName);
    setGrantEmail(application.email);
    setGrantAnswer(application.buildAnswer);
    setGrantXPostUrl(application.xPostUrl ?? "");
    setAppliedSource(source);
    setAppliedApplication(storedApplication);
    if (options.persist && options.grantMonth) {
      storeGrantApplication(options.grantMonth, storedApplication);
    }
  };

  const loadStoredGrantApplication = (grantMonth: string): StoredGrantApplication | null => {
    try {
      const raw = window.localStorage.getItem(getStoredGrantApplicationKey(grantMonth));
      return raw ? normalizeStoredGrantApplication(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const interval = window.setInterval(() => setAuctionClock(new Date()), MINUTE_MS);
    return () => window.clearInterval(interval);
  }, []);

  const loadMillionStatus = async (viewerFid: number | null, token: string | null) => {
    const params = new URLSearchParams();
    if (viewerFid) params.set("fid", String(viewerFid));
    if (token) params.set("sessionToken", token);
    if (forceEntryAvatars) params.set("entries", "1");
    const response = await fetch(`/api/million-status?${params.toString()}`);
    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as MillionStatus;
    setStatus(data);
    setActionSessionToken(data.actionSessionToken ?? token ?? "");
    return data;
  };

  const normalizeWatchers = (raw: unknown): EntryAvatar[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as { fid?: unknown; username?: unknown; pfpUrl?: unknown };
        if (typeof row.fid !== "number" || !Number.isFinite(row.fid)) return null;
        if (typeof row.pfpUrl !== "string" || row.pfpUrl.trim().length === 0) return null;
        return {
          fid: row.fid,
          username: typeof row.username === "string" && row.username.trim().length > 0 ? row.username : String(row.fid),
          pfpUrl: row.pfpUrl,
        } satisfies EntryAvatar;
      })
      .filter((item): item is EntryAvatar => item !== null)
      .slice(0, 10);
  };

  const loadWatchers = async (viewerFid: number | null, token: string | null) => {
    try {
      const params = new URLSearchParams();
      if (viewerFid) params.set("fid", String(viewerFid));
      if (token) params.set("sessionToken", token);
      const query = params.toString();
      const response = await fetch(`/api/million-watchers${query ? `?${query}` : ""}`);
      if (!response.ok) return;
      const data = (await response.json()) as WatchersResponse;
      setWatchers(normalizeWatchers(data.watchers));
    } catch {
      setWatchers([]);
    }
  };

  const loadFollowers = async (viewerFid: number | null, token: string | null) => {
    try {
      const params = new URLSearchParams();
      if (viewerFid) params.set("fid", String(viewerFid));
      if (token) params.set("sessionToken", token);
      const query = params.toString();
      const response = await fetch(`/api/million-followers${query ? `?${query}` : ""}`);
      if (!response.ok) return;
      const data = (await response.json()) as FollowersResponse;
      setFollowers(normalizeWatchers(data.followers));
    } catch {
      setFollowers([]);
    }
  };

  const loadBuyers = async () => {
    try {
      const response = await fetch("/api/recent-buys?mode=buyers");
      if (!response.ok) return;
      const data = (await response.json()) as RecentBuysResponse;
      setBuyers(normalizeWatchers(data.buyers));
    } catch {
      setBuyers([]);
    }
  };

  const loadGrantStatus = async (viewerFid: number | null, token: string | null) => {
    try {
      const params = new URLSearchParams();
      if (viewerFid) params.set("fid", String(viewerFid));
      if (token) params.set("sessionToken", token);
      const query = params.toString();
      const response = await fetch(`/api/million-grants/status${query ? `?${query}` : ""}`);
      if (!response.ok) return null;
      const data = (await response.json()) as GrantStatus;
      setGrantStatus(data);
      if (data.actionSessionToken) setActionSessionToken(data.actionSessionToken);
      if (forceAppliedTest) {
        applyGrantApplicationToForm(LOCAL_TEST_GRANT_APPLICATION, "localStorage");
      } else if (data.application) {
        applyGrantApplicationToForm(data.application, "fid", { persist: true, grantMonth: data.grantMonth });
      } else if (!viewerFid) {
        const storedApplication = loadStoredGrantApplication(data.grantMonth);
        if (storedApplication) {
          applyGrantApplicationToForm(storedApplication, "localStorage");
        } else if (!grantEmail && status?.email) {
          setGrantEmail(status.email);
        }
      } else if (!grantEmail && status?.email) {
        setGrantEmail(status.email);
      }
      return data;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    let shouldCallReady = false;

    const init = async () => {
      try {
        const inMiniApp =
          typeof sdk.isInMiniApp === "function" ? await sdk.isInMiniApp() : true;
        setInMiniAppContext(Boolean(inMiniApp));
        if (!inMiniApp) {
          setShowOpenInFarcaster(true);
          const data = await loadMillionStatus(null, null);
          if (data.email && !grantEmail) setGrantEmail(data.email);
          await loadWatchers(null, null);
          await loadFollowers(null, null);
          await loadBuyers();
          await loadGrantStatus(null, null);
          return;
        }

        shouldCallReady = true;
        const context = await sdk.context;
        const viewerFid = context.user.fid;
        setFid(viewerFid);
        setUsername(context.user.username ?? "");

        const warpletStatusRes = await fetch("/api/warplet-status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fid: viewerFid,
            referrerFid: referrerFid && /^\d+$/.test(referrerFid) ? Number(referrerFid) : undefined,
          }),
        });
        const warpletStatus = warpletStatusRes.ok
          ? ((await warpletStatusRes.json()) as WarpletStatus)
          : null;
        const token = warpletStatus?.actionSessionToken ?? null;
        if (token) setActionSessionToken(token);
        if (typeof warpletStatus?.matchedTokenId === "number" && Number.isInteger(warpletStatus.matchedTokenId) && warpletStatus.matchedTokenId > 0) {
          setGrantApplicationImageUrl(`https://warplets.10x.meme/${warpletStatus.matchedTokenId}.avif`);
        } else {
          setGrantApplicationImageUrl(DEFAULT_BUILDERS_IMAGE_URL);
        }

        const data = await loadMillionStatus(viewerFid, token);
        if (data.email && !grantEmail) setGrantEmail(data.email);
        await loadWatchers(viewerFid, token);
        await loadFollowers(viewerFid, token);
        await loadBuyers();
        await loadGrantStatus(viewerFid, token);
        if (data.hasEntry && getRouteMode() === "landing") {
          goToEnter();
        }

        const shouldPromptAddApp =
          !context.client.added || !context.client.notificationDetails;
        setShowAddAppPrompt(shouldPromptAddApp);
        setNotificationsOnlyPrompt(Boolean(context.client.added && !context.client.notificationDetails));
      } catch (err) {
        console.error("Million app init error:", err);
        const message = err instanceof Error ? err.message : String(err);
        const normalized = message.toLowerCase();
        if (
          normalized.includes("context is undefined") ||
          normalized.includes("can't access property \"user\"") ||
          normalized.includes("cannot read properties of undefined")
        ) {
          setInMiniAppContext(false);
          setShowOpenInFarcaster(true);
        } else {
          setActionError(message);
        }
      } finally {
        setLoading(false);
        if (shouldCallReady) sdk.actions.ready();
      }
    };

    init();
  }, []);

  useEffect(() => {
    const onPop = () => setRouteMode(getRouteMode());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const siteKey = grantStatus?.recaptchaSiteKey?.trim();
    if (!siteKey || document.querySelector("script[data-million-recaptcha='1']")) return;
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true;
    script.defer = true;
    script.dataset.millionRecaptcha = "1";
    document.head.appendChild(script);
  }, [grantStatus?.recaptchaSiteKey]);

  const refreshStatus = async () => {
    if (!fid) return;
    await loadMillionStatus(fid, actionSessionToken || null);
  };

  const trackRareWatcher = async () => {
    if (!fid) return;
    try {
      const response = await fetch("/api/million-watchers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fid,
          sessionToken: actionSessionToken || undefined,
        }),
      });
      if (!response.ok) return;
      const data = (await response.json()) as WatchersResponse;
      setWatchers(normalizeWatchers(data.watchers));
    } catch {
      return;
    }
  };

  const grantAnswerWordCount = grantAnswer.trim().split(/\s+/).filter(Boolean).length;
  const tenXAnswer2WordCount = tenXAnswer2.trim().split(/\s+/).filter(Boolean).length;
  const hasApplied = appliedSource !== "none" && Boolean(appliedApplication);
  const attentionUnlocked = Boolean(
    appliedApplication?.emailVerified && appliedApplication.status === "accepted"
  );
  const grantShareTextX = `🟢 10X Builders: Grant Application ($500K → $10)\n\nQ: What are you building?\n\nA: ${grantAnswer.trim()}\n\n👀 `;

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
  };

  const showCopyToast = () => {
    setCopyToastVisible(true);
    window.setTimeout(() => setCopyToastVisible(false), 1600);
  };

  const openExternalUrl = async (url: string) => {
    try {
      await sdk.actions.openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const completeAttentionAction = async (actionKey: string, options: { auctionDay?: number; payload?: unknown } = {}) => {
    if (!fid) throw new Error("Open in Farcaster or use a signed-in local test user to earn points.");
    const response = await fetch("/api/million-action-complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionKey,
        auctionDay: options.auctionDay,
        payload: options.payload,
        fid,
        sessionToken: actionSessionToken || undefined,
      }),
    });
    const payload = await response.json().catch(() => null) as { error?: string; reason?: string; payload?: unknown } | null;
    if (!response.ok) throw new Error(payload?.error ?? payload?.reason ?? "Unable to complete action.");
    await refreshStatus();
    return payload;
  };

  const executeRecaptcha = async (): Promise<string | null> => {
    const siteKey = grantStatus?.recaptchaSiteKey?.trim();
    if (!siteKey) return null;
    const grecaptcha = (window as Window & {
      grecaptcha?: {
        ready: (callback: () => void) => void;
        execute: (siteKey: string, options: { action: string }) => Promise<string>;
      };
    }).grecaptcha;
    if (!grecaptcha) return null;
    return new Promise((resolve) => {
      grecaptcha.ready(() => {
        grecaptcha.execute(siteKey, { action: "million_grant_apply" }).then(resolve).catch(() => resolve(null));
      });
    });
  };

  const refreshGrantStatus = async () => {
    await loadGrantStatus(fid, actionSessionToken || null);
  };

  const submitGrantApplication = async () => {
    if (grantSubmitting) return;
    if (hasApplied) return;
    setGrantMessage("");
    if (!grantFullName.trim()) {
      setGrantMessage("Please enter your full name.");
      return;
    }
    if (!grantEmail.trim()) {
      setGrantMessage("Please enter your email.");
      return;
    }
    if (!isValidEmail(grantEmail.trim())) {
      setGrantMessage("Please enter a valid email.");
      return;
    }
    if (!grantAnswer.trim() || grantAnswerWordCount > 25) {
      setGrantMessage("Answer must be 25 words or less.");
      return;
    }

    setGrantSubmitting(true);
    try {
      const subscribeResponse = await fetch("/api/email/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: grantEmail.trim(),
          fid: fid ?? undefined,
          username,
          campaign: "million-grant",
          sessionToken: actionSessionToken || undefined,
        }),
      });
      if (!subscribeResponse.ok) throw new Error(await subscribeResponse.text());
      const subscribePayload = (await subscribeResponse.json()) as { alreadyVerified?: boolean; verificationEmailSent?: boolean };
      if (!subscribePayload.alreadyVerified) {
        setGrantMessage(subscribePayload.verificationEmailSent
          ? "Verification sent. Please verify your email, then return and submit again."
          : "Please verify your email, then return and submit again.");
        await refreshGrantStatus();
        return;
      }

      const recaptchaToken = await executeRecaptcha();
      const applyResponse = await fetch("/api/million-grants/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fid: fid ?? undefined,
          sessionToken: actionSessionToken || undefined,
          fullName: grantFullName.trim(),
          email: grantEmail.trim(),
          buildAnswer: grantAnswer.trim(),
          xPostUrl: grantXPostUrl.trim() || undefined,
          grant: referrerGrant || undefined,
          recaptchaToken: recaptchaToken || undefined,
        }),
      });
      const applyPayload = await applyResponse.json().catch(() => null) as { error?: string; status?: string; grantMonth?: string; application?: GrantApplication } | null;
      if (!applyResponse.ok) throw new Error(applyPayload?.error ?? "Unable to submit application.");
      applyGrantApplicationToForm(applyPayload?.application ?? {
        fullName: grantFullName.trim(),
        email: grantEmail.trim(),
        buildAnswer: grantAnswer.trim(),
        xPostUrl: grantXPostUrl.trim() || null,
        status: applyPayload?.status ?? "accepted",
        emailVerified: true,
      }, "submit", { persist: true, grantMonth: applyPayload?.grantMonth ?? getGrantMonthKey(auctionClock) });
      await refreshGrantStatus();
      await refreshStatus();
      setGrantMessage(applyPayload?.status === "pending_review"
        ? "Application received and pending review."
        : "Application received. 10X Attention is unlocked.");
      await hapticSuccess();
    } catch (err) {
      void hapticError();
      setGrantMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setGrantSubmitting(false);
    }
  };

  const openGrantShareX = async () => {
    if (hasApplied) {
      const href = grantXPostUrl.trim() || grantStatus?.config.xQuoteUrl?.trim();
      if (!href) return;
      if (inMiniAppContext) {
        await sdk.actions.openUrl(href).catch(() => {});
        return;
      }
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    await copyToClipboard(grantShareTextX);
    const params = new URLSearchParams({
      text: grantShareTextX,
      via: "10XMemeX",
      hashtags: "10X",
    });
    const quoteUrl = grantStatus?.config.xQuoteUrl?.trim();
    if (quoteUrl) params.set("url", quoteUrl);
    const intentUrl = `https://x.com/intent/post?${params.toString()}`;
    if (inMiniAppContext) {
      await sdk.actions.openUrl(intentUrl).catch(() => {});
      return;
    }
    window.open(intentUrl, "_blank", "noopener,noreferrer");
  };

  const requestGrantRestore = async () => {
    if (restoreSubmitting) return;
    setRestoreMessage("");
    if (!isValidEmail(restoreEmail.trim())) {
      setRestoreMessage("Please enter a valid email.");
      return;
    }
    setRestoreSubmitting(true);
    try {
      const response = await fetch("/api/million-grants/restore/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: restoreEmail.trim() }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; nonce?: string; message?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Unable to request restore code.");
      setRestoreNonce(payload?.nonce ?? "");
      setRestoreMessage(payload?.nonce
        ? "Restore code sent. Check your email."
        : (payload?.message ?? "If an accepted application exists for that email this month, a restore code has been sent."));
    } catch (err) {
      setRestoreMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoreSubmitting(false);
    }
  };

  const verifyGrantRestore = async () => {
    if (restoreSubmitting) return;
    setRestoreMessage("");
    if (!restoreNonce) {
      setRestoreMessage("Request a restore code first.");
      return;
    }
    if (!/^\d{6}$/.test(restoreCode.replace(/\D/g, ""))) {
      setRestoreMessage("Enter the 6 digit code.");
      return;
    }
    setRestoreSubmitting(true);
    try {
      const response = await fetch("/api/million-grants/restore/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nonce: restoreNonce, code: restoreCode }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; application?: GrantApplication } | null;
      if (!response.ok || !payload?.application) throw new Error(payload?.error ?? "Unable to restore application.");
      applyGrantApplicationToForm(payload.application, "restore", { persist: true, grantMonth: grantStatus?.grantMonth ?? getGrantMonthKey(auctionClock) });
      setShowRestoreModal(false);
      setRestoreCode("");
      setRestoreNonce("");
      setRestoreMessage("");
      setGrantMessage("Application restored.");
      await hapticSuccess();
    } catch (err) {
      void hapticError();
      setRestoreMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoreSubmitting(false);
    }
  };

  const verifyAction = async (slug: string) => {
    if (!fid) return;
    try {
      const response = await fetch("/api/million-action-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionSlug: slug,
          fid,
          sessionToken: actionSessionToken || undefined,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { reason?: string } | null;
        throw new Error(payload?.reason ?? "Action is not verified yet.");
      }
      setPendingVerify((prev) => ({ ...prev, [slug]: false }));
      setRejectedVerify((prev) => ({ ...prev, [slug]: false }));
      await hapticSuccess();
      await refreshStatus();
    } catch (err) {
      void hapticError();
      setPendingVerify((prev) => ({ ...prev, [slug]: false }));
      setRejectedVerify((prev) => ({ ...prev, [slug]: true }));
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const runAction = async (action: MillionAction) => {
    if (action.completed) return;
    await hapticTap();
    setRejectedVerify((prev) => ({ ...prev, [action.slug]: false }));
    setPendingVerify((prev) => ({ ...prev, [action.slug]: true }));

    if (action.slug === "million-cast") {
      await sdk.actions.composeCast({
        text: `🟢 $1M Warplet\n\nDon't miss out.\n\nVisit mini-app: ${referralMillionUrl}`,
        embeds: [referralMillionUrl],
        channelKey: "10xmeme",
      } as Parameters<typeof sdk.actions.composeCast>[0] & { channelKey: string }).catch(() => {});
      return;
    }
    if (action.slug === "million-tweet") {
      const text = `🟢 $1M Warplet\n\nDon't miss out.\n\n1️⃣ Join Farcaster: ${FARCASTER_JOIN_URL}\n2️⃣ Visit mini-app: ${referralMillionUrl}`;
      const intentUrl = `https://x.com/intent/post?${new URLSearchParams({
        text,
        url: "",
        hashtags: "1MWarplet",
        via: "10XMemeX",
      }).toString()}`;
      await sdk.actions.openUrl(intentUrl).catch(() => {});
      return;
    }
    if (action.slug === "million-follow-fc-10xmeme") {
      await sdk.actions.viewProfile({ fid: 1313340 }).catch(() => {});
      window.setTimeout(() => verifyAction(action.slug), 5000);
      return;
    }
    if (action.slug === "million-follow-fc-10xchris") {
      await sdk.actions.viewProfile({ fid: 1129138 }).catch(() => {});
      window.setTimeout(() => verifyAction(action.slug), 5000);
      return;
    }
    if (action.url) {
      await sdk.actions.openUrl(action.url).catch(() => {});
    }
  };

  const buildDailyShareText = (collection: DailyCollection) =>
    `${collection.budget} NFT sweep and airdrop for ${collection.collection} by @${collection.twitter}...\n\nBut only if the $1M Warplet by @10XMemeX sells for ${collection.sale} on Day ${collection.day}.\n\nWatching this 30 day dutch auction 👀\n\n${ONE_M_WARPLET_OPENSEA_URL}`;

  const runAttentionAction = async (action: AttentionAction, section?: AttentionSection) => {
    if (action.completed) return;
    if (!attentionUnlocked) {
      setActionError("Submit a Grant Application to unlock 10X Attention.");
      return;
    }
    await hapticTap();
    setPendingVerify((prev) => ({ ...prev, [action.key]: true }));
    setActionError("");
    try {
      if (action.kind === "modal") {
        setTenXMessage("");
        setTenXModalMode(action.key === "tenx-post-x" ? "post" : "list");
        const listPayload = section?.actions.find((item) => item.key === "tenx-list-warplet")?.payload as { answer2?: string } | undefined;
        if (action.key === "tenx-post-x" && listPayload?.answer2) setTenXAnswer2(listPayload.answer2);
        setShowTenXModal(true);
        return;
      }
      if (action.kind === "profile" && action.fid) {
        await sdk.actions.viewProfile({ fid: action.fid }).catch(() => {});
      } else if (action.kind === "farcaster") {
        await sdk.actions.composeCast({
          text: `🟢 $1M Warplet\n\nDon't miss out.\n\nVisit mini-app: ${referralMillionUrl}`,
          embeds: [referralMillionUrl],
          channelKey: action.channelKey ?? "10xmeme",
        } as Parameters<typeof sdk.actions.composeCast>[0] & { channelKey: string }).catch(() => {});
      } else if (action.kind === "add-app") {
        await sdk.actions.addMiniApp().catch(() => {});
      } else if (action.kind === "x") {
        const daily = section?.dailyCollection;
        const text = daily
          ? buildDailyShareText(daily)
          : `🟢 $1M Warplet\n\nDon't miss out.\n\n1️⃣ Join Farcaster: ${FARCASTER_JOIN_URL}\n2️⃣ Visit mini-app: ${referralMillionUrl}`;
        await openExternalUrl(`https://x.com/intent/post?${new URLSearchParams({
          text,
          hashtags: daily ? "10X" : "1MWarplet",
          via: "10XMemeX",
        }).toString()}`);
      } else if (action.url) {
        await openExternalUrl(action.url);
      }
      await completeAttentionAction(action.key, { auctionDay: action.auctionDay });
      await hapticSuccess();
    } catch (err) {
      void hapticError();
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingVerify((prev) => ({ ...prev, [action.key]: false }));
    }
  };

  const submitTenXListAction = async () => {
    if (tenXSubmitting) return;
    setTenXMessage("");
    if (tenXPath === "alternative") {
      if (!tenXAnswer2.trim() || tenXAnswer2WordCount > 25) {
        setTenXMessage("Answer must be 25 words or less.");
        return;
      }
    } else if (!/^https?:\/\/([^/]*\.)?(x\.com|twitter\.com)\/.+/i.test(tenXXPostUrl.trim())) {
      setTenXMessage("Enter a valid X post URL.");
      return;
    }
    setTenXSubmitting(true);
    try {
      await completeAttentionAction("tenx-list-warplet", {
        payload: tenXPath === "alternative"
          ? { path: tenXPath, answer2: tenXAnswer2.trim() }
          : { path: tenXPath, xPostUrl: tenXXPostUrl.trim() },
      });
      setTenXMessage("10X action completed.");
      setShowTenXModal(false);
      await hapticSuccess();
    } catch (err) {
      void hapticError();
      setTenXMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setTenXSubmitting(false);
    }
  };

  const submitTenXPostAction = async () => {
    if (tenXSubmitting) return;
    if (!tenXAnswer2.trim() || tenXAnswer2WordCount > 25) {
      setTenXMessage("Answer must be 25 words or less.");
      return;
    }
    setTenXSubmitting(true);
    try {
      const quoteUrl = grantXPostUrl.trim() || grantStatus?.config.xQuoteUrl?.trim() || "";
      const intentUrl = `https://x.com/intent/post?${new URLSearchParams({
        text: `How to 10X what I'm building...\n\n${tenXAnswer2.trim()}\n\n`,
        url: quoteUrl,
        via: "10XMemeX",
        hashtags: "10X",
      }).toString()}`;
      await openExternalUrl(intentUrl);
      await completeAttentionAction("tenx-post-x", { payload: { answer2: tenXAnswer2.trim() } });
      setShowTenXModal(false);
      await hapticSuccess();
    } catch (err) {
      void hapticError();
      setTenXMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setTenXSubmitting(false);
    }
  };

  const renderLanding = () => (
    <div className="relative z-10 w-full max-w-md mx-auto text-center space-y-4 px-4 pt-2 pb-8">
      <div className="space-y-5">
        {promoCards.map((card) => (
          <PromoSection
            key={card.id}
            card={card.id === "builders" && hasApplied
              ? { ...card, ctas: card.ctas.map((cta) => ({ ...cta, label: "You Have Applied. Next: 10X Attention!" })) }
              : card}
            referralMillionUrl={referralMillionUrl}
            entryAvatars={status?.entryAvatars ?? []}
            onEnter={goToEnter}
            watchers={watchers}
            applicants={grantStatus?.applicants ?? []}
            followers={followers}
            buyers={buyers}
            onRareCtaClick={trackRareWatcher}
            currentAuctionDay={currentAuctionDay}
            inMiniAppContext={inMiniAppContext}
          />
        ))}
      </div>
    </div>
  );

  const renderEntryPage = () => {
    const grantMonthLabel = auctionClock.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const entryCtaClass = "block w-full rounded-[20px] border border-[#009900] bg-[#00FF00] px-5 py-3 text-base font-bold shadow-[3px_6px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:border-gray-700 disabled:bg-gray-700 disabled:text-gray-300 disabled:shadow-[3px_6px_0_#333]";
    const appliedCtaClass = "block w-full rounded-[20px] border border-gray-700 bg-gray-700 px-5 py-3 text-base font-bold text-gray-300";
    const compactCtaClass = "inline-flex items-center justify-center rounded-[16px] border border-[#009900] bg-[#00FF00] px-4 py-2 text-sm font-bold shadow-[2px_4px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[2px] active:shadow-[1px_2px_0_#008000] disabled:border-gray-700 disabled:bg-gray-700 disabled:text-gray-300 disabled:shadow-[2px_4px_0_#333]";
    const inputClass = "w-full rounded-xl border border-[#0F0] bg-black px-3 py-3 text-sm text-[#0F0] opacity-100 outline-none placeholder:text-[#0F0]/60 disabled:border-gray-700 disabled:text-gray-300 disabled:opacity-100";
    const applicationReferralUrl = appliedApplication?.id ? `${buildMillionUrl(null)}?grant=${appliedApplication.id}` : "";
    const applicationReferralCount = appliedApplication?.referrals ?? grantStatus?.application?.referrals ?? 0;
    const grantTopReferrers = (forceAppliedTest && (!grantStatus?.topReferrers || grantStatus.topReferrers.length === 0))
      ? LOCAL_TEST_GRANT_REFERRERS
      : grantStatus?.topReferrers ?? [];
    const attentionSections = status?.attentionSections ?? [];
    const renderAttentionSection = (section: AttentionSection) => (
      <div key={section.id} className="space-y-3 text-left">
        <Text className="text-lg font-bold text-center" style={{ color: "#00FF00" }}>
          {section.title}
        </Text>
        {section.dailyCollection && (
          <Text className="text-base font-bold text-center" style={{ color: "#b7ffb7" }}>
            Day {section.dailyCollection.day}: {section.dailyCollection.collection}
          </Text>
        )}
        {section.dailyCollection && <AttentionDailySlideshow collection={section.dailyCollection} />}
        {section.id === "tenx" && (
          <div className="w-full rounded-[20px] border border-[#00FF00]/45 bg-[#00FF00]/20 p-[2px]">
            <img src="https://warplets.10x.meme/1358.avif" alt="10X Action" className="aspect-square w-full rounded-[18px] object-cover" style={{ color: "#0F0" }} />
          </div>
        )}
        <div className="overflow-hidden rounded-2xl border border-[#0F0]/35 bg-[#041204]/85">
          {section.actions.map((action) => {
            const pending = pendingVerify[action.key] === true;
            const actionFlat = action.completed || pending || !attentionUnlocked;
            return (
              <div key={`${action.key}-${action.auctionDay ?? 0}`} className="border-b border-[#0F0]/15 p-3 last:border-b-0">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <Text className="text-left text-base font-bold text-[#0F0]">{action.label}</Text>
                  </div>
                  <button
                    type="button"
                    disabled={pending || !attentionUnlocked}
                    onClick={() => runAttentionAction(action, section).catch(() => {})}
                    className={actionFlat
                      ? "flex h-10 min-w-12 items-center justify-center rounded-xl border border-gray-600 bg-gray-700 px-3 text-sm font-black text-gray-200"
                      : "flex h-10 min-w-12 items-center justify-center rounded-xl border border-[#009900] bg-[#0F0] px-3 text-sm font-black shadow-[2px_3px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[2px] active:shadow-[1px_1px_0_#008000]"}
                    style={actionFlat ? undefined : { color: "rgb(0, 80, 0)" }}
                  >
                    {action.completed ? <ActionCheckIcon /> : pending ? "..." : `+${action.points}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
    return (
      <div className="relative z-10 w-full max-w-md mx-auto text-center space-y-5 px-4 pt-2 pb-8">
            <form onSubmit={(event) => {
              event.preventDefault();
              submitGrantApplication().catch(() => {});
            }}>
              <Text className="text-[clamp(1.6rem,5vw,1.6rem)] font-bold leading-tight text-center" style={{ color: "#00FF00" }}>Grant Application</Text>
              <Text className="mt-2 text-lg font-semibold leading-snug text-center" style={{ color: "#00FF00" }}>50% of Sale = Free Grants: $500,000 → $10</Text>
              <div className="mt-3 w-full rounded-[20px] p-[2px] bg-[#00FF00]/20 border border-[#00FF00]/45">
                <img
                  src={grantApplicationImageUrl}
                  alt="Grant Application"
                  className="aspect-square w-full rounded-[18px] object-cover"
                  style={{ color: "#0F0" }}
                />
              </div>
              <div className="mt-5 grid grid-cols-1 gap-3">
                <input required disabled={hasApplied} value={grantFullName} onChange={(event) => setGrantFullName(event.target.value)} className={inputClass} placeholder="Name" />
                <input type="email" required disabled={hasApplied} value={grantEmail} onChange={(event) => setGrantEmail(event.target.value)} className={inputClass} placeholder="Email" />
                <div className="relative">
                  <textarea required disabled={hasApplied} value={grantAnswer} onChange={(event) => setGrantAnswer(event.target.value)} className="min-h-36 w-full resize-none rounded-xl border border-[#0F0] bg-black px-3 pb-7 pt-3 text-lg text-[#0F0] opacity-100 outline-none placeholder:text-[#0F0]/60 disabled:border-gray-700 disabled:text-gray-300 disabled:opacity-100" placeholder="What are you building? (25 words or less)" />
                  <Text className={hasApplied ? "pointer-events-none absolute bottom-2 right-3 z-10 text-xs text-gray-300" : grantAnswerWordCount > 25 ? "pointer-events-none absolute bottom-2 right-3 z-10 text-xs text-[#F00]/90" : "pointer-events-none absolute bottom-2 right-3 z-10 text-xs text-[#0F0]/90"}>{grantAnswerWordCount}/25 words</Text>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-[#00A3FF]/60 bg-[#00A3FF]/10 px-3 py-3 text-left">
                <Text className="text-base font-bold text-[#8FD8FF]">Judging Criteria</Text>
                <Text className="mt-2 text-sm leading-relaxed text-[#8FD8FF]/90"><strong>Creativity:</strong> Original, witty, high-impact written entry.</Text>
                <Text className="mt-1 text-sm leading-relaxed text-[#8FD8FF]/90"><strong>Utility:</strong> Clear real-world value, a meaningful product.</Text>
                <Text className="mt-1 text-sm leading-relaxed text-[#8FD8FF]/90"><strong>Fun:</strong> Bringing joy, entertainment, culture, excitement.</Text>
                <Text className="mt-1 text-sm leading-relaxed text-[#8FD8FF]/90"><strong>10X:</strong> Radically challenge the status quo, Think 10X.</Text>
              </div>
              {grantAnswerWordCount > 0 && (
                <div className="mt-4 rounded-xl border border-[#0F0]/20 bg-[#041204]/65 p-3 text-left">
                  <Text className="text-base font-bold text-[#0F0]">Optional: Share on X (Twitter)</Text>
                  <Text className="mt-1 text-sm leading-relaxed text-[#0F0]/65">
                    Post a tweet with more detail (e.g. images, video, etc) so we can learn more about your project and pick the best winners!
                  </Text>
                  <div className="mt-3">
                    <button type="button" onClick={() => openGrantShareX().catch(() => {})} disabled={!grantAnswer.trim() || (hasApplied && !grantXPostUrl.trim() && !grantStatus?.config.xQuoteUrl?.trim())} className={compactCtaClass} style={{ color: "rgb(0, 80, 0)" }}>
                      {hasApplied ? (grantXPostUrl.trim() ? "View your post on X" : "View our post on X") : "Start by quoting our post on X"}
                    </button>
                  </div>
                  {!hasApplied && <Text className="mt-3 text-sm leading-relaxed text-[#0F0]/60">Paste the URL to your tweet below:</Text>}
                  <input disabled={hasApplied} type="url" pattern="https?://([^/]*\.)?(x\.com|twitter\.com)(/.*)?" title="Enter a valid X or Twitter URL." value={grantXPostUrl} onChange={(event) => setGrantXPostUrl(event.target.value)} className={`mt-3 ${inputClass}`} placeholder="Your tweet URL" />
                </div>
              )}
              {grantStatus?.application && (
                <Text className="mt-4 text-sm font-bold text-[#0F0]">
                  Application status: {grantStatus.application.status === "accepted" ? "Accepted" : "Pending review"}
                  {grantStatus.application.emailVerified ? " + verified email" : " + email pending verification"}
                </Text>
              )}
              {grantMessage && <Text className="mt-4 text-sm text-yellow-200">{grantMessage}</Text>}
              <button type="submit" disabled={grantSubmitting || hasApplied} className={hasApplied ? `mt-5 ${appliedCtaClass}` : `mt-5 ${entryCtaClass}`} style={hasApplied ? undefined : { color: "rgb(0, 80, 0)" }}>
                {hasApplied ? "You Have Applied. Next: 10X Attention!" : grantSubmitting ? "Submitting..." : "Submit Grant Application"}
              </button>
              <Text className="mt-5 text-sm font-semibold leading-relaxed text-center" style={{ color: "#b7ffb7" }}>
                🤝 Zero Equity. No Strings Attached. Free Money.
              </Text>
              {grantStatus?.applicants && grantStatus.applicants.length > 0 && (
                <AvatarStack avatars={grantStatus.applicants} label="Applied:" />
              )}
            </form>
            <div className="pt-4">
              <Text className="text-[clamp(1.6rem,5vw,1.6rem)] font-bold leading-tight text-center" style={{ color: "#00FF00" }}>
                10X Attention
              </Text>
              <Text className="mt-2 text-lg font-semibold leading-snug text-center" style={{ color: "#00FF00" }}>
                Earn Points → Win Attention → 10X Spotlight
              </Text>
              <div className="mt-3 w-full rounded-[20px] p-[2px] bg-[#00FF00]/20 border border-[#00FF00]/45">
                <img
                  src="https://warplets.10x.meme/7840.avif"
                  alt="10X Attention"
                  className="aspect-square w-full rounded-[18px] object-cover"
                  style={{ color: "#0F0" }}
                />
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <StatBox value={status?.userEntries ?? 0} label="Your Points" />
              <StatBox value={status?.totalEntries ?? 0} label="Total Points" />
              <StatBox value={status?.daysLeft ?? 0} label="Days Left" />
            </div>
            {!attentionUnlocked && (
              <Text className="mt-5 rounded-xl border border-[#F00]/60 bg-[#F00]/10 px-3 py-3 text-center text-base font-normal text-[#F00]/90">
                Submit a Grant Application to unlock 10X Attention.
                <br />
                <br />
                Already submitted?{" "}
                <button type="button" onClick={() => {
                  setRestoreEmail(grantEmail);
                  setRestoreMessage("");
                  setRestoreCode("");
                  setRestoreNonce("");
                  setShowRestoreModal(true);
                }} className="cursor-pointer underline decoration-[#F00]/80 underline-offset-2">
                  Restore your application
                </button>.
              </Text>
            )}
            {attentionSections.map(renderAttentionSection)}

            <div className="space-y-3 text-left">
              <Text className="text-lg font-bold text-center" style={{ color: "#00FF00" }}>
                Referral Actions (10pts)
              </Text>
              <div className="w-full rounded-[20px] border border-[#00FF00]/45 bg-[#00FF00]/20 p-[2px]">
                <img src="https://warplets.10x.meme/281.avif" alt="Referral Actions" className="aspect-square w-full rounded-[18px] object-cover" style={{ color: "#0F0" }} />
              </div>
              <div className="rounded-2xl border border-[#00FF00]/35 bg-[#041204]/85 px-4 py-4 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    disabled={!applicationReferralUrl}
                    value={applicationReferralUrl}
                    className="h-11 w-full rounded-xl border border-[#00FF00] bg-black/70 px-3 text-[16px] text-white outline-none disabled:border-gray-700 disabled:text-gray-400"
                  />
                  <button
                    type="button"
                    disabled={!applicationReferralUrl}
                    onClick={() => {
                      void hapticTap();
                      if (!applicationReferralUrl) return;
                      copyToClipboard(applicationReferralUrl).then(showCopyToast).catch(() => {});
                    }}
                    className="h-10 w-10 shrink-0 rounded-[10px] border border-[#009900] bg-[#00FF00] text-xl font-bold shadow-[2px_4px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[2px] active:shadow-[1px_2px_0_#008000] cursor-pointer disabled:cursor-default disabled:border-gray-700 disabled:bg-gray-700 disabled:text-gray-300 disabled:shadow-none"
                    style={{ color: "rgb(0, 80, 0)" }}
                    aria-label="Copy referral link"
                  >
                    📋
                  </button>
                </div>
                <Text className="text-sm leading-relaxed text-left" style={{ color: "#b7ffb7" }}>
                  Share your referral link to earn more points (maximum: 10pts)
                </Text>
                <Text className="text-sm font-bold text-left" style={{ color: "#00FF00" }}>
                  Your referrals: {applicationReferralCount}
                </Text>
              </div>
            </div>

            <div className="space-y-3 text-left">
              <Text className="text-lg font-bold text-center" style={{ color: "#00FF00" }}>
                Top Referrers
              </Text>
              <div className="rounded-2xl overflow-hidden border border-[#00FF00]/35 bg-[#041204]/85 p-0">
                <table className="w-full border-separate border-spacing-0 text-left">
                  <thead>
                    <tr>
                      <th className="border-b border-r border-[#00FF00]/25 px-2 py-2 text-xs text-center" style={{ color: "#00FF00" }}>Rank</th>
                      <th className="border-b border-r border-[#00FF00]/25 px-2 py-2 text-xs text-center" style={{ color: "#00FF00" }}>Referrals</th>
                      <th className="border-b border-[#00FF00]/25 px-2 py-2 text-xs" style={{ color: "#00FF00" }}>Username</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grantTopReferrers.slice(0, 10).map((referrer, index) => (
                      <tr key={referrer.id}>
                        <td className="border-b border-r border-[#00FF00]/20 px-2 py-2 text-sm text-center" style={{ color: "#b7ffb7" }}>{index + 1}</td>
                        <td className="border-b border-r border-[#00FF00]/20 px-2 py-2 text-sm font-semibold text-center" style={{ color: "#b7ffb7" }}>
                          {referrer.referrals}
                        </td>
                        <td className="border-b border-[#00FF00]/20 px-2 py-2">
                          {referrer.hasProfile && referrer.fid ? (
                            <button
                              type="button"
                              className="flex min-w-0 items-center gap-2 text-left cursor-pointer"
                              style={{ color: "#b7ffb7" }}
                              onClick={() => {
                                void hapticTap();
                                sdk.actions.viewProfile({ fid: referrer.fid as number }).catch(() => {});
                              }}
                            >
                              {referrer.pfpUrl ? (
                                <img
                                  src={referrer.pfpUrl}
                                  alt={referrer.username}
                                  className="h-8 w-8 shrink-0 rounded-full object-cover"
                                  style={{ border: "2px solid #00FF00" }}
                                  loading="lazy"
                                />
                              ) : (
                                <span className="h-8 w-8 shrink-0 rounded-full bg-[#00FF00]" aria-hidden="true" />
                              )}
                              <span className="min-w-0 truncate text-sm underline underline-offset-2">{referrer.username}</span>
                            </button>
                          ) : (
                            <div className="flex min-w-0 items-center gap-2" style={{ color: "#b7ffb7" }}>
                              <span className="h-8 w-8 shrink-0 rounded-full bg-[#00FF00]" aria-hidden="true" />
                              <span className="min-w-0 truncate text-sm">{referrer.username}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {grantTopReferrers.length === 0 && (
                      <tr>
                        <td className="px-2 py-3 text-sm text-center" style={{ color: "#b7ffb7" }} colSpan={3}>
                          No referrers yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
      </div>
    );
  };

  const handleConfirmAddAppPrompt = async () => {
    setShowAddAppPrompt(false);
    try {
      await hapticPrimaryTap();
      await sdk.actions.addMiniApp();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <MiniAppShell>
      <div className="relative z-10 w-full">
        <MiniAppHeader
          appSlug="million"
          title={routeMode === "enter" ? "Grants + Attention" : getHeaderTitle("million", isMenuRoute)}
          canGoBack={canGoBack || routeMode === "enter"}
          onBack={routeMode === "enter" ? () => {
            window.history.pushState(window.history.state, "", getMillionRootPath());
            setRouteMode("landing");
          } : actions.goBack}
          onLogo={actions.openHubRoot}
          onMenu={actions.openMenu}
        />

        {isMenuRoute ? (
          <MiniAppMenuPage appSlug="million" />
        ) : loading ? (
          <div className="px-4 py-10 text-center">
            <Text className="text-sm font-bold text-[#0F0]">Loading $1M Warplet...</Text>
          </div>
        ) : routeMode === "enter" ? renderEntryPage() : renderLanding()}
      </div>

      {showAddAppPrompt && !showOpenInFarcaster && (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4 bg-black/70 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-2xl border border-[#00FF00]/45 bg-[#041204] p-5 shadow-[0_0_40px_rgba(0,255,0,0.15)]">
            <Text className="text-xl font-bold text-left" style={{ color: "#00FF00" }}>
              🟢 Don&apos;t miss out
            </Text>
            <Text className="mt-3 text-sm text-left" style={{ color: "#b7ffb7" }}>
              {notificationsOnlyPrompt
                ? "Please turn on notifications so you don\u2019t miss out on important updates."
                : "Please Add Mini App and enable notifications so you don\u2019t miss out on important updates."}
            </Text>
            <div className="mt-5 grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={handleConfirmAddAppPrompt}
                className="w-full px-4 py-3 rounded-[14px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold transition-colors cursor-pointer"
                style={{ color: "rgb(0, 80, 0)" }}
              >
                Ok, let&apos;s go!
              </button>
            </div>
          </div>
        </div>
      )}

      {showRestoreModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 px-4 pb-8">
          <div className="w-full max-w-sm rounded-2xl border border-[#0F0]/40 bg-black px-5 py-6 shadow-2xl">
            <Text className="text-center text-lg font-black text-[#0F0]">Restore Grant Application</Text>
            <Text className="mt-2 text-center text-sm text-[#0F0]/75">Enter your application email. If it matches an accepted application this month, we will send a restore code.</Text>
            <input
              type="email"
              value={restoreEmail}
              onChange={(event) => setRestoreEmail(event.target.value)}
              placeholder="you@example.com"
              className="mt-5 w-full rounded-xl border border-[#0F0]/30 bg-black px-3 py-3 text-sm text-[#0F0] outline-none"
            />
            {restoreNonce && (
              <input
                inputMode="numeric"
                value={restoreCode}
                onChange={(event) => setRestoreCode(event.target.value)}
                placeholder="6 digit code"
                className="mt-3 w-full rounded-xl border border-[#0F0]/30 bg-black px-3 py-3 text-sm text-[#0F0] outline-none"
              />
            )}
            {restoreMessage && <Text className="mt-3 text-xs text-yellow-200">{restoreMessage}</Text>}
            <button
              type="button"
              onClick={() => (restoreNonce ? verifyGrantRestore() : requestGrantRestore()).catch(() => {})}
              disabled={restoreSubmitting}
              className="mt-5 block w-full rounded-[20px] border border-[#009900] bg-[#00FF00] px-5 py-3 text-base font-bold shadow-[3px_6px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:border-gray-700 disabled:bg-gray-700 disabled:text-gray-300 disabled:shadow-[3px_6px_0_#333]"
              style={{ color: "rgb(0, 80, 0)" }}
            >
              {restoreSubmitting ? "Working..." : restoreNonce ? "Unlock Application" : "Send Restore Code"}
            </button>
            <button
              type="button"
              onClick={() => setShowRestoreModal(false)}
              className="mt-3 w-full rounded-xl py-2 text-sm text-[#0F0]/60"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showTenXModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 px-4 pb-8">
          <div className="max-h-[88vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-[#0F0]/40 bg-black px-5 py-6 shadow-2xl">
            <Text className="text-center text-lg font-black text-[#0F0]">
              {tenXModalMode === "post" ? "Post on X" : "$10B Mission"}
            </Text>
            {tenXModalMode === "list" ? (
              <div className="mt-4 space-y-4 text-left">
                <Text className="text-sm leading-relaxed text-[#b7ffb7]">
                  The $10B Mission: Have all 10,000 10X Warplets listed for $1,000,000, for a combined listed value of $10,000,000,000.
                </Text>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    ["own", "I already own a 10X Warplet..."],
                    ["buy", "I don't own a 10X Warplet..."],
                    ["alternative", "Alternative entry method..."],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTenXPath(value as "own" | "buy" | "alternative")}
                      className={tenXPath === value ? "rounded-xl border border-[#0F0] bg-[#0F0] px-3 py-2 text-left text-sm font-bold" : "rounded-xl border border-[#0F0]/35 bg-[#041204] px-3 py-2 text-left text-sm font-bold text-[#0F0]"}
                      style={tenXPath === value ? { color: "rgb(0, 80, 0)" } : undefined}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {tenXPath === "own" && (
                  <div className="space-y-3">
                    <Text className="text-sm leading-relaxed text-[#b7ffb7]">List on OpenSea for $1M and post a screenshot on X, then share the post URL.</Text>
                    <button type="button" onClick={() => openExternalUrl(TEN_X_WARPLETS_OPENSEA_URL).catch(() => {})} className="rounded-xl border border-[#009900] bg-[#0F0] px-3 py-2 text-sm font-bold shadow-[2px_3px_0_#008000]" style={{ color: "rgb(0, 80, 0)" }}>Open 10X Warplets on OpenSea</button>
                    <input value={tenXXPostUrl} onChange={(event) => setTenXXPostUrl(event.target.value)} className="w-full rounded-xl border border-[#0F0] bg-black px-3 py-3 text-sm text-[#0F0] outline-none placeholder:text-[#0F0]/60" placeholder="Your X screenshot post URL" />
                  </div>
                )}

                {tenXPath === "buy" && (
                  <div className="space-y-3">
                    <Text className="text-sm leading-relaxed text-[#b7ffb7]">Buy or claim a 10X Warplet, post a screenshot on X, then share the post URL.</Text>
                    <div className="grid grid-cols-1 gap-2">
                      <button type="button" onClick={() => openExternalUrl(DROP_APP_URL).catch(() => {})} className="rounded-xl border border-[#009900] bg-[#0F0] px-3 py-2 text-sm font-bold shadow-[2px_3px_0_#008000]" style={{ color: "rgb(0, 80, 0)" }}>Open 10X Warplet Drop app</button>
                      <button type="button" onClick={() => openExternalUrl(TEN_X_WARPLETS_OPENSEA_URL).catch(() => {})} className="rounded-xl border border-[#009900] bg-[#0F0] px-3 py-2 text-sm font-bold shadow-[2px_3px_0_#008000]" style={{ color: "rgb(0, 80, 0)" }}>Open 10X Warplets on OpenSea</button>
                    </div>
                    <input value={tenXXPostUrl} onChange={(event) => setTenXXPostUrl(event.target.value)} className="w-full rounded-xl border border-[#0F0] bg-black px-3 py-3 text-sm text-[#0F0] outline-none placeholder:text-[#0F0]/60" placeholder="Your X screenshot post URL" />
                  </div>
                )}

                {tenXPath === "alternative" && (
                  <div className="space-y-2">
                    <Text className="text-sm leading-relaxed text-[#b7ffb7]">No Purchase Necessary method of entry.</Text>
                    <div className="relative">
                      <textarea value={tenXAnswer2} onChange={(event) => setTenXAnswer2(event.target.value)} className="min-h-32 w-full resize-none rounded-xl border border-[#0F0] bg-black px-3 pb-7 pt-3 text-sm text-[#0F0] outline-none placeholder:text-[#0F0]/60" placeholder="How could you 10X what you're building? (in 25 words or less)" />
                      <Text className={tenXAnswer2WordCount > 25 ? "pointer-events-none absolute bottom-2 right-3 z-10 text-xs text-[#F00]/90" : "pointer-events-none absolute bottom-2 right-3 z-10 text-xs text-[#0F0]/90"}>{tenXAnswer2WordCount}/25 words</Text>
                    </div>
                  </div>
                )}
                {tenXMessage && <Text className="text-sm text-yellow-200">{tenXMessage}</Text>}
                <button type="button" onClick={() => submitTenXListAction().catch(() => {})} disabled={tenXSubmitting} className="block w-full rounded-[20px] border border-[#009900] bg-[#00FF00] px-5 py-3 text-base font-bold shadow-[3px_6px_0_#008000] disabled:border-gray-700 disabled:bg-gray-700 disabled:text-gray-300 disabled:shadow-[3px_6px_0_#333]" style={{ color: "rgb(0, 80, 0)" }}>
                  {tenXSubmitting ? "Submitting..." : "Submit 10X Action"}
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-4 text-left">
                <Text className="text-sm leading-relaxed text-[#b7ffb7]">Answer this prompt, then post it on X.</Text>
                <div className="relative">
                  <textarea value={tenXAnswer2} onChange={(event) => setTenXAnswer2(event.target.value)} className="min-h-32 w-full resize-none rounded-xl border border-[#0F0] bg-black px-3 pb-7 pt-3 text-sm text-[#0F0] outline-none placeholder:text-[#0F0]/60" placeholder="How could you 10X what you're building? (in 25 words or less)" />
                  <Text className={tenXAnswer2WordCount > 25 ? "pointer-events-none absolute bottom-2 right-3 z-10 text-xs text-[#F00]/90" : "pointer-events-none absolute bottom-2 right-3 z-10 text-xs text-[#0F0]/90"}>{tenXAnswer2WordCount}/25 words</Text>
                </div>
                {tenXMessage && <Text className="text-sm text-yellow-200">{tenXMessage}</Text>}
                <button type="button" onClick={() => submitTenXPostAction().catch(() => {})} disabled={tenXSubmitting} className="block w-full rounded-[20px] border border-[#009900] bg-[#00FF00] px-5 py-3 text-base font-bold shadow-[3px_6px_0_#008000] disabled:border-gray-700 disabled:bg-gray-700 disabled:text-gray-300 disabled:shadow-[3px_6px_0_#333]" style={{ color: "rgb(0, 80, 0)" }}>
                  {tenXSubmitting ? "Posting..." : "Post your answer on X"}
                </button>
              </div>
            )}
            <button type="button" onClick={() => setShowTenXModal(false)} className="mt-4 w-full rounded-xl py-2 text-sm text-[#0F0]/60">
              Close
            </button>
          </div>
        </div>
      )}

      {copyToastVisible && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="rounded-xl border border-[#0F0]/45 bg-black/90 px-4 py-2 shadow-lg backdrop-blur-sm">
            <Text className="text-center text-sm font-semibold text-[#0F0]">Link copied to clipboard</Text>
          </div>
        </div>
      )}

      {actionError && (
        <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-full max-w-sm px-4">
          <button
            type="button"
            onClick={() => setActionError("")}
            className="w-full rounded-2xl border border-red-400/40 bg-red-950/95 px-4 py-3 text-left"
          >
            <Text className="text-sm text-red-100">{actionError}</Text>
          </button>
        </div>
      )}
    </MiniAppShell>
  );
}
