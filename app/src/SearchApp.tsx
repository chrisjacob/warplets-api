import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import confetti from "canvas-confetti";
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
import { useOverlayScrollbars } from "overlayscrollbars-react";
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
  hapticError,
  hapticPrimaryTap,
  hapticSelectionChanged,
  hapticSuccess,
  hapticTap,
  hapticWarning,
} from "./haptics";
import {
  ensureBaseChain,
  ensureErc20Approval,
  ensureErc721ApprovalForAll,
  executeOpenSeaActions,
  extractFulfillmentTransaction,
  buildSeaportCancelTransaction,
  getWalletAccounts,
  getWalletErrorCode,
  getWalletErrorMessage,
  isUserRejected,
  readErc20Balance,
  readNativeBalance,
  sendPreparedTransaction,
  signTypedData,
  wrapEthToWeth,
  type EthereumProvider,
  type NftApprovalRequirement,
  type PreparedTransaction,
  type SeaportCancelOrderParameters,
  type TokenApprovalRequirement,
} from "./walletTrade";

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
const MIN_LISTING_ETH = 0.00000000000001;
const TRADE_PRICE_DECIMAL_PLACES = 4;
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

type MarketOrderMoney = MarketMoney & {
  orderHash?: string | null;
  protocolAddress?: string | null;
};

type MarketSnapshot = {
  version: "opensea-market-v1";
  generatedAt: string;
  maxAgeSeconds: number;
  collection?: {
    floor: MarketMoney | null;
    topOffer: MarketOrderMoney & { offerer?: string | null; source: "collection" } | null;
  };
  listings: Record<string, MarketOrderMoney & { seller?: string | null }>;
  offers: Record<string, MarketOrderMoney & { offerer?: string | null; source?: "item" }>;
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
  itemOffer?: MarketSnapshot["offers"][string];
  collectionOffer?: NonNullable<MarketSnapshot["collection"]>["topOffer"] | null;
  offer?: (MarketOrderMoney & { offerer?: string | null; source?: "item" | "collection" }) | null;
  sale?: MarketSnapshot["sales"][string];
  owner?: MarketSnapshot["owners"][string];
};
type MarketKind = "price" | "offer" | "sold";

type TradeActionName =
  | "buy"
  | "make_offer"
  | "cancel_offer"
  | "list"
  | "cancel_listing"
  | "accept_offer";

type TradeToast = {
  id: number;
  kind: "success" | "neutral" | "warning" | "error";
  message: string;
  manualClose?: boolean;
};

type FreshTradeState = {
  tokenId: number;
  generatedAt: string;
  listing: (MarketOrderMoney & { seller?: string | null; protocolData?: unknown }) | null;
  itemOffer: (MarketOrderMoney & { offerer?: string | null; source: "item"; protocolData?: unknown }) | null;
  collectionOffer: (MarketOrderMoney & { offerer?: string | null; source: "collection"; protocolData?: unknown }) | null;
  topOffer: (MarketOrderMoney & { offerer?: string | null; source: "item" | "collection"; protocolData?: unknown }) | null;
  ownItemOffer: (MarketOrderMoney & { offerer?: string | null; source: "item"; protocolData?: unknown }) | null;
  sale?: MarketSnapshot["sales"][string] | null;
  floor: MarketMoney | null;
  owner: {
    wallet: string | null;
    fid: number | null;
    checkedAt: string | null;
  };
  snapshot?: MarketSnapshot;
};

type OptimisticPurchaseUpdate = {
  buyerWallet: string;
  buyerFid: number | null;
  buyerProfile?: Partial<MarketSnapshot["owners"][string]>;
  sale: MarketSnapshot["sales"][string];
};

type ViewerProfile = {
  fid: number | null;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
};

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

type MatchedWarpletCard = {
  warplet: WarpletResult;
  label: string;
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

function parseOwnerWalletSearch(value: string): { ownerWalletFilter: string | null; searchText: string } {
  const walletMatches = value.match(ETHEREUM_WALLET_ADDRESS_PATTERN) ?? [];
  const ownerWalletFilter = walletMatches[0]?.toLowerCase() ?? null;
  const searchText = value
    .replace(ETHEREUM_WALLET_ADDRESS_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { ownerWalletFilter, searchText };
}

function filterRowsByOwnerWallet(
  rows: WarpletResult[],
  snapshot: MarketSnapshot | null,
  ownerWalletFilter: string | null,
): WarpletResult[] {
  if (!ownerWalletFilter) return rows;
  const normalizedWallet = ownerWalletFilter.toLowerCase();
  return rows.filter((row) => {
    const ownerWallet = snapshot?.owners[String(row.id)]?.wallet?.trim().toLowerCase() ?? "";
    return ownerWallet === normalizedWallet;
  });
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

function loadWarpletResultById(db: SqliteDatabase, tokenId: number): WarpletResult | null {
  const rows = db.exec(
    `SELECT
       ${RESULT_SELECT_COLUMNS}
     FROM warplets w
     WHERE w.id = ?
     LIMIT 1`,
    {
      bind: [tokenId],
      rowMode: "array",
      returnValue: "resultRows",
    },
  );
  return mapRows(rows)[0] ?? null;
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

const DEFAULT_TRADE_DURATION_SECONDS = 179 * 24 * 60 * 60;
const FIREFOX_WALLET_WARNING = "Firefox doesn't work well with Farcaster Wallet. Please use another browser.";
const ETH_USD_PRICE_STALE_MS = 5 * 60 * 1000;
const ETHEREUM_WALLET_ADDRESS_PATTERN = /\b0x[a-fA-F0-9]{40}\b/g;

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

function chooseTopOffer(
  itemOffer: MarketSnapshot["offers"][string] | undefined,
  collectionOffer: NonNullable<MarketSnapshot["collection"]>["topOffer"] | null | undefined,
): TokenMarketState["offer"] {
  if (!itemOffer) return collectionOffer ?? null;
  if (!collectionOffer) return itemOffer;
  const itemValue = getMarketNumber(itemOffer);
  const collectionValue = getMarketNumber(collectionOffer);
  if (itemValue == null) return collectionOffer;
  if (collectionValue == null) return itemOffer;
  return itemValue >= collectionValue ? itemOffer : collectionOffer;
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
  const itemOffer = snapshot?.offers[key];
  const collectionOffer = snapshot?.collection?.topOffer ?? null;
  const listing = snapshot?.listings[key];
  const ownerWallet = snapshot?.owners[key]?.wallet?.toLowerCase() ?? "";
  const listingSellerWallet = listing?.seller?.toLowerCase() ?? "";
  const activeListing = !ownerWallet || !listingSellerWallet || ownerWallet === listingSellerWallet
    ? listing
    : undefined;
  return {
    listing: activeListing,
    itemOffer,
    collectionOffer,
    offer: chooseTopOffer(itemOffer, collectionOffer),
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
    collection: tokenSnapshot.collection ?? current?.collection ?? { floor: null, topOffer: null },
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

function decimalStringFromNumber(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  return value.toFixed(18).replace(/0+$/, "").replace(/\.$/, "");
}

function truncateDecimalDigits(value: string, maxDigits: number): string {
  const normalized = value.replace(/,/g, "");
  const [wholeRaw, fractionRaw = ""] = normalized.split(".");
  const whole = wholeRaw || "0";
  if (whole.length >= maxDigits) return whole.slice(0, maxDigits);
  const remainingDigits = maxDigits - whole.length;
  if (!fractionRaw || remainingDigits <= 0) return whole;
  const fraction = fractionRaw.slice(0, remainingDigits);
  return fraction ? `${whole}.${fraction}` : whole;
}

function formatEthValue(value: MarketMoney | null | undefined, maxDigits?: number): string {
  if (!value || value.eth == null) return "-";
  if (maxDigits != null) {
    const numeric = decimalStringFromNumber(value.eth);
    return numeric == null ? "-" : `${truncateDecimalDigits(numeric, maxDigits)} \u039e`;
  }
  return `${value.eth.toLocaleString("en-US", { maximumFractionDigits: 4 })} \u039e`;
}

function isEthLikeMarketMoney(value: MarketMoney | null | undefined): boolean {
  if (!value) return false;
  const symbol = value.currencySymbol?.toUpperCase() ?? "";
  const tokenAddress = value.tokenAddress?.toLowerCase() ?? null;
  if (symbol === "ETH" || symbol === "WETH") return true;
  if (tokenAddress === BASE_WETH_TOKEN_ADDRESS || tokenAddress === NATIVE_TOKEN_ADDRESS) return true;
  return !symbol && !tokenAddress && value.decimals === 18;
}

function formatEthNumber(value: number, maxDigits?: number): string {
  if (maxDigits != null) {
    const numeric = decimalStringFromNumber(value);
    return numeric == null ? "-" : `${truncateDecimalDigits(numeric, maxDigits)} \u039e`;
  }
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 4 })} \u039e`;
}

function getFormattedRawMarketParts(value: MarketMoney): {
  formatted: string;
  numeric: string;
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
    return { formatted, numeric, parsed: Number.isFinite(parsed) ? parsed : null };
  } catch {
    return null;
  }
}

function formatRawMarketValue(value: MarketMoney | null | undefined, maxDigits?: number): string {
  if (!value) return "-";
  const parts = getFormattedRawMarketParts(value);
  if (!parts) return "-";
  const formatted = maxDigits == null ? parts.formatted : truncateDecimalDigits(parts.numeric, maxDigits);
  const symbol = value.currencySymbol?.toUpperCase() ?? "";
  if (symbol === "USDC" || symbol === "USDBC") return `$${formatted}`;
  return `${formatted} ${value.currencySymbol ?? "RAW"}`;
}

function getRawMarketNumber(value: MarketMoney | null | undefined): number | null {
  if (!value) return null;
  return getFormattedRawMarketParts(value)?.parsed ?? null;
}

function getMarketNumber(value: MarketMoney | null | undefined): number | null {
  if (!value) return null;
  if (value.eth != null) return value.eth;
  if (isEthLikeMarketMoney(value)) return getRawMarketNumber(value);
  return getRawMarketNumber(value);
}

function formatMarketValue(value: MarketMoney | null | undefined, options: { maxDigits?: number } = {}): string {
  if (!value) return "-";
  if (value.eth != null) return formatEthValue(value, options.maxDigits);
  if (isEthLikeMarketMoney(value)) {
    const rawEth = getRawMarketNumber(value);
    return rawEth == null ? "-" : formatEthNumber(rawEth, options.maxDigits);
  }
  return formatRawMarketValue(value, options.maxDigits);
}

function marketMoneyToDecimal(value: MarketMoney | null | undefined): number | null {
  if (!value) return null;
  if (value.eth != null) return value.eth;
  return getRawMarketNumber(value);
}

function trimTradePriceDecimals(value: string): string {
  return value.includes(".") ? value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : value;
}

function formatTradePriceInput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const factor = 10 ** TRADE_PRICE_DECIMAL_PLACES;
  const rounded = Math.round(value * factor) / factor;
  const normalized = rounded > 0 ? rounded : 1 / factor;
  return trimTradePriceDecimals(normalized.toFixed(TRADE_PRICE_DECIMAL_PLACES));
}

function sanitizeTradePriceInput(value: string): string {
  const normalized = value.replace(/,/g, ".").replace(/[^\d.]/g, "");
  if (!normalized) return "";
  const [wholeRaw, ...fractionParts] = normalized.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");
  if (fractionParts.length === 0) return whole;
  const fraction = fractionParts.join("").slice(0, TRADE_PRICE_DECIMAL_PLACES);
  return `${whole || "0"}.${fraction}`;
}

function decimalEthToWeiString(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{0,18})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  return `${whole}${fraction.padEnd(18, "0").slice(0, 18)}`.replace(/^0+(?=\d)/, "") || "0";
}

function formatWeiTokenAmount(value: bigint, symbol: "ETH" | "WETH"): string {
  const divisor = 10n ** 18n;
  const whole = value / divisor;
  const fraction = value % divisor;
  const fractionText = fraction.toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return `${whole.toString()}${fractionText ? `.${fractionText}` : ""} ${symbol}`;
}

function getPreparedTransactionRawValue(tx: PreparedTransaction): string | null {
  const value = tx.value;
  if (value == null || value === "") return null;
  try {
    const raw = typeof value === "string" && value.startsWith("0x")
      ? BigInt(value)
      : BigInt(value);
    return raw > 0n ? raw.toString() : null;
  } catch {
    return null;
  }
}

function defaultOfferPrice(topOffer: MarketMoney | null | undefined): string {
  const numeric = marketMoneyToDecimal(topOffer);
  if (numeric == null || numeric <= 0) return "";
  return formatTradePriceInput(numeric);
}

function defaultListingPrice(floor: MarketMoney | null | undefined): string {
  const numeric = marketMoneyToDecimal(floor);
  if (numeric == null || numeric <= 0) return "";
  return formatTradePriceInput(numeric);
}

function hasMarketValue(value: MarketMoney | null | undefined): boolean {
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
  const focus = useFocus(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions(showTooltip ? [hover, focus, role] : []);

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps({
          "aria-label": showTooltip ? tooltip : undefined,
          tabIndex: showTooltip ? 0 : undefined,
          onClick: showTooltip ? () => setIsOpen((current) => !current) : undefined,
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
        <MarketValueChip kind="price" value={formatMarketValue(market?.listing, { maxDigits: 5 })} tooltip="Price" variant="column" showTooltip={false} className="w-full" />
        <MarketValueChip kind="offer" value={formatMarketValue(market?.offer, { maxDigits: 5 })} tooltip="Top Offer" variant="column" showTooltip={false} className="w-full" />
        <MarketValueChip kind="sold" value={formatMarketValue(market?.sale, { maxDigits: 5 })} tooltip="Latest Sale" variant="column" showTooltip={false} className="w-full border-r-0" />
      </span>
    </button>
  );
}

const OWNED_BY_VISIBLE_AVATAR_LIMIT = 24;

function OwnedByPanel({
  owner,
  currentTokenId,
  ownedTokenIds,
  onOpenWarplet,
  onSearchOwnerWallet,
}: {
  owner?: TokenMarketState["owner"];
  currentTokenId: number;
  ownedTokenIds: number[];
  onOpenWarplet: (tokenId: number) => void;
  onSearchOwnerWallet: (wallet: string) => void;
}) {
  const wallet = owner?.wallet?.trim() || null;
  const fid = typeof owner?.fid === "number" ? owner.fid : null;
  const username = owner?.username?.trim() || null;
  const displayName = owner?.displayName?.trim() || null;
  const pfpUrl = owner?.pfpUrl?.trim() || null;
  const allWarpletIds = Array.from(new Set([currentTokenId, ...ownedTokenIds])).sort((left, right) => left - right);
  const warpletIds = allWarpletIds.slice(0, OWNED_BY_VISIBLE_AVATAR_LIMIT);
  const ownedCount = allWarpletIds.length;
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
          {wallet && (
            <button
              type="button"
              onClick={() => {
                void hapticPrimaryTap();
                onSearchOwnerWallet(wallet);
              }}
              className="flex aspect-square w-full min-w-0 cursor-pointer items-center justify-center rounded-full border border-[#00FF00] bg-black text-base font-bold text-[#00FF00] transition-[border-width,background-color] duration-100 hover:border-2 hover:border-[#00FF00] hover:bg-[#041204]"
              title={`Search ${ownedCount.toLocaleString("en-US")} owned 10X Warplets`}
            >
              {ownedCount.toLocaleString("en-US")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function showTradeConfetti(): void {
  confetti({
    particleCount: 120,
    spread: 70,
    origin: { y: 0.72 },
    colors: ["#00FF00", "#FFFFFF", "#FFFF00"],
  });
}

const TRADE_TOAST_EXTRA_MS = 3000;
const TRADE_TOAST_EXIT_MS = 240;

function TradeToastView({
  toast,
  exiting,
  onClose,
}: {
  toast: TradeToast;
  exiting: boolean;
  onClose: () => void;
}) {
  const isDanger = toast.kind === "error" || toast.kind === "warning";
  return (
    <div
      className={`trade-toast ${isDanger ? "trade-toast--danger" : ""} ${exiting ? "trade-toast--exiting" : ""}`}
    >
      <div className="flex w-full items-center gap-3">
        <span className="min-w-0 flex-1">{toast.message}</span>
        <button
          type="button"
          aria-label="Close message"
          onClick={onClose}
          className="trade-toast__close"
        >
          X
        </button>
      </div>
    </div>
  );
}

function getTradeButtons({
  listed,
  offer,
  owner,
  ownItemOffer,
}: {
  listed: boolean;
  offer: boolean;
  owner: boolean;
  ownItemOffer: boolean;
}): Array<{ action: TradeActionName; label: string; variant: "primary" | "secondary" }> {
  if (owner) {
    if (listed && offer) {
      return [
        { action: "accept_offer", label: "Accept offer", variant: "primary" },
        { action: "cancel_listing", label: "Cancel listing", variant: "secondary" },
      ];
    }
    if (listed) return [{ action: "cancel_listing", label: "Cancel listing", variant: "primary" }];
    if (offer) {
      return [
        { action: "accept_offer", label: "Accept offer", variant: "primary" },
        { action: "list", label: "List for sale", variant: "secondary" },
      ];
    }
    return [{ action: "list", label: "List for sale", variant: "primary" }];
  }

  if (listed && ownItemOffer) {
    return [
      { action: "buy", label: "Buy now", variant: "primary" },
      { action: "cancel_offer", label: "Cancel offer", variant: "secondary" },
    ];
  }
  if (listed) {
    return [
      { action: "buy", label: "Buy now", variant: "primary" },
      { action: "make_offer", label: "Make offer", variant: "secondary" },
    ];
  }
  if (ownItemOffer) return [{ action: "cancel_offer", label: "Cancel offer", variant: "primary" }];
  return [{ action: "make_offer", label: "Make offer", variant: "primary" }];
}

function getActionLogName(action: TradeActionName): string {
  if (action === "buy") return "buy";
  if (action === "make_offer") return "make_offer";
  if (action === "cancel_offer") return "cancel_offer";
  if (action === "list") return "list";
  if (action === "cancel_listing") return "cancel_listing";
  return "accept_offer";
}

function isFirefoxBrowser(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("firefox");
}

function parseTradeAmount(value: string): number | null {
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatTradeTokenAmount(value: number, symbol: "ETH" | "WETH" = "ETH"): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${symbol}`;
}

function formatMarketEthForTradeCopy(value: MarketMoney | null | undefined): string {
  const amount = marketMoneyToDecimal(value);
  return amount == null ? "0 ETH" : formatTradeTokenAmount(amount, "ETH");
}

function formatFloorComparison(amount: string, floor: MarketMoney | null | undefined): string {
  const parsedAmount = parseTradeAmount(amount);
  const floorAmount = marketMoneyToDecimal(floor);
  if (parsedAmount == null || floorAmount == null || floorAmount <= 0) return "";
  const delta = ((parsedAmount - floorAmount) / floorAmount) * 100;
  if (Math.abs(delta) < 0.01) return " (current floor price)";
  const rounded = Math.round(delta);
  return ` (${rounded}% ${delta > 0 ? "above" : "below"} floor)`;
}

function formatUsdEstimate(amount: string, ethUsdPrice: number | null, floor?: MarketMoney | null): string {
  const parsedAmount = parseTradeAmount(amount);
  const suffix = formatFloorComparison(amount, floor);
  if (parsedAmount == null) return `~$0.00 USD${suffix}`;
  if (ethUsdPrice == null) return `USD loading...${suffix}`;
  return `~${(parsedAmount * ethUsdPrice).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USD${suffix}`;
}

async function fetchEthUsdPrice(): Promise<number> {
  const coinbase = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
    headers: { accept: "application/json" },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Coinbase ETH price failed (${response.status})`);
    const payload = await response.json() as { data?: { amount?: unknown } };
    const amount = typeof payload.data?.amount === "string" ? Number(payload.data.amount) : null;
    if (amount == null || !Number.isFinite(amount)) throw new Error("Coinbase ETH price response was invalid");
    return amount;
  }).catch(() => null);
  if (coinbase != null) return coinbase;

  const coingecko = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", {
    headers: { accept: "application/json" },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`CoinGecko ETH price failed (${response.status})`);
    const payload = await response.json() as { ethereum?: { usd?: unknown } };
    const amount = typeof payload.ethereum?.usd === "number" ? payload.ethereum.usd : null;
    if (amount == null || !Number.isFinite(amount)) throw new Error("CoinGecko ETH price response was invalid");
    return amount;
  });
  return coingecko;
}

function focusInputAtEnd(input: HTMLInputElement | null): void {
  if (!input) return;
  input.focus({ preventScroll: true });
  const caretPosition = input.value.length;
  try {
    input.setSelectionRange(caretPosition, caretPosition);
  } catch {
    // Some input modes may not support selection ranges; focus alone is still useful.
  }
}

function WarpletDetailsModal({
  details,
  onClose,
  onShare,
  onSearchTag,
  onLevelFilter,
  onOpenRelatedWarplet,
  onSearchOwnerWallet,
  market,
  ownedTokenIds,
  isRefreshingMarket,
  marketRefreshError,
  onRefreshMarket,
  viewerFid,
  onMergeMarketSnapshot,
  onClearMarketSide,
  onUpsertItemOffer,
  onApplyPurchase,
  stackIndex,
}: {
  details: WarpletDetails;
  onClose: () => void;
  onShare: () => void;
  onSearchTag: (tag: string) => void;
  onLevelFilter: (attribute: LevelAttributeColumn, level: number) => void;
  onOpenRelatedWarplet: (tokenId: number) => void;
  onSearchOwnerWallet: (wallet: string) => void;
  market: TokenMarketState;
  ownedTokenIds: number[];
  isRefreshingMarket: boolean;
  marketRefreshError: string;
  onRefreshMarket: () => void;
  viewerFid: number | null;
  onMergeMarketSnapshot: (tokenId: number, snapshot: MarketSnapshot) => void;
  onClearMarketSide: (tokenId: number, side: "listing" | "offer" | "collectionOffer") => void;
  onUpsertItemOffer: (tokenId: number, offer: MarketSnapshot["offers"][string]) => void;
  onApplyPurchase: (tokenId: number, update: OptimisticPurchaseUpdate) => void;
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
  const [tradeState, setTradeState] = useState<FreshTradeState | null>(null);
  const [optimisticSale, setOptimisticSale] = useState<MarketSnapshot["sales"][string] | null>(null);
  const [activeWallet, setActiveWallet] = useState<string | null>(null);
  const [tradeMode, setTradeMode] = useState<"idle" | "offer" | "list">("idle");
  const [offerPrice, setOfferPrice] = useState("");
  const [listingPrice, setListingPrice] = useState("");
  const [tradeBusyAction, setTradeBusyAction] = useState<TradeActionName | null>(null);
  const [tradeToast, setTradeToast] = useState<TradeToast | null>(null);
  const [tradeToastExiting, setTradeToastExiting] = useState(false);
  const [showFirefoxWalletWarning, setShowFirefoxWalletWarning] = useState(false);
  const [ethUsdPrice, setEthUsdPrice] = useState<number | null>(null);
  const tradeToastIdRef = useRef(0);
  const tradeToastHideTimerRef = useRef<number | null>(null);
  const tradeToastExitTimerRef = useRef<number | null>(null);
  const tradeBusyActionRef = useRef<TradeActionName | null>(null);
  const actionIdRef = useRef<string | null>(null);
  const optimisticOwnItemOfferRef = useRef<FreshTradeState["ownItemOffer"]>(null);
  const modalScrollRef = useRef<HTMLDivElement | null>(null);
  const modalHeaderRef = useRef<HTMLDivElement | null>(null);
  const marketSummaryRef = useRef<HTMLDivElement | null>(null);
  const offerFormRef = useRef<HTMLDivElement | null>(null);
  const listingFormRef = useRef<HTMLDivElement | null>(null);
  const offerInputRef = useRef<HTMLInputElement | null>(null);
  const listingInputRef = useRef<HTMLInputElement | null>(null);
  const ethUsdPriceFetchedAtRef = useRef(0);
  const [initializeModalScrollbars, getModalScrollbars] = useOverlayScrollbars({
    options: {
      scrollbars: {
        theme: "os-theme-10x",
        autoHide: "scroll",
        clickScroll: true,
      },
    },
    defer: true,
  });
  const rawEffectiveListing = tradeState ? tradeState.listing : market.listing ?? null;
  const effectiveItemOffer = tradeState ? tradeState.itemOffer : market.itemOffer ?? null;
  const effectiveCollectionOffer = tradeState ? tradeState.collectionOffer : market.collectionOffer ?? null;
  const effectiveTopOffer = tradeState ? tradeState.topOffer : chooseTopOffer(effectiveItemOffer ?? undefined, effectiveCollectionOffer ?? null);
  const effectiveSale = optimisticSale ?? (tradeState ? tradeState.sale ?? null : market.sale ?? null);
  const effectiveOwner = (() => {
    const freshOwner = tradeState?.owner;
    const cachedOwner = market.owner;
    if (!freshOwner) return cachedOwner ?? null;
    const freshWallet = freshOwner.wallet?.toLowerCase() ?? "";
    const cachedWallet = cachedOwner?.wallet?.toLowerCase() ?? "";
    if (cachedOwner && freshWallet && cachedWallet === freshWallet) {
      return {
        ...cachedOwner,
        wallet: freshOwner.wallet,
        fid: freshOwner.fid ?? cachedOwner.fid,
        checkedAt: freshOwner.checkedAt ?? cachedOwner.checkedAt,
      };
    }
    return freshOwner;
  })();
  const effectiveFloor = tradeState?.floor ?? null;
  const normalizedActiveWallet = activeWallet?.toLowerCase() ?? "";
  const ownerWallet = effectiveOwner?.wallet?.toLowerCase() ?? "";
  const listingSellerWallet = rawEffectiveListing?.seller?.toLowerCase() ?? "";
  const listingBelongsToOwner = Boolean(!ownerWallet || !listingSellerWallet || listingSellerWallet === ownerWallet);
  const effectiveListing = listingBelongsToOwner ? rawEffectiveListing : null;
  const isViewerOwnerByFid = Boolean(viewerFid != null && effectiveOwner?.fid === viewerFid);
  const isOwner = Boolean(
    (normalizedActiveWallet && ownerWallet && normalizedActiveWallet === ownerWallet) ||
    (!normalizedActiveWallet && isViewerOwnerByFid)
  );
  const hasListing = hasMarketValue(effectiveListing ?? undefined);
  const topOffererWallet = effectiveTopOffer?.offerer?.toLowerCase() ?? "";
  const topOfferIsOwnerCollectionOffer = Boolean(
    isOwner &&
    effectiveTopOffer?.source === "collection" &&
    ownerWallet &&
    topOffererWallet === ownerWallet,
  );
  const hasTopOffer = hasMarketValue(effectiveTopOffer ?? undefined);
  const hasSellableTopOffer = hasTopOffer && !topOfferIsOwnerCollectionOffer;
  const ownItemOfferOrder = tradeState?.ownItemOffer && hasMarketValue(tradeState.ownItemOffer)
    ? tradeState.ownItemOffer
    : normalizedActiveWallet &&
      effectiveItemOffer?.offerer?.toLowerCase() === normalizedActiveWallet &&
      hasMarketValue(effectiveItemOffer)
    ? { ...effectiveItemOffer, source: "item" as const }
    : null;
  const hasOwnItemOffer = Boolean(ownItemOfferOrder);
  const tradeButtons = getTradeButtons({
    listed: hasListing,
    offer: hasSellableTopOffer,
    owner: isOwner,
    ownItemOffer: hasOwnItemOffer,
  });
  const knownFloorPrice = defaultListingPrice(effectiveFloor);
  const knownTopOfferPrice = defaultOfferPrice(effectiveTopOffer);
  const listingAmount = parseTradeAmount(listingPrice);
  const offerAmount = parseTradeAmount(offerPrice);
  const activeListingAmount = marketMoneyToDecimal(effectiveListing);
  const topOfferAmount = marketMoneyToDecimal(effectiveTopOffer);
  const listingPriceIsAtOrBelowTopOffer = Boolean(
    listingAmount != null &&
    topOfferAmount != null &&
    topOfferAmount > 0 &&
    listingAmount <= topOfferAmount
  );
  const listingPriceIsValid = Boolean(
    listingAmount != null &&
    listingAmount >= MIN_LISTING_ETH &&
    decimalEthToWeiString(listingPrice) &&
    !listingPriceIsAtOrBelowTopOffer
  );
  const offerPriceIsValid = Boolean(
    offerAmount != null &&
    offerAmount > 0 &&
    decimalEthToWeiString(offerPrice)
  );
  const offerIsAboveCurrentListing = Boolean(
    offerAmount != null &&
    activeListingAmount != null &&
    activeListingAmount > 0 &&
    offerAmount > activeListingAmount
  );
  const chipGroups = [
    { label: "Colours", values: splitChips(row.warplet_colours) },
    { label: "Keywords", values: splitChips(row.warplet_keywords) },
    { label: "Traits", values: splitChips(row.warplet_traits) },
  ];

  const closeTradeToast = useCallback(() => {
    if (tradeToastHideTimerRef.current != null) {
      window.clearTimeout(tradeToastHideTimerRef.current);
      tradeToastHideTimerRef.current = null;
    }
    if (tradeToastExitTimerRef.current != null) {
      window.clearTimeout(tradeToastExitTimerRef.current);
      tradeToastExitTimerRef.current = null;
    }
    setTradeToastExiting(true);
    tradeToastExitTimerRef.current = window.setTimeout(() => {
      setTradeToast(null);
      setTradeToastExiting(false);
      tradeToastExitTimerRef.current = null;
    }, TRADE_TOAST_EXIT_MS);
  }, []);

  const showToast = useCallback((kind: TradeToast["kind"], message: string, options: { manualClose?: boolean; minMs?: number } = {}) => {
    if (tradeToastHideTimerRef.current != null) {
      window.clearTimeout(tradeToastHideTimerRef.current);
      tradeToastHideTimerRef.current = null;
    }
    if (tradeToastExitTimerRef.current != null) {
      window.clearTimeout(tradeToastExitTimerRef.current);
      tradeToastExitTimerRef.current = null;
    }
    const id = tradeToastIdRef.current + 1;
    tradeToastIdRef.current = id;
    const manualClose = options.manualClose || kind === "error" || kind === "warning";
    const toast: TradeToast = { id, kind, message, manualClose };
    setTradeToastExiting(false);
    setTradeToast(toast);
    if (!manualClose) {
      tradeToastHideTimerRef.current = window.setTimeout(() => {
        if (tradeToastIdRef.current !== id) return;
        setTradeToastExiting(true);
        tradeToastExitTimerRef.current = window.setTimeout(() => {
          setTradeToast((current) => (current?.id === id ? null : current));
          setTradeToastExiting(false);
          tradeToastExitTimerRef.current = null;
        }, TRADE_TOAST_EXIT_MS);
        tradeToastHideTimerRef.current = null;
      }, (options.minMs ?? 5000) + TRADE_TOAST_EXTRA_MS);
    }
  }, []);

  useEffect(() => () => {
    if (tradeToastHideTimerRef.current != null) window.clearTimeout(tradeToastHideTimerRef.current);
    if (tradeToastExitTimerRef.current != null) window.clearTimeout(tradeToastExitTimerRef.current);
  }, []);

  const postTradeLog = useCallback((payload: Record<string, unknown>) => {
    fetch("/api/warplet-trade/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionId: actionIdRef.current,
        fid: viewerFid,
        tokenId: details.id,
        walletFrom: activeWallet,
        ...payload,
      }),
    }).catch(() => {});
  }, [activeWallet, details.id, viewerFid]);

  const getProviderAndAccount = useCallback(async (
    preferredAccount?: string | null,
    options: { skipChainSwitch?: boolean } = {},
  ): Promise<{ provider: EthereumProvider; account: string }> => {
    const provider = (await sdk.wallet.getEthereumProvider()) as EthereumProvider | null;
    if (!provider) throw new Error("Farcaster wallet is not available");
    const accounts = await getWalletAccounts(provider, preferredAccount);
    const account = accounts[0] ?? preferredAccount;
    if (!account) throw new Error("No wallet account is connected");
    setActiveWallet(account);
    await ensureBaseChain(provider, undefined, { allowSkipSwitch: options.skipChainSwitch });
    return { provider, account };
  }, []);

  const refreshTradeState = useCallback(async (
    walletOverride?: string | null,
    options: { excludeCollectionOrderHash?: string | null } = {},
  ): Promise<FreshTradeState | null> => {
    const params = new URLSearchParams();
    const wallet = walletOverride ?? activeWallet ?? "";
    if (wallet) params.set("wallet", wallet);
    if (options.excludeCollectionOrderHash) params.set("excludeCollectionOrderHash", options.excludeCollectionOrderHash);
    const queryString = params.toString();
    const response = await fetch(`/api/warplet-trade-state/${details.id}${queryString ? `?${queryString}` : ""}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Trade state failed (${response.status})`);
    const next = (await response.json()) as FreshTradeState;
    const optimisticOffer = optimisticOwnItemOfferRef.current;
    const normalizedWallet = (walletOverride ?? activeWallet ?? "").toLowerCase();
    const shouldPreserveOptimisticOffer = Boolean(
      optimisticOffer &&
      normalizedWallet &&
      optimisticOffer.offerer?.toLowerCase() === normalizedWallet &&
      hasMarketValue(optimisticOffer) &&
      (
        !next.ownItemOffer ||
        !hasMarketValue(next.ownItemOffer) ||
        (getMarketNumber(optimisticOffer) ?? -1) >= (getMarketNumber(next.ownItemOffer) ?? -1)
      )
    );
    const preservedTopOffer = optimisticOffer
      ? chooseTopOffer(optimisticOffer, next.collectionOffer) as FreshTradeState["topOffer"]
      : null;
    const merged: FreshTradeState = shouldPreserveOptimisticOffer && optimisticOffer
      ? {
          ...next,
          itemOffer: optimisticOffer,
          ownItemOffer: optimisticOffer,
          topOffer: preservedTopOffer,
        }
      : next;
    if (!shouldPreserveOptimisticOffer && next.ownItemOffer?.orderHash === optimisticOffer?.orderHash) {
      optimisticOwnItemOfferRef.current = null;
    }
    setTradeState(merged);
    setOptimisticSale(merged.sale ?? null);
    if (next.owner?.wallet) setActiveWallet((current) => current);
    if (next.snapshot) onMergeMarketSnapshot(details.id, next.snapshot);
    if (shouldPreserveOptimisticOffer && optimisticOffer) onUpsertItemOffer(details.id, optimisticOffer);
    setOfferPrice((current) => current || defaultOfferPrice(merged.topOffer));
    setListingPrice((current) => current || defaultListingPrice(merged.floor));
    return merged;
  }, [activeWallet, details.id, onMergeMarketSnapshot, onUpsertItemOffer]);

  useEffect(() => {
    let cancelled = false;
    const loadPassiveWallet = async () => {
      try {
        const provider = (await sdk.wallet.getEthereumProvider()) as EthereumProvider | null;
        if (!provider) return;
        const raw = await provider.request({ method: "eth_accounts" }).catch(() => []);
        const account = Array.isArray(raw) && typeof raw[0] === "string" ? raw[0] : null;
        if (account && !cancelled) {
          setActiveWallet(account);
          await refreshTradeState(account);
        } else if (!cancelled) {
          await refreshTradeState(null);
        }
      } catch {
        if (!cancelled) {
          refreshTradeState(null).catch(() => {});
        }
      }
    };
    void loadPassiveWallet();
    return () => {
      cancelled = true;
    };
  }, [details.id, refreshTradeState]);

  useEffect(() => {
    if (!tradeState) return;
    setOfferPrice((current) => current || defaultOfferPrice(tradeState.topOffer));
    setListingPrice((current) => current || defaultListingPrice(tradeState.floor));
  }, [tradeState]);

  useEffect(() => {
    const target = modalScrollRef.current;
    if (!target) return;
    target.setAttribute("data-overlayscrollbars-initialize", "");
    initializeModalScrollbars(target);
    return () => {
      target.removeAttribute("data-overlayscrollbars-initialize");
    };
  }, [initializeModalScrollbars]);

  useEffect(() => {
    if (tradeMode === "idle") return;
    const frame = window.requestAnimationFrame(() => {
      const input = tradeMode === "offer" ? offerInputRef.current : listingInputRef.current;
      focusInputAtEnd(input);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tradeMode]);

  useEffect(() => {
    if (tradeMode === "idle") return;
    if (ethUsdPrice != null && Date.now() - ethUsdPriceFetchedAtRef.current < ETH_USD_PRICE_STALE_MS) return;

    let cancelled = false;
    fetchEthUsdPrice()
      .then((price) => {
        if (cancelled) return;
        setEthUsdPrice(price);
        ethUsdPriceFetchedAtRef.current = Date.now();
      })
      .catch((error) => {
        console.error("Failed to fetch ETH/USD price:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [ethUsdPrice, tradeMode]);

  const handleOpenFarcasterProfile = () => {
    if (!farcasterFid) return;
    void hapticTap();
    sdk.actions.viewProfile({ fid: farcasterFid }).catch((error) => {
      console.error("Failed to open Farcaster profile:", error);
    });
  };

  const handleTradeError = useCallback((action: TradeActionName, error: unknown) => {
    const message = getWalletErrorMessage(error);
    const rejected = isUserRejected(error);
    void (rejected ? hapticWarning() : hapticError());
    postTradeLog({
      actionName: getActionLogName(action),
      status: rejected ? "rejected" : "error",
      phase: rejected ? "user_rejected" : "wallet_error",
      walletErrorCode: getWalletErrorCode(error),
      errorMessage: message,
    });
    showToast(
      rejected ? "neutral" : "error",
      rejected
        ? action === "buy"
          ? "Item not purchased"
          : action === "make_offer"
          ? "Offer not made"
          : action === "cancel_offer"
          ? "Offer not canceled"
          : action === "list"
          ? "Item not listed"
          : action === "cancel_listing"
          ? "Listing not canceled"
          : "Offer not accepted"
        : message,
      { manualClose: !rejected, minMs: 5000 },
    );
  }, [postTradeLog, showToast]);

  const showFirefoxWarningIfNeeded = useCallback(() => {
    if (isFirefoxBrowser()) setShowFirefoxWalletWarning(true);
  }, []);

  const handleFreshMismatch = useCallback((payload: { freshState?: FreshTradeState }) => {
    if (payload.freshState) {
      setTradeState(payload.freshState);
      if (payload.freshState.snapshot) onMergeMarketSnapshot(details.id, payload.freshState.snapshot);
    }
    void hapticWarning();
    showToast("warning", "The price has changed. Refreshing...", { minMs: 5000 });
  }, [details.id, onMergeMarketSnapshot, showToast]);

  const applyOptimisticItemOffer = useCallback((account: string, rawAmount: string, protocolAddress: string, orderHash?: string | null) => {
    const now = new Date().toISOString();
    const optimisticEth = getRawMarketNumber({
      eth: null,
      at: now,
      rawAmount,
      decimals: 18,
      currencySymbol: "WETH",
      tokenAddress: BASE_WETH_TOKEN_ADDRESS,
    });
    const offer: NonNullable<FreshTradeState["itemOffer"]> = {
      eth: optimisticEth,
      at: now,
      rawAmount,
      decimals: 18,
      currencySymbol: "WETH",
      tokenAddress: BASE_WETH_TOKEN_ADDRESS,
      orderHash: orderHash ?? null,
      protocolAddress,
      offerer: account.toLowerCase(),
      source: "item",
    };
    optimisticOwnItemOfferRef.current = offer;
    const chooseFreshTopOffer = (
      collectionOffer: FreshTradeState["collectionOffer"],
    ): NonNullable<FreshTradeState["topOffer"]> => {
      if (!collectionOffer) return offer;
      const itemValue = getMarketNumber(offer);
      const collectionValue = getMarketNumber(collectionOffer);
      if (itemValue == null) return collectionOffer;
      if (collectionValue == null) return offer;
      return itemValue >= collectionValue ? offer : collectionOffer;
    };
    setTradeState((current) => {
      if (!current) {
        return {
          tokenId: details.id,
          generatedAt: now,
          listing: effectiveListing ?? null,
          itemOffer: offer,
          collectionOffer: effectiveCollectionOffer ?? null,
          topOffer: chooseFreshTopOffer(effectiveCollectionOffer ?? null),
          ownItemOffer: offer,
          floor: effectiveFloor ?? null,
          owner: {
            wallet: effectiveOwner?.wallet ?? null,
            fid: effectiveOwner?.fid ?? null,
            checkedAt: effectiveOwner?.checkedAt ?? null,
          },
        };
      }
      return {
        ...current,
        itemOffer: offer,
        ownItemOffer: offer,
        topOffer: chooseFreshTopOffer(current.collectionOffer ?? null),
        generatedAt: now,
      };
    });
    onUpsertItemOffer(details.id, offer);
  }, [details.id, effectiveCollectionOffer, effectiveFloor, effectiveListing, effectiveOwner, onUpsertItemOffer]);

  const assertConnectedOwnerWallet = useCallback((account: string) => {
    const expectedOwner = ownerWallet;
    if (expectedOwner && account.toLowerCase() !== expectedOwner) {
      throw new Error("Connected wallet does not own this Warplet.");
    }
  }, [ownerWallet]);

  const runBuyNow = useCallback(async () => {
    const actionId = crypto.randomUUID();
    actionIdRef.current = actionId;
    setTradeBusyAction("buy");
    try {
      showFirefoxWarningIfNeeded();
      void hapticPrimaryTap();
      const { provider, account } = await getProviderAndAccount();
      const response = await fetch("/api/warplet-trade/buy/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionId,
          fid: viewerFid,
          tokenId: details.id,
          wallet: account,
          expectedOrderHash: effectiveListing?.orderHash,
          expectedRawAmount: effectiveListing?.rawAmount,
        }),
      });
      const payload = await response.json() as { status?: string; freshState?: FreshTradeState; fulfillment?: unknown; state?: FreshTradeState; chainIdHex?: string; message?: string };
      if (response.status === 409 || payload.status === "mismatch") {
        handleFreshMismatch(payload);
        return;
      }
      if (!response.ok) throw new Error(payload.message || `Buy prepare failed (${response.status})`);
      if (payload.state) setTradeState(payload.state);
      const purchasedListing = payload.state?.listing ?? effectiveListing ?? null;
      await ensureBaseChain(provider, payload.chainIdHex ?? undefined);
      postTradeLog({ actionName: "buy", status: "requested", phase: "transaction_requested" });
      const tx = extractFulfillmentTransaction(payload.fulfillment);
      if (!tx) throw new Error("OpenSea did not return a buy transaction");
      const hash = await sendPreparedTransaction(provider, account, tx);
      postTradeLog({ actionName: "buy", status: "submitted", phase: "transaction_submitted", transactionHash: hash });
      postTradeLog({ actionName: "buy", status: "confirmed", phase: "confirmed", transactionHash: hash });
      await refreshTradeState(account).catch((error) => {
        console.warn("Fresh trade state after buy was not ready yet:", error);
      });
      const now = new Date().toISOString();
      const transactionRawValue = getPreparedTransactionRawValue(tx);
      const saleRawAmount = purchasedListing?.rawAmount ?? transactionRawValue;
      const saleEth = purchasedListing?.eth ?? (saleRawAmount
        ? getRawMarketNumber({
            eth: null,
            at: now,
            rawAmount: saleRawAmount,
            decimals: 18,
            currencySymbol: "ETH",
            tokenAddress: NATIVE_TOKEN_ADDRESS,
          })
        : null);
      const sale: MarketSnapshot["sales"][string] = {
        eth: saleEth,
        at: now,
        rawAmount: saleRawAmount ?? null,
        decimals: purchasedListing?.decimals ?? (saleRawAmount ? 18 : null),
        currencySymbol: purchasedListing?.currencySymbol ?? (saleRawAmount ? "ETH" : null),
        tokenAddress: purchasedListing?.tokenAddress ?? (saleRawAmount ? NATIVE_TOKEN_ADDRESS : null),
        txHash: hash,
        seller: purchasedListing?.seller ?? null,
      };
      setOptimisticSale(sale);
      onApplyPurchase(details.id, {
        buyerWallet: account,
        buyerFid: viewerFid,
        sale,
      });
      setTradeState((current) => {
        const itemOffer = current?.itemOffer ?? (effectiveItemOffer ? { ...effectiveItemOffer, source: "item" as const } : null);
        const collectionOffer = current?.collectionOffer ?? effectiveCollectionOffer ?? null;
        const topOffer = current?.topOffer ?? (chooseTopOffer(itemOffer ?? undefined, collectionOffer) as FreshTradeState["topOffer"]) ?? null;
        return {
          tokenId: details.id,
          generatedAt: now,
          listing: null,
          itemOffer,
          collectionOffer,
          topOffer,
          ownItemOffer: current?.ownItemOffer ?? null,
          floor: current?.floor ?? effectiveFloor ?? null,
          owner: {
            wallet: account.toLowerCase(),
            fid: viewerFid,
            checkedAt: now,
          },
        };
      });
      setTradeMode("idle");
      void hapticSuccess();
      showTradeConfetti();
      showToast("success", "Item successfully purchased", { minMs: 5000 });
    } catch (error) {
      handleTradeError("buy", error);
    } finally {
      setTradeBusyAction(null);
    }
  }, [details.id, effectiveCollectionOffer, effectiveFloor, effectiveItemOffer, effectiveListing, effectiveTopOffer, getProviderAndAccount, handleFreshMismatch, handleTradeError, onApplyPurchase, postTradeLog, refreshTradeState, showFirefoxWarningIfNeeded, showToast, viewerFid]);

  const runAcceptOffer = useCallback(async () => {
    const actionId = crypto.randomUUID();
    actionIdRef.current = actionId;
    setTradeBusyAction("accept_offer");
    try {
      showFirefoxWarningIfNeeded();
      void hapticPrimaryTap();
      const { provider, account } = await getProviderAndAccount(ownerWallet);
      assertConnectedOwnerWallet(account);
      const response = await fetch("/api/warplet-trade/offer/accept/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionId,
          fid: viewerFid,
          tokenId: details.id,
          wallet: account,
          expectedOrderHash: effectiveTopOffer?.orderHash,
          expectedRawAmount: effectiveTopOffer?.rawAmount,
        }),
      });
      const payload = await response.json() as {
        status?: string;
        freshState?: FreshTradeState;
        fulfillment?: unknown;
        state?: FreshTradeState;
        chainIdHex?: string;
        nftApproval?: NftApprovalRequirement;
        message?: string;
      };
      if (response.status === 409 || payload.status === "mismatch") {
        handleFreshMismatch(payload);
        return;
      }
      if (!response.ok) throw new Error(payload.message || `Accept offer prepare failed (${response.status})`);
      const acceptedOffer = payload.state?.topOffer ?? effectiveTopOffer ?? null;
      const acceptedCollectionOfferHash = acceptedOffer?.source === "collection" ? acceptedOffer.orderHash ?? null : null;
      if (payload.state) setTradeState(payload.state);
      await ensureBaseChain(provider, payload.chainIdHex ?? undefined);
      showToast("neutral", "Note: Received ETH excludes OpenSea fees.", { minMs: 5000 });
      if (payload.nftApproval) {
        postTradeLog({ actionName: "accept_offer", status: "requested", phase: "approval_requested" });
        await ensureErc721ApprovalForAll(provider, account, payload.nftApproval);
        postTradeLog({ actionName: "accept_offer", status: "approved", phase: "approval_success" });
      }
      postTradeLog({ actionName: "accept_offer", status: "requested", phase: "transaction_requested" });
      const tx = extractFulfillmentTransaction(payload.fulfillment);
      if (!tx) throw new Error("OpenSea did not return an offer fulfillment transaction");
      const hash = await sendPreparedTransaction(provider, account, tx);
      postTradeLog({ actionName: "accept_offer", status: "submitted", phase: "transaction_submitted", transactionHash: hash });
      postTradeLog({ actionName: "accept_offer", status: "confirmed", phase: "confirmed", transactionHash: hash });
      const now = new Date().toISOString();
      const acceptedBuyerWallet = acceptedOffer?.offerer ?? null;
      const sale: MarketSnapshot["sales"][string] = {
        eth: acceptedOffer?.eth ?? null,
        at: now,
        rawAmount: acceptedOffer?.rawAmount ?? null,
        decimals: acceptedOffer?.decimals ?? null,
        currencySymbol: acceptedOffer?.currencySymbol ?? null,
        tokenAddress: acceptedOffer?.tokenAddress ?? null,
        txHash: hash,
        seller: account.toLowerCase(),
      };
      setOptimisticSale(sale);
      const acceptedBuyerProfile: Partial<MarketSnapshot["owners"][string]> | undefined =
        acceptedBuyerWallet && wallet && acceptedBuyerWallet.toLowerCase() === wallet.toLowerCase()
          ? {
              wallet: acceptedBuyerWallet.toLowerCase(),
              fid: farcasterFid,
              username: farcasterUsername || null,
              displayName: farcasterUsername || null,
            }
          : undefined;
      if (acceptedBuyerWallet) {
        onApplyPurchase(details.id, {
          buyerWallet: acceptedBuyerWallet,
          buyerFid: acceptedBuyerProfile?.fid ?? null,
          buyerProfile: acceptedBuyerProfile,
          sale,
        });
      } else {
        onClearMarketSide(details.id, "listing");
      }
      if (acceptedOffer?.source === "item") onClearMarketSide(details.id, "offer");
      const refreshed = await refreshTradeState(account, {
        excludeCollectionOrderHash: acceptedCollectionOfferHash,
      }).catch((error) => {
        console.warn("Fresh trade state after accepting offer was not ready yet:", error);
        return null;
      });
      setOptimisticSale(sale);
      setTradeState((current) => {
        const itemOffer = acceptedOffer?.source === "item" ? null : current?.itemOffer ?? effectiveItemOffer ?? null;
        const collectionOffer = acceptedOffer?.source === "collection"
          ? refreshed?.collectionOffer ?? null
          : current?.collectionOffer ?? effectiveCollectionOffer ?? null;
        const nextOwnerWallet = acceptedBuyerWallet?.toLowerCase() ?? current?.owner.wallet ?? null;
        const refreshedOwner = refreshed?.snapshot?.owners?.[String(details.id)] ?? null;
        const currentOwner = current?.owner as MarketSnapshot["owners"][string] | undefined;
        const matchingOwnerProfile = [refreshedOwner, market.owner, currentOwner, acceptedBuyerProfile].find(
          (owner) => owner?.wallet?.toLowerCase() === nextOwnerWallet &&
            (owner.username || owner.displayName || owner.pfpUrl || owner.followerCount != null || owner.followingCount != null),
        );
        return {
          tokenId: details.id,
          generatedAt: now,
          listing: null,
          itemOffer: itemOffer ? { ...itemOffer, source: "item" as const } : null,
          collectionOffer,
          topOffer: chooseTopOffer(itemOffer ? { ...itemOffer, source: "item" as const } : undefined, collectionOffer) as FreshTradeState["topOffer"],
          ownItemOffer: acceptedOffer?.source === "item" ? null : current?.ownItemOffer ?? null,
          sale,
          floor: current?.floor ?? effectiveFloor ?? null,
          owner: {
            ...(matchingOwnerProfile ?? {}),
            wallet: nextOwnerWallet,
            fid: matchingOwnerProfile?.fid ?? acceptedBuyerProfile?.fid ?? refreshed?.owner.fid ?? current?.owner.fid ?? null,
            checkedAt: now,
          },
        };
      });
      if (acceptedCollectionOfferHash) {
        if (refreshed?.collectionOffer) {
          if (refreshed.snapshot) onMergeMarketSnapshot(details.id, refreshed.snapshot);
        } else {
          setTradeState((current) => current
            ? current.collectionOffer?.orderHash === acceptedCollectionOfferHash
              ? { ...current, collectionOffer: null, topOffer: current.itemOffer ?? null }
              : current
            : current);
          onClearMarketSide(details.id, "collectionOffer");
        }
        window.setTimeout(() => {
          void refreshTradeState(account, { excludeCollectionOrderHash: acceptedCollectionOfferHash })
            .then((next) => {
              if (!next?.sale || (sale.txHash && next.sale.txHash !== sale.txHash)) {
                setOptimisticSale(sale);
              }
            });
        }, 5000);
      }
      if (acceptedBuyerWallet) {
        onApplyPurchase(details.id, {
          buyerWallet: acceptedBuyerWallet,
          buyerFid: acceptedBuyerProfile?.fid ?? null,
          buyerProfile: acceptedBuyerProfile,
          sale,
        });
      }
      void hapticSuccess();
      showTradeConfetti();
      showToast("success", "Offer successfully accepted", { minMs: 5000 });
    } catch (error) {
      handleTradeError("accept_offer", error);
    } finally {
      setTradeBusyAction(null);
    }
  }, [assertConnectedOwnerWallet, details.id, effectiveCollectionOffer, effectiveFloor, effectiveItemOffer, effectiveTopOffer, farcasterFid, farcasterUsername, getProviderAndAccount, handleFreshMismatch, handleTradeError, market.owner, onApplyPurchase, onClearMarketSide, onMergeMarketSnapshot, postTradeLog, refreshTradeState, showFirefoxWarningIfNeeded, showToast, viewerFid, wallet]);

  const runListForSale = useCallback(async () => {
    if (tradeBusyActionRef.current) return;
    const priceRaw = decimalEthToWeiString(listingPrice);
    if (!priceRaw || BigInt(priceRaw) < 10000n) {
      showToast("error", "Enter a listing price of at least 0.00000000000001 ETH.", { manualClose: true });
      return;
    }
    if (listingPriceIsAtOrBelowTopOffer) {
      showToast("error", `Listing price must be above the current Top Offer of ${formatMarketEthForTradeCopy(effectiveTopOffer)}.`, { manualClose: true });
      return;
    }
    const actionId = crypto.randomUUID();
    actionIdRef.current = actionId;
    tradeBusyActionRef.current = "list";
    setTradeBusyAction("list");
    try {
      showFirefoxWarningIfNeeded();
      void hapticPrimaryTap();
      const { provider, account } = await getProviderAndAccount(ownerWallet, { skipChainSwitch: true });
      assertConnectedOwnerWallet(account);
      const prepare = await fetch("/api/warplet-trade/listing/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId, fid: viewerFid, tokenId: details.id, wallet: account, priceRaw, durationSeconds: DEFAULT_TRADE_DURATION_SECONDS }),
      });
      const payload = await prepare.json() as { actions?: unknown; chainIdHex?: string; message?: string };
      if (!prepare.ok) throw new Error(payload.message || `Listing prepare failed (${prepare.status})`);
      postTradeLog({ actionName: "list", status: "requested", phase: "signature_requested", expectedPriceRaw: priceRaw });
      showToast("neutral", "Check your Farcaster wallet to confirm the listing...", { minMs: 5000 });
      const signed = await executeOpenSeaActions(provider, account, payload.actions);
      postTradeLog({ actionName: "list", status: "signed", phase: "signature_success", expectedPriceRaw: priceRaw });
      const submit = await fetch("/api/warplet-trade/listing/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId, payload: signed.payload }),
      });
      if (!submit.ok) {
        const failure = await submit.json().catch(() => ({})) as { message?: string };
        throw new Error(failure.message || `Listing submit failed (${submit.status})`);
      }
      await refreshTradeState(account);
      void hapticSuccess();
      showTradeConfetti();
      setTradeMode("idle");
      showToast("success", "Item successfully listed", { minMs: 5000 });
    } catch (error) {
      handleTradeError("list", error);
    } finally {
      tradeBusyActionRef.current = null;
      setTradeBusyAction(null);
    }
  }, [assertConnectedOwnerWallet, details.id, effectiveTopOffer, getProviderAndAccount, handleTradeError, listingPrice, listingPriceIsAtOrBelowTopOffer, postTradeLog, refreshTradeState, showFirefoxWarningIfNeeded, showToast, viewerFid]);

  const runMakeOffer = useCallback(async () => {
    const priceRaw = decimalEthToWeiString(offerPrice);
    if (!priceRaw || BigInt(priceRaw) <= 0n) {
      showToast("error", "Enter a valid offer price.", { manualClose: true });
      return;
    }
    const actionId = crypto.randomUUID();
    actionIdRef.current = actionId;
    setTradeBusyAction("make_offer");
    try {
      showFirefoxWarningIfNeeded();
      void hapticPrimaryTap();
      const { provider, account } = await getProviderAndAccount(null, { skipChainSwitch: true });
      const prepare = await fetch("/api/warplet-trade/offer/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId, fid: viewerFid, tokenId: details.id, wallet: account, priceRaw, durationSeconds: DEFAULT_TRADE_DURATION_SECONDS }),
      });
      const payload = await prepare.json() as {
        protocol?: string;
        protocolAddress?: string;
        parameters?: unknown;
        typedData?: unknown;
        chainIdHex?: string;
        wethApproval?: TokenApprovalRequirement;
        message?: string;
      };
      if (!prepare.ok) throw new Error(payload.message || `Offer prepare failed (${prepare.status})`);
      if (payload.wethApproval) {
        await ensureBaseChain(provider, payload.chainIdHex ?? undefined);
        const requiredWeth = BigInt(payload.wethApproval.amount);
        const currentWeth = await readErc20Balance(payload.wethApproval.tokenAddress, account);
        if (currentWeth < requiredWeth) {
          const missingWeth = requiredWeth - currentWeth;
          const nativeEth = await readNativeBalance(account);
          if (nativeEth <= missingWeth) {
            throw new Error(
              `Offer requires ${formatWeiTokenAmount(requiredWeth, "WETH")}. Wallet has ${formatWeiTokenAmount(currentWeth, "WETH")} and ${formatWeiTokenAmount(nativeEth, "ETH")}.`,
            );
          }
          postTradeLog({ actionName: "make_offer", status: "requested", phase: "transaction_requested", expectedPriceRaw: priceRaw });
          showToast("neutral", `Wrap ${formatWeiTokenAmount(missingWeth, "ETH")} to WETH to make this offer...`, { minMs: 5000 });
          const wrapHash = await wrapEthToWeth(provider, account, payload.wethApproval.tokenAddress, missingWeth);
          postTradeLog({ actionName: "make_offer", status: "submitted", phase: "transaction_submitted", transactionHash: wrapHash, expectedPriceRaw: priceRaw });
          showToast("neutral", "ETH wrapped to WETH. Continuing offer...", { minMs: 5000 });
        }
        postTradeLog({ actionName: "make_offer", status: "requested", phase: "approval_requested", expectedPriceRaw: priceRaw });
        await ensureErc20Approval(provider, account, payload.wethApproval);
        postTradeLog({ actionName: "make_offer", status: "approved", phase: "approval_success", expectedPriceRaw: priceRaw });
      }
      postTradeLog({ actionName: "make_offer", status: "requested", phase: "signature_requested", expectedPriceRaw: priceRaw });
      showToast("neutral", "Check your Farcaster wallet to confirm the offer...", { minMs: 5000 });
      if (!payload.typedData || !payload.parameters || !payload.protocolAddress) {
        throw new Error("OpenSea did not return item offer signature data");
      }
      const signature = await signTypedData(provider, account, payload.typedData);
      postTradeLog({ actionName: "make_offer", status: "signed", phase: "signature_success", expectedPriceRaw: priceRaw });
      const submit = await fetch("/api/warplet-trade/offer/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionId,
          protocol: payload.protocol ?? "seaport",
          payload: {
            parameters: payload.parameters,
            protocol_address: payload.protocolAddress,
            signature,
          },
        }),
      });
      if (!submit.ok) {
        const failure = await submit.json().catch(() => ({})) as { message?: string };
        throw new Error(failure.message || `Offer submit failed (${submit.status})`);
      }
      const submitPayload = await submit.json().catch(() => ({})) as {
        result?: {
          order_hash?: string;
          orderHash?: string;
        };
      };
      applyOptimisticItemOffer(account, priceRaw, payload.protocolAddress, submitPayload.result?.order_hash ?? submitPayload.result?.orderHash ?? null);
      void refreshTradeState(account);
      window.setTimeout(() => {
        void refreshTradeState(account);
      }, 5000);
      void hapticSuccess();
      showTradeConfetti();
      setTradeMode("idle");
      showToast("success", "Offer successfully made", { minMs: 5000 });
    } catch (error) {
      handleTradeError("make_offer", error);
    } finally {
      setTradeBusyAction(null);
    }
  }, [applyOptimisticItemOffer, details.id, getProviderAndAccount, handleTradeError, offerPrice, postTradeLog, refreshTradeState, showFirefoxWarningIfNeeded, showToast, viewerFid]);

  const runCancelOrder = useCallback(async (action: "cancel_offer" | "cancel_listing") => {
    const order = action === "cancel_offer" ? ownItemOfferOrder : effectiveListing;
    if (!order?.orderHash || !order.protocolAddress) {
      showToast("error", "No active order is available to cancel.", { manualClose: true });
      return;
    }
    const actionId = crypto.randomUUID();
    actionIdRef.current = actionId;
    setTradeBusyAction(action);
    try {
      showFirefoxWarningIfNeeded();
      void hapticPrimaryTap();
      const { provider, account } = await getProviderAndAccount(
        action === "cancel_listing" ? ownerWallet : null,
        { skipChainSwitch: true },
      );
      if (action === "cancel_listing") assertConnectedOwnerWallet(account);
      if (
        action === "cancel_listing" &&
        effectiveListing?.seller &&
        effectiveListing.seller.toLowerCase() !== account.toLowerCase()
      ) {
        setTradeState((current) => current ? { ...current, listing: null } : current);
        onClearMarketSide(details.id, "listing");
        showToast("error", "This listing belongs to another wallet and cannot be canceled.", { manualClose: true });
        return;
      }
      postTradeLog({ actionName: getActionLogName(action), status: "requested", phase: "prepare_requested", orderHash: order.orderHash, protocolAddress: order.protocolAddress });
      const endpoint = action === "cancel_offer" ? "/api/warplet-trade/offer/cancel-prepare" : "/api/warplet-trade/listing/cancel-prepare";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionId,
          fid: viewerFid,
          tokenId: details.id,
          wallet: account,
          orderHash: order.orderHash,
          protocolAddress: order.protocolAddress,
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        chainIdHex?: string;
        protocolAddress?: string;
        orderParameters?: SeaportCancelOrderParameters;
        message?: string;
      };
      if (!response.ok) throw new Error(payload.message || `Cancel prepare failed (${response.status})`);
      if (!payload.protocolAddress || !payload.orderParameters) throw new Error("OpenSea did not return cancel transaction data");
      await ensureBaseChain(provider, payload.chainIdHex ?? undefined);
      postTradeLog({ actionName: getActionLogName(action), status: "requested", phase: "transaction_requested", orderHash: order.orderHash, protocolAddress: payload.protocolAddress });
      showToast("neutral", "Check your Farcaster wallet to confirm cancellation...", { minMs: 5000 });
      const hash = await sendPreparedTransaction(
        provider,
        account,
        buildSeaportCancelTransaction(payload.protocolAddress, payload.orderParameters),
      );
      postTradeLog({ actionName: getActionLogName(action), status: "submitted", phase: "transaction_submitted", orderHash: order.orderHash, protocolAddress: payload.protocolAddress, transactionHash: hash });
      postTradeLog({ actionName: getActionLogName(action), status: "confirmed", phase: "confirmed", orderHash: order.orderHash, protocolAddress: payload.protocolAddress, transactionHash: hash });
      if (action === "cancel_listing") {
        setTradeState((current) => current ? { ...current, listing: null } : current);
        onClearMarketSide(details.id, "listing");
      } else {
        optimisticOwnItemOfferRef.current = null;
        setTradeState((current) => current ? { ...current, itemOffer: null, ownItemOffer: null, topOffer: current.collectionOffer ?? null } : current);
        onClearMarketSide(details.id, "offer");
      }
      await refreshTradeState(account);
      if (action === "cancel_listing") {
        setTradeState((current) => current ? { ...current, listing: null } : current);
        onClearMarketSide(details.id, "listing");
      } else {
        optimisticOwnItemOfferRef.current = null;
        setTradeState((current) => current ? { ...current, itemOffer: null, ownItemOffer: null, topOffer: current.collectionOffer ?? null } : current);
        onClearMarketSide(details.id, "offer");
      }
      void hapticSuccess();
      showTradeConfetti();
      showToast("success", action === "cancel_offer" ? "Offer successfully canceled" : "Listing successfully canceled", { minMs: 5000 });
    } catch (error) {
      handleTradeError(action, error);
    } finally {
      setTradeBusyAction(null);
    }
  }, [assertConnectedOwnerWallet, details.id, effectiveListing, getProviderAndAccount, handleTradeError, onClearMarketSide, ownItemOfferOrder, postTradeLog, refreshTradeState, showFirefoxWarningIfNeeded, showToast, viewerFid]);

  const scrollTradeFormToTop = useCallback((mode: "offer" | "list") => {
    const container = getModalScrollbars()?.elements().viewport ?? modalScrollRef.current;
    const target = marketSummaryRef.current ?? (mode === "offer" ? offerFormRef.current : listingFormRef.current);
    if (!container || !target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const headerHeight = modalHeaderRef.current?.getBoundingClientRect().height ?? 0;
    const targetTop = container.scrollTop + targetRect.top - containerRect.top - headerHeight - 8;
    container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  }, [getModalScrollbars]);

  const focusTradeInput = useCallback((mode: "offer" | "list") => {
    scrollTradeFormToTop(mode);
    const input = mode === "offer" ? offerInputRef.current : listingInputRef.current;
    focusInputAtEnd(input);
    window.setTimeout(() => {
      scrollTradeFormToTop(mode);
      const laterInput = mode === "offer" ? offerInputRef.current : listingInputRef.current;
      if (laterInput && document.activeElement !== laterInput) {
        focusInputAtEnd(laterInput);
      }
    }, 0);
    window.setTimeout(() => {
      scrollTradeFormToTop(mode);
    }, 350);
  }, [scrollTradeFormToTop]);

  const handleTradeAction = useCallback((action: TradeActionName) => {
    void hapticSelectionChanged();
    showFirefoxWarningIfNeeded();
    if (action === "make_offer") {
      flushSync(() => {
        setTradeMode("offer");
        setOfferPrice(defaultOfferPrice(effectiveTopOffer));
      });
      focusTradeInput("offer");
      return;
    }
    if (action === "list") {
      flushSync(() => {
        setTradeMode("list");
        setListingPrice(defaultListingPrice(effectiveFloor));
      });
      focusTradeInput("list");
      return;
    }
    if (action === "buy") void runBuyNow();
    if (action === "accept_offer") void runAcceptOffer();
    if (action === "cancel_offer") void runCancelOrder("cancel_offer");
    if (action === "cancel_listing") void runCancelOrder("cancel_listing");
  }, [effectiveFloor, effectiveTopOffer, focusTradeInput, runAcceptOffer, runBuyNow, runCancelOrder, showFirefoxWarningIfNeeded]);

  const marketSummaryPanels = (
    <div ref={marketSummaryRef} className="grid scroll-mt-16 grid-cols-3 overflow-hidden">
      {[
        { kind: "price" as const, label: "Price", money: effectiveListing, emptyValue: "Not listed" },
        { kind: "offer" as const, label: "Top Offer", money: effectiveTopOffer, emptyValue: "No offers" },
        { kind: "sold" as const, label: "Latest Sale", money: effectiveSale, emptyValue: "No sales" },
      ].map(({ kind, label, money, emptyValue }) => {
        const styles = getMarketKindStyles(kind);
        const hasValue = hasMarketValue(money);
        const value = hasValue ? formatMarketValue(money, { maxDigits: 8 }) : emptyValue;
        const timestamp = hasValue && money?.at ? formatMarketTimestamp(money.at) : label;
        return (
          <div
            key={label}
            className="min-w-0 px-2 pb-2.5 pt-2"
            style={{ backgroundColor: styles.backgroundColor }}
          >
            <Text className="truncate text-center text-[10px] uppercase" style={{ color: styles.color }}>
              {label}
            </Text>
            <MarketValueChip kind={kind} value={value} tooltip={timestamp} showTooltip={hasValue} align="center" className="mt-1 w-full text-xs" />
          </div>
        );
      })}
    </div>
  );

  const compactAttributePreview = (
    <div className="overflow-hidden rounded-t-xl bg-[#041204]/60">
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
  );

  const tradeActionPanel = (
    <div className="mt-1.5 space-y-1.5">
      {tradeMode === "idle" && (
        <div className={`grid gap-2 ${tradeButtons.length === 2 ? "grid-cols-2" : ""}`}>
          {tradeButtons.map((button) => (
            <button
              key={button.action}
              type="button"
              disabled={tradeBusyAction !== null}
              onClick={() => handleTradeAction(button.action)}
              className={
                button.variant === "primary"
                  ? `w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] ${tradeButtons.length === 2 ? "px-3" : "px-5"} py-3 text-center text-base font-bold text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:cursor-wait disabled:opacity-70`
                  : `secondary-trade-cta w-full cursor-pointer rounded-[20px] border bg-black ${tradeButtons.length === 2 ? "px-3" : "px-5"} py-2.5 text-center text-sm font-bold text-[#00FF00] transition-all duration-100 hover:bg-[#041204] active:translate-x-[1px] active:translate-y-[3px] disabled:cursor-wait disabled:opacity-70`
              }
            >
              {tradeBusyAction === button.action ? "Working..." : button.label}
            </button>
          ))}
        </div>
      )}
      {showFirefoxWalletWarning && (
        <p className="rounded-lg border border-[#FFFF00]/35 bg-[rgba(255,255,0,0.12)] px-3 py-2 text-center text-xs font-bold text-[#e6e68a]">
          {FIREFOX_WALLET_WARNING}
        </p>
      )}

      {tradeMode === "offer" && (
        <div ref={offerFormRef} className="rounded-xl border border-[#33AAFF]/35 bg-[rgba(51,170,255,0.12)] p-3">
          <label className="block text-xs font-bold uppercase text-[#8bcfff]">
            <span className="flex items-center justify-between gap-3">
              <span>Offered at</span>
              <span className="text-right text-[11px] text-[#8bcfff]">
                {formatUsdEstimate(offerPrice, ethUsdPrice, effectiveFloor)}
              </span>
            </span>
            <div className="mt-1 flex items-center rounded-lg border-2 border-[#33AAFF]/35 bg-black/60 px-3 py-2 transition-[border-color,box-shadow] focus-within:border-[#33AAFF] focus-within:shadow-[0_0_10px_rgba(51,170,255,0.22)]">
              <input
                ref={offerInputRef}
                data-no-focus-ring
                type="text"
                inputMode="decimal"
                value={offerPrice}
                onChange={(event) => setOfferPrice(sanitizeTradePriceInput(event.target.value))}
                placeholder="0.0"
                className="min-w-0 flex-1 appearance-none border-0 bg-transparent text-base font-bold text-[#33AAFF] outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0"
              />
              <span className="text-sm font-bold text-[#33AAFF]">WETH</span>
            </div>
          </label>
          <p className="mt-1 text-[11px] font-bold text-[#8bcfff]">
            Offer will be on OpenSea.
            {knownTopOfferPrice && (
              <>
                {" "}Set price to{" "}
                <button
                  type="button"
                  onClick={() => {
                    void hapticTap();
                    setOfferPrice(sanitizeTradePriceInput(knownTopOfferPrice));
                    focusTradeInput("offer");
                  }}
                  className="cursor-pointer text-[#33AAFF] underline underline-offset-2 hover:text-[#70c6ff]"
                >
                  Top Offer
                </button>
                .
              </>
            )}
          </p>
          {offerIsAboveCurrentListing && activeListingAmount != null && (
            <p className="mt-2 rounded-lg border border-[#33AAFF]/35 bg-[rgba(51,170,255,0.12)] px-3 py-2 text-xs font-bold text-[#8bcfff]">
              Offer is above the current listing of {formatTradeTokenAmount(activeListingAmount ?? 0, "ETH")}.
            </p>
          )}
          <button
            type="button"
            onClick={() => void runMakeOffer()}
            disabled={tradeBusyAction !== null || !offerPriceIsValid}
            className="mt-3 w-full cursor-pointer rounded-[20px] border border-[#1c78b3] bg-[#33AAFF] px-5 py-3 text-base font-bold leading-normal text-[rgb(0,54,80)] shadow-[3px_6px_0_#1c78b3] transition-all duration-100 hover:bg-[#70c6ff] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#1c78b3] disabled:cursor-wait disabled:opacity-70"
          >
            {tradeBusyAction === "make_offer" ? "Working..." : "Review item offer"}
          </button>
          <button
            type="button"
            onClick={() => {
              void hapticTap();
              setTradeMode("idle");
            }}
            className="mx-auto mt-2 block cursor-pointer px-4 py-2 text-xs font-bold text-[#33AAFF] underline underline-offset-4 hover:text-[#70c6ff]"
          >
            Cancel item offer
          </button>
        </div>
      )}

      {tradeMode === "list" && (
        <div ref={listingFormRef} className="rounded-xl border border-[#FFFF00]/35 bg-[rgba(255,255,0,0.12)] p-3">
          <label className="block text-xs font-bold uppercase text-[#e6e68a]">
            <span className="flex items-center justify-between gap-3">
              <span>Listed as</span>
              <span className="text-right text-[11px] text-[#e6e68a]">
                {formatUsdEstimate(listingPrice, ethUsdPrice, effectiveFloor)}
              </span>
            </span>
            <div className="mt-1 flex items-center rounded-lg border-2 border-[#FFFF00]/35 bg-black/60 px-3 py-2 transition-[border-color,box-shadow] focus-within:border-[#FFFF00] focus-within:shadow-[0_0_10px_rgba(255,255,0,0.2)]">
              <input
                ref={listingInputRef}
                data-no-focus-ring
                type="text"
                inputMode="decimal"
                value={listingPrice}
                onChange={(event) => setListingPrice(sanitizeTradePriceInput(event.target.value))}
                placeholder="0.0"
                className="min-w-0 flex-1 appearance-none border-0 bg-transparent text-base font-bold text-[#FFFF00] outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0"
              />
              <span className="text-sm font-bold text-[#FFFF00]">ETH</span>
            </div>
          </label>
          <p className="mt-1 text-[11px] font-bold text-[#e6e68a]">
            Listing will be on OpenSea. Received ETH excludes fees.
            {knownFloorPrice && (
              <>
                {" "}Set price to{" "}
                <button
                  type="button"
                  onClick={() => {
                    void hapticTap();
                    setListingPrice(sanitizeTradePriceInput(knownFloorPrice));
                    focusTradeInput("list");
                  }}
                  className="cursor-pointer text-[#FFFF00] underline underline-offset-2 hover:text-[#ffff66]"
                >
                  Floor
                </button>
                .
              </>
            )}
          </p>
          {listingPriceIsAtOrBelowTopOffer && effectiveTopOffer && (
            <p className="mt-2 rounded-lg border border-[#FFFF00]/35 bg-[rgba(255,255,0,0.12)] px-3 py-2 text-xs font-bold text-[#e6e68a]">
              Listing price must be above the current Top Offer of {formatMarketEthForTradeCopy(effectiveTopOffer)}.
            </p>
          )}
          <button
            type="button"
            onClick={() => void runListForSale()}
            disabled={tradeBusyAction !== null || !listingPriceIsValid}
            className="mt-3 w-full cursor-pointer rounded-[20px] border border-[#b3b300] bg-[#FFFF00] px-5 py-3 text-base font-bold leading-normal text-[rgb(80,80,0)] shadow-[3px_6px_0_#b3b300] transition-all duration-100 hover:bg-[#ffff66] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#b3b300] disabled:cursor-wait disabled:opacity-70"
          >
            {tradeBusyAction === "list" ? "Working..." : "Review item listing"}
          </button>
          <button
            type="button"
            onClick={() => {
              void hapticTap();
              setTradeMode("idle");
            }}
            className="mx-auto mt-2 block cursor-pointer px-4 py-2 text-xs font-bold text-[#FFFF00] underline underline-offset-4 hover:text-[#ffff66]"
          >
            Cancel item listing
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          void hapticTap();
          sdk.actions.openUrl(getOpenSeaUrl(details.id)).catch((error) => {
            console.error("Failed to open OpenSea in Farcaster:", error);
          });
        }}
        className="mx-auto block cursor-pointer px-4 pb-1.5 pt-3.5 text-xs font-bold text-[#00FF00] underline underline-offset-4 hover:text-[#66ff66]"
      >
        View on OpenSea
      </button>
    </div>
  );

  return (
    <>
    {tradeToast && (
      <TradeToastView toast={tradeToast} exiting={tradeToastExiting} onClose={closeTradeToast} />
    )}
    <div className="fixed inset-0 flex items-end justify-center bg-black/80 p-4 sm:items-center" style={{ zIndex: 50 + stackIndex }}>
      <div ref={modalScrollRef} className="max-h-[92vh] w-full max-w-md overflow-auto rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl">
        <div ref={modalHeaderRef} className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#00FF00]/20 bg-black px-4 py-3">
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

        <div>
          {compactAttributePreview}

          <img
            src={getWarpletAssetUrl(details.id, "avif")}
            alt=""
            className="aspect-square w-full bg-[rgba(0,255,0,0.12)] object-cover"
          />

          {marketSummaryPanels}
        </div>

        <div className="px-4 pb-4 pt-2.5">
          {tradeActionPanel}

            {false && (
            <>
            <div className="mt-4 space-y-3">
              {tradeMode === "idle" && (
                <div className={`grid gap-2 ${tradeButtons.length === 2 ? "grid-cols-2" : ""}`}>
                  {tradeButtons.map((button) => (
                    <button
                      key={button.action}
                      type="button"
                      disabled={tradeBusyAction !== null}
                      onClick={() => handleTradeAction(button.action)}
                      className={
                        button.variant === "primary"
                          ? `w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] ${tradeButtons.length === 2 ? "px-3" : "px-5"} py-3 text-center text-base font-bold text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:cursor-wait disabled:opacity-70`
                          : `w-full cursor-pointer rounded-xl border border-[#00FF00]/45 bg-black ${tradeButtons.length === 2 ? "px-3" : "px-5"} py-2.5 text-center text-sm font-bold text-[#00FF00] transition-colors hover:bg-[#041204] disabled:cursor-wait disabled:opacity-70`
                      }
                    >
                      {tradeBusyAction === button.action ? "Working..." : button.label}
                    </button>
                  ))}
                </div>
              )}
              {showFirefoxWalletWarning && (
                <p className="rounded-lg border border-[#FFFF00]/35 bg-[rgba(255,255,0,0.12)] px-3 py-2 text-center text-xs font-bold text-[#e6e68a]">
                  {FIREFOX_WALLET_WARNING}
                </p>
              )}

              {tradeMode === "offer" && (
                <div ref={offerFormRef} className="rounded-xl border border-[#33AAFF]/35 bg-[rgba(51,170,255,0.12)] p-3">
                  <label className="block text-xs font-bold uppercase text-[#8bcfff]">
                    <span className="flex items-center justify-between gap-3">
                      <span>Offered at</span>
                      <span className="text-right text-[11px] text-[#8bcfff]">
                        {formatUsdEstimate(offerPrice, ethUsdPrice, effectiveFloor)}
                      </span>
                    </span>
                    <div className="mt-1 flex items-center rounded-lg border-2 border-[#33AAFF]/35 bg-black/60 px-3 py-2 transition-[border-color,box-shadow] focus-within:border-[#33AAFF] focus-within:shadow-[0_0_10px_rgba(51,170,255,0.22)]">
                      <input
                        ref={offerInputRef}
                        data-no-focus-ring
                        type="text"
                        inputMode="decimal"
                        value={offerPrice}
                        onChange={(event) => setOfferPrice(sanitizeTradePriceInput(event.target.value))}
                        placeholder="0.0"
                        className="min-w-0 flex-1 appearance-none border-0 bg-transparent text-base font-bold text-[#33AAFF] outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0"
                      />
                      <span className="text-sm font-bold text-[#33AAFF]">WETH</span>
                    </div>
                  </label>
                  <p className="mt-1 text-[11px] font-bold text-[#8bcfff]">
                    Offer will be on OpenSea.
                    {knownTopOfferPrice && (
                      <>
                        {" "}Set price to{" "}
                        <button
                          type="button"
                          onClick={() => {
                            void hapticTap();
                            setOfferPrice(sanitizeTradePriceInput(knownTopOfferPrice));
                            focusTradeInput("offer");
                          }}
                          className="cursor-pointer text-[#33AAFF] underline underline-offset-2 hover:text-[#70c6ff]"
                        >
                          Top Offer
                        </button>
                        .
                      </>
                    )}
                  </p>
                  {offerIsAboveCurrentListing && activeListingAmount != null && (
                    <p className="mt-2 rounded-lg border border-[#33AAFF]/35 bg-[rgba(51,170,255,0.12)] px-3 py-2 text-xs font-bold text-[#8bcfff]">
                      Offer is above the current listing of {formatTradeTokenAmount(activeListingAmount ?? 0, "ETH")}.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void runMakeOffer()}
                    disabled={tradeBusyAction !== null || !offerPriceIsValid}
                    className="mt-3 w-full cursor-pointer rounded-[20px] border border-[#1c78b3] bg-[#33AAFF] px-5 py-3 text-base font-bold leading-normal text-[rgb(0,54,80)] shadow-[3px_6px_0_#1c78b3] transition-all duration-100 hover:bg-[#70c6ff] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#1c78b3] disabled:cursor-wait disabled:opacity-70"
                  >
                    {tradeBusyAction === "make_offer" ? "Working..." : "Review item offer"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void hapticTap();
                      setTradeMode("idle");
                    }}
                    className="mx-auto mt-2 block cursor-pointer px-4 py-2 text-xs font-bold text-[#33AAFF] underline underline-offset-4 hover:text-[#70c6ff]"
                  >
                    Cancel item offer
                  </button>
                </div>
              )}

              {tradeMode === "list" && (
                <div ref={listingFormRef} className="rounded-xl border border-[#FFFF00]/35 bg-[rgba(255,255,0,0.12)] p-3">
                  <label className="block text-xs font-bold uppercase text-[#e6e68a]">
                    <span className="flex items-center justify-between gap-3">
                      <span>Listed as</span>
                      <span className="text-right text-[11px] text-[#e6e68a]">
                        {formatUsdEstimate(listingPrice, ethUsdPrice, effectiveFloor)}
                      </span>
                    </span>
                    <div className="mt-1 flex items-center rounded-lg border-2 border-[#FFFF00]/35 bg-black/60 px-3 py-2 transition-[border-color,box-shadow] focus-within:border-[#FFFF00] focus-within:shadow-[0_0_10px_rgba(255,255,0,0.2)]">
                      <input
                        ref={listingInputRef}
                        data-no-focus-ring
                        type="text"
                        inputMode="decimal"
                        value={listingPrice}
                        onChange={(event) => setListingPrice(sanitizeTradePriceInput(event.target.value))}
                        placeholder="0.0"
                        className="min-w-0 flex-1 appearance-none border-0 bg-transparent text-base font-bold text-[#FFFF00] outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0"
                      />
                      <span className="text-sm font-bold text-[#FFFF00]">ETH</span>
                    </div>
                  </label>
                  <p className="mt-1 text-[11px] font-bold text-[#e6e68a]">
                    Listing will be on OpenSea. Received ETH excludes fees.
                    {knownFloorPrice && (
                      <>
                        {" "}Set price to{" "}
                        <button
                          type="button"
                          onClick={() => {
                            void hapticTap();
                            setListingPrice(sanitizeTradePriceInput(knownFloorPrice));
                            focusTradeInput("list");
                          }}
                          className="cursor-pointer text-[#FFFF00] underline underline-offset-2 hover:text-[#ffff66]"
                        >
                          Floor
                        </button>
                        .
                      </>
                    )}
                  </p>
                  {listingPriceIsAtOrBelowTopOffer && effectiveTopOffer && (
                    <p className="mt-2 rounded-lg border border-[#FFFF00]/35 bg-[rgba(255,255,0,0.12)] px-3 py-2 text-xs font-bold text-[#e6e68a]">
                      Listing price must be above the current Top Offer of {formatMarketEthForTradeCopy(effectiveTopOffer)}.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void runListForSale()}
                    disabled={tradeBusyAction !== null || !listingPriceIsValid}
                    className="mt-3 w-full cursor-pointer rounded-[20px] border border-[#b3b300] bg-[#FFFF00] px-5 py-3 text-base font-bold leading-normal text-[rgb(80,80,0)] shadow-[3px_6px_0_#b3b300] transition-all duration-100 hover:bg-[#ffff66] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#b3b300] disabled:cursor-wait disabled:opacity-70"
                  >
                    {tradeBusyAction === "list" ? "Working..." : "Review item listing"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void hapticTap();
                      setTradeMode("idle");
                    }}
                    className="mx-auto mt-2 block cursor-pointer px-4 py-2 text-xs font-bold text-[#FFFF00] underline underline-offset-4 hover:text-[#ffff66]"
                  >
                    Cancel item listing
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  void hapticTap();
                  sdk.actions.openUrl(getOpenSeaUrl(details.id)).catch((error) => {
                    console.error("Failed to open OpenSea in Farcaster:", error);
                  });
                }}
                className="mx-auto block cursor-pointer px-4 py-2 text-xs font-bold text-[#00FF00] underline underline-offset-4 hover:text-[#66ff66]"
              >
                View on OpenSea
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { kind: "price" as const, label: "Price", money: effectiveListing, emptyValue: "Not listed" },
                { kind: "offer" as const, label: "Top Offer", money: effectiveTopOffer, emptyValue: "No offers" },
                { kind: "sold" as const, label: "Latest Sale", money: effectiveSale, emptyValue: "No sales" },
              ].map(({ kind, label, money, emptyValue }) => {
                const styles = getMarketKindStyles(kind);
                const hasValue = hasMarketValue(money);
                const value = hasValue ? formatMarketValue(money, { maxDigits: 8 }) : emptyValue;
                const timestamp = hasValue && money?.at ? formatMarketTimestamp(money.at) : label;
                return (
                  <div
                    key={label}
                    className="min-w-0 rounded-xl border px-2 py-2"
                    style={{ borderColor: styles.borderColor, backgroundColor: styles.backgroundColor }}
                  >
                    <Text className="truncate text-center text-[10px] uppercase" style={{ color: styles.color }}>
                    {label}
                    </Text>
                    <MarketValueChip kind={kind} value={value} tooltip={timestamp} showTooltip={hasValue} align="center" className="mt-1 w-full text-xs" />
                  </div>
                );
              })}
            </div>

            </>
            )}

            <div className="mt-4 space-y-3">
              <OwnedByPanel
                owner={effectiveOwner ?? undefined}
                currentTokenId={details.id}
                ownedTokenIds={ownedTokenIds}
                onOpenWarplet={onOpenRelatedWarplet}
                onSearchOwnerWallet={onSearchOwnerWallet}
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
    </>
  );
}

export default function SearchApp() {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState("");
  const [viewerFid, setViewerFid] = useState<number | null>(null);
  const [viewerProfile, setViewerProfile] = useState<ViewerProfile | null>(null);
  const [matchedWarpletCard, setMatchedWarpletCard] = useState<MatchedWarpletCard | null>(null);
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
        const user = (context as { user?: Record<string, unknown> }).user;
        const fid = user?.fid;
        const normalizedFid = typeof fid === "number" && Number.isInteger(fid) && fid > 0 ? fid : null;
        setViewerFid(normalizedFid);
        setViewerProfile({
          fid: normalizedFid,
          username: typeof user?.username === "string" ? user.username : null,
          displayName: typeof user?.displayName === "string"
            ? user.displayName
            : typeof user?.display_name === "string"
              ? user.display_name
              : null,
          pfpUrl: typeof user?.pfpUrl === "string"
            ? user.pfpUrl
            : typeof user?.pfp_url === "string"
              ? user.pfp_url
              : typeof user?.pfp === "string"
                ? user.pfp
                : null,
        });
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
    if (!dbReady || !db || viewerFid == null || !marketSnapshot) {
      setMatchedWarpletCard(null);
      return;
    }

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
        const matchOwnerWallet = match
          ? marketSnapshot.owners[String(match.id)]?.wallet?.trim().toLowerCase() ?? ""
          : "";
        const matchMetadataWallet = match?.wallet.trim().toLowerCase() ?? "";

        if (match && matchOwnerWallet && matchMetadataWallet && matchOwnerWallet === matchMetadataWallet) {
          await preloadResultImages([match]);
          if (!cancelled) {
            setMatchedWarpletCard({ warplet: match, label: "👀 We Found You!" });
          }
          return;
        }

        const rarestOwnedTokenId = Object.entries(marketSnapshot.owners)
          .filter(([, owner]) => owner.fid === viewerFid)
          .map(([tokenId]) => Number(tokenId))
          .filter((tokenId) => Number.isInteger(tokenId) && tokenId > 0)
          .sort((left, right) => left - right)[0];
        const rarestOwnedWarplet = rarestOwnedTokenId ? loadWarpletResultById(db, rarestOwnedTokenId) : null;

        if (rarestOwnedWarplet) {
          await preloadResultImages([rarestOwnedWarplet]);
        }
        if (!cancelled) {
          setMatchedWarpletCard(
            rarestOwnedWarplet
              ? { warplet: rarestOwnedWarplet, label: "👀 Your Rarest Warplet!" }
              : null,
          );
        }
      } catch (err) {
        console.error("Failed to match Farcaster user to Warplet:", err);
        if (!cancelled) {
          setMatchedWarpletCard(null);
        }
      }
    };

    loadViewerMatch();

    return () => {
      cancelled = true;
    };
  }, [dbReady, marketSnapshot, viewerFid]);

  const runSearch = useCallback(async (
    nextQuery: string,
    offset = 0,
    filterOverride?: SearchFilterOverride,
    limit = PAGE_SIZE,
  ) => {
    const db = dbRef.current;
    const activeAttributes = filterOverride?.attributes ?? selectedAttributes;
    const activeLevels = filterOverride?.levels ?? selectedLevels;
    const ownerSearch = parseOwnerWalletSearch(nextQuery);
    const ownerWalletFilter = ownerSearch.ownerWalletFilter;
    const searchText = ownerSearch.searchText;
    const isWildcardSearch = searchText.trim() === "*" || (!searchText && nextQuery.trim() === "*");
    const ftsQuery = isWildcardSearch ? "" : normalizeFtsQuery(searchText);
    const levelFilter = buildLevelFilter(activeAttributes, activeLevels);
    const hasAttributeOnlyFilter = activeAttributes.length > 0 && activeLevels.length === 0;
    const attributeOnlyRankColumn =
      !ftsQuery && hasAttributeOnlyFilter ? getRankColumnForLevelAttribute(activeAttributes[0]) : null;
    const runId = searchRunRef.current + 1;
    searchRunRef.current = runId;

    if (!db || (!ftsQuery && !levelFilter && !hasAttributeOnlyFilter && !isWildcardSearch && !ownerWalletFilter)) {
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
      const nextRows = filterRowsByOwnerWallet(
        mapRows(rows, Boolean(ftsQuery)),
        marketSnapshot,
        ownerWalletFilter,
      );
      await preloadResultImages(nextRows.slice(0, PAGE_SIZE));

      if (searchRunRef.current !== runId) return;

      setSubmittedQuery(nextQuery.trim());
      setTotalResults(nextRows.length);
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
  }, [marketSnapshot, selectedAttributes, selectedLevels]);

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
    const parsedSearchText = parseOwnerWalletSearch(nextSearchText).searchText;
    const hasFtsQuery = Boolean(parsedSearchText.trim()) && parsedSearchText.trim() !== "*";
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
        isRandomMode && matchedWarpletCard ? PAGE_SIZE - 1 : PAGE_SIZE,
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
  }, [activeExampleSearch, dbReady, loadWarpletDetails, matchedWarpletCard, runSearch]);

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
      const limit = isExampleSearch && matchedWarpletCard ? PAGE_SIZE - 1 : PAGE_SIZE;
      runSearch(nextQuery, 0, undefined, limit);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [activeExampleSearch, dbReady, isAllWarpletsMode, matchedWarpletCard, query, runSearch, selectedAttributes.length, selectedLevels.length]);

  useEffect(() => {
    if (!urlHydratedRef.current || applyingUrlStateRef.current) return;
    const parsedSearchText = parseOwnerWalletSearch(query.trim() || submittedQuery.trim()).searchText;
    const hasFtsQuery = !isAllWarpletsMode && Boolean(parsedSearchText.trim()) && parsedSearchText.trim() !== "*";
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
  const shouldPrependMatchedWarplet = Boolean(isExampleSearchMode && matchedWarpletCard);
  const rankAttribute = selectedAttributes.length === 1 ? selectedAttributes[0] : undefined;
  const sortedResults = useMemo(
    () => sortWarplets(results, orderBy, orderDirection, marketSnapshot, rankAttribute),
    [marketSnapshot, orderBy, orderDirection, rankAttribute, results],
  );
  const visibleResults = sortedResults.slice(0, visibleCount);
  const displayedResults = shouldPrependMatchedWarplet && matchedWarpletCard
    ? [matchedWarpletCard.warplet, ...visibleResults]
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
    setVisibleCount(matchedWarpletCard ? PAGE_SIZE - 1 : PAGE_SIZE);
    setOrderBy("relevance");
    setOrderDirection("asc");
    setUserSelectedOrder(false);
    setSearchError("");
    if (dbReady) {
      void runSearch(
        nextExample,
        0,
        { attributes: [], levels: [] },
        matchedWarpletCard ? PAGE_SIZE - 1 : PAGE_SIZE,
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
    setVisibleCount(matchedWarpletCard ? PAGE_SIZE - 1 : PAGE_SIZE);
    setOrderBy("relevance");
    setOrderDirection("asc");
    setUserSelectedOrder(false);
    if (dbReady) {
      void runSearch(
        nextExample,
        0,
        { attributes: [], levels: [] },
        matchedWarpletCard ? PAGE_SIZE - 1 : PAGE_SIZE,
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

  const handleSearchOwnerWallet = useCallback((wallet: string) => {
    const normalizedWallet = wallet.trim();
    if (!normalizedWallet) return;
    setSelectedWarpletDetailsStack([]);
    setQuery(normalizedWallet);
    setIsAllWarpletsMode(false);
    setSelectedAttributes([]);
    setSelectedLevels([]);
    setVisibleCount(PAGE_SIZE);
    setOrderBy("rarity");
    setOrderDirection("asc");
    setUserSelectedOrder(false);
    setSearchError("");
    if (dbReady) {
      void runSearch(normalizedWallet, 0, { attributes: [], levels: [] }, PAGE_SIZE);
    }
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [dbReady, runSearch]);

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

  const handleMergeMarketSnapshot = useCallback((tokenId: number, snapshot: MarketSnapshot) => {
    setMarketSnapshot((current) => {
      const merged = mergeTokenSnapshot(current, snapshot, tokenId);
      writeCachedMarketSnapshot(merged);
      return merged;
    });
  }, []);

  const handleClearMarketSide = useCallback((tokenId: number, side: "listing" | "offer" | "collectionOffer") => {
    setMarketSnapshot((current) => {
      const key = String(tokenId);
      const next: MarketSnapshot = {
        version: "opensea-market-v1",
        generatedAt: new Date().toISOString(),
        maxAgeSeconds: current?.maxAgeSeconds ?? 600,
        collection: side === "collectionOffer"
          ? { floor: current?.collection?.floor ?? null, topOffer: null }
          : current?.collection ?? { floor: null, topOffer: null },
        listings: { ...(current?.listings ?? {}) },
        offers: { ...(current?.offers ?? {}) },
        sales: { ...(current?.sales ?? {}) },
        owners: { ...(current?.owners ?? {}) },
      };
      if (side === "listing") delete next.listings[key];
      if (side === "offer") delete next.offers[key];
      writeCachedMarketSnapshot(next);
      return next;
    });
  }, []);

  const handleUpsertItemOffer = useCallback((tokenId: number, offer: MarketSnapshot["offers"][string]) => {
    setMarketSnapshot((current) => {
      const key = String(tokenId);
      const next: MarketSnapshot = {
        version: "opensea-market-v1",
        generatedAt: new Date().toISOString(),
        maxAgeSeconds: current?.maxAgeSeconds ?? 600,
        collection: current?.collection ?? { floor: null, topOffer: null },
        listings: { ...(current?.listings ?? {}) },
        offers: { ...(current?.offers ?? {}), [key]: offer },
        sales: { ...(current?.sales ?? {}) },
        owners: { ...(current?.owners ?? {}) },
      };
      writeCachedMarketSnapshot(next);
      return next;
    });
  }, []);

  const handleApplyPurchase = useCallback((tokenId: number, update: OptimisticPurchaseUpdate) => {
    setMarketSnapshot((current) => {
      const key = String(tokenId);
      const now = update.sale.at ?? new Date().toISOString();
      const normalizedBuyerWallet = update.buyerWallet.trim().toLowerCase();
      const matchingOwnerProfile = Object.values(current?.owners ?? {}).find(
        (owner) => owner.wallet?.trim().toLowerCase() === normalizedBuyerWallet &&
          (owner.username || owner.displayName || owner.pfpUrl || owner.followerCount != null || owner.followingCount != null),
      );
      const providedOwnerProfile = update.buyerProfile ?? {};
      const viewerOwnerProfile = viewerProfile?.fid != null && viewerProfile.fid === update.buyerFid
        ? {
            username: viewerProfile.username,
            displayName: viewerProfile.displayName,
            pfpUrl: viewerProfile.pfpUrl,
          }
        : {};
      const nextOwner: MarketSnapshot["owners"][string] = {
        ...(matchingOwnerProfile ?? {}),
        ...viewerOwnerProfile,
        ...providedOwnerProfile,
        wallet: normalizedBuyerWallet,
        fid: update.buyerFid ?? providedOwnerProfile.fid ?? matchingOwnerProfile?.fid ?? null,
        checkedAt: now,
      };
      const next: MarketSnapshot = {
        version: "opensea-market-v1",
        generatedAt: now,
        maxAgeSeconds: current?.maxAgeSeconds ?? 600,
        collection: current?.collection ?? { floor: null, topOffer: null },
        listings: { ...(current?.listings ?? {}) },
        offers: { ...(current?.offers ?? {}) },
        sales: { ...(current?.sales ?? {}), [key]: update.sale },
        owners: { ...(current?.owners ?? {}), [key]: nextOwner },
      };
      delete next.listings[key];
      writeCachedMarketSnapshot(next);
      return next;
    });
  }, [viewerProfile]);

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
        handleMergeMarketSnapshot(tokenId, payload.snapshot);
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
  }, [handleMergeMarketSnapshot, marketRefreshTokenId, selectedWarpletDetails?.id]);

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
                      labelOverride={shouldPrependMatchedWarplet && index === 0 ? matchedWarpletCard?.label : undefined}
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
            onSearchOwnerWallet={handleSearchOwnerWallet}
            market={market}
            ownedTokenIds={getOwnedTokenIds(marketSnapshot, market.owner?.wallet, details.id)}
            isRefreshingMarket={marketRefreshTokenId === details.id}
            marketRefreshError={index === selectedWarpletDetailsStack.length - 1 ? marketRefreshError : ""}
            onRefreshMarket={handleRefreshSelectedMarket}
            viewerFid={viewerFid}
            onMergeMarketSnapshot={handleMergeMarketSnapshot}
            onClearMarketSide={handleClearMarketSide}
            onUpsertItemOffer={handleUpsertItemOffer}
            onApplyPurchase={handleApplyPurchase}
            stackIndex={index}
          />
        );
      })}
    </MiniAppShell>
  );
}
