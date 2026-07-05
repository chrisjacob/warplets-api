import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import sdk from "@farcaster/miniapp-sdk";
import { Text } from "@neynar/ui/typography";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
  MiniAppHeader,
  MiniAppMenuPage,
  getHeaderTitle,
  useMiniAppChrome,
} from "./miniAppChrome.tsx";
import MiniAppShell from "./MiniAppShell";
import {
  hapticPrimaryTap,
  hapticSelectionChanged,
  hapticSuccess,
  hapticTap,
} from "./haptics";

const DB_URL = "/db/warplets.v1.fts.sqlite.br";
const PAGE_SIZE = 20;
const SEARCH_RESULT_LIMIT = 10000;
const DB_FILENAME = "/warplets-search.sqlite3";
const SEARCH_DEBOUNCE_MS = 300;
const STATUS_LINE_CLASS = "text-center text-xs uppercase leading-4";
const OPENSEA_COLLECTION_URL = "https://opensea.io/collection/10xwarplets";
const MARKET_CACHE_KEY = "warplets-market-state-v2";
const MARKET_SNAPSHOT_STALE_MS = 10 * 60 * 1000;
const MARKET_DETAIL_STALE_MS = 30 * 60 * 1000;
const MARKET_CACHE_MAX_STALE_MS = 60 * 60 * 1000;
const BASE_WETH_TOKEN_ADDRESS = "0x4200000000000000000000000000000000000006";
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";
const EXAMPLE_SEARCHES = [
  "Wizard Hat",
  "Pink Bunny",
  "Sharp Teeth",
  "Wide Eyes",
  "Open Mouth",
  "Pink Tongue",
  "Wide Mouth",
  '"Purple Background"',
  '"Black Background"',
  '"Grey Background"',
  '"Light Blue Background"',
  '"Blue Background"',
  '"Teal Background"',
  '"Orange Background"',
  '"Pink Background"',
  '"Red Background"',
  '"White Background"',
  '"Dark Blue Background"',
  '"Dark Grey Background"',
  '"Green Background"',
  '"Yellow Background"',
  '"Brown Background"',
  "Solid Purple",
  "Solid Black",
  "Solid Blue",
  "Solid Teal",
  "Solid Orange",
  "Solid Red",
  "Solid Grey",
  "Sunglasses",
  "Round Glasses",
  "Black Sunglasses",
  "Black T-Shirt",
  "White T-Shirt",
  "Collared Shirt",
  "Baseball Cap",
  "Backward Cap",
  "Cigarette",
  "Lit Cigarette",
  "Fangs",
  "Toothy Grin",
  "Wide Grin",
  "Gaping Mouth",
  "Huge Open Mouth",
  "Wide Open Mouth",
  "Closed Eyes",
  "Droopy Eyes",
  "Glowing Eyes",
  "Bulging Eyes",
  "Half-Closed Eyes",
  "Winking Eye",
  "Heavy-Lidded Eyes",
  "Furrowed Brows",
  "Dark Eye Circles",
  "Grumpy Expression",
  "Excited Expression",
  "Mischievous Expression",
  "Neutral Expression",
  "Smiling Expression",
  "Subtle Smile",
  "Chill Vibe",
  "Playful Monster",
  "Cartoon Monster",
  "Cartoon Creature",
  "Playful Creature",
  "Bumpy Skin",
  "Textured Skin",
  "Purple Skin",
  "Green Skin",
  "Blue Skin",
  "Brown Skin",
  "Dark Grey Skin",
  "Pink Skin",
  "Green Bumpy Skin",
  "Pointed Ears",
  "Clawed Feet",
  "Clawed Hands",
  "Small Clawed Feet",
  "Small Clawed Hands",
  "Small Black Pupils",
  "Black Pupils",
  "Wide White Eyes",
  "Large White Eyes",
  "Large Wide Eyes",
  "Sharp White Teeth",
  "Sharp Pointed Teeth",
  "Downturned Mouth",
  "Closed Mouth",
  "Smiling Mouth",
  "Black Suit Jacket",
  "Black Hoodie",
  "White Collared Shirt",
  "Rainbow",
  "Neon Green",
  "Hot Pink",
  "Red",
  "Blue",
  "Green",
  "Yellow",
  "Orange",
  "Purple",
  "Pink",
  "Black",
  "White",
  "Grey",
  "Brown",
  "Gold",
  "Silver",
  "Teal",
  "Neon",
  "Hot",
  "Dog",
  "Cat",
  "Robot",
  "Bunny",
  "Rabbit",
  "Bird",
  "Frog",
  "Bear",
  "Alien",
  "Wizard",
  "Dragon",
  "Fish",
  "Duck",
  "Monkey",
  "Happy",
  "Sad",
  "Angry",
  "Grumpy",
  "Excited",
  "Sleepy",
  "Chill",
  "Cool",
  "Playful",
  "Mischievous",
  "Dapper",
  "Neutral",
  "Smiling",
  "Winking",
  "Serious",
  "Intense",
  "Surprised",
  "Confident",
  "Hat",
  "Cap",
  "Beanie",
  "Helmet",
  "Hoodie",
  "Shirt",
  "Jacket",
  "Suit",
  "Tie",
  "Glasses",
  "Lit",
  "Coffee",
  "Crown",
  "Hood",
  "Collar",
  "Monster",
  "Bumpy",
  "Textured",
  "Hair",
  "Smoke",
  "Vibrant",
  "Sharp",
  "Striking",
  "Pointed",
  "Sports",
  "Standout",
  "Expressive",
  "Dressed",
  "Bold",
  "Stylish",
  "Revealing",
  "Sleek",
  "Iconic",
  "Massive",
  "Captivating",
  "Clawed",
  "Eye-catching",
  "Pattern",
  "Simple",
  "Crisp",
  "Glowing",
  "Formidable",
  "Bright",
  "Cartoon",
  "Wild",
  "Demeanor",
  "Memorable",
  "Tone",
  "Energy",
  "Gaping",
  "Energetic",
  "Impressive",
  "Classic",
  "Aesthetic",
  "Closed",
  "Aura",
  "Rare",
  "Casual",
  "Powerful",
  "Sporting",
  "Collared",
  "Stripes",
  "Personality",
  "Charming",
  "Mysterious",
  "Lumpy",
  "Wide-Set Eyes",
  "Unimpressed",
  "Wide-Open White Eyes",
  "Furrowed Brow",
  "Furry Body",
  "Goggles",
  "Straight Mouth",
  "Closed-Mouth Smile",
  "White Fur",
  "Blue Eyes",
  "Warrior",
  "Lumpy Skin Texture",
  "Brown Spots",
  "Red Tongue",
  "Headphones",
  "Yellow Eyes",
  "Formal Attire",
  "Sleepy Expression",
  "Top Hat",
  "Sharp Fangs",
  "Gold Trim",
  "Streetwear",
  "Curious Expression",
  "Cat Ears",
  "Black Baseball Cap",
  "Playful Expression",
  "Grey Bumpy Skin",
  "Cool Vibe",
  "Bumpy Texture",
  "Mottled Skin",
  "Striped Body",
  "Grey Hoodie",
  "Menacing Expression",
  "Purple Monster",
  "Tired Eyes",
  "Neutral Mouth",
  "Gentle Smile",
  "Blue T-Shirt",
  "Blue Hoodie",
  "Large Eyes",
  "Fedora Hat",
  "Plain White Background",
  "Light Green Background",
  "Wide-Eyed Monster",
  "Cat-Like Ears",
  "Black Glasses",
  "Round Sunglasses",
  "Fierce Expression",
  "Short Sleeves",
  "Bow Tie",
  "Dark Purple Background",
  "Cracked Skin",
  "Smartphone",
  "Happy Expression",
  "Black Jacket",
  "Dark Grey Hoodie",
  "Gold Chain",
  "Small Pupils",
  "Striped Fur",
  "Plain Background",
  "Small Fangs",
  "Stoic Expression",
  "Startled Expression",
  "Long Pink Tongue",
  "Hood Up",
  "Light Blue Skin",
  "Front Pouch Pocket",
  "Silver Zipper",
  "Smooth Skin",
  "Wide-Eyed Creature",
  "Heavy Eyelids",
  "Black Top Hat",
  "Goofy Expression",
  "Smug Expression",
  "Speckled Skin",
  "Street Style",
  "Red Skin",
  "Gold Crown",
  "Straight Line Mouth",
  "Glowing Red Eyes",
  "Manic Expression",
  "White Dress Shirt",
  "Casual Outfit",
  "Blue Baseball Cap",
  "Orange Spots",
  "Hooded Cloak",
  "Green Frog",
  "Big Eyes",
  "Beige Skin",
  "Unique Skin",
  "White Hoodie",
  "Blue Shirt",
  "Red Tie",
  "Scaly Skin",
  "Droopy Eyelids",
  "Flat Mouth",
  "Gold Buttons",
  "Worried Expression",
  "Dapper Monster",
  "Pink Inner Ears",
  "Reddish-Brown Skin",
  "Backward Baseball Cap",
  "Straw Hat",
  "Wide Bulging Eyes",
  "White Collar",
  "Suit Jacket",
  "Light Beige Skin",
  "Round Black-Rimmed Glasses",
  "Large Round Eyes",
  "Relaxed Expression",
  "Formal Wear",
  "Quirky Monster",
  "Black Tank Top",
  "Black Shirt",
  "Whiskers",
  "Small Smile",
  "Grey T-Shirt",
  "Sharp Teeth Monster",
  "Furry Monster",
  "Cartoon Character",
  "Goofy Monster",
  "Pink Tongue With Teeth",
  "Huge Gaping Mouth",
  "Squinted Eyes",
  "White Belly",
  "Red Baseball Cap",
  "Light Blue Irises",
  "Edgy",
  "Red Hoodie",
  "Large Bulging Eyes",
  "Stern Expression",
  "Closed Smile",
  "Plaid Shirt",
  "Dark Grey Bumpy Skin",
  "Glowing Blue Eyes",
  "Extremely Wide Open Mouth",
  "Glowing Yellow Eyes",
  "Dark Grey Pants",
  "White Tank Top",
  "Red T-Shirt",
  "White Sclera",
  "Pink Bumpy Tongue",
  "Dark Blue Skin",
  "Sharp-Toothed Creature",
  "Purple Top Hat",
  "Smoking Pipe",
  "Orange Beak",
  "Blue Jeans",
  "Black Beanie",
  "Red Bandana",
  "Yellow T-Shirt",
] as const;

const LEVEL_ATTRIBUTES = [
  { label: "Cast", column: "cast_level", emoji: "✏️" },
  { label: "FID", column: "fid_level", emoji: "⛩️" },
  { label: "Follower", column: "follower_level", emoji: "💞" },
  { label: "Holder", column: "holder_level", emoji: "💎" },
  { label: "Luck", column: "luck_level", emoji: "🍀" },
  { label: "Minter", column: "minter_level", emoji: "✨" },
  { label: "Neynar", column: "neynar_level", emoji: "🪐" },
  { label: "NFT", column: "nft_level", emoji: "🖼️" },
  { label: "Token", column: "token_level", emoji: "🪙" },
  { label: "Volume", column: "volume_level", emoji: "📈" },
] as const;

const LEVEL_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const LEVEL_FILTER_OPTIONS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const DETAIL_FIELDS = [
  { key: "description", label: "Description", column: "description" },
  { key: "10x_level", label: "10X Level", column: "10x_level" },
  { key: "10x_rank", label: "10X Rank", column: "10x_rank" },
  { key: "10x_rarity", label: "10X Rarity", column: "10x_rarity" },
  { key: "cast_level", label: "Cast Level", column: "cast_level" },
  { key: "cast_rank", label: "Cast Rank", column: "cast_rank" },
  { key: "cast_value", label: "Cast Value", column: "cast_value" },
  { key: "fid_level", label: "FID Level", column: "fid_level" },
  { key: "fid_rank", label: "FID Rank", column: "fid_rank" },
  { key: "fid_value", label: "FID Value", column: "fid_value" },
  { key: "follower_level", label: "Follower Level", column: "follower_level" },
  { key: "follower_rank", label: "Follower Rank", column: "follower_rank" },
  { key: "follower_value", label: "Follower Value", column: "follower_value" },
  { key: "holder_level", label: "Holder Level", column: "holder_level" },
  { key: "holder_rank", label: "Holder Rank", column: "holder_rank" },
  { key: "holder_value", label: "Holder Value", column: "holder_value" },
  { key: "luck_level", label: "Luck Level", column: "luck_level" },
  { key: "luck_rank", label: "Luck Rank", column: "luck_rank" },
  { key: "luck_value", label: "Luck Value", column: "luck_value" },
  { key: "minter_level", label: "Minter Level", column: "minter_level" },
  { key: "minter_rank", label: "Minter Rank", column: "minter_rank" },
  { key: "minter_value", label: "Minter Value", column: "minter_value" },
  { key: "neynar_level", label: "Neynar Level", column: "neynar_level" },
  { key: "neynar_rank", label: "Neynar Rank", column: "neynar_rank" },
  { key: "neynar_value", label: "Neynar Value", column: "neynar_value" },
  { key: "nft_level", label: "NFT Level", column: "nft_level" },
  { key: "nft_rank", label: "NFT Rank", column: "nft_rank" },
  { key: "nft_value", label: "NFT Value", column: "nft_value" },
  { key: "token_level", label: "Token Level", column: "token_level" },
  { key: "token_rank", label: "Token Rank", column: "token_rank" },
  { key: "token_value", label: "Token Value", column: "token_value" },
  { key: "volume_level", label: "Volume Level", column: "volume_level" },
  { key: "volume_rank", label: "Volume Rank", column: "volume_rank" },
  { key: "volume_value", label: "Volume Value", column: "volume_value" },
  { key: "warplet_colours", label: "Colours", column: "warplet_colours" },
  { key: "warplet_keywords", label: "Keywords", column: "warplet_keywords" },
  { key: "warplet_traits", label: "Traits", column: "warplet_traits" },
  { key: "warplet_user_is_pro", label: "User Is Pro", column: "warplet_user_is_pro" },
  { key: "warplet_username_farcaster", label: "Farcaster Username", column: "warplet_username_farcaster" },
  { key: "warplet_username_x", label: "X Username", column: "warplet_username_x" },
  { key: "warplet_wallet", label: "Wallet", column: "warplet_wallet" },
] as const;

const ASSET_LINKS = [
  { ext: "gif", label: ".GIF", detail: "500x500 ~5MB" },
  { ext: "mp4", label: ".MP4", detail: "1024x1024 ~2MB" },
  { ext: "avif", label: ".AVIF", detail: "1024x1024 ~0.5MB" },
  { ext: "webp", label: ".WEBP", detail: "1024x1024 ~0.25MB" },
  { ext: "png", label: ".PNG", detail: "1024x1024 ~1MB" },
  { ext: "jpg", label: ".JPG", detail: "256x256 ~0.01MB" },
] as const;

const ATTRIBUTE_GROUPS = [
  {
    label: "10X",
    emoji: "",
    description: "Overall sum of the Level and Rank scores",
    valueLabel: "Rarity",
    level: "10x_level",
    rank: "10x_rank",
    value: "10x_rarity",
  },
  {
    label: "Cast",
    emoji: "✏️",
    description: "Farcaster posts since The Warplets launch",
    valueLabel: "Value",
    level: "cast_level",
    rank: "cast_rank",
    value: "cast_value",
  },
  {
    label: "FID",
    emoji: "⛩️",
    description: "Earlier Farcaster IDs rank higher",
    valueLabel: "Value",
    level: "fid_level",
    rank: "fid_rank",
    value: "fid_value",
  },
  {
    label: "Follower",
    emoji: "💞",
    description: "Farcaster + Twitter followers",
    valueLabel: "Value",
    level: "follower_level",
    rank: "follower_rank",
    value: "follower_value",
  },
  {
    label: "Holder",
    emoji: "💎",
    description: "Number of The Warplets held",
    valueLabel: "Value",
    level: "holder_level",
    rank: "holder_rank",
    value: "holder_value",
  },
  {
    label: "Luck",
    emoji: "🍀",
    description: "A sprinkle of random luck",
    valueLabel: "Value",
    level: "luck_level",
    rank: "luck_rank",
    value: "luck_value",
  },
  {
    label: "Minter",
    emoji: "✨",
    description: "When the original Warplet was minted",
    valueLabel: "Value",
    level: "minter_level",
    rank: "minter_rank",
    value: "minter_value",
  },
  {
    label: "Neynar",
    emoji: "🪐",
    description: "Profile quality & engagement score",
    valueLabel: "Value",
    level: "neynar_level",
    rank: "neynar_rank",
    value: "neynar_value",
  },
  {
    label: "NFT",
    emoji: "🖼️",
    description: "Wallet NFT holdings value",
    valueLabel: "Value",
    level: "nft_level",
    rank: "nft_rank",
    value: "nft_value",
  },
  {
    label: "Token",
    emoji: "🪙",
    description: "Wallet token holdings value",
    valueLabel: "Value",
    level: "token_level",
    rank: "token_rank",
    value: "token_value",
  },
  {
    label: "Volume",
    emoji: "📈",
    description: "Wallet transaction volume value",
    valueLabel: "Value",
    level: "volume_level",
    rank: "volume_rank",
    value: "volume_value",
  },
] as const;

const ATTRIBUTE_LEVEL_SUMMARY = ATTRIBUTE_GROUPS.filter((group) => group.label !== "10X");

const CURRENCY_FIELD_KEYS = new Set(["volume_value", "token_value", "nft_value"]);

type LevelAttributeColumn = (typeof LEVEL_ATTRIBUTES)[number]["column"];

type OrderByOption = "relevance" | "rarity" | "price" | "offer" | "sold" | "recently-listed" | "recently-offered" | "recently-sold" | "rank";
type OrderDirection = "asc" | "desc";

type MarketMoney = {
  eth: number | null;
  at: string | null;
  rawAmount?: string | null;
  decimals?: number | null;
  currencySymbol?: string | null;
  tokenAddress?: string | null;
};

type MarketSnapshot = {
  version: "opensea-market-v1";
  generatedAt: string;
  maxAgeSeconds: number;
  listings: Record<string, MarketMoney & { orderHash?: string | null; seller?: string | null }>;
  offers: Record<string, MarketMoney & { orderHash?: string | null; offerer?: string | null }>;
  sales: Record<string, MarketMoney & { txHash?: string | null; seller?: string | null }>;
  owners: Record<string, {
    wallet: string | null;
    fid: number | null;
    checkedAt: string | null;
    username?: string | null;
    displayName?: string | null;
    pfpUrl?: string | null;
    bio?: string | null;
    followerCount?: number | null;
    followingCount?: number | null;
  }>;
};

type TokenMarketState = {
  listing?: MarketSnapshot["listings"][string];
  offer?: MarketSnapshot["offers"][string];
  sale?: MarketSnapshot["sales"][string];
  owner?: MarketSnapshot["owners"][string];
};
type MarketKind = "price" | "offer" | "sold";

type WarpletResult = {
  id: number;
  rarityValue: number | null;
  fidValue: number | null;
  description: string;
  colours: string;
  keywords: string;
  traits: string;
  farcasterUsername: string;
  xUsername: string;
  wallet: string;
  rankValues: Partial<Record<LevelAttributeColumn, number | null>>;
  searchScore: number | null;
  searchIndex: number;
};

type WarpletDetails = {
  id: number;
  title: string;
  username: string;
  row: Record<string, unknown>;
};

function cellToString(value: unknown): string {
  return value == null ? "" : String(value);
}

function cellToNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type SqliteDatabase = InstanceType<
  Awaited<ReturnType<typeof sqlite3InitModule>>["oo1"]["DB"]
>;

type SqlClause = {
  sql: string;
  bind: number[];
};

type SearchFilterOverride = {
  attributes: LevelAttributeColumn[];
  levels: number[];
};

type SearchUrlState = {
  search: string;
  attributes: LevelAttributeColumn[];
  levels: number[];
  random: string;
  warplet: number | null;
  first: number | null;
  order: OrderByOption | null;
  dir: OrderDirection | null;
};

type MiniAppHistoryStateWithSearch = {
  searchUrl?: {
    signature: string;
  };
};

const EMPTY_SEARCH_URL_STATE: SearchUrlState = {
  search: "",
  attributes: [],
  levels: [],
  random: "",
  warplet: null,
  first: null,
  order: null,
  dir: null,
};

const ATTRIBUTE_PARAM_LOOKUP = new Map<string, LevelAttributeColumn>(
  LEVEL_ATTRIBUTES.flatMap((attribute) => [
    [attribute.column.toLowerCase(), attribute.column],
    [attribute.label.toLowerCase(), attribute.column],
  ]),
);
const ATTRIBUTE_RANK_SELECT = LEVEL_ATTRIBUTES.map((attribute) => `w."${getRankColumnForLevelAttribute(attribute.column)}"`).join(",\n             ");
const RESULT_SELECT_COLUMNS = `w.id,
             w."10x_rarity",
             w.fid_value,
             w.description,
             w.warplet_colours,
             w.warplet_keywords,
             w.warplet_traits,
             w.warplet_username_farcaster,
             w.warplet_username_x,
             w.warplet_wallet,
             ${ATTRIBUTE_RANK_SELECT}`;

function getRandomExampleSearch(current?: string): string {
  let next = current;
  while (!next || next === current) {
    next = EXAMPLE_SEARCHES[Math.floor(Math.random() * EXAMPLE_SEARCHES.length)];
  }
  return next;
}

function getRandomExampleDisplayLabel(value: string): string {
  const trimmed = value.trim();
  return trimmed.replace(/\s+Warplets?$/i, "").trim() || trimmed;
}

function normalizeFtsQuery(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length > 1) {
    return trimmed
      .slice(1, -1)
      .trim()
      .replace(/["']/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .join("+");
  }

  return value
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/["']/g, "").replace(/\+/g, " "))
    .filter(Boolean)
    .map((term) => `"${term}"*`)
    .join(" ");
}

function mapRows(values: unknown[][], hasSearchScore = false): WarpletResult[] {
  return values.map((row, index) => {
    const rankOffset = 10;
    const scoreOffset = rankOffset + LEVEL_ATTRIBUTES.length;
    const rankValues = LEVEL_ATTRIBUTES.reduce<Partial<Record<LevelAttributeColumn, number | null>>>(
      (current, attribute, attributeIndex) => {
        current[attribute.column] = cellToNumber(row[rankOffset + attributeIndex]);
        return current;
      },
      {},
    );
    return {
      id: cellToNumber(row[0]) ?? 0,
      rarityValue: cellToNumber(row[1]),
      fidValue: cellToNumber(row[2]),
      description: cellToString(row[3]),
      colours: cellToString(row[4]),
      keywords: cellToString(row[5]),
      traits: cellToString(row[6]),
      farcasterUsername: cellToString(row[7]),
      xUsername: cellToString(row[8]),
      wallet: cellToString(row[9]),
      rankValues,
      searchScore: hasSearchScore ? cellToNumber(row[scoreOffset]) : null,
      searchIndex: index,
    };
  });
}

function mapDetails(row: Record<string, unknown> | undefined): WarpletDetails | null {
  if (!row) return null;
  const id = cellToNumber(row.id) ?? 0;
  if (!id) return null;
  const username = cellToString(row.warplet_username_farcaster);
  return {
    id,
    title: `#${id}`,
    username,
    row,
  };
}

function formatInteger(value: unknown): string {
  const number = cellToNumber(value);
  return number == null ? cellToString(value) || "-" : Math.round(number).toLocaleString("en-US");
}

function formatCompactCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value < 10000 ? 1 : 0,
  }).format(value);
}

function formatShortWallet(value: string | null | undefined): string {
  const wallet = value?.trim();
  if (!wallet) return "-";
  return wallet.length > 13 ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : wallet;
}

function getFirstBioLine(value: string | null | undefined): string {
  const firstLine = value?.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine ?? "";
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength).trimEnd()}...` : value;
}

function formatCurrency(value: unknown): string {
  const number = cellToNumber(value);
  return number == null ? cellToString(value) || "-" : `$${Math.round(number).toLocaleString("en-US")}`;
}

function formatLevel(value: unknown): string {
  const number = cellToNumber(value);
  return number == null ? cellToString(value) || "-" : `${number}X`;
}

function formatDetailValue(key: string, value: unknown): string {
  if (key.endsWith("_level")) return formatLevel(value);
  if (CURRENCY_FIELD_KEYS.has(key)) return formatCurrency(value);
  if (key === "10x_rarity") {
    const formatted = formatInteger(value);
    return formatted === "-" ? formatted : `#${formatted}`;
  }
  if (key === "warplet_user_is_pro") {
    const number = cellToNumber(value);
    if (number === 1) return "Yes";
    if (number === 0) return "No";
  }
  if (key.endsWith("_rank") || key.endsWith("_value")) return formatInteger(value);
  return cellToString(value) || "-";
}

function splitChips(value: unknown): string[] {
  return cellToString(value)
    .split(" | ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildLevelFilter(
  selectedAttributes: LevelAttributeColumn[],
  selectedLevels: number[],
): SqlClause | null {
  if (selectedLevels.length === 0) return null;

  const attributes = selectedAttributes.length > 0
    ? selectedAttributes
    : LEVEL_ATTRIBUTES.map((attribute) => attribute.column);
  const placeholders = selectedLevels.map(() => "?").join(", ");
  return {
    sql: `(${attributes.map((attribute) => `w.${attribute} IN (${placeholders})`).join(" OR ")})`,
    bind: attributes.flatMap(() => selectedLevels),
  };
}

function getRankColumnForLevelAttribute(attribute: LevelAttributeColumn | undefined): string | null {
  return attribute ? attribute.replace(/_level$/, "_rank") : null;
}

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function splitParamValues(value: string | null): string[] {
  return (value ?? "")
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAttributeParam(value: string | null): LevelAttributeColumn[] {
  const next = new Set<LevelAttributeColumn>();
  for (const item of splitParamValues(value)) {
    const attribute = ATTRIBUTE_PARAM_LOOKUP.get(item.toLowerCase());
    if (attribute) next.add(attribute);
  }
  return LEVEL_ATTRIBUTES
    .map((attribute) => attribute.column)
    .filter((attribute) => next.has(attribute));
}

function parseLevelParam(value: string | null): number[] {
  const next = new Set<number>();
  for (const item of splitParamValues(value)) {
    const level = Number(item.replace(/x$/i, ""));
    if (Number.isInteger(level) && LEVEL_OPTIONS.includes(level)) {
      next.add(level);
    }
  }
  return [...next].sort((a, b) => a - b);
}

function parseWarpletParam(value: string | null): number | null {
  const tokenId = Number(value);
  return Number.isInteger(tokenId) && tokenId > 0 ? tokenId : null;
}

function parseOrderParam(value: string | null): OrderByOption | null {
  const normalized = (value ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (["relevance", "rarity", "price", "offer", "sold", "recently-listed", "recently-offered", "recently-sold", "rank"].includes(normalized)) {
    return normalized as OrderByOption;
  }
  return null;
}

function parseOrderDirectionParam(value: string | null): OrderDirection | null {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "asc" || normalized === "desc" ? normalized : null;
}

function parseSearchUrlState(searchParams: URLSearchParams): SearchUrlState {
  const search = (searchParams.get("search") ?? searchParams.get("q") ?? "").trim();
  const attributes = parseAttributeParam(searchParams.get("attributes") ?? searchParams.get("attrs"));
  const levels = parseLevelParam(searchParams.get("levels"));
  const random = (searchParams.get("random") ?? "").trim();
  const warplet = parseWarpletParam(searchParams.get("warplet") ?? searchParams.get("tokenId"));
  const first = parseWarpletParam(searchParams.get("first") ?? searchParams.get("First"));
  const order = parseOrderParam(searchParams.get("order"));
  const dir = parseOrderDirectionParam(searchParams.get("dir"));

  return {
    search,
    attributes,
    levels,
    random,
    warplet,
    first,
    order,
    dir,
  };
}

function serializeSearchUrlState(state: SearchUrlState): string {
  const params = new URLSearchParams();
  const search = state.search.trim();
  const random = state.random.trim();

  if (search) {
    params.set("search", search);
  }

  if (state.attributes.length > 0) {
    params.set("attributes", state.attributes.join(","));
  }

  if (state.levels.length > 0) {
    params.set("levels", state.levels.join(","));
  }

  if (!search && state.attributes.length === 0 && state.levels.length === 0 && random) {
    params.set("random", random);
  }

  if (state.warplet != null) {
    params.set("warplet", String(state.warplet));
  }

  if (state.first != null) {
    params.set("first", String(state.first));
  }

  if (state.order) {
    params.set("order", state.order);
    params.set("dir", state.dir ?? "asc");
  }

  return params.toString();
}

function buildSearchUrl(state: SearchUrlState): string {
  const url = new URL(window.location.href);
  const serialized = serializeSearchUrlState(state);
  url.search = serialized ? `?${serialized}` : "";
  return `${url.pathname}${url.search}${url.hash}`;
}

function buildSearchHref(state: SearchUrlState): string {
  return new URL(buildSearchUrl(state), window.location.origin).href;
}

function getSearchUrlSignature(state: SearchUrlState): string {
  return serializeSearchUrlState(state);
}

function hasDeepLinkState(state: SearchUrlState): boolean {
  return Boolean(
    state.search ||
    state.attributes.length > 0 ||
    state.levels.length > 0 ||
    state.random ||
    state.warplet != null ||
    state.first != null ||
    state.order != null,
  );
}

function getEffectiveSearchText(state: SearchUrlState): string {
  if (state.search) return state.search;
  if (state.levels.length > 0) return "";
  if (state.attributes.length > 0) return "";
  return state.random;
}

function getSearchUrlStateFromAppState({
  query,
  isAllWarpletsMode,
  selectedAttributes,
  selectedLevels,
  activeExampleSearch,
  selectedWarpletDetails,
  orderBy,
  orderDirection,
  userSelectedOrder,
}: {
  query: string;
  isAllWarpletsMode: boolean;
  selectedAttributes: LevelAttributeColumn[];
  selectedLevels: number[];
  activeExampleSearch: string;
  selectedWarpletDetails: WarpletDetails | null;
  orderBy: OrderByOption;
  orderDirection: OrderDirection;
  userSelectedOrder: boolean;
}): SearchUrlState {
  const search = query.trim();
  const hasFilters = selectedAttributes.length > 0 || selectedLevels.length > 0;
  const urlSearch = isAllWarpletsMode && !search ? "*" : search;
  return {
    search: urlSearch,
    attributes: selectedAttributes,
    levels: selectedLevels,
    random: urlSearch || hasFilters ? "" : activeExampleSearch,
    warplet: selectedWarpletDetails?.id ?? null,
    first: null,
    order: userSelectedOrder ? orderBy : null,
    dir: userSelectedOrder ? orderDirection : null,
  };
}

function appendSearchShareParams(href: string, firstWarpletId: number, totalCount: number): string {
  const url = new URL(href);
  url.searchParams.set("first", String(firstWarpletId));
  url.searchParams.set("count", String(totalCount));
  return url.href;
}

const ORDER_OPTIONS: Array<{ value: OrderByOption; label: string }> = [
  { value: "relevance", label: "Relevance" },
  { value: "rarity", label: "Rarity" },
  { value: "price", label: "Price" },
  { value: "offer", label: "Offer" },
  { value: "sold", label: "Sold" },
  { value: "recently-listed", label: "Recently listed" },
  { value: "recently-offered", label: "Recently offered" },
  { value: "recently-sold", label: "Recently sold" },
  { value: "rank", label: "Rank" },
];

function getDefaultOrderBy(hasFtsQuery: boolean, selectedAttributes: LevelAttributeColumn[]): OrderByOption {
  if (hasFtsQuery) return "relevance";
  if (selectedAttributes.length === 1) return "rank";
  return "rarity";
}

function getOrderLabel(orderBy: OrderByOption, direction: OrderDirection): string {
  const label = ORDER_OPTIONS.find((option) => option.value === orderBy)?.label ?? "Rarity";
  return `${label} ${direction.toUpperCase()}`;
}

function getOrderMarketKind(orderBy: OrderByOption): MarketKind | null {
  if (orderBy === "price" || orderBy === "recently-listed") return "price";
  if (orderBy === "offer" || orderBy === "recently-offered") return "offer";
  if (orderBy === "sold" || orderBy === "recently-sold") return "sold";
  return null;
}

function getMarketKindStyles(kind: MarketKind): {
  color: string;
  previewColor: string;
  backgroundColor: string;
  borderColor: string;
} {
  if (kind === "price") {
    return {
      color: "#FFFF00",
      previewColor: "#e6e68a",
      backgroundColor: "rgba(255, 255, 0, 0.12)",
      borderColor: "rgba(255, 255, 0, 0.42)",
    };
  }
  if (kind === "offer") {
    return {
      color: "#33AAFF",
      previewColor: "#8bcfff",
      backgroundColor: "rgba(51, 170, 255, 0.12)",
      borderColor: "rgba(51, 170, 255, 0.42)",
    };
  }
  return {
    color: "#FF4040",
    previewColor: "#ff9a9a",
    backgroundColor: "rgba(255, 64, 64, 0.12)",
    borderColor: "rgba(255, 64, 64, 0.42)",
  };
}

function OrderDirectionIcon({
  direction,
}: {
  direction: OrderDirection;
}) {
  return (
    <svg
      aria-label={direction === "asc" ? "Ascending" : "Descending"}
      role="img"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction === "asc" ? (
        <path d="M8 3v10M4 7l4-4 4 4" />
      ) : (
        <path d="M8 3v10M4 9l4 4 4-4" />
      )}
    </svg>
  );
}

function OrderValueLabel({
  orderBy,
  direction,
  tone = "normal",
}: {
  orderBy: OrderByOption;
  direction: OrderDirection;
  tone?: "normal" | "preview";
}) {
  const label = ORDER_OPTIONS.find((option) => option.value === orderBy)?.label ?? "Rarity";
  const marketKind = getOrderMarketKind(orderBy);
  const marketStyles = marketKind ? getMarketKindStyles(marketKind) : undefined;
  const color = marketStyles ? (tone === "preview" ? marketStyles.previewColor : marketStyles.color) : undefined;
  return (
    <span className="inline-flex min-w-0 items-center gap-1" style={color ? { color } : undefined}>
      <span className="truncate">{label}</span>
      <OrderDirectionIcon direction={direction} />
    </span>
  );
}

function getMarketState(snapshot: MarketSnapshot | null, tokenId: number): TokenMarketState {
  const key = String(tokenId);
  return {
    listing: snapshot?.listings[key],
    offer: snapshot?.offers[key],
    sale: snapshot?.sales[key],
    owner: snapshot?.owners[key],
  };
}

function getOwnedTokenIds(snapshot: MarketSnapshot | null, ownerWallet: string | null | undefined, currentTokenId: number): number[] {
  const normalizedWallet = ownerWallet?.trim().toLowerCase();
  if (!normalizedWallet) return [currentTokenId];
  const tokenIds = Object.entries(snapshot?.owners ?? {})
    .filter(([, owner]) => owner.wallet?.trim().toLowerCase() === normalizedWallet)
    .map(([tokenId]) => Number(tokenId))
    .filter((tokenId) => Number.isInteger(tokenId) && tokenId > 0)
    .sort((a, b) => a - b);
  return Array.from(new Set([currentTokenId, ...tokenIds]));
}

function mergeTokenSnapshot(current: MarketSnapshot | null, tokenSnapshot: MarketSnapshot, tokenId: number): MarketSnapshot {
  const generatedAt = tokenSnapshot.generatedAt || new Date().toISOString();
  const key = String(tokenId);
  const listings = { ...(current?.listings ?? {}) };
  const offers = { ...(current?.offers ?? {}) };
  const sales = { ...(current?.sales ?? {}) };
  const owners = { ...(current?.owners ?? {}) };
  delete listings[key];
  delete offers[key];
  delete sales[key];
  delete owners[key];
  return {
    version: "opensea-market-v1",
    generatedAt,
    maxAgeSeconds: tokenSnapshot.maxAgeSeconds || 600,
    listings: { ...listings, ...tokenSnapshot.listings },
    offers: { ...offers, ...tokenSnapshot.offers },
    sales: { ...sales, ...tokenSnapshot.sales },
    owners: { ...owners, ...tokenSnapshot.owners },
  };
}

function readCachedMarketSnapshot(): MarketSnapshot | null {
  try {
    const raw = window.localStorage.getItem(MARKET_CACHE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as MarketSnapshot;
    const age = Date.now() - Date.parse(snapshot.generatedAt || "");
    if (!Number.isFinite(age) || age > MARKET_CACHE_MAX_STALE_MS) return null;
    return snapshot;
  } catch {
    return null;
  }
}

function writeCachedMarketSnapshot(snapshot: MarketSnapshot): void {
  try {
    window.localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // The market snapshot is a speed cache only; quota failures are harmless.
  }
}

function formatEthValue(value: MarketMoney | undefined): string {
  if (!value || value.eth == null) return "-";
  return `${value.eth.toLocaleString("en-US", { maximumFractionDigits: 4 })} \u039e`;
}

function isEthLikeMarketMoney(value: MarketMoney | undefined): boolean {
  if (!value) return false;
  const symbol = value.currencySymbol?.toUpperCase() ?? "";
  const tokenAddress = value.tokenAddress?.toLowerCase() ?? null;
  if (symbol === "ETH" || symbol === "WETH") return true;
  if (tokenAddress === BASE_WETH_TOKEN_ADDRESS || tokenAddress === NATIVE_TOKEN_ADDRESS) return true;
  return !symbol && !tokenAddress && value.decimals === 18;
}

function formatEthNumber(value: number): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 4 })} \u039e`;
}

function getFormattedRawMarketParts(value: MarketMoney): {
  formatted: string;
  parsed: number | null;
} | null {
  if (!value.rawAmount || value.decimals == null) return null;
  try {
    const raw = BigInt(value.rawAmount);
    const decimals = Math.max(0, value.decimals);
    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const fraction = raw % divisor;
    const fractionText = decimals > 0
      ? fraction.toString().padStart(decimals, "0").replace(/0+$/, "")
      : "";
    const numeric = fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
    const parsed = Number(numeric);
    const formatted = Number.isFinite(parsed)
      ? parsed.toLocaleString("en-US", { maximumFractionDigits: 6 })
      : numeric;
    return { formatted, parsed: Number.isFinite(parsed) ? parsed : null };
  } catch {
    return null;
  }
}

function formatRawMarketValue(value: MarketMoney | undefined): string {
  if (!value) return "-";
  const parts = getFormattedRawMarketParts(value);
  if (!parts) return "-";
  const symbol = value.currencySymbol?.toUpperCase() ?? "";
  if (symbol === "USDC" || symbol === "USDBC") return `$${parts.formatted}`;
  return `${parts.formatted} ${value.currencySymbol ?? "RAW"}`;
}

function getRawMarketNumber(value: MarketMoney | undefined): number | null {
  if (!value) return null;
  return getFormattedRawMarketParts(value)?.parsed ?? null;
}

function getMarketNumber(value: MarketMoney | undefined): number | null {
  if (!value) return null;
  if (value.eth != null) return value.eth;
  if (isEthLikeMarketMoney(value)) return getRawMarketNumber(value);
  return getRawMarketNumber(value);
}

function formatMarketValue(value: MarketMoney | undefined): string {
  if (!value) return "-";
  if (value.eth != null) return formatEthValue(value);
  if (isEthLikeMarketMoney(value)) {
    const rawEth = getRawMarketNumber(value);
    return rawEth == null ? "-" : formatEthNumber(rawEth);
  }
  return formatRawMarketValue(value);
}

function hasMarketValue(value: MarketMoney | undefined): boolean {
  return Boolean(value && (value.eth != null || getRawMarketNumber(value) != null));
}

function formatMarketTimestamp(value: string | null | undefined): string {
  if (!value) return "-";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function getMarketUpdatedAt(market: TokenMarketState): string | null {
  const timestamps = [
    market.listing?.at,
    market.offer?.at,
    market.sale?.at,
    market.owner?.checkedAt,
  ]
    .map((value) => (value ? Date.parse(value) : NaN))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function getSortValue(
  warplet: WarpletResult,
  orderBy: OrderByOption,
  snapshot: MarketSnapshot | null,
  rankAttribute: LevelAttributeColumn | undefined,
): number | null {
  const market = getMarketState(snapshot, warplet.id);
  if (orderBy === "relevance") return warplet.searchScore ?? warplet.searchIndex;
  if (orderBy === "rarity") return warplet.id;
  if (orderBy === "rank") return rankAttribute ? warplet.rankValues[rankAttribute] ?? null : null;
  if (orderBy === "price") return getMarketNumber(market.listing);
  if (orderBy === "offer") return getMarketNumber(market.offer);
  if (orderBy === "sold") return getMarketNumber(market.sale);
  if (orderBy === "recently-listed") return market.listing?.at ? Date.parse(market.listing.at) : null;
  if (orderBy === "recently-offered") return market.offer?.at ? Date.parse(market.offer.at) : null;
  if (orderBy === "recently-sold") return market.sale?.at ? Date.parse(market.sale.at) : null;
  return null;
}

function getMarketTieBreakTimestamp(
  warplet: WarpletResult,
  orderBy: OrderByOption,
  snapshot: MarketSnapshot | null,
): number | null {
  if (orderBy !== "price" && orderBy !== "offer" && orderBy !== "sold") return null;
  const market = getMarketState(snapshot, warplet.id);
  const timestamp =
    orderBy === "price"
      ? market.listing?.at
      : orderBy === "offer"
        ? market.offer?.at
        : market.sale?.at;
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function sortWarplets(
  warplets: WarpletResult[],
  orderBy: OrderByOption,
  direction: OrderDirection,
  snapshot: MarketSnapshot | null,
  rankAttribute: LevelAttributeColumn | undefined,
): WarpletResult[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...warplets].sort((a, b) => {
    const aValue = getSortValue(a, orderBy, snapshot, rankAttribute);
    const bValue = getSortValue(b, orderBy, snapshot, rankAttribute);
    const aMissing = aValue == null || !Number.isFinite(aValue);
    const bMissing = bValue == null || !Number.isFinite(bValue);
    if (aMissing && bMissing) return a.searchIndex - b.searchIndex || a.id - b.id;
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (aValue !== bValue) return (aValue - bValue) * multiplier;
    const aTimestamp = getMarketTieBreakTimestamp(a, orderBy, snapshot);
    const bTimestamp = getMarketTieBreakTimestamp(b, orderBy, snapshot);
    const aTimestampMissing = aTimestamp == null || !Number.isFinite(aTimestamp);
    const bTimestampMissing = bTimestamp == null || !Number.isFinite(bTimestamp);
    if (!aTimestampMissing || !bTimestampMissing) {
      if (aTimestampMissing) return 1;
      if (bTimestampMissing) return -1;
      if (aTimestamp !== bTimestamp) return bTimestamp - aTimestamp;
    }
    return a.id - b.id;
  });
}

function FilterDropdown({
  label,
  valueLabel,
  children,
}: {
  label: string;
  valueLabel: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative flex-1">
      <button
        type="button"
        onClick={() => {
          void hapticTap();
          setIsOpen((current) => !current);
        }}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between rounded-xl border border-[#00FF00]/25 bg-black/70 px-3 py-2 text-left text-sm text-[#00FF00]"
      >
        <span>{label}</span>
        <span className="ml-2 truncate text-xs text-[#8bbf8b]">
          {valueLabel}
        </span>
      </button>
      {isOpen && (
        <div
          className="absolute left-0 right-0 z-30 mt-2 overflow-visible rounded-xl border border-[#00FF00]/30 bg-black p-2 shadow-2xl"
          onChange={(event) => {
            if (event.target instanceof HTMLInputElement && event.target.type === "checkbox") {
              void hapticSelectionChanged();
              window.setTimeout(() => setIsOpen(false), 0);
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function OrderByDropdown({
  orderBy,
  orderDirection,
  selectedAttributes,
  onSelect,
}: {
  orderBy: OrderByOption;
  orderDirection: OrderDirection;
  selectedAttributes: LevelAttributeColumn[];
  onSelect: (orderBy: OrderByOption) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const options = ORDER_OPTIONS.filter((option) => option.value !== "rank" || selectedAttributes.length === 1)
    .sort((a, b) => {
      if (a.value === "rank") return -1;
      if (b.value === "rank") return 1;
      return 0;
    });

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => {
          void hapticTap();
          setIsOpen((current) => !current);
        }}
        className="flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-between rounded-xl border border-[#00FF00]/25 bg-black/70 px-3 py-2 text-left text-sm text-[#00FF00]"
      >
        <span className="truncate">Order</span>
        <span className="ml-2 min-w-0 text-xs text-[#8bbf8b]">
          <OrderValueLabel orderBy={orderBy} direction={orderDirection} tone="preview" />
        </span>
      </button>
      {isOpen && (
        <div className="absolute left-0 right-0 z-30 mt-2 rounded-xl border border-[#00FF00]/30 bg-black p-2 shadow-2xl">
          {options.map((option) => {
            const active = option.value === orderBy;
            const marketKind = getOrderMarketKind(option.value);
            const marketStyles = marketKind ? getMarketKindStyles(marketKind) : undefined;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  void hapticSelectionChanged();
                  onSelect(option.value);
                  setIsOpen(false);
                }}
                className={`flex w-full cursor-pointer items-center justify-between rounded-lg border px-2 py-2 text-left text-xs ${
                  active ? "font-bold" : "hover:bg-[#041204]"
                }`}
                style={marketStyles
                  ? {
                    backgroundColor: active ? marketStyles.backgroundColor : "transparent",
                    borderColor: active ? marketStyles.borderColor : "transparent",
                    color: marketStyles.color,
                  }
                  : {
                    backgroundColor: active ? "rgba(0, 255, 0, 0.12)" : "transparent",
                    borderColor: active ? "rgba(0, 255, 0, 0.42)" : "transparent",
                    color: "#00FF00",
                  }}
              >
                {active ? (
                  <OrderValueLabel orderBy={option.value} direction={orderDirection} />
                ) : (
                  <span>{option.label}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AttributeTooltip({
  emoji,
  label,
  description,
}: {
  emoji: string;
  label: string;
  description: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const hover = useHover(context, { delay: { open: 0, close: 60 }, move: false });
  const focus = useFocus(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, role]);

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps({
          tabIndex: 0,
          "aria-label": `${label}: ${description}`,
          className: "inline-flex cursor-help items-center justify-center rounded-md px-1 outline-none focus:ring-1 focus:ring-[#00FF00]/70",
        })}
      >
        {emoji}
      </span>
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps({
              className: "z-[70] max-w-[min(92vw,520px)] whitespace-nowrap rounded-lg border border-[#00FF00]/40 bg-black px-3 py-2 text-[11px] leading-snug text-[#8bbf8b] shadow-2xl",
            })}
          >
            <span className="font-bold text-[#00FF00]">{label}</span>
            <span> — {description}</span>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

function ValueTooltip({
  value,
}: {
  value: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const hover = useHover(context, { delay: { open: 0, close: 60 }, move: false });
  const focus = useFocus(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, role]);

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps({
          tabIndex: 0,
          "aria-label": value,
          className: "mt-1 block max-w-full cursor-help truncate text-xs font-bold text-[#00FF00] outline-none focus:ring-1 focus:ring-[#00FF00]/70",
        })}
      >
        {value}
      </span>
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps({
              className: "z-[70] max-w-[min(92vw,520px)] whitespace-nowrap rounded-lg border border-[#00FF00]/40 bg-black px-3 py-2 text-[11px] leading-snug text-[#00FF00] shadow-2xl",
            })}
          >
            {value}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

function MarketValueChip({
  kind,
  value,
  tooltip,
  className = "",
  variant = "pill",
  showTooltip = true,
  align = "center",
}: {
  kind: MarketKind;
  value: string;
  tooltip: string;
  className?: string;
  variant?: "pill" | "column";
  showTooltip?: boolean;
  align?: "center" | "left";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const styles = getMarketKindStyles(kind);
  const isColumn = variant === "column";
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const hover = useHover(context, { delay: { open: 0, close: 60 }, move: false });
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions(showTooltip ? [hover, role] : []);

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps({
          "aria-label": showTooltip ? tooltip : undefined,
          className: `inline-flex min-w-0 ${showTooltip ? "cursor-help" : "cursor-default"} items-center ${
            align === "left" ? "justify-start text-left" : "justify-center text-center"
          } border font-bold leading-none ${
            isColumn ? "min-h-[24px] rounded-none border-y-0 border-l-0 px-1 py-1" : "rounded-md px-1.5 py-1"
          } ${className}`,
          style: styles,
        })}
      >
        <span className="truncate">{value}</span>
      </span>
      {showTooltip && isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              borderColor: styles.borderColor,
              color: styles.color,
            }}
            {...getFloatingProps({
              className: "z-[70] max-w-[min(92vw,520px)] whitespace-nowrap rounded-lg border bg-black px-3 py-2 text-[11px] font-bold leading-snug shadow-2xl",
            })}
          >
            {tooltip}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

function getLevelFilterTarget(
  group: (typeof ATTRIBUTE_GROUPS)[number],
  row: Record<string, unknown>,
): { attribute: LevelAttributeColumn; level: number } | null {
  if (group.label === "10X") return null;
  const level = cellToNumber(row[group.level]);
  if (level == null || !LEVEL_OPTIONS.includes(level)) return null;
  return {
    attribute: group.level as LevelAttributeColumn,
    level,
  };
}

function getWarpletImageUrl(tokenId: number): string {
  return `https://warplets.10x.meme/${tokenId}.jpg`;
}

function getWarpletAssetUrl(tokenId: number, extension: string): string {
  return `https://warplets.10x.meme/${tokenId}.${extension}`;
}

function getOpenSeaUrl(tokenId: number): string {
  return `https://opensea.io/item/base/0x780446dd12e080ae0db762fcd4daf313f3e359de/${tokenId}`;
}

function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;
  });
}

async function preloadResultImages(results: WarpletResult[]): Promise<void> {
  await Promise.all(results.map((result) => preloadImage(getWarpletImageUrl(result.id))));
}

async function openExternalAsset(url: string) {
  try {
    await sdk.actions.openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function WarpletCard({
  warplet,
  onOpen,
  labelOverride,
  market,
}: {
  warplet: WarpletResult;
  onOpen: (tokenId: number) => void;
  labelOverride?: string;
  market?: TokenMarketState;
}) {
  const label = labelOverride ?? `#${warplet.id} ${warplet.farcasterUsername ? `@${warplet.farcasterUsername}` : warplet.wallet}`;

  return (
    <button
      type="button"
      onClick={() => {
        void hapticPrimaryTap();
        onOpen(warplet.id);
      }}
      className="flex w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-[18px] border border-[#00FF00]/25 bg-[#041204]/90 p-0 text-left transition hover:-translate-y-px hover:border-[#00FF00]/50 hover:bg-[#071807]/95"
    >
      <img
        src={getWarpletImageUrl(warplet.id)}
        alt=""
        loading="eager"
        className="aspect-square w-full bg-[rgba(0,255,0,0.12)] object-cover"
      />
      <span className="flex min-h-[38px] w-full min-w-0 items-center justify-center bg-[#00FF00] px-2 py-1.5 text-center text-[0.76rem] font-bold text-[rgb(0,80,0)]">
        <span className="block max-w-full truncate">{label}</span>
      </span>
      <span className="grid w-full grid-cols-3 border-t border-[#00FF00]/20 bg-black text-center text-[10px]">
        <MarketValueChip kind="price" value={formatMarketValue(market?.listing)} tooltip="Price" variant="column" showTooltip={false} className="w-full" />
        <MarketValueChip kind="offer" value={formatMarketValue(market?.offer)} tooltip="Top Offer" variant="column" showTooltip={false} className="w-full" />
        <MarketValueChip kind="sold" value={formatMarketValue(market?.sale)} tooltip="Latest Sale" variant="column" showTooltip={false} className="w-full border-r-0" />
      </span>
    </button>
  );
}

const OWNED_BY_VISIBLE_AVATAR_LIMIT = 25;

function OwnedByPanel({
  owner,
  currentTokenId,
  ownedTokenIds,
  onOpenWarplet,
}: {
  owner?: TokenMarketState["owner"];
  currentTokenId: number;
  ownedTokenIds: number[];
  onOpenWarplet: (tokenId: number) => void;
}) {
  const wallet = owner?.wallet?.trim() || null;
  const fid = typeof owner?.fid === "number" ? owner.fid : null;
  const username = owner?.username?.trim() || null;
  const displayName = owner?.displayName?.trim() || null;
  const pfpUrl = owner?.pfpUrl?.trim() || null;
  const allWarpletIds = Array.from(new Set([currentTokenId, ...ownedTokenIds])).sort((left, right) => left - right);
  const hasMoreThanVisibleWarplets = allWarpletIds.length > OWNED_BY_VISIBLE_AVATAR_LIMIT;
  const warpletIds = hasMoreThanVisibleWarplets
    ? allWarpletIds.slice(0, OWNED_BY_VISIBLE_AVATAR_LIMIT - 1)
    : allWarpletIds.slice(0, OWNED_BY_VISIBLE_AVATAR_LIMIT);
  const ownedCount = allWarpletIds.length;
  const remainingOwnedCount = ownedCount - (OWNED_BY_VISIBLE_AVATAR_LIMIT - 1);
  const hasFarcasterProfile = Boolean(fid && username);
  const hasFollowerCounts = hasFarcasterProfile && (owner?.followerCount != null || owner?.followingCount != null);

  const handleOpenProfile = () => {
    if (!fid) return;
    void hapticTap();
    sdk.actions.viewProfile({ fid }).catch((error) => {
      console.error("Failed to open owner Farcaster profile:", error);
    });
  };

  const handleOpenWallet = () => {
    if (!wallet) return;
    void hapticTap();
    openExternalAsset(`https://basescan.org/address/${wallet}`).catch((error) => {
      console.error("Failed to open owner wallet:", error);
    });
  };

  if (!wallet && !fid) return null;

  return (
    <div className="rounded-xl border border-[#00FF00]/15 bg-[#041204]/60 p-3">
      <Text className="text-xs font-bold uppercase" style={{ color: "#00FF00" }}>
        Owned by
      </Text>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] gap-2">
        <div className="min-w-0 pt-1">
          {hasFarcasterProfile ? (
          <button
            type="button"
            onClick={handleOpenProfile}
            className="aspect-square w-full min-w-0 shrink-0 cursor-pointer overflow-hidden rounded-full border-2 border-[#00FF00] bg-[rgba(0,255,0,0.12)]"
            title={`View Farcaster profile ${fid}`}
          >
            {pfpUrl ? (
              <img src={pfpUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <video
                src="/matrix_bg_1080x1080.mp4"
                autoPlay
                loop
                muted
                playsInline
                aria-hidden="true"
                className="h-full w-full object-cover"
              />
            )}
          </button>
          ) : (
          <div className="aspect-square w-full min-w-0 shrink-0 overflow-hidden rounded-full border-2 border-[#00FF00] bg-[rgba(0,255,0,0.12)]">
            <video
              src="/matrix_bg_1080x1080.mp4"
              autoPlay
              loop
              muted
              playsInline
              aria-hidden="true"
              className="h-full w-full object-cover"
            />
          </div>
          )}
        </div>

        <div className={`${hasFarcasterProfile ? "" : "col-span-2"} min-w-0 px-2 py-1`}>
          {hasFarcasterProfile ? (
            <button
              type="button"
              onClick={handleOpenProfile}
              className="block max-w-full cursor-pointer truncate text-left text-sm font-bold text-[#00FF00] hover:underline"
            >
              @{username}
            </button>
          ) : wallet ? (
            <button
              type="button"
              onClick={handleOpenWallet}
              className="block max-w-full cursor-pointer truncate text-left text-sm font-bold text-[#00FF00] hover:underline"
            >
              {formatShortWallet(wallet)}
            </button>
          ) : (
            <Text className="truncate text-sm font-bold" style={{ color: "#00FF00" }}>
              Unknown wallet
            </Text>
          )}
          {hasFarcasterProfile && displayName && (
            <Text className="truncate text-[11px]" style={{ color: "#8bbf8b" }}>
              {displayName}
            </Text>
          )}
          {hasFarcasterProfile && fid && (
            <Text className="mt-1 text-[11px]" style={{ color: "#8bbf8b" }}>
              FID #{fid.toLocaleString("en-US")}
            </Text>
          )}
          {!hasFarcasterProfile && (
            <Text className="mt-1 text-[11px]" style={{ color: "#8bbf8b" }}>
              Wallet does not match a Farcaster profile.
            </Text>
          )}
          {wallet && hasFarcasterProfile && (
            <button
              type="button"
              onClick={handleOpenWallet}
              className="mt-1 block max-w-full cursor-pointer truncate text-left text-[11px] text-[#8bbf8b] hover:text-[#00FF00] hover:underline"
            >
              {formatShortWallet(wallet)}
            </button>
          )}
        </div>

        {hasFollowerCounts && (
          <div className="grid min-w-0 grid-rows-2 gap-2 pl-1">
            <div className="rounded-lg border border-[#00FF00]/15 bg-black/35 px-2 py-1.5">
              <Text className="text-[9px] uppercase leading-3" style={{ color: "#8bbf8b" }}>
                Followers
              </Text>
              <Text className="truncate text-xs font-bold leading-4" style={{ color: "#00FF00" }}>
                {formatCompactCount(owner?.followerCount)}
              </Text>
            </div>
            <div className="rounded-lg border border-[#00FF00]/15 bg-black/35 px-2 py-1.5">
              <Text className="text-[9px] uppercase leading-3" style={{ color: "#8bbf8b" }}>
                Following
              </Text>
              <Text className="truncate text-xs font-bold leading-4" style={{ color: "#00FF00" }}>
                {formatCompactCount(owner?.followingCount)}
              </Text>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3">
        <Text className="text-[10px] uppercase" style={{ color: "#8bbf8b" }}>
          10X Warplets
        </Text>
        <div className="mt-2 grid grid-cols-5 gap-1">
          {warpletIds.map((tokenId) => (
            <button
              key={tokenId}
              type="button"
              onClick={() => {
                void hapticTap();
                onOpenWarplet(tokenId);
              }}
              className="aspect-square w-full min-w-0 cursor-pointer overflow-hidden rounded-full border-2 border-[rgba(0,255,0,0)] bg-transparent hover:border-[#00FF00]"
              title={`Open 10X Warplet #${tokenId}`}
            >
              <img src={getWarpletImageUrl(tokenId)} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
          {hasMoreThanVisibleWarplets && (
            <div
              className="flex aspect-square w-full min-w-0 items-center justify-center rounded-full border border-[#00FF00]/15 bg-black/35 text-xs font-bold text-[#00FF00]"
              title={`${remainingOwnedCount.toLocaleString("en-US")} more 10X Warplets`}
            >
              +{remainingOwnedCount.toLocaleString("en-US")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WarpletDetailsModal({
  details,
  onClose,
  onShare,
  onSearchTag,
  onLevelFilter,
  onOpenRelatedWarplet,
  market,
  ownedTokenIds,
  isRefreshingMarket,
  marketRefreshError,
  onRefreshMarket,
  stackIndex,
}: {
  details: WarpletDetails;
  onClose: () => void;
  onShare: () => void;
  onSearchTag: (tag: string) => void;
  onLevelFilter: (attribute: LevelAttributeColumn, level: number) => void;
  onOpenRelatedWarplet: (tokenId: number) => void;
  market: TokenMarketState;
  ownedTokenIds: number[];
  isRefreshingMarket: boolean;
  marketRefreshError: string;
  onRefreshMarket: () => void;
  stackIndex: number;
}) {
  const row = details.row;
  const farcasterUsername = cellToString(row.warplet_username_farcaster);
  const farcasterFid = cellToNumber(row.fid_value);
  const xUsername = cellToString(row.warplet_username_x).replace(/^@/, "");
  const wallet = cellToString(row.warplet_wallet);
  const userIsPro = formatDetailValue("warplet_user_is_pro", row.warplet_user_is_pro);
  const lastMarketUpdatedAt = getMarketUpdatedAt(market);
  const marketLooksStale = lastMarketUpdatedAt ? Date.now() - Date.parse(lastMarketUpdatedAt) > MARKET_DETAIL_STALE_MS : true;
  const chipGroups = [
    { label: "Colours", values: splitChips(row.warplet_colours) },
    { label: "Keywords", values: splitChips(row.warplet_keywords) },
    { label: "Traits", values: splitChips(row.warplet_traits) },
  ];

  const handleOpenFarcasterProfile = () => {
    if (!farcasterFid) return;
    void hapticTap();
    sdk.actions.viewProfile({ fid: farcasterFid }).catch((error) => {
      console.error("Failed to open Farcaster profile:", error);
    });
  };

  return (
    <div className="fixed inset-0 flex items-end justify-center bg-black/80 p-4 sm:items-center" style={{ zIndex: 50 + stackIndex }}>
      <div className="max-h-[92vh] w-full max-w-md overflow-auto rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#00FF00]/20 bg-black px-4 py-3">
          <Text className="min-w-0 truncate text-base font-bold" style={{ color: "#00FF00" }}>
            <span>{details.title}</span>
            {details.username && (
              <span style={{ color: "rgb(139, 191, 139)" }}> @{details.username}</span>
            )}
          </Text>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void hapticPrimaryTap();
                onShare();
              }}
              className="h-9 cursor-pointer rounded-lg border border-[#00FF00]/55 bg-[#00FF00] px-3 text-sm font-bold text-[rgb(0,80,0)] hover:bg-[#33ff33]"
            >
              Share
            </button>
            <button
              type="button"
              aria-label="Close details"
              title="Close"
              onClick={() => {
                void hapticTap();
                onClose();
              }}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[#00FF00]/35 text-[#00FF00] hover:bg-[#041204]"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-4">
          <img
            src={getWarpletAssetUrl(details.id, "avif")}
            alt=""
            className="aspect-square w-full rounded-xl bg-[rgba(0,255,0,0.12)] object-cover"
          />

          <div className="mt-3 overflow-hidden rounded-xl border border-[#00FF00]/20 bg-[#041204]/60">
            <div className="grid grid-cols-10 border-b border-[#00FF00]/15">
              {ATTRIBUTE_LEVEL_SUMMARY.map((group) => (
                <div
                  key={group.label}
                  className="flex min-h-9 items-center justify-center text-base"
                >
                  <AttributeTooltip
                    emoji={group.emoji}
                    label={`${group.label} Level`}
                    description={group.description}
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-10">
              {ATTRIBUTE_LEVEL_SUMMARY.map((group) => {
                const target = getLevelFilterTarget(group, row);
                const value = formatDetailValue(group.level, row[group.level]);
                return (
                  <div
                    key={group.label}
                    className="flex min-h-8 items-center justify-center border-r border-[#00FF00]/10 text-[10px] font-bold text-[#00FF00] last:border-r-0"
                  >
                    {target ? (
                      <button
                        type="button"
                        onClick={() => {
                          void hapticSelectionChanged();
                          onLevelFilter(target.attribute, target.level);
                        }}
                        className="cursor-pointer rounded px-1 text-[#00FF00] underline-offset-2 hover:text-[#00FF00] hover:underline"
                      >
                        {value}
                      </button>
                    ) : (
                      value
                    )}
                  </div>
                );
              })}
            </div>
          </div>

            <button
              type="button"
              onClick={() => {
                void hapticPrimaryTap();
                sdk.actions.openUrl(getOpenSeaUrl(details.id)).catch((error) => {
                  console.error("Failed to open OpenSea in Farcaster:", error);
                });
              }}
              className="mt-4 w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-5 py-3 text-center text-base font-bold text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000]"
            >
              View on OpenSea
            </button>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { kind: "price" as const, label: "Price", money: market.listing, emptyValue: "Not listed" },
                { kind: "offer" as const, label: "Top Offer", money: market.offer, emptyValue: "No offers" },
                { kind: "sold" as const, label: "Latest Sale", money: market.sale, emptyValue: "No sales" },
              ].map(({ kind, label, money, emptyValue }) => {
                const styles = getMarketKindStyles(kind);
                const hasValue = hasMarketValue(money);
                const value = hasValue ? formatMarketValue(money) : emptyValue;
                const timestamp = hasValue && money?.at ? formatMarketTimestamp(money.at) : "\u00A0";
                return (
                  <div
                    key={label}
                    className="min-w-0 rounded-xl border px-2 py-2"
                    style={{ borderColor: styles.borderColor, backgroundColor: styles.backgroundColor }}
                  >
                    <Text className="truncate text-[10px] uppercase" style={{ color: styles.color }}>
                    {label}
                    </Text>
                    <MarketValueChip kind={kind} value={value} tooltip={label} showTooltip={false} align="left" className="mt-1 w-full text-xs" />
                    <Text className="mt-1 truncate text-[9px]" style={{ color: styles.color }}>
                      {timestamp}
                    </Text>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 space-y-3">
              <OwnedByPanel
                owner={market.owner}
                currentTokenId={details.id}
                ownedTokenIds={ownedTokenIds}
                onOpenWarplet={onOpenRelatedWarplet}
              />

              {ATTRIBUTE_GROUPS.map((group) => (
                <div key={group.label} className="rounded-xl border border-[#00FF00]/15 bg-[#041204]/60 p-3">
                  <Text className="text-xs font-bold uppercase" style={{ color: "#00FF00" }}>
                    {group.emoji ? `${group.emoji} ` : ""}{group.label}
                    <span className="font-normal italic normal-case" style={{ color: "#8bbf8b" }}>
                      {" — "}{group.description}
                    </span>
                  </Text>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {[
                      ["Level", formatDetailValue(group.level, row[group.level])],
                      ["Rank", formatDetailValue(group.rank, row[group.rank])],
                      [group.valueLabel, formatDetailValue(group.value, row[group.value])],
                    ].map(([label, value]) => {
                      const target = label === "Level" ? getLevelFilterTarget(group, row) : null;
                      const shouldShowValueTooltip = group.label === "Minter" && label === group.valueLabel;
                      return (
                        <div
                          key={label}
                          className="min-w-0 rounded-lg border border-[#00FF00]/15 bg-black/35 px-2 py-2"
                        >
                          <Text className="text-[10px] uppercase" style={{ color: "#8bbf8b" }}>
                            {label}
                          </Text>
                          {target ? (
                            <button
                            type="button"
                            onClick={() => {
                              void hapticSelectionChanged();
                              onLevelFilter(target.attribute, target.level);
                            }}
                            className="mt-1 max-w-full cursor-pointer truncate text-left text-xs font-bold text-[#00FF00] underline-offset-2 hover:text-[#00FF00] hover:underline"
                          >
                              {value}
                            </button>
                          ) : shouldShowValueTooltip ? (
                            <ValueTooltip value={value} />
                          ) : (
                            <Text className="mt-1 truncate text-xs font-bold" style={{ color: "#00FF00" }}>
                              {value}
                            </Text>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-2">
              <div className="rounded-xl border border-[#00FF00]/15 bg-[#041204]/60 px-3 py-3">
                <Text className="text-[10px] uppercase" style={{ color: "#8bbf8b" }}>
                  Description
                </Text>
                <Text className="mt-2 text-xs leading-relaxed" style={{ color: "#00FF00" }}>
                  {formatDetailValue("description", row.description)}
                </Text>
              </div>

              {chipGroups.map((group) => (
                <div key={group.label} className="rounded-xl border border-[#00FF00]/15 bg-[#041204]/60 px-3 py-2">
                  <Text className="text-[10px] uppercase" style={{ color: "#8bbf8b" }}>
                    {group.label}
                  </Text>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(group.values.length ? group.values : ["-"]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          if (value !== "-") {
                            void hapticSelectionChanged();
                            onSearchTag(value);
                          }
                        }}
                        className="rounded-full border border-[#00FF00]/25 bg-black/60 px-2 py-1 text-left text-[11px] text-[#00FF00] hover:border-[#00FF00]/60 hover:bg-[#041204]"
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <div className="rounded-xl border border-[#00FF00]/15 bg-[#041204]/60 px-3 py-2">
                <Text className="text-[10px] uppercase" style={{ color: "#8bbf8b" }}>
                  User Is Pro
                </Text>
                <Text className="mt-1 break-words text-xs" style={{ color: "#00FF00" }}>
                  {userIsPro}
                </Text>
              </div>

              {farcasterUsername && (
                <button
                  type="button"
                  onClick={handleOpenFarcasterProfile}
                  className="w-full rounded-xl border border-[#00FF00]/25 bg-[#041204]/60 px-3 py-2 text-left hover:border-[#00FF00]/60 hover:bg-[#071807]"
                >
                  <Text className="text-[10px] uppercase" style={{ color: "#8bbf8b" }}>
                    Farcaster Username
                  </Text>
                  <Text className="mt-1 break-words text-xs" style={{ color: "#00FF00" }}>
                    @{farcasterUsername}
                  </Text>
                </button>
              )}

              {xUsername && xUsername !== "-" && (
                <button
                  type="button"
                  onClick={() => {
                    void hapticTap();
                    openExternalAsset(`https://x.com/${encodeURIComponent(xUsername)}`).catch((error) => {
                      console.error("Failed to open X profile:", error);
                    });
                  }}
                  className="w-full rounded-xl border border-[#00FF00]/25 bg-[#041204]/60 px-3 py-2 text-left hover:border-[#00FF00]/60 hover:bg-[#071807]"
                >
                  <Text className="text-[10px] uppercase" style={{ color: "#8bbf8b" }}>
                    X Username
                  </Text>
                  <Text className="mt-1 break-words text-xs" style={{ color: "#00FF00" }}>
                    @{xUsername}
                  </Text>
                </button>
              )}

              {wallet && wallet !== "-" && (
                <button
                  type="button"
                  onClick={() => {
                    void hapticTap();
                    openExternalAsset(`https://basescan.org/address/${wallet}`).catch((error) => {
                      console.error("Failed to open wallet:", error);
                    });
                  }}
                  className="w-full rounded-xl border border-[#00FF00]/25 bg-[#041204]/60 px-3 py-2 text-left hover:border-[#00FF00]/60 hover:bg-[#071807]"
                >
                  <Text className="text-[10px] uppercase" style={{ color: "#8bbf8b" }}>
                    Wallet
                  </Text>
                  <Text className="mt-1 break-all text-xs" style={{ color: "#00FF00" }}>
                    {wallet}
                  </Text>
                </button>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {ASSET_LINKS.map((asset) => (
                <button
                  key={asset.ext}
                  type="button"
                  onClick={() => {
                    void hapticTap();
                    openExternalAsset(getWarpletAssetUrl(details.id, asset.ext)).catch((error) => {
                      console.error(`Failed to open ${asset.ext} asset:`, error);
                    });
                  }}
                  className="rounded-xl border border-[#00FF00]/30 bg-[#041204]/90 px-3 py-2 text-left text-xs text-[#00FF00] hover:border-[#00FF00]/60 hover:bg-[#071807]"
                >
                  <span className="block font-bold">{asset.label}</span>
                  <span className="block text-[10px] text-[#8bbf8b]">{asset.detail}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 text-center text-[11px] leading-4 text-[#8bbf8b]">
              Last updated: {lastMarketUpdatedAt ? formatMarketTimestamp(lastMarketUpdatedAt) : "Not yet"}
              {marketLooksStale && <span> (stale)</span>}
              {". "}
              <span
                role="button"
                tabIndex={0}
                onClick={() => {
                  void hapticPrimaryTap();
                  onRefreshMarket();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void hapticPrimaryTap();
                    onRefreshMarket();
                  }
                }}
                className="cursor-pointer font-bold text-[#00FF00]"
              >
                {isRefreshingMarket ? "Refreshing..." : "Refresh"}
              </span>
              {marketRefreshError && (
                <span className="block text-red-300">{marketRefreshError}</span>
              )}
            </div>
          </div>
      </div>
    </div>
  );
}

export default function SearchApp() {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState("");
  const [viewerFid, setViewerFid] = useState<number | null>(null);
  const [matchedWarplet, setMatchedWarplet] = useState<WarpletResult | null>(null);
  const [query, setQuery] = useState("");
  const [isAllWarpletsMode, setIsAllWarpletsMode] = useState(false);
  const [activeExampleSearch, setActiveExampleSearch] = useState(() => getRandomExampleSearch());
  const [selectedAttributes, setSelectedAttributes] = useState<LevelAttributeColumn[]>([]);
  const [selectedLevels, setSelectedLevels] = useState<number[]>([]);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<WarpletResult[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selectedWarpletDetailsStack, setSelectedWarpletDetailsStack] = useState<WarpletDetails[]>([]);
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null);
  const [marketRefreshTokenId, setMarketRefreshTokenId] = useState<number | null>(null);
  const [marketRefreshError, setMarketRefreshError] = useState("");
  const [orderBy, setOrderBy] = useState<OrderByOption>("rarity");
  const [orderDirection, setOrderDirection] = useState<OrderDirection>("asc");
  const [userSelectedOrder, setUserSelectedOrder] = useState(false);
  const dbRef = useRef<SqliteDatabase | null>(null);
  const searchRunRef = useRef(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const urlHydratedRef = useRef(false);
  const applyingUrlStateRef = useRef(false);
  const lastUrlSignatureRef = useRef("");
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome("search");
  const selectedWarpletDetails = selectedWarpletDetailsStack.at(-1) ?? null;

  const updateSearchUrl = useCallback((state: SearchUrlState, mode: "push" | "replace") => {
    const signature = getSearchUrlSignature(state);
    if (signature === lastUrlSignatureRef.current && mode === "push") return;

    const historyState = {
      ...(window.history.state ?? {}),
      searchUrl: {
        signature,
      },
    } satisfies MiniAppHistoryStateWithSearch & Record<string, unknown>;
    const nextUrl = buildSearchUrl(state);

    if (mode === "replace") {
      window.history.replaceState(historyState, "", nextUrl);
    } else {
      window.history.pushState(historyState, "", nextUrl);
    }

    lastUrlSignatureRef.current = signature;
  }, []);

  const loadWarpletDetails = useCallback(async (tokenId: number) => {
    const db = dbRef.current;
    if (!db) return null;

    try {
      const rows = db.exec(
        `SELECT
           w.id,
           ${DETAIL_FIELDS.map((field) => `w."${field.column}" AS "${field.key}"`).join(",\n           ")}
         FROM warplets w
         WHERE w.id = ?
         LIMIT 1`,
        {
          bind: [tokenId],
          rowMode: "object",
          returnValue: "resultRows",
        },
      );
      const details = mapDetails(rows[0] as Record<string, unknown> | undefined);
      if (!details) return null;
      await preloadImage(getWarpletAssetUrl(details.id, "avif"));
      return details;
    } catch (err) {
      console.error("Failed to load Warplet details:", err);
      return null;
    }
  }, []);

  useEffect(() => {
    let shouldCallReady = false;

    const init = async () => {
      try {
        const inMiniApp =
          typeof sdk.isInMiniApp === "function" ? await sdk.isInMiniApp() : true;

        if (!inMiniApp) {
          return;
        }

        shouldCallReady = true;
        const context = await sdk.context;
        const fid = (context as { user?: { fid?: unknown } }).user?.fid;
        setViewerFid(typeof fid === "number" && Number.isInteger(fid) && fid > 0 ? fid : null);
      } catch (err) {
        console.error("Search app init error:", err);
        const message = err instanceof Error ? err.message : String(err);
        const normalized = message.toLowerCase();
        const looksLikeBrowserLaunch =
          normalized.includes("context is undefined") ||
          normalized.includes("can't access property \"user\"") ||
          normalized.includes("cannot read properties of undefined");

        if (looksLikeBrowserLaunch) return;
      } finally {
        if (shouldCallReady) {
          sdk.actions.ready();
        }
      }
    };

    init();
  }, []);

  const refreshMarketSnapshot = useCallback(async (force = false) => {
    const cached = readCachedMarketSnapshot();
    if (cached && !force) {
      setMarketSnapshot(cached);
      const age = Date.now() - Date.parse(cached.generatedAt || "");
      if (Number.isFinite(age) && age < MARKET_SNAPSHOT_STALE_MS) return;
    }

    try {
      const response = await fetch("/api/warplets-market-state", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Market data failed (${response.status})`);
      const snapshot = (await response.json()) as MarketSnapshot;
      setMarketSnapshot(snapshot);
      writeCachedMarketSnapshot(snapshot);
    } catch (error) {
      console.error("Failed to refresh market state:", error);
      if (!cached) {
        setMarketRefreshError(error instanceof Error ? error.message : String(error));
      }
    }
  }, []);

  useEffect(() => {
    void refreshMarketSnapshot();
  }, [refreshMarketSnapshot]);

  useEffect(() => {
    let cancelled = false;

    const loadDatabase = async () => {
      try {
        const sqlite3 = await sqlite3InitModule();
        const response = await fetch(DB_URL);
        if (!response.ok) {
          throw new Error(`Database download failed (${response.status})`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        sqlite3.capi.sqlite3_js_posix_create_file(DB_FILENAME, bytes);
        const db = new sqlite3.oo1.DB(DB_FILENAME, "r");

        if (cancelled) {
          db.close();
          return;
        }

        dbRef.current = db;
        setDbReady(true);
        void hapticSuccess();
      } catch (err) {
        console.error("Failed to load Warplets search database:", err);
        if (!cancelled) {
          setDbError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    loadDatabase();

    return () => {
      cancelled = true;
      dbRef.current?.close();
      dbRef.current = null;
    };
  }, []);

  useEffect(() => {
    const db = dbRef.current;
    if (!dbReady || !db || viewerFid == null) return;

    let cancelled = false;

    const loadViewerMatch = async () => {
      try {
        const rows = db.exec(
          `SELECT
             ${RESULT_SELECT_COLUMNS}
           FROM warplets w
           WHERE w.fid_value = ?
           ORDER BY w.id ASC
           LIMIT 1`,
          {
            bind: [viewerFid],
            rowMode: "array",
            returnValue: "resultRows",
          },
        );
        const match = mapRows(rows)[0] ?? null;
        if (match) {
          await preloadResultImages([match]);
        }
        if (!cancelled) {
          setMatchedWarplet(match);
        }
      } catch (err) {
        console.error("Failed to match Farcaster user to Warplet:", err);
        if (!cancelled) {
          setMatchedWarplet(null);
        }
      }
    };

    loadViewerMatch();

    return () => {
      cancelled = true;
    };
  }, [dbReady, viewerFid]);

  const runSearch = useCallback(async (
    nextQuery: string,
    offset = 0,
    filterOverride?: SearchFilterOverride,
    limit = PAGE_SIZE,
  ) => {
    const db = dbRef.current;
    const activeAttributes = filterOverride?.attributes ?? selectedAttributes;
    const activeLevels = filterOverride?.levels ?? selectedLevels;
    const isWildcardSearch = nextQuery.trim() === "*";
    const ftsQuery = isWildcardSearch ? "" : normalizeFtsQuery(nextQuery);
    const levelFilter = buildLevelFilter(activeAttributes, activeLevels);
    const hasAttributeOnlyFilter = activeAttributes.length > 0 && activeLevels.length === 0;
    const attributeOnlyRankColumn =
      !ftsQuery && hasAttributeOnlyFilter ? getRankColumnForLevelAttribute(activeAttributes[0]) : null;
    const runId = searchRunRef.current + 1;
    searchRunRef.current = runId;

    if (!db || (!ftsQuery && !levelFilter && !hasAttributeOnlyFilter && !isWildcardSearch)) {
      setResults([]);
      setTotalResults(0);
      setVisibleCount(PAGE_SIZE);
      setSubmittedQuery(nextQuery.trim());
      setSearchError("");
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setSearchError("");

    try {
      const countSql = ftsQuery
        ? `SELECT COUNT(*)
           FROM warplets_fts
           JOIN warplets w ON w.id = warplets_fts.rowid
           WHERE warplets_fts MATCH ?${levelFilter ? ` AND ${levelFilter.sql}` : ""}`
        : `SELECT COUNT(*)
           FROM warplets w${levelFilter ? `
           WHERE ${levelFilter.sql}` : ""}`;
      const countBind = ftsQuery
        ? [ftsQuery, ...(levelFilter?.bind ?? [])]
        : [...(levelFilter?.bind ?? [])];
      const countRows = db.exec(
        countSql,
        {
          bind: countBind,
          rowMode: "array",
          returnValue: "resultRows",
        },
      );
      const nextTotal = cellToNumber(countRows[0]?.[0]) ?? 0;
      const resultSql = ftsQuery
        ? `SELECT
             ${RESULT_SELECT_COLUMNS},
             bm25(warplets_fts) AS score
           FROM warplets_fts
           JOIN warplets w ON w.id = warplets_fts.rowid
           WHERE warplets_fts MATCH ?${levelFilter ? ` AND ${levelFilter.sql}` : ""}
           ORDER BY score, w."10x_rank" ASC, w.id ASC
           LIMIT ? OFFSET ?`
        : `SELECT
             ${RESULT_SELECT_COLUMNS}
           FROM warplets w${levelFilter ? `
           WHERE ${levelFilter.sql}` : ""}
           ORDER BY ${attributeOnlyRankColumn ? `w."${attributeOnlyRankColumn}" ASC, ` : ""}w.id ASC
           LIMIT ? OFFSET ?`;
      const resultBind = ftsQuery
        ? [ftsQuery, ...(levelFilter?.bind ?? []), SEARCH_RESULT_LIMIT, 0]
        : [...(levelFilter?.bind ?? []), SEARCH_RESULT_LIMIT, 0];
      const rows = db.exec(
        resultSql,
        {
          bind: resultBind,
          rowMode: "array",
          returnValue: "resultRows",
        },
      );
      const nextRows = mapRows(rows, Boolean(ftsQuery));
      await preloadResultImages(nextRows.slice(0, PAGE_SIZE));

      if (searchRunRef.current !== runId) return;

      setSubmittedQuery(nextQuery.trim());
      setTotalResults(nextTotal);
      setVisibleCount(limit);
      setResults(nextRows);
      void hapticSuccess();
    } catch (err) {
      console.error("Warplets search failed:", err);
      if (searchRunRef.current === runId) {
        setSearchError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (searchRunRef.current === runId) {
        setIsSearching(false);
      }
    }
  }, [selectedAttributes, selectedLevels]);

  const applySearchUrlState = useCallback(async (state: SearchUrlState) => {
    if (!dbReady || !dbRef.current) return;

    applyingUrlStateRef.current = true;
    searchRunRef.current += 1;

    const nextState = {
      ...EMPTY_SEARCH_URL_STATE,
      ...state,
    };
    const nextRandom = nextState.random || activeExampleSearch;
    const nextSearchText = getEffectiveSearchText({
      ...nextState,
      random: nextRandom,
    });
    const hasLevelFilter = nextState.levels.length > 0;
    const hasAttributeFilter = nextState.attributes.length > 0;
    const nextAllWarpletsMode = nextState.search.trim() === "*";
    const isRandomMode = !nextAllWarpletsMode && !nextState.search && !hasAttributeFilter && !hasLevelFilter && Boolean(nextSearchText);

    setQuery(nextAllWarpletsMode ? "" : nextState.search);
    setIsAllWarpletsMode(nextAllWarpletsMode);
    setActiveExampleSearch(nextRandom);
    setSelectedAttributes(nextState.attributes);
    setSelectedLevels(nextState.levels);
    const hasFtsQuery = Boolean(nextSearchText.trim()) && nextSearchText.trim() !== "*";
    const canUseRequestedRank = nextState.order !== "rank" || nextState.attributes.length === 1;
    const nextOrderBy = nextState.order && canUseRequestedRank
      ? nextState.order
      : getDefaultOrderBy(hasFtsQuery, nextState.attributes);
    setOrderBy(nextOrderBy);
    setOrderDirection(nextState.dir ?? "asc");
    setUserSelectedOrder(Boolean(nextState.order && canUseRequestedRank));
    setSelectedWarpletDetailsStack([]);
    setSearchError("");
    setIsSearching(false);

    if (nextSearchText || hasAttributeFilter || hasLevelFilter) {
      await runSearch(
        nextSearchText,
        0,
        { attributes: nextState.attributes, levels: nextState.levels },
        isRandomMode && matchedWarplet ? PAGE_SIZE - 1 : PAGE_SIZE,
      );
    } else {
      setResults([]);
      setTotalResults(0);
      setVisibleCount(PAGE_SIZE);
      setSubmittedQuery("");
    }

    if (nextState.warplet != null) {
      const details = await loadWarpletDetails(nextState.warplet);
      if (details) setSelectedWarpletDetailsStack([details]);
    }

    applyingUrlStateRef.current = false;
  }, [activeExampleSearch, dbReady, loadWarpletDetails, matchedWarplet, runSearch]);

  useEffect(() => {
    if (!dbReady || urlHydratedRef.current) return;

    const parsed = parseSearchUrlState(new URLSearchParams(window.location.search));
    const hasUrlState = hasDeepLinkState(parsed);
    const initialState = hasUrlState
      ? parsed
      : {
        ...parsed,
        random: activeExampleSearch,
      };

    urlHydratedRef.current = true;
    lastUrlSignatureRef.current = getSearchUrlSignature(initialState);
    if (!hasUrlState) {
      updateSearchUrl(initialState, "replace");
    }
    void applySearchUrlState(initialState);
  }, [activeExampleSearch, applySearchUrlState, dbReady, updateSearchUrl]);

  useEffect(() => {
    if (!dbReady || !urlHydratedRef.current || applyingUrlStateRef.current) return;
    const timeoutId = window.setTimeout(() => {
      if (applyingUrlStateRef.current) return;
      const hasQuery = query.trim().length > 0;
      const hasLevelFilter = selectedLevels.length > 0;
      const isExampleSearch = !isAllWarpletsMode && !hasQuery && !hasLevelFilter && selectedAttributes.length === 0;
      const nextQuery = hasQuery
        ? query
        : isAllWarpletsMode
          ? "*"
          : hasLevelFilter
          ? ""
          : selectedAttributes.length > 0
            ? ""
            : activeExampleSearch;
      const limit = isExampleSearch && matchedWarplet ? PAGE_SIZE - 1 : PAGE_SIZE;
      runSearch(nextQuery, 0, undefined, limit);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [activeExampleSearch, dbReady, isAllWarpletsMode, matchedWarplet, query, runSearch, selectedAttributes.length, selectedLevels.length]);

  useEffect(() => {
    if (!urlHydratedRef.current || applyingUrlStateRef.current) return;
    const hasFtsQuery = !isAllWarpletsMode && Boolean((query.trim() || submittedQuery.trim()).trim()) && (query.trim() || submittedQuery.trim()).trim() !== "*";
    if (!userSelectedOrder || (orderBy === "rank" && selectedAttributes.length !== 1)) {
      setOrderBy(getDefaultOrderBy(hasFtsQuery, selectedAttributes));
      setOrderDirection("asc");
      setUserSelectedOrder(false);
    }
  }, [isAllWarpletsMode, orderBy, query, selectedAttributes, submittedQuery, userSelectedOrder]);

  useEffect(() => {
    if (!dbReady || !urlHydratedRef.current) return;

    const handlePopState = () => {
      const nextState = parseSearchUrlState(new URLSearchParams(window.location.search));
      lastUrlSignatureRef.current = getSearchUrlSignature(nextState);
      void applySearchUrlState(nextState);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [applySearchUrlState, dbReady]);

  useEffect(() => {
    if (!dbReady || !urlHydratedRef.current || applyingUrlStateRef.current) return;

    const timeoutId = window.setTimeout(() => {
      if (applyingUrlStateRef.current) return;
      const nextState = getSearchUrlStateFromAppState({
        query,
        isAllWarpletsMode,
        selectedAttributes,
        selectedLevels,
        activeExampleSearch,
        selectedWarpletDetails,
        orderBy,
        orderDirection,
        userSelectedOrder,
      });
      updateSearchUrl(nextState, "push");
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeExampleSearch,
    dbReady,
    isAllWarpletsMode,
    query,
    selectedAttributes,
    selectedLevels,
    selectedWarpletDetails,
    orderBy,
    orderDirection,
    userSelectedOrder,
    updateSearchUrl,
  ]);

  useEffect(() => {
    if (!dbReady || isMenuRoute) return;
    searchInputRef.current?.focus();
  }, [dbReady, isMenuRoute]);

  const hasActiveAttributeFilter = selectedAttributes.length > 0;
  const hasActiveLevelFilter = selectedLevels.length > 0;
  const hasTypedQuery = query.trim().length > 0;
  const isAllWarpletsSearchMode = isAllWarpletsMode && !hasTypedQuery;
  const isExampleSearchMode = !isAllWarpletsSearchMode && !hasTypedQuery && !hasActiveAttributeFilter && !hasActiveLevelFilter;
  const searchPlaceholder = isAllWarpletsSearchMode
    ? "All Warplets..."
    : hasTypedQuery || hasActiveAttributeFilter || hasActiveLevelFilter
    ? "Search for Warplets..."
    : `${getRandomExampleDisplayLabel(activeExampleSearch)} Warplets...`;
  const shouldPrependMatchedWarplet = Boolean(isExampleSearchMode && matchedWarplet);
  const rankAttribute = selectedAttributes.length === 1 ? selectedAttributes[0] : undefined;
  const sortedResults = useMemo(
    () => sortWarplets(results, orderBy, orderDirection, marketSnapshot, rankAttribute),
    [marketSnapshot, orderBy, orderDirection, rankAttribute, results],
  );
  const visibleResults = sortedResults.slice(0, visibleCount);
  const displayedResults = shouldPrependMatchedWarplet && matchedWarplet
    ? [matchedWarplet, ...visibleResults]
    : visibleResults;
  const displayedTotalResults = totalResults + (shouldPrependMatchedWarplet ? 1 : 0);
  const canLoadMore = sortedResults.length > visibleCount;
  const hasActiveSearchOrFilter = Boolean(submittedQuery || hasTypedQuery || hasActiveAttributeFilter || hasActiveLevelFilter || isAllWarpletsSearchMode);
  const selectedAttributeLabel = selectedAttributes.length === 0
    ? "All"
    : LEVEL_ATTRIBUTES
      .filter((attribute) => selectedAttributes.includes(attribute.column))
      .map((attribute) => attribute.label)
      .join(", ");
  const selectedLevelLabel = selectedLevels.length === 0
    ? "Any"
    : selectedLevels.map((level) => `${level}X`).join(", ");
  const rawSearchResultsShareLabel = (
    query.trim() ||
    (isAllWarpletsSearchMode && submittedQuery.trim() === "*" ? "10X" : submittedQuery.trim()) ||
    (isExampleSearchMode ? activeExampleSearch : "") ||
    "Filtered"
  ).trim();
  const searchResultsShareLabel = isExampleSearchMode
    ? getRandomExampleDisplayLabel(rawSearchResultsShareLabel)
    : rawSearchResultsShareLabel;
  const searchResultsShareTitle = `${displayedTotalResults.toLocaleString("en-US")} ${searchResultsShareLabel} Warplets...`;
  const showResetSearchControl = Boolean(hasTypedQuery || hasActiveAttributeFilter || hasActiveLevelFilter || userSelectedOrder);

  const handleToggleAttribute = (column: LevelAttributeColumn) => {
    setSelectedAttributes((current) => {
      const next = toggleValue(current, column);
      return LEVEL_ATTRIBUTES
        .map((attribute) => attribute.column)
        .filter((attribute) => next.includes(attribute));
    });
  };

  const handleToggleLevel = (level: number) => {
    setSelectedLevels((current) => toggleValue(current, level).sort((a, b) => a - b));
  };

  const handleResetSearch = () => {
    void hapticPrimaryTap();
    const nextExample = getRandomExampleSearch(activeExampleSearch);
    setActiveExampleSearch(nextExample);
    setQuery("");
    setIsAllWarpletsMode(false);
    setSelectedAttributes([]);
    setSelectedLevels([]);
    setVisibleCount(matchedWarplet ? PAGE_SIZE - 1 : PAGE_SIZE);
    setOrderBy("relevance");
    setOrderDirection("asc");
    setUserSelectedOrder(false);
    setSearchError("");
    if (dbReady) {
      void runSearch(
        nextExample,
        0,
        { attributes: [], levels: [] },
        matchedWarplet ? PAGE_SIZE - 1 : PAGE_SIZE,
      );
    }
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const handleRandomExampleSearch = () => {
    void hapticPrimaryTap();
    const nextExample = getRandomExampleSearch(activeExampleSearch);
    setActiveExampleSearch(nextExample);
    setQuery("");
    setIsAllWarpletsMode(false);
    setSelectedAttributes([]);
    setSelectedLevels([]);
    setVisibleCount(matchedWarplet ? PAGE_SIZE - 1 : PAGE_SIZE);
    setOrderBy("relevance");
    setOrderDirection("asc");
    setUserSelectedOrder(false);
    if (dbReady) {
      void runSearch(
        nextExample,
        0,
        { attributes: [], levels: [] },
        matchedWarplet ? PAGE_SIZE - 1 : PAGE_SIZE,
      );
    }
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const handleOpenWarpletDetails = useCallback(async (tokenId: number) => {
    const details = await loadWarpletDetails(tokenId);
    if (details) setSelectedWarpletDetailsStack([details]);
  }, [loadWarpletDetails]);

  const handleOpenRelatedWarpletDetails = useCallback(async (tokenId: number) => {
    const details = await loadWarpletDetails(tokenId);
    if (!details) return;
    setSelectedWarpletDetailsStack((current) => {
      if (current.at(-1)?.id === details.id) return current;
      return [...current, details];
    });
  }, [loadWarpletDetails]);

  const handleCloseTopWarpletDetails = useCallback(() => {
    setSelectedWarpletDetailsStack((current) => current.slice(0, -1));
  }, []);

  const handleSearchTag = useCallback((tag: string) => {
    setSelectedWarpletDetailsStack([]);
    setIsAllWarpletsMode(false);
    setQuery(tag);
    void runSearch(tag, 0);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [runSearch]);

  const handleLevelFilter = useCallback((attribute: LevelAttributeColumn, level: number) => {
    const nextAttributes = [attribute];
    const nextLevels = [level];
    setSelectedWarpletDetailsStack([]);
    setQuery("");
    setIsAllWarpletsMode(false);
    setSelectedAttributes(nextAttributes);
    setSelectedLevels(nextLevels);
    void runSearch("", 0, { attributes: nextAttributes, levels: nextLevels });
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [runSearch]);

  const handleShareWarpletDetails = useCallback((tokenId: number) => {
    const shareState = getSearchUrlStateFromAppState({
      query,
      isAllWarpletsMode,
      selectedAttributes,
      selectedLevels,
      activeExampleSearch,
      selectedWarpletDetails,
      orderBy,
      orderDirection,
      userSelectedOrder,
    });
    shareState.warplet = tokenId;
    const shareUrl = buildSearchHref(shareState);
    updateSearchUrl(shareState, "replace");

    sdk.actions.composeCast({
      text: `Check out 10X Warplet #${tokenId}`,
      embeds: [shareUrl, getOpenSeaUrl(tokenId)],
    }).catch((error) => {
      console.error("Failed to compose Warplet share cast:", error);
    });
  }, [
    activeExampleSearch,
    isAllWarpletsMode,
    query,
    selectedAttributes,
    selectedLevels,
    selectedWarpletDetails,
    orderBy,
    orderDirection,
    userSelectedOrder,
    updateSearchUrl,
  ]);

  const handleShareSearchResults = useCallback(() => {
    const sharePreviewWarplet = shouldPrependMatchedWarplet
      ? displayedResults[1] ?? displayedResults[0]
      : displayedResults[0];
    const firstWarpletId = sharePreviewWarplet?.id;
    if (!firstWarpletId || displayedTotalResults <= 0) return;

    const shareState = getSearchUrlStateFromAppState({
      query,
      isAllWarpletsMode,
      selectedAttributes,
      selectedLevels,
      activeExampleSearch,
      selectedWarpletDetails: null,
      orderBy,
      orderDirection,
      userSelectedOrder,
    });
    shareState.first = firstWarpletId;

    const shareUrl = appendSearchShareParams(
      buildSearchHref(shareState),
      firstWarpletId,
      displayedTotalResults,
    );

    sdk.actions.composeCast({
      text: searchResultsShareTitle,
      embeds: [shareUrl, OPENSEA_COLLECTION_URL],
    }).catch((error) => {
      console.error("Failed to compose search results share cast:", error);
    });
  }, [
    activeExampleSearch,
    displayedResults,
    displayedTotalResults,
    isAllWarpletsMode,
    query,
    searchResultsShareTitle,
    selectedAttributes,
    selectedLevels,
    shouldPrependMatchedWarplet,
    orderBy,
    orderDirection,
    userSelectedOrder,
  ]);

  const handleSelectOrderBy = useCallback((nextOrderBy: OrderByOption) => {
    setUserSelectedOrder(true);
    setVisibleCount(PAGE_SIZE);
    if (orderBy === nextOrderBy) {
      setOrderDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setOrderBy(nextOrderBy);
    setOrderDirection("asc");
  }, [orderBy]);

  const handleRefreshSelectedMarket = useCallback(async () => {
    const tokenId = selectedWarpletDetails?.id;
    if (!tokenId || marketRefreshTokenId === tokenId) return;
    setMarketRefreshTokenId(tokenId);
    setMarketRefreshError("");
    try {
      const response = await fetch(`/api/warplets-market-state/${tokenId}?refresh=1`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
      const payload = (await response.json()) as {
        snapshot?: MarketSnapshot;
        refreshStatus?: string;
        error?: string;
      };
      if (payload.snapshot) {
        setMarketSnapshot((current) => {
          const merged = mergeTokenSnapshot(current, payload.snapshot!, tokenId);
          writeCachedMarketSnapshot(merged);
          return merged;
        });
      }
      if (payload.refreshStatus === "cooldown") {
        setMarketRefreshError("Recently refreshed. Showing cached data.");
      } else if (payload.error) {
        setMarketRefreshError(payload.error);
      }
    } catch (error) {
      setMarketRefreshError(error instanceof Error ? error.message : String(error));
    } finally {
      setMarketRefreshTokenId(null);
    }
  }, [marketRefreshTokenId, selectedWarpletDetails?.id]);

  useEffect(() => {
    if (!canLoadMore || isSearching || !hasActiveSearchOrFilter) return;
    const target = loadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          setVisibleCount((current) => Math.min(current + PAGE_SIZE, sortedResults.length));
        }
      },
      { rootMargin: "600px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [canLoadMore, hasActiveSearchOrFilter, isSearching, sortedResults.length, visibleCount]);

  return (
    <MiniAppShell>
      <div className="relative z-10 w-full">
        <MiniAppHeader
          appSlug="search"
          title={getHeaderTitle("search", isMenuRoute)}
          canGoBack={canGoBack}
          onBack={actions.goBack}
          onLogo={actions.openHubRoot}
          onMenu={actions.openMenu}
        />

        {isMenuRoute ? (
          <MiniAppMenuPage appSlug="search" />
        ) : (
          <div className="mx-auto w-full max-w-md px-4 pb-10 pt-6">
            <div className="relative flex">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[#00FF00]"
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </svg>
              </span>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[0px] text-[#00FF00]"
              >
                🔍
              </span>
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (nextValue.trim().length === 0) {
                    setQuery("");
                    setIsAllWarpletsMode(true);
                    setVisibleCount(PAGE_SIZE);
                    return;
                  }
                  setIsAllWarpletsMode(false);
                  setQuery(nextValue);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Backspace" &&
                    query.trim().length === 0 &&
                    !isAllWarpletsMode &&
                    !hasActiveAttributeFilter &&
                    !hasActiveLevelFilter
                  ) {
                    setIsAllWarpletsMode(true);
                    setVisibleCount(PAGE_SIZE);
                  }
                }}
                placeholder={searchPlaceholder}
                disabled={!dbReady}
                className="min-w-0 flex-1 rounded-xl border border-[#00FF00] bg-black/70 py-3 pl-10 pr-16 text-base text-[#00FF00] outline-none transition-[border-color,box-shadow] placeholder:text-[#8bbf8b] focus:border-[#00FF00] focus:shadow-[0_0_10px_rgba(0,255,0,0.22)] disabled:cursor-wait disabled:opacity-60"
              />
              {showResetSearchControl ? (
                <button
                  type="button"
                  onClick={handleResetSearch}
                  className="absolute bottom-0 right-0 top-0 flex cursor-pointer items-center px-3 text-xs font-bold text-[#00FF00] hover:text-[#8bbf8b]"
                >
                  Reset
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRandomExampleSearch}
                  disabled={!dbReady}
                  className="absolute bottom-0 right-0 top-0 flex cursor-pointer items-center px-3 text-xs font-bold text-[#00FF00] hover:text-[#8bbf8b] disabled:cursor-wait disabled:opacity-60"
                >
                  Random
                </button>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <FilterDropdown label="Attributes" valueLabel={selectedAttributeLabel}>
                {LEVEL_ATTRIBUTES.map((attribute) => (
                  <label
                    key={attribute.column}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-[#00FF00] hover:bg-[#041204]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAttributes.includes(attribute.column)}
                      onChange={() => handleToggleAttribute(attribute.column)}
                      className="h-4 w-4 appearance-none rounded border border-[#0F0] bg-[rgba(0,255,0,0.12)] checked:appearance-auto checked:accent-[#00FF00]"
                    />
                    <span aria-hidden="true">{attribute.emoji}</span>
                    {attribute.label}
                  </label>
                ))}
              </FilterDropdown>

              <FilterDropdown label="Levels" valueLabel={selectedLevelLabel}>
                {LEVEL_FILTER_OPTIONS.map((level) => (
                  <label
                    key={level}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-[#00FF00] hover:bg-[#041204]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedLevels.includes(level)}
                      onChange={() => handleToggleLevel(level)}
                      className="h-4 w-4 appearance-none rounded border border-[#0F0] bg-[rgba(0,255,0,0.12)] checked:appearance-auto checked:accent-[#00FF00]"
                    />
                    {level}X
                  </label>
                ))}
              </FilterDropdown>
            </div>

            {!dbReady && (
              <Text className="mt-3 text-sm" style={{ color: "#00FF00" }}>
                Loading: 10X Warplets Database...
              </Text>
            )}

            {dbError && (
              <Text className="mt-2 text-xs text-red-400">
                {dbError}
              </Text>
            )}

            {searchError && (
              <Text className="mt-3 text-xs text-red-400">
                {searchError}
              </Text>
            )}

            {false && matchedWarplet && (
              <div className="mt-5">
                <div className="grid grid-cols-2 gap-3">
                  <WarpletCard
                    warplet={matchedWarplet!}
                    onOpen={handleOpenWarpletDetails}
                    labelOverride="👀 We Found You!"
                  />
                </div>
              </div>
            )}

            {hasActiveSearchOrFilter && !isSearching && displayedTotalResults === 0 && !searchError && (
              <Text className={`mt-6 ${STATUS_LINE_CLASS}`} style={{ color: "#00FF00" }}>
                No Warplets found.
              </Text>
            )}

            {displayedTotalResults > 0 && (
              <div className="mt-3">
                <div className="grid grid-cols-2 gap-2">
                  <OrderByDropdown
                    orderBy={orderBy}
                    orderDirection={orderDirection}
                    selectedAttributes={selectedAttributes}
                    onSelect={handleSelectOrderBy}
                  />
                  <div className="flex min-w-0 items-center justify-end gap-2">
                    <Text className="whitespace-nowrap text-center text-xs font-bold leading-4" style={{ color: "#00FF00" }}>
                      {displayedTotalResults.toLocaleString("en-US")} Warplets
                    </Text>
                    <button
                      type="button"
                      onClick={() => {
                        void hapticPrimaryTap();
                        handleShareSearchResults();
                      }}
                      className="h-8 shrink-0 cursor-pointer rounded-lg border border-[#00FF00]/55 bg-[#00FF00] px-3 text-xs font-bold text-[rgb(0,80,0)] hover:bg-[#33ff33]"
                    >
                      Share
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  {displayedResults.map((warplet, index) => (
                    <WarpletCard
                      key={`${warplet.id}-${index}`}
                      warplet={warplet}
                      market={getMarketState(marketSnapshot, warplet.id)}
                      onOpen={handleOpenWarpletDetails}
                      labelOverride={shouldPrependMatchedWarplet && index === 0 ? "👀 We Found You!" : undefined}
                    />
                  ))}
                </div>

                <div ref={loadMoreRef} className="h-8" />
              </div>
            )}

            {isSearching && (query.trim() || hasActiveLevelFilter || isExampleSearchMode || isAllWarpletsSearchMode) && (
              <Text className={`mt-5 ${STATUS_LINE_CLASS}`} style={{ color: "#00FF00" }}>
                Loading results...
              </Text>
            )}
          </div>
        )}
      </div>
      {selectedWarpletDetailsStack.map((details, index) => {
        const market = getMarketState(marketSnapshot, details.id);
        return (
          <WarpletDetailsModal
            key={`${details.id}-${index}`}
            details={details}
            onClose={handleCloseTopWarpletDetails}
            onShare={() => handleShareWarpletDetails(details.id)}
            onSearchTag={handleSearchTag}
            onLevelFilter={handleLevelFilter}
            onOpenRelatedWarplet={handleOpenRelatedWarpletDetails}
            market={market}
            ownedTokenIds={getOwnedTokenIds(marketSnapshot, market.owner?.wallet, details.id)}
            isRefreshingMarket={marketRefreshTokenId === details.id}
            marketRefreshError={index === selectedWarpletDetailsStack.length - 1 ? marketRefreshError : ""}
            onRefreshMarket={handleRefreshSelectedMarket}
            stackIndex={index}
          />
        );
      })}
    </MiniAppShell>
  );
}
