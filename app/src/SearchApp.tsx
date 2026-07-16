import { CSSProperties, MouseEvent, ReactNode, cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const DATABASE_LOADING_PREFIX = "Loading: ";
const DATABASE_LOADING_MESSAGE_SUFFIXES = [
  "10X Warplets Database...",
  "Just a little longer...",
  "Almost done I swear...",
  "It will be worth the wait...",
  "So close I can almost smell it...",
  "...well this is awkward.",
  "Enjoy the elevator music...",
  "We're testing your patience...",
  "It's not you, it's me...",
  "Follow the white rabbit...",
  "My other loading screen is much faster...",
  "Are we there yet?",
  "Counting backwards from Infinity...",
  "I feel like I'm supposed to be loading something. . .",
  "Listening for the sound of one hand clapping...",
  "Unicorns are at the end of this road, I promise.",
  "Granting wishes...",
  "Time flies when you're having fun!",
  "I think I am, therefore, I am. I think...",
  "There is no spoon.",
];
const DATABASE_LOADING_TYPE_MS = 1000;
const DATABASE_LOADING_HOLD_MS = 1750;
const DATABASE_LOADING_DELETE_MS = 250;
const DATABASE_LOADING_MESSAGE_INTERVAL_MS = 3000;
const DATABASE_LOADING_ANIMATION_TICK_MS = 50;
const ONBOARDING_COMPLETE_KEY = "warplets-search-onboarding-v1-complete";
const SEARCH_DEBOUNCE_MS = 300;
const STATUS_LINE_CLASS = "text-center text-xs uppercase leading-4";
const OPENSEA_COLLECTION_URL = "https://opensea.io/collection/10xwarplets";
const MARKET_CACHE_KEY = "warplets-market-state-v3";
const MARKET_SNAPSHOT_STALE_MS = 10 * 60 * 1000;
const MARKET_DETAIL_STALE_MS = 30 * 60 * 1000;
const MARKET_CACHE_MAX_STALE_MS = 60 * 60 * 1000;
const BASE_WETH_TOKEN_ADDRESS = "0x4200000000000000000000000000000000000006";
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";
const MIN_LISTING_ETH = 0.00000000000001;
const TRADE_PRICE_DECIMAL_PLACES = 4;

function getDatabaseLoadingMessage(elapsedMs: number): string {
  const cycleNumber = Math.floor(elapsedMs / DATABASE_LOADING_MESSAGE_INTERVAL_MS);
  const suffix = DATABASE_LOADING_MESSAGE_SUFFIXES[cycleNumber % DATABASE_LOADING_MESSAGE_SUFFIXES.length];
  const cycleElapsed = elapsedMs % DATABASE_LOADING_MESSAGE_INTERVAL_MS;
  let visibleCharacters = suffix.length;

  if (cycleElapsed < DATABASE_LOADING_TYPE_MS) {
    visibleCharacters = Math.ceil((suffix.length * cycleElapsed) / DATABASE_LOADING_TYPE_MS);
  } else if (cycleElapsed >= DATABASE_LOADING_TYPE_MS + DATABASE_LOADING_HOLD_MS) {
    const deleteElapsed = cycleElapsed - DATABASE_LOADING_TYPE_MS - DATABASE_LOADING_HOLD_MS;
    const deleteProgress = Math.min(1, deleteElapsed / DATABASE_LOADING_DELETE_MS);
    visibleCharacters = Math.floor(suffix.length * (1 - deleteProgress));
  }

  return `${DATABASE_LOADING_PREFIX}${suffix.slice(0, Math.max(0, visibleCharacters))}`;
}

function isOnboardingForced(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("onboarding") === "1";
}

function readOnboardingComplete(): boolean {
  if (typeof window === "undefined") return false;
  if (isOnboardingForced()) return false;
  return window.localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "1";
}

function writeOnboardingComplete(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ONBOARDING_COMPLETE_KEY, "1");
}

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

type OrderByOption = "relevance" | "rarity" | "price" | "offer" | "sold" | "recently-listed" | "recently-offered" | "recently-sold" | "favourited" | "rank";
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
  favouriteWallet?: string | null;
};

type SearchUrlState = {
  search: string;
  attributes: LevelAttributeColumn[];
  levels: number[];
  random: string;
  fav: string;
  warplet: number | null;
  first: number | null;
  order: OrderByOption | null;
  dir: OrderDirection | null;
};

type SharePreviewImage = {
  src: string;
  alt: string;
  sourceUrl?: string;
  fallbackSrc?: string;
  isLoading?: boolean;
};

type SharePreviewState = {
  title: string;
  text: string;
  farcasterText?: string;
  twitterPostText?: string;
  links: string[];
  images: SharePreviewImage[];
  farcasterEmbeds: [] | [string] | [string, string];
  twitterText: string;
};

function buildTwitterShareText(text: string, links: string[]): string {
  return [text, ...links, "#10XWarplets via @10XMemeX"].join("\n\n");
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

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
  fav: "",
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

function normalizeWalletAddress(value: string | null | undefined): string | null {
  const wallet = value?.trim();
  return wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet) ? wallet.toLowerCase() : null;
}

function getFavouritesCacheKey(wallet: string): string {
  return `${FAVOURITES_CACHE_PREFIX}${wallet.toLowerCase()}`;
}

function normalizeFavouriteTokenIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const tokenIds: number[] = [];
  for (const raw of value) {
    const tokenId = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 10000 || seen.has(tokenId)) continue;
    seen.add(tokenId);
    tokenIds.push(tokenId);
  }
  return tokenIds;
}

function readCachedFavouriteTokenIds(wallet: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeFavouriteTokenIds(JSON.parse(window.localStorage.getItem(getFavouritesCacheKey(wallet)) ?? "[]"));
  } catch {
    return [];
  }
}

function writeCachedFavouriteTokenIds(wallet: string, tokenIds: number[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getFavouritesCacheKey(wallet), JSON.stringify(tokenIds));
}

function getFavouriteTokenIds(favouriteListsByWallet: Record<string, number[]>, wallet: string | null | undefined): number[] {
  const normalizedWallet = normalizeWalletAddress(wallet);
  return normalizedWallet ? favouriteListsByWallet[normalizedWallet] ?? [] : [];
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

function filterRowsByFavourites(
  rows: WarpletResult[],
  favouriteListsByWallet: Record<string, number[]>,
  favouriteWallet: string | null | undefined,
): WarpletResult[] {
  if (!favouriteWallet) return rows;
  const tokenSet = new Set(getFavouriteTokenIds(favouriteListsByWallet, favouriteWallet));
  return rows.filter((row) => tokenSet.has(row.id));
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
  const fav = normalizeWalletAddress(searchParams.get("fav")) ?? "";
  const warplet = parseWarpletParam(searchParams.get("warplet") ?? searchParams.get("tokenId"));
  const first = parseWarpletParam(searchParams.get("first") ?? searchParams.get("First"));
  const order = parseOrderParam(searchParams.get("order"));
  const dir = parseOrderDirectionParam(searchParams.get("dir"));

  return {
    search,
    attributes,
    levels,
    random,
    fav,
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

  if (state.fav) {
    params.set("fav", state.fav);
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
    state.fav ||
    state.warplet != null ||
    state.first != null ||
    state.order != null,
  );
}

function getEffectiveSearchText(state: SearchUrlState): string {
  if (state.search) return state.search;
  if (state.levels.length > 0) return "";
  if (state.attributes.length > 0) return "";
  if (state.fav) return "*";
  return state.random;
}

function getSearchUrlStateFromAppState({
  query,
  isAllWarpletsMode,
  selectedAttributes,
  selectedLevels,
  activeExampleSearch,
  favouriteFilterWallet,
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
  favouriteFilterWallet: string | null;
  selectedWarpletDetails: WarpletDetails | null;
  orderBy: OrderByOption;
  orderDirection: OrderDirection;
  userSelectedOrder: boolean;
}): SearchUrlState {
  const search = query.trim();
  const hasFilters = selectedAttributes.length > 0 || selectedLevels.length > 0 || Boolean(favouriteFilterWallet);
  const urlSearch = isAllWarpletsMode && !search && !favouriteFilterWallet ? "*" : search;
  return {
    search: urlSearch,
    attributes: selectedAttributes,
    levels: selectedLevels,
    random: urlSearch || hasFilters ? "" : activeExampleSearch,
    fav: favouriteFilterWallet ?? "",
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
  { value: "offer", label: "Top Offer" },
  { value: "sold", label: "Latest Sale" },
  { value: "recently-listed", label: "Recently listed" },
  { value: "recently-offered", label: "Recently offered" },
  { value: "recently-sold", label: "Recently sold" },
  { value: "favourited", label: "Favourited" },
  { value: "rank", label: "Rank" },
];

const DEFAULT_TRADE_DURATION_SECONDS = 179 * 24 * 60 * 60;
const FIREFOX_WALLET_WARNING = "Firefox doesn't work well with Farcaster Wallet. Please use another browser.";
const ETH_USD_PRICE_STALE_MS = 5 * 60 * 1000;
const ETHEREUM_WALLET_ADDRESS_PATTERN = /\b0x[a-fA-F0-9]{40}\b/g;
const FAVOURITES_CACHE_PREFIX = "warplets-favourites-v1:";

function getDefaultOrderBy(hasFtsQuery: boolean, selectedAttributes: LevelAttributeColumn[], isFavouriteOnly = false): OrderByOption {
  if (isFavouriteOnly) return "favourited";
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

function isMarketOnlyOrder(orderBy: OrderByOption): boolean {
  return getOrderMarketKind(orderBy) !== null;
}

function getMarketOrderShareMeta(orderBy: OrderByOption, direction: OrderDirection): {
  suffix: string;
  openSeaUrl: string;
} | null {
  if (orderBy === "price") {
    return {
      suffix: " ordered by Price.",
      openSeaUrl: direction === "desc"
        ? `${OPENSEA_COLLECTION_URL}?sortDirection=desc`
        : OPENSEA_COLLECTION_URL,
    };
  }
  if (orderBy === "offer") {
    return {
      suffix: " ordered by Top Offer.",
      openSeaUrl: direction === "desc"
        ? `${OPENSEA_COLLECTION_URL}?sortDirection=desc&sortBy=top_offer`
        : OPENSEA_COLLECTION_URL,
    };
  }
  if (orderBy === "sold") {
    return {
      suffix: " ordered by Latest Sale.",
      openSeaUrl: direction === "desc"
        ? `${OPENSEA_COLLECTION_URL}?sortBy=last_sale&sortDirection=desc`
        : `${OPENSEA_COLLECTION_URL}?sortBy=last_sale`,
    };
  }
  if (orderBy === "recently-listed") {
    return {
      suffix: " ordered by Recently Listed.",
      openSeaUrl: direction === "desc"
        ? `${OPENSEA_COLLECTION_URL}?sortBy=listing_created_date&sortDirection=desc`
        : OPENSEA_COLLECTION_URL,
    };
  }
  if (orderBy === "recently-offered") {
    return {
      suffix: " ordered by Recently Offered.",
      openSeaUrl: OPENSEA_COLLECTION_URL,
    };
  }
  if (orderBy === "recently-sold") {
    return {
      suffix: " ordered by Recently Sold.",
      openSeaUrl: direction === "desc"
        ? `${OPENSEA_COLLECTION_URL}?sortBy=last_sale_date&sortDirection=desc`
        : OPENSEA_COLLECTION_URL,
    };
  }
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
  favouriteTokenIds: number[],
): number | null {
  const market = getMarketState(snapshot, warplet.id);
  if (orderBy === "relevance") return warplet.searchScore ?? warplet.searchIndex;
  if (orderBy === "rarity") return warplet.id;
  if (orderBy === "rank") return rankAttribute ? warplet.rankValues[rankAttribute] ?? null : null;
  if (orderBy === "favourited") {
    const index = favouriteTokenIds.indexOf(warplet.id);
    return index >= 0 ? index : null;
  }
  if (orderBy === "price") return getMarketNumber(market.listing);
  if (orderBy === "offer") return getMarketNumber(market.offer);
  if (orderBy === "sold") return getMarketNumber(market.sale);
  if (orderBy === "recently-listed") return market.listing?.at ? Date.parse(market.listing.at) : null;
  if (orderBy === "recently-offered") return market.offer?.at ? Date.parse(market.offer.at) : null;
  if (orderBy === "recently-sold") return market.sale?.at ? Date.parse(market.sale.at) : null;
  return null;
}

function hasMarketOrderValue(
  warplet: WarpletResult,
  orderBy: OrderByOption,
  snapshot: MarketSnapshot | null,
): boolean {
  if (!isMarketOnlyOrder(orderBy)) return true;
  const value = getSortValue(warplet, orderBy, snapshot, undefined, []);
  return value != null && Number.isFinite(value);
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
  favouriteTokenIds: number[] = [],
): WarpletResult[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...warplets].sort((a, b) => {
    const aValue = getSortValue(a, orderBy, snapshot, rankAttribute, favouriteTokenIds);
    const bValue = getSortValue(b, orderBy, snapshot, rankAttribute, favouriteTokenIds);
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
  showFavouriteOrder,
  onSelect,
}: {
  orderBy: OrderByOption;
  orderDirection: OrderDirection;
  selectedAttributes: LevelAttributeColumn[];
  showFavouriteOrder: boolean;
  onSelect: (orderBy: OrderByOption) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const options = ORDER_OPTIONS.filter((option) =>
    (option.value !== "rank" || selectedAttributes.length === 1) &&
    (option.value !== "favourited" || showFavouriteOrder)
  )
    .sort((a, b) => {
      if (a.value === "favourited") return -1;
      if (b.value === "favourited") return 1;
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
  placement = "top",
}: {
  emoji: string;
  label: string;
  description: string;
  placement?: "top" | "bottom";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
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
  placement = "top",
}: {
  kind: MarketKind;
  value: string;
  tooltip: string;
  className?: string;
  variant?: "pill" | "column";
  showTooltip?: boolean;
  align?: "center" | "left";
  placement?: "top" | "bottom";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const styles = getMarketKindStyles(kind);
  const isColumn = variant === "column";
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
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
          } ${isColumn ? "border-0" : "border"} font-bold leading-none ${
            isColumn ? "min-h-[24px] rounded-none px-1 py-1" : "rounded-md px-1.5 py-1"
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

function MarketValuePanel({
  kind,
  label,
  money,
  emptyValue,
  className,
  style,
}: {
  kind: MarketKind;
  label: string;
  money: MarketMoney | null | undefined;
  emptyValue: string;
  className: string;
  style?: CSSProperties;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const styles = getMarketKindStyles(kind);
  const hasValue = hasMarketValue(money);
  const value = hasValue ? formatMarketValue(money, { maxDigits: 8 }) : emptyValue;
  const timestamp = hasValue && money?.at ? formatMarketTimestamp(money.at) : label;
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(0), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const hover = useHover(context, { delay: { open: 0, close: 60 }, move: false });
  const focus = useFocus(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions(hasValue ? [hover, focus, role] : []);

  return (
    <>
      <div
        ref={refs.setReference}
        {...getReferenceProps({
          tabIndex: hasValue ? 0 : undefined,
          "aria-label": hasValue ? `${label}: ${timestamp}` : undefined,
          onClick: hasValue ? () => setIsOpen((current) => !current) : undefined,
          className: `${hasValue ? "cursor-help" : ""} ${className}`,
          style: { ...style, backgroundColor: style?.backgroundColor ?? styles.backgroundColor },
        })}
      >
        <Text className="truncate text-center text-[10px] uppercase" style={{ color: styles.color }}>
          {label}
        </Text>
        <MarketValueChip kind={kind} value={value} tooltip={timestamp} showTooltip={false} align="center" className="mt-1 w-full text-xs" />
      </div>
      {hasValue && isOpen && (
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
            {timestamp}
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
  isFavourited,
  onToggleFavourite,
  labelOverride,
  market,
}: {
  warplet: WarpletResult;
  onOpen: (tokenId: number) => void;
  isFavourited: boolean;
  onToggleFavourite: (tokenId: number) => void;
  labelOverride?: string;
  market?: TokenMarketState;
}) {
  const label = labelOverride ?? `#${warplet.id} ${warplet.farcasterUsername ? `@${warplet.farcasterUsername}` : warplet.wallet}`;

  const openCard = () => {
    void hapticPrimaryTap();
    onOpen(warplet.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openCard}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openCard();
        }
      }}
      className="group relative flex w-full min-w-0 cursor-pointer flex-col rounded-[10px] border border-[#00FF00]/25 bg-[#041204]/90 p-0 text-left transition hover:-translate-y-px hover:border-[#00FF00]/50 hover:bg-[#071807]/95"
    >
      <img
        src={getWarpletImageUrl(warplet.id)}
        alt=""
        loading="eager"
        className="aspect-square w-full rounded-t-[9px] bg-[rgba(0,255,0,0.12)] object-cover"
      />
      <span className="flex h-[38px] w-full min-w-0 items-center bg-[#00FF00] pl-2 text-left text-[0.76rem] font-bold text-[rgb(0,80,0)]">
        <span className="block min-w-0 flex-1 truncate pr-1">{label}</span>
        <FavouriteButton
          active={isFavourited}
          title={isFavourited ? `Remove 10X Warplet #${warplet.id} from favourites` : `Add 10X Warplet #${warplet.id} to favourites`}
          variant="card"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleFavourite(warplet.id);
          }}
        />
      </span>
      <span className="grid w-full grid-cols-3 overflow-hidden rounded-b-[9px] border-t border-[#00FF00]/20 bg-black text-center text-[10px]">
        <MarketValueChip kind="price" value={formatMarketValue(market?.listing, { maxDigits: 5 })} tooltip="Price" variant="column" showTooltip={false} className="w-full rounded-bl-[9px]" />
        <MarketValueChip kind="offer" value={formatMarketValue(market?.offer, { maxDigits: 5 })} tooltip="Top Offer" variant="column" showTooltip={false} className="w-full" />
        <MarketValueChip kind="sold" value={formatMarketValue(market?.sale, { maxDigits: 5 })} tooltip="Latest Sale" variant="column" showTooltip={false} className="w-full rounded-br-[9px]" />
      </span>
    </div>
  );
}

const OWNED_BY_VISIBLE_AVATAR_LIMIT = 24;

function OwnedByPanel({
  owner,
  currentTokenId,
  ownedTokenIds,
  ownerFavouriteCount,
  onOpenWarplet,
  onSearchOwnerWallet,
  onSearchOwnerFavourites,
}: {
  owner?: TokenMarketState["owner"];
  currentTokenId: number;
  ownedTokenIds: number[];
  ownerFavouriteCount: number;
  onOpenWarplet: (tokenId: number) => void;
  onSearchOwnerWallet: (wallet: string) => void;
  onSearchOwnerFavourites: (wallet: string) => void;
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
  const hasOwnerFavourites = Boolean(wallet && ownerFavouriteCount > 0);

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
            <span className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={handleOpenWallet}
                className="block max-w-full cursor-pointer truncate text-left text-sm font-bold text-[#00FF00] hover:underline"
              >
                {formatShortWallet(wallet)}
              </button>
              {hasOwnerFavourites && (
                <FavouriteButton
                  active
                  title={`View ${ownerFavouriteCount.toLocaleString("en-US")} favourite Warplets`}
                  variant="inline"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void hapticPrimaryTap();
                    onSearchOwnerFavourites(wallet);
                  }}
                />
              )}
            </span>
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
            <span className="mt-1 flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={handleOpenWallet}
                className="block max-w-full cursor-pointer truncate text-left text-[11px] text-[#8bbf8b] hover:text-[#00FF00] hover:underline"
              >
                {formatShortWallet(wallet)}
              </button>
              {hasOwnerFavourites && (
                <FavouriteButton
                  active
                  title={`View ${ownerFavouriteCount.toLocaleString("en-US")} favourite Warplets`}
                  variant="inline"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void hapticPrimaryTap();
                    onSearchOwnerFavourites(wallet);
                  }}
                />
              )}
            </span>
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
  );
}

function HeartIcon({
  filled = false,
  className = "h-4 w-4",
  strokeWidth = 2.2,
}: {
  filled?: boolean;
  className?: string;
  strokeWidth?: number;
}) {
  const heartPath = "M20.8 4.6c-1.8-1.7-4.7-1.7-6.5.1L12 7l-2.3-2.3c-1.8-1.8-4.7-1.8-6.5-.1-1.9 1.8-1.9 4.8-.1 6.6L12 20l8.9-8.8c1.8-1.8 1.8-4.8-.1-6.6Z";

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      overflow="visible"
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={heartPath} />
    </svg>
  );
}

function FavouriteButton({
  active,
  onClick,
  title,
  className = "",
  variant = "default",
}: {
  active: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  title: string;
  className?: string;
  variant?: "default" | "card" | "inline" | "modal";
}) {
  const [suppressCardHoverPreview, setSuppressCardHoverPreview] = useState(false);
  const variantClass =
    variant === "card"
      ? "border-0 bg-transparent hover:bg-transparent"
      : variant === "inline"
        ? "border-transparent bg-transparent p-0 text-[#8bbf8b] hover:text-[#00FF00]"
        : variant === "modal"
          ? "rounded-lg border border-[#00FF00]/35 bg-transparent hover:bg-[#041204]"
          : "border-0 bg-transparent hover:text-[#8bbf8b]";
  const sizeClass = variant === "inline"
    ? "h-5 w-5"
    : variant === "card"
      ? "h-full px-2"
      : "h-9 w-9";
  const iconClass = variant === "inline"
    ? "h-3 w-3"
      : variant === "modal"
      ? "h-[17px] w-[17px] translate-y-px"
      : variant === "card"
        ? active
          ? `h-5 w-5 fill-current ${suppressCardHoverPreview ? "" : "group-hover/fav:fill-none"}`
          : `h-5 w-5 fill-none ${suppressCardHoverPreview ? "" : "group-hover/fav:fill-current"}`
        : "h-5 w-5";
  const strokeWidth = variant === "card" ? 2 : variant === "default" ? 2 : 2.2;
  const alignmentClass = "items-center justify-center";
  const textClass = variant === "card" ? "text-[rgb(0,80,0)]" : "text-[#00FF00]";

  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      onClick={(event) => {
        if (variant === "card") setSuppressCardHoverPreview(true);
        onClick(event);
      }}
      onPointerLeave={() => setSuppressCardHoverPreview(false)}
      onBlur={() => setSuppressCardHoverPreview(false)}
      className={`group/fav inline-flex shrink-0 cursor-pointer transition-[background-color,opacity,color] ${textClass} ${alignmentClass} ${sizeClass} ${variantClass} ${className}`}
    >
      <HeartIcon filled={active} className={iconClass} strokeWidth={strokeWidth} />
    </button>
  );
}

type OnboardingVisualKind =
  | "featuredWarplet"
  | "airdrop"
  | "attributes"
  | "levels"
  | "access"
  | "search"
  | "trade";

type OnboardingSlide = {
  title: string;
  bullets: ReactNode[];
  visual: OnboardingVisualKind;
};

const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    title: "Welcome to 10X Warplets",
    visual: "featuredWarplet",
    bullets: [
      "10X Warplets is a fun 10,000 NFT collection.",
      "Farcaster focused. Meme powered. Data driven.",
      "10X is where Builders, Capital, & Attention align.",
    ],
  },
  {
    title: "Airdropped to Diamond Hands",
    visual: "airdrop",
    bullets: [
      "Airdropped to an exclusive group of 10,000 holders from the original 49,137 The Warplets collection... the people who never sold!",
      "Starting 10X with a core \"diamond hands\" community of active onchain users, with real influence, and the belief to hold long-term.",
    ],
  },
  {
    title: "Rarity was Earned!",
    visual: "attributes",
    bullets: [
      "For most NFT collections, rarity is visual (...eyes, hat, background, etc). But for 10X Warplets rarity comes from onchain data.",
      "10 NFT attributes scored a real humans onchain social presence, capital, and conviction.",
      "Rarity isn't random, it was earned!",
    ],
  },
  {
    title: "10 Levels. Exponential Scarcity.",
    visual: "levels",
    bullets: [
      "Each attribute has a Level from 10X to 1X.",
      "10X = 10 NFTs, 9X = 20, 8X = 40 ... 1X = 4,890!",
      "To keep things simple... Token #1 is the most rare, through to Token #10,000 is the least rare.",
    ],
  },
  {
    title: "Future Airdrops & Access",
    visual: "access",
    bullets: [
      <>
        You want higher Levels to get bigger 10X Meme daily memecoin airdrop bonuses (coming soon on Base, BSC, Solana... and <em>maybe</em> Robinhood).
      </>,
      "Holding a 10X Warplet also gives you whitelist access to future 10X NFT launches (coming soon on Ethereum).",
    ],
  },
  {
    title: "Find Warplets and Track The Market",
    visual: "search",
    bullets: [
      "Search all 10,000 Warplets, filter by attributes and levels, and order by market data.",
      "💚 Favourite a Warplet to track market updates.",
    ],
  },
  {
    title: "Trade, Share, and Stay Updated",
    visual: "trade",
    bullets: [
      "Buy, offer, list, and sell in-app via OpenSea.",
      "Share interesting Warplets and search results.",
      "Get notifications for stats, activity, and friends.",
    ],
  },
];

const ONBOARDING_ATTRIBUTE_SAMPLE_LEVELS = ["9X", "3X", "2X", "1X", "7X", "2X", "1X", "3X", "1X", "2X"] as const;
const ONBOARDING_ATTRIBUTES = LEVEL_ATTRIBUTES.map(({ label, emoji }, index) => ({ label, emoji, level: ONBOARDING_ATTRIBUTE_SAMPLE_LEVELS[index] ?? "1X" }));
const ONBOARDING_LEVELS = [
  ["10X", 10],
  ["9X", 20],
  ["8X", 40],
  ["7X", 80],
  ["6X", 160],
  ["5X", 320],
  ["4X", 640],
  ["3X", 1280],
  ["2X", 2560],
  ["1X", 4890],
] as const;
const ONBOARDING_ATTRIBUTE_TILE_INTERVAL_MS = 400;
const ONBOARDING_ATTRIBUTE_TILE_ANIMATION_MS = 500;
const ONBOARDING_LEVEL_BAR_INTERVAL_MS = 500;
const getOnboardingLevelBarDurationMs = (index: number) => 500 + index * 100;
const ONBOARDING_TYPEWRITER_MS_PER_CHARACTER = 38;

function getOnboardingPreviewAnimationDurationMs(kind: OnboardingVisualKind): number {
  if (kind === "attributes") {
    return (ONBOARDING_ATTRIBUTES.length - 1) * ONBOARDING_ATTRIBUTE_TILE_INTERVAL_MS + ONBOARDING_ATTRIBUTE_TILE_ANIMATION_MS;
  }
  if (kind === "levels") {
    const finalLevelIndex = ONBOARDING_LEVELS.length - 1;
    return finalLevelIndex * ONBOARDING_LEVEL_BAR_INTERVAL_MS + getOnboardingLevelBarDurationMs(finalLevelIndex);
  }
  return 0;
}

function countTypewriterCharacters(node: ReactNode): number {
  if (node == null || typeof node === "boolean") return 0;
  if (typeof node === "string" || typeof node === "number") return String(node).length;
  if (Array.isArray(node)) return node.reduce((total, child) => total + countTypewriterCharacters(child), 0);
  if (isValidElement<{ children?: ReactNode }>(node)) return countTypewriterCharacters(node.props.children);
  return 0;
}

function renderTypewriterNode(node: ReactNode, visibleCharacters: number): { content: ReactNode; totalCharacters: number } {
  if (node == null || typeof node === "boolean") return { content: null, totalCharacters: 0 };

  if (typeof node === "string" || typeof node === "number") {
    const text = String(node);
    return {
      content: text.slice(0, Math.max(0, Math.min(visibleCharacters, text.length))),
      totalCharacters: text.length,
    };
  }

  if (Array.isArray(node)) {
    let remainingCharacters = visibleCharacters;
    let totalCharacters = 0;
    const content = node.map((child, index) => {
      const rendered = renderTypewriterNode(child, remainingCharacters);
      remainingCharacters -= rendered.totalCharacters;
      totalCharacters += rendered.totalCharacters;
      return <span key={index}>{rendered.content}</span>;
    });
    return { content, totalCharacters };
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    const rendered = renderTypewriterNode(node.props.children, visibleCharacters);
    return {
      content: cloneElement(node, undefined, rendered.content),
      totalCharacters: rendered.totalCharacters,
    };
  }

  return { content: node, totalCharacters: 0 };
}

function TypewriterText({
  children,
  visibleCharacters,
}: {
  children: ReactNode;
  visibleCharacters: number;
}) {
  const rendered = renderTypewriterNode(children, visibleCharacters);
  return <>{rendered.content}</>;
}

function OnboardingVisual({
  kind,
  animationStarted = true,
}: {
  kind: OnboardingVisualKind;
  animationStarted?: boolean;
}) {
  const [isFeaturedVideoReady, setIsFeaturedVideoReady] = useState(false);
  const [readyAccessVideos, setReadyAccessVideos] = useState<Record<string, boolean>>({});
  const [levelAnimationStep, setLevelAnimationStep] = useState(-1);

  useEffect(() => {
    if (kind !== "levels" || !animationStarted) {
      setLevelAnimationStep(-1);
      return;
    }

    let isCancelled = false;
    const timeoutIds: number[] = [];

    setLevelAnimationStep(-1);
    ONBOARDING_LEVELS.forEach((_, index) => {
      const timeoutId = window.setTimeout(() => {
        if (!isCancelled) setLevelAnimationStep(index);
      }, index * ONBOARDING_LEVEL_BAR_INTERVAL_MS);
      timeoutIds.push(timeoutId);
    });

    return () => {
      isCancelled = true;
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [animationStarted, kind]);

  if (kind === "featuredWarplet") {
    return (
      <div className="relative mx-auto aspect-[9/8] w-full max-w-[min(100%,360px)] overflow-hidden rounded-lg border border-[#00FF00]/25 bg-black">
        {!isFeaturedVideoReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-[rgba(0,255,0,0.12)]">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#00FF00]/25 border-t-[#00FF00]" aria-label="Loading 10X Warplet video" />
          </div>
        )}
        <video
          src={getWarpletAssetUrl(760, "mp4")}
          autoPlay
          muted
          loop
          playsInline
          onCanPlay={() => setIsFeaturedVideoReady(true)}
          onLoadedData={() => setIsFeaturedVideoReady(true)}
          className={`h-full w-full object-cover transition-opacity duration-300 ${isFeaturedVideoReady ? "opacity-100" : "opacity-0"}`}
        />
      </div>
    );
  }

  if (kind === "airdrop") {
    return (
      <div className="relative aspect-[9/7] overflow-hidden rounded-lg border border-[#00FF00]/25 bg-black">
        <img src="/onboarding/step-2.avif" alt="The Warplets collection" className="onboarding-pan-zoom h-full w-full object-cover" loading="eager" />
      </div>
    );
  }

  if (kind === "attributes") {
    return (
      <div className="aspect-[16/10] rounded-lg border border-[#00FF00]/25 bg-black p-3">
        <div className="grid h-full grid-cols-2 gap-2">
          {ONBOARDING_ATTRIBUTES.map(({ label, emoji, level }, index) => (
            <div
              key={label}
              className={`${animationStarted ? "onboarding-attribute-tile" : "opacity-0"} flex items-center justify-between rounded border border-[#00FF00]/15 bg-[#041204] px-2 py-1`}
              style={{
                animationDelay: animationStarted ? `${index * ONBOARDING_ATTRIBUTE_TILE_INTERVAL_MS}ms` : undefined,
              }}
            >
              <span className="flex min-w-0 items-center gap-1 text-[10px] font-bold uppercase text-[#8bbf8b]">
                <span aria-hidden="true">{emoji}</span>
                <span className="truncate">{label}</span>
              </span>
              <span className="rounded bg-[rgba(0,255,0,0.12)] px-2 py-0.5 text-xs font-bold text-[#00FF00]">{level}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (kind === "levels") {
    const currentLevelIndex = Math.max(0, Math.min(levelAnimationStep, ONBOARDING_LEVELS.length - 1));
    const currentMaxSupply = ONBOARDING_LEVELS[currentLevelIndex][1];
    const pixelScalePerNft = 0.3;
    const zoomOutThresholdSupply = 320;
    const getLevelHeight = (count: number) => {
      if (currentMaxSupply <= zoomOutThresholdSupply) {
        return `${count * pixelScalePerNft}px`;
      }
      return count === 10 ? "1px" : `${Math.max(1, (count / currentMaxSupply) * 100)}%`;
    };

    return (
      <div className="h-[250px] rounded-lg border border-[#00FF00]/25 bg-black p-3">
        <div className="flex h-full items-end gap-1">
          {ONBOARDING_LEVELS.map(([level, count], index) => {
            const isVisible = index <= levelAnimationStep;
            return (
            <div key={level} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <div className="flex min-h-0 w-full flex-1 items-end">
                <div
                  className="onboarding-level-bar w-full rounded-t border border-[#00FF00]/25 bg-[rgba(0,255,0,0.12)]"
                  style={{
                    "--level-height": isVisible ? getLevelHeight(count) : "1px",
                    "--level-duration": `${getOnboardingLevelBarDurationMs(index)}ms`,
                    opacity: isVisible ? 1 : 0,
                  } as CSSProperties}
                />
              </div>
              <span className="text-[10px] font-bold text-[#00FF00]">{level}</span>
              <span className="text-[8px] text-[#8bbf8b]">{count.toLocaleString("en-US")}</span>
            </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (kind === "access") {
    const accessVideos = [
      { title: "10X Memes", body: "Future airdrop bonuses", src: "/onboarding/ansem.mp4" },
      { title: "10X NFTs", body: "Future whitelist access", src: "/onboarding/Token_S1.mp4" },
    ];

    return (
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-[#00FF00]/25 bg-black p-3">
        {accessVideos.map(({ title, body, src }) => (
          <div key={title} className="flex min-h-0 flex-col gap-2">
            <span className="text-center text-xs font-bold uppercase text-[#00FF00]">{title}</span>
            <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-[#00FF00]/25 bg-[rgba(0,255,0,0.12)]">
              {!readyAccessVideos[src] && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#00FF00]/25 border-t-[#00FF00]" aria-label={`Loading ${title} video`} />
                </div>
              )}
              <video
                src={src}
                autoPlay
                muted
                loop
                playsInline
                onCanPlay={() => setReadyAccessVideos((current) => ({ ...current, [src]: true }))}
                onLoadedData={() => setReadyAccessVideos((current) => ({ ...current, [src]: true }))}
                className={`h-full w-full object-cover transition-opacity duration-300 ${readyAccessVideos[src] ? "opacity-100" : "opacity-0"}`}
              />
            </div>
            <span className="text-center text-xs font-bold text-[#8bbf8b]">{body}</span>
          </div>
        ))}
      </div>
    );
  }

  if (kind === "search") {
    const searchPreviewImages = [1, 2, 3, 4, 5].map((index) => `/onboarding/step6-${index}.jpg`);

    return (
      <div className="relative aspect-square overflow-hidden rounded-lg border border-[#00FF00]/25 bg-black">
        {searchPreviewImages.map((src, index) => (
          <img
            key={src}
            src={src}
            alt=""
            className="onboarding-search-carousel-image absolute inset-0 h-full w-full object-cover"
            style={{
              "--onboarding-carousel-duration": "20s",
              animationDelay: `${index * 4}s`,
            } as CSSProperties}
            loading={index === 0 ? "eager" : "lazy"}
          />
          ))}
      </div>
    );
  }

  if (kind === "trade") {
    const tradePreviewImages = [1, 2, 3, 4, 5, 6, 7].map((index) => `/onboarding/step7-${index}-v2.jpg`);

    return (
      <div className="relative aspect-[450/400] overflow-hidden rounded-lg border border-[#00FF00]/25 bg-black">
        {tradePreviewImages.map((src, index) => (
          <img
            key={src}
            src={src}
            alt=""
            className="onboarding-trade-carousel-image absolute inset-0 h-full w-full object-cover"
            style={{
              "--onboarding-carousel-duration": "28s",
              animationDelay: `${index * 4}s`,
            } as CSSProperties}
            loading={index === 0 ? "eager" : "lazy"}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="aspect-[16/10] rounded-lg border border-[#00FF00]/25 bg-black p-3">
      <div className="grid h-full grid-rows-3 gap-2">
        {[["Buy now", "Make offer"], ["List for sale", "Accept offer"], ["Share", "Notifications"]].map((row, rowIndex) => (
          <div key={rowIndex} className="grid grid-cols-2 gap-2">
            {row.map((label, index) => (
              <div
                key={label}
                className={`flex items-center justify-center rounded-full border-b-4 border-r-4 px-2 text-center text-xs font-bold ${
                  rowIndex === 0 && index === 0
                    ? "border-[#005000] bg-[#00FF00] text-[rgb(0,80,0)]"
                    : "border-[#00FF00]/35 bg-black text-[#00FF00]"
                }`}
              >
                {label}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function OnboardingCarousel({ onDone }: { onDone: () => void }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [typedCharacterCount, setTypedCharacterCount] = useState(0);
  const onboardingContentRef = useRef<HTMLDivElement | null>(null);
  const activeSlide = ONBOARDING_SLIDES[activeIndex];
  const isFirst = activeIndex === 0;
  const isLast = activeIndex === ONBOARDING_SLIDES.length - 1;
  const onboardingTitleCharacterCount = activeSlide.title.length;
  const visibleTitleCharacters = Math.max(
    0,
    Math.min(onboardingTitleCharacterCount, typedCharacterCount),
  );
  const onboardingTextCharacterCounts = useMemo(
    () => activeSlide.bullets.map((bullet) => countTypewriterCharacters(bullet)),
    [activeSlide],
  );
  const onboardingPreviewAnimationCharacters = Math.ceil(
    getOnboardingPreviewAnimationDurationMs(activeSlide.visual) / ONBOARDING_TYPEWRITER_MS_PER_CHARACTER,
  );
  const onboardingBodyStartCharacterCount = onboardingTitleCharacterCount + onboardingPreviewAnimationCharacters;
  const onboardingPreviewAnimationStarted = typedCharacterCount >= onboardingTitleCharacterCount;
  const onboardingTotalTextCharacters = useMemo(
    () => onboardingBodyStartCharacterCount + onboardingTextCharacterCounts.reduce((total, count) => total + count, 0),
    [onboardingBodyStartCharacterCount, onboardingTextCharacterCounts],
  );
  const [initializeOnboardingScrollbars] = useOverlayScrollbars({
    options: {
      scrollbars: {
        theme: "os-theme-10x",
        autoHide: "scroll",
        clickScroll: true,
      },
    },
    defer: true,
  });

  useEffect(() => {
    const target = onboardingContentRef.current;
    if (!target) return;
    target.setAttribute("data-overlayscrollbars-initialize", "");
    initializeOnboardingScrollbars(target);
    return () => {
      target.removeAttribute("data-overlayscrollbars-initialize");
    };
  }, [initializeOnboardingScrollbars]);

  useEffect(() => {
    let animationFrameId = 0;
    const startedAt = performance.now();

    setTypedCharacterCount(0);

    const tick = (now: number) => {
      const nextCount = Math.min(
        onboardingTotalTextCharacters,
        Math.floor((now - startedAt) / ONBOARDING_TYPEWRITER_MS_PER_CHARACTER),
      );
      setTypedCharacterCount(nextCount);
      if (nextCount < onboardingTotalTextCharacters) {
        animationFrameId = window.requestAnimationFrame(tick);
      }
    };

    animationFrameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [activeIndex, onboardingTotalTextCharacters]);

  const goBack = () => {
    if (isFirst) return;
    void hapticTap();
    setActiveIndex((current) => Math.max(0, current - 1));
  };

  const goForward = () => {
    void hapticPrimaryTap();
    if (isLast) {
      onDone();
      return;
    }
    setActiveIndex((current) => Math.min(ONBOARDING_SLIDES.length - 1, current + 1));
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/85 p-4 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl">
        <div className="border-b border-[#00FF00]/20 bg-black px-4 py-3">
          <Text className="relative text-base font-bold" style={{ color: "#00FF00" }}>
            <span className="invisible select-none" aria-hidden="true">{activeSlide.title}</span>
            <span className="absolute inset-0">
              <TypewriterText visibleCharacters={visibleTitleCharacters}>
                {activeSlide.title}
              </TypewriterText>
            </span>
          </Text>
        </div>
        <div ref={onboardingContentRef} className="min-h-0 flex-1 overflow-y-auto p-4">
          <OnboardingVisual kind={activeSlide.visual} animationStarted={onboardingPreviewAnimationStarted} />
          <div className="mt-3 space-y-2">
            {activeSlide.bullets.map((bullet, index) => {
              const previousCharacters = onboardingBodyStartCharacterCount + onboardingTextCharacterCounts
                .slice(0, index)
                .reduce((total, count) => total + count, 0);
              const bulletCharacterCount = onboardingTextCharacterCounts[index] ?? 0;
              const visibleCharacters = Math.max(
                0,
                Math.min(bulletCharacterCount, typedCharacterCount - previousCharacters),
              );

              return (
                <div key={index} className="relative rounded-lg border border-[#00FF00]/15 bg-[#041204] px-3 py-2 text-sm leading-relaxed text-[#8bbf8b]">
                  <div className="invisible select-none" aria-hidden="true">
                    {bullet}
                  </div>
                  <div className="absolute inset-0 px-3 py-2">
                    <TypewriterText visibleCharacters={visibleCharacters}>
                      {bullet}
                    </TypewriterText>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="border-t border-[#00FF00]/20 bg-black p-4">
          <div className="mb-4 flex items-center justify-center gap-1.5">
            {ONBOARDING_SLIDES.map((slide, index) => (
              <button
                key={slide.title}
                type="button"
                aria-label={`Go to onboarding slide ${index + 1}`}
                onClick={() => {
                  void hapticSelectionChanged();
                  setActiveIndex(index);
                }}
                className={`h-2 rounded-full transition-all ${index === activeIndex ? "w-6 bg-[#00FF00]" : "w-2 bg-[#00FF00]/25 hover:bg-[#00FF00]/60"}`}
              />
            ))}
          </div>
          <div className="flex gap-3">
            {!isFirst && (
              <button
                type="button"
                onClick={goBack}
                className="secondary-trade-cta flex-1 cursor-pointer rounded-[20px] border bg-black px-4 py-3 text-sm font-bold text-[#00FF00] transition-all duration-100 hover:bg-[#041204] active:translate-x-[1px] active:translate-y-[3px]"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={goForward}
              className="flex-1 cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-4 py-3 text-sm font-bold text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000]"
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SharePreviewModal({
  preview,
  onClose,
  onCopySuccess,
  onShareFarcaster,
  onShareTwitter,
}: {
  preview: SharePreviewState;
  onClose: () => void;
  onCopySuccess: () => void;
  onShareFarcaster: () => void;
  onShareTwitter: () => void;
}) {
  const shareContentRef = useRef<HTMLDivElement | null>(null);
  const [resolvedImages, setResolvedImages] = useState<SharePreviewImage[]>(preview.images);
  const farcasterPostText = preview.farcasterText ?? preview.text;
  const twitterPostText = preview.twitterPostText ?? preview.text;
  const hasChannelTabs = farcasterPostText !== twitterPostText;
  const [activeShareChannel, setActiveShareChannel] = useState<"farcaster" | "twitter">("farcaster");
  const visiblePostBody = hasChannelTabs && activeShareChannel === "twitter" ? twitterPostText : farcasterPostText;
  const postText = [visiblePostBody, ...preview.links].join("\n\n");
  const [titleFirstWord, ...titleRestWords] = preview.title.split(" ");
  const titleRest = titleRestWords.join(" ");
  const [isClipboardTooltipOpen, setIsClipboardTooltipOpen] = useState(false);
  const [initializeShareScrollbars] = useOverlayScrollbars({
    options: {
      scrollbars: {
        theme: "os-theme-10x",
        autoHide: "scroll",
        clickScroll: true,
      },
    },
    defer: true,
  });
  const {
    refs: clipboardTooltipRefs,
    floatingStyles: clipboardTooltipStyles,
    context: clipboardTooltipContext,
  } = useFloating({
    open: isClipboardTooltipOpen,
    onOpenChange: setIsClipboardTooltipOpen,
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const clipboardHover = useHover(clipboardTooltipContext, { delay: { open: 0, close: 60 }, move: false });
  const clipboardFocus = useFocus(clipboardTooltipContext);
  const clipboardRole = useRole(clipboardTooltipContext, { role: "tooltip" });
  const { getReferenceProps: getClipboardReferenceProps, getFloatingProps: getClipboardFloatingProps } = useInteractions([
    clipboardHover,
    clipboardFocus,
    clipboardRole,
  ]);

  useEffect(() => {
    setActiveShareChannel("farcaster");
  }, [preview]);

  useEffect(() => {
    const target = shareContentRef.current;
    if (!target) return;
    target.setAttribute("data-overlayscrollbars-initialize", "");
    initializeShareScrollbars(target);
    return () => {
      target.removeAttribute("data-overlayscrollbars-initialize");
    };
  }, [initializeShareScrollbars]);

  useEffect(() => {
    let cancelled = false;
    setResolvedImages(preview.images.map((image) => image.sourceUrl ? { ...image, isLoading: true } : image));

    preview.images.forEach((image, index) => {
      if (!image.sourceUrl) return;

      fetch(`/api/opengraph-image?url=${encodeURIComponent(image.sourceUrl)}`, {
        headers: { accept: "application/json" },
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: unknown) => {
          if (cancelled) return;
          if (!payload || typeof payload !== "object") {
            setResolvedImages((currentImages) =>
              currentImages.map((currentImage, currentIndex) =>
                currentIndex === index ? { ...currentImage, isLoading: false } : currentImage,
              ),
            );
            return;
          }
          const imageUrl = "imageUrl" in payload ? payload.imageUrl : null;
          if (typeof imageUrl !== "string" || !imageUrl) {
            setResolvedImages((currentImages) =>
              currentImages.map((currentImage, currentIndex) =>
                currentIndex === index ? { ...currentImage, isLoading: false } : currentImage,
              ),
            );
            return;
          }

          setResolvedImages((currentImages) =>
            currentImages.map((currentImage, currentIndex) =>
              currentIndex === index
                ? {
                    ...currentImage,
                    fallbackSrc: currentImage.fallbackSrc ?? currentImage.src,
                    src: imageUrl,
                    isLoading: false,
                  }
                : currentImage,
            ),
          );
        })
        .catch((error) => {
          console.warn("Failed to resolve OpenSea OpenGraph image", error);
          if (cancelled) return;
          setResolvedImages((currentImages) =>
            currentImages.map((currentImage, currentIndex) =>
              currentIndex === index ? { ...currentImage, isLoading: false } : currentImage,
            ),
          );
        });
    });

    return () => {
      cancelled = true;
    };
  }, [preview]);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/80 p-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-md overflow-hidden rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#00FF00]/20 bg-black px-4 py-3">
          <Text className="min-w-0 truncate text-base font-bold" style={{ color: "rgb(139, 191, 139)" }}>
            <span style={{ color: "#00FF00" }}>{titleFirstWord}</span>
            {titleRest && <span> {titleRest}</span>}
          </Text>
          <button
            type="button"
            aria-label="Close share preview"
            title="Close"
            onClick={() => {
              void hapticTap();
              onClose();
            }}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#00FF00]/35 text-[#00FF00] hover:bg-[#041204]"
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

        <div ref={shareContentRef} className="max-h-[calc(92vh-156px)] overflow-auto px-4 py-4">
          <div>
            {hasChannelTabs && (
              <div className="flex items-end gap-1">
                {[
                  ["farcaster", "Farcaster"],
                  ["twitter", "X (Twitter)"],
                ].map(([channel, label]) => {
                  const isActive = activeShareChannel === channel;
                  return (
                    <button
                      key={channel}
                      type="button"
                      onClick={() => {
                        void hapticTap();
                        setActiveShareChannel(channel as "farcaster" | "twitter");
                      }}
                      style={{ color: isActive ? "#00FF00" : "rgb(139, 191, 139)" }}
                      className={`relative -mb-px cursor-pointer rounded-t-lg border px-4 py-2 text-xs font-bold transition-colors ${
                        isActive
                          ? "z-10 border-[#00FF00]/25 border-b-transparent bg-[#041204]"
                          : "border-[#00FF00]/20 border-b-[#00FF00]/25 bg-black"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          <div className={`relative rounded-xl border border-[#00FF00]/25 bg-[#041204]/80 p-3 ${hasChannelTabs ? "rounded-tl-none" : ""}`}>
            <Text className="mb-2 text-xs font-bold uppercase" style={{ color: "#8bbf8b" }}>
              Post
            </Text>
            <button
              ref={clipboardTooltipRefs.setReference}
              type="button"
              aria-label="Copy to Clipboard"
              {...getClipboardReferenceProps({
                onClick: () => {
                  void hapticPrimaryTap();
                  setIsClipboardTooltipOpen(false);
                  copyTextToClipboard(postText)
                    .then(() => {
                      void hapticSuccess();
                      onCopySuccess();
                    })
                    .catch((error) => {
                      console.error("Failed to copy share post:", error);
                      void hapticError();
                    });
                },
                className:
                  "absolute right-3 top-3 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[oklab(0.866435_-0.23384_0.179502_/_0.35)] bg-black text-base text-[#00FF00] shadow-[2px_3px_0_oklab(0.866435_-0.23384_0.179502_/_0.35)] transition-all duration-100 hover:bg-[#041204] active:translate-x-[1px] active:translate-y-[2px] active:shadow-[1px_1px_0_oklab(0.866435_-0.23384_0.179502_/_0.35)]",
              })}
            >
              <span aria-hidden="true">📋</span>
            </button>
            {isClipboardTooltipOpen && (
              <FloatingPortal>
                <div
                  ref={clipboardTooltipRefs.setFloating}
                  style={clipboardTooltipStyles}
                  {...getClipboardFloatingProps({
                    className: "z-[100] max-w-[min(92vw,520px)] whitespace-nowrap rounded-lg border border-[#00FF00]/40 bg-black px-3 py-2 text-[11px] font-bold leading-snug text-[#00FF00] shadow-2xl",
                  })}
                >
                  Copy to Clipboard
                </div>
              </FloatingPortal>
            )}
            <pre className="min-h-9 select-text whitespace-pre-wrap break-words pr-12 pt-1 font-sans text-sm font-bold leading-snug text-[#00FF00]">
              {postText}
            </pre>
          </div>
          </div>

          <div className="mt-3 rounded-xl border border-[#00FF00]/25 bg-[#041204]/80 p-3">
            <Text className="mb-2 text-xs font-bold uppercase" style={{ color: "#8bbf8b" }}>
              Images
            </Text>
            <div className="grid grid-cols-2 gap-2">
              {resolvedImages.map((image, index) => (
                <div key={`${image.src}-${index}`} className="aspect-square overflow-hidden rounded-lg border border-[#00FF00]/25 bg-[rgba(0,255,0,0.12)]">
                  {image.isLoading ? (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#00FF00]/25 border-t-[#00FF00]" aria-label="Loading OpenSea preview image" />
                    </div>
                  ) : (
                    <img
                      src={image.src}
                      alt={image.alt}
                      className={`block h-full w-full ${image.sourceUrl ? "object-contain" : "object-cover"}`}
                      loading="lazy"
                      onError={(event) => {
                        if (!image.fallbackSrc || event.currentTarget.src === image.fallbackSrc) return;
                        event.currentTarget.src = image.fallbackSrc;
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 border-t border-[#00FF00]/20 bg-black px-4 py-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                void hapticPrimaryTap();
                onShareFarcaster();
              }}
              className="w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-3 py-3 text-center text-sm font-bold text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000]"
            >
              Share on Farcaster
            </button>
            <button
              type="button"
              onClick={() => {
                void hapticPrimaryTap();
                onShareTwitter();
              }}
              className="secondary-trade-cta w-full cursor-pointer rounded-[20px] border bg-black px-3 py-3 text-center text-sm font-bold text-[#00FF00] transition-all duration-100 hover:bg-[#041204] active:translate-x-[1px] active:translate-y-[3px]"
            >
              Share on X (Twitter)
            </button>
          </div>
        </div>
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

type WarpletSocialProfile = {
  farcasterUsername: string | null;
  xUsername: string | null;
};

type TradeShareAction = "offer" | "listing" | "purchase" | "sale";

function parseTradeShareTestAction(value: string | null): TradeShareAction | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "offer" || normalized === "make-offer") return "offer";
  if (normalized === "list" || normalized === "listing" || normalized === "list-for-sale") return "listing";
  if (normalized === "buy" || normalized === "purchase" || normalized === "buy-now") return "purchase";
  if (normalized === "sell" || normalized === "sale" || normalized === "accept-offer") return "sale";
  return null;
}

type TradeShareCounterparty = {
  wallet?: string | null;
  fid?: number | null;
  farcasterUsername?: string | null;
  xUsername?: string | null;
};

function normalizeShareUsername(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/^@/, "");
  if (!trimmed || trimmed === "-") return null;
  return trimmed;
}

function formatWarpletShareUsername(value: string | null | undefined): string {
  const username = normalizeShareUsername(value);
  return username ? ` [@${username}]` : "";
}

function formatTradeShareAmount(amountEth: number | null, ethUsdPrice: number | null): string {
  if (amountEth == null || !Number.isFinite(amountEth)) return "0 ETH";
  const numeric = decimalStringFromNumber(amountEth);
  const ethAmount = numeric == null ? "0" : truncateDecimalDigits(numeric, 8);
  if (ethUsdPrice == null || !Number.isFinite(ethUsdPrice)) return `${ethAmount} ETH`;
  const usdAmount = amountEth * ethUsdPrice;
  const formattedUsd = usdAmount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: usdAmount >= 100 ? 0 : 2,
  });
  return `${ethAmount} ETH (~${formattedUsd})`;
}

async function fetchWarpletSocialProfile(input: {
  wallet?: string | null;
  fid?: number | null;
}): Promise<WarpletSocialProfile> {
  const params = new URLSearchParams();
  if (input.wallet) params.set("wallet", input.wallet);
  if (input.fid != null) params.set("fid", String(input.fid));
  if (!params.toString()) return { farcasterUsername: null, xUsername: null };

  try {
    const response = await fetch(`/api/warplet-social-profile?${params.toString()}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Social profile lookup failed (${response.status})`);
    const payload = await response.json() as Partial<WarpletSocialProfile>;
    return {
      farcasterUsername: normalizeShareUsername(payload.farcasterUsername),
      xUsername: normalizeShareUsername(payload.xUsername),
    };
  } catch (error) {
    console.warn("Failed to resolve trade share social profile:", error);
    return { farcasterUsername: null, xUsername: null };
  }
}

async function buildTradeSharePreview({
  action,
  details,
  amountEth,
  ethUsdPrice,
  counterparty,
}: {
  action: TradeShareAction;
  details: WarpletDetails;
  amountEth: number | null;
  ethUsdPrice: number | null;
  counterparty?: TradeShareCounterparty | null;
}): Promise<SharePreviewState> {
  const tokenId = details.id;
  const shareState = { ...EMPTY_SEARCH_URL_STATE, warplet: tokenId };
  const miniAppLink = buildSearchHref(shareState);
  const openSeaLink = getOpenSeaUrl(tokenId);
  const links = [miniAppLink, openSeaLink];
  const amountText = formatTradeShareAmount(amountEth, ethUsdPrice);
  const resolvedCounterparty = counterparty
    ? await fetchWarpletSocialProfile({ wallet: counterparty.wallet, fid: counterparty.fid })
    : { farcasterUsername: null, xUsername: null };
  const farcasterCounterparty = normalizeShareUsername(counterparty?.farcasterUsername) ?? resolvedCounterparty.farcasterUsername;
  const twitterCounterparty = normalizeShareUsername(counterparty?.xUsername) ?? resolvedCounterparty.xUsername;
  const farcasterWarpletUsername = formatWarpletShareUsername(cellToString(details.row.warplet_username_farcaster));
  const twitterWarpletUsername = formatWarpletShareUsername(cellToString(details.row.warplet_username_x));
  const withCounterparty = (keyword: "to" | "from", username: string | null) => username ? ` ${keyword} @${username}` : "";

  let title = "";
  let farcasterText = "";
  let twitterPostText = "";

  if (action === "offer") {
    title = "Share Item Offer";
    farcasterText = `Offering ${amountText}${withCounterparty("to", farcasterCounterparty)} for 10X Warplet #${tokenId}${farcasterWarpletUsername}.`;
    twitterPostText = `Offering ${amountText}${withCounterparty("to", twitterCounterparty)} for 10X Warplet #${tokenId}${twitterWarpletUsername}.`;
  } else if (action === "listing") {
    title = "Share Item Listing";
    farcasterText = `Listing for ${amountText} my 10X Warplet #${tokenId}${farcasterWarpletUsername}.`;
    twitterPostText = `Listing for ${amountText} my 10X Warplet #${tokenId}${twitterWarpletUsername}.`;
  } else if (action === "purchase") {
    title = "Share Item Purchase";
    farcasterText = `Purchased for ${amountText}${withCounterparty("from", farcasterCounterparty)} the 10X Warplet #${tokenId}${farcasterWarpletUsername}.`;
    twitterPostText = `Purchased for ${amountText}${withCounterparty("from", twitterCounterparty)} the 10X Warplet #${tokenId}${twitterWarpletUsername}.`;
  } else {
    title = "Share Item Sale";
    farcasterText = `Sold for ${amountText}${withCounterparty("to", farcasterCounterparty)} the 10X Warplet #${tokenId}${farcasterWarpletUsername}.`;
    twitterPostText = `Sold for ${amountText}${withCounterparty("to", twitterCounterparty)} the 10X Warplet #${tokenId}${twitterWarpletUsername}.`;
  }

  return {
    title,
    text: farcasterText,
    farcasterText,
    twitterPostText,
    links,
    images: [
      { src: getWarpletAssetUrl(tokenId, "gif"), alt: `10X Warplet #${tokenId} share image` },
      {
        src: getWarpletAssetUrl(tokenId, "gif"),
        alt: `10X Warplet #${tokenId} OpenSea share image`,
        sourceUrl: openSeaLink,
      },
    ],
    farcasterEmbeds: [miniAppLink, openSeaLink],
    twitterText: buildTwitterShareText(twitterPostText, links),
  };
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
  isFavourited,
  onToggleFavourite,
  onSearchTag,
  onLevelFilter,
  onOpenRelatedWarplet,
  onSearchOwnerWallet,
  onSearchOwnerFavourites,
  market,
  ownedTokenIds,
  ownerFavouriteCount,
  isRefreshingMarket,
  marketRefreshError,
  onRefreshMarket,
  viewerFid,
  onMergeMarketSnapshot,
  onClearMarketSide,
  onUpsertItemOffer,
  onApplyPurchase,
  onOpenTradeSharePreview,
  stackIndex,
}: {
  details: WarpletDetails;
  onClose: () => void;
  onShare: () => void;
  onSearchTag: (tag: string) => void;
  onLevelFilter: (attribute: LevelAttributeColumn, level: number) => void;
  onOpenRelatedWarplet: (tokenId: number) => void;
  onSearchOwnerWallet: (wallet: string) => void;
  onSearchOwnerFavourites: (wallet: string) => void;
  market: TokenMarketState;
  ownedTokenIds: number[];
  ownerFavouriteCount: number;
  isFavourited: boolean;
  onToggleFavourite: (tokenId: number) => void;
  isRefreshingMarket: boolean;
  marketRefreshError: string;
  onRefreshMarket: () => void;
  viewerFid: number | null;
  onMergeMarketSnapshot: (tokenId: number, snapshot: MarketSnapshot) => void;
  onClearMarketSide: (tokenId: number, side: "listing" | "offer" | "collectionOffer") => void;
  onUpsertItemOffer: (tokenId: number, offer: MarketSnapshot["offers"][string]) => void;
  onApplyPurchase: (tokenId: number, update: OptimisticPurchaseUpdate) => void;
  onOpenTradeSharePreview: (preview: SharePreviewState) => void;
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
  const getTradeShareUsdPrice = useCallback(async () => {
    if (ethUsdPrice != null && Date.now() - ethUsdPriceFetchedAtRef.current < ETH_USD_PRICE_STALE_MS) {
      return ethUsdPrice;
    }

    try {
      const nextPrice = await fetchEthUsdPrice();
      ethUsdPriceFetchedAtRef.current = Date.now();
      setEthUsdPrice(nextPrice);
      return nextPrice;
    } catch (error) {
      console.warn("Failed to refresh ETH/USD for trade share:", error);
      return ethUsdPrice;
    }
  }, [ethUsdPrice]);
  const openTradeSharePreview = useCallback(async ({
    action,
    amountEth,
    counterparty,
  }: {
    action: TradeShareAction;
    amountEth: number | null;
    counterparty?: TradeShareCounterparty | null;
  }) => {
    const usdPrice = await getTradeShareUsdPrice();
    const preview = await buildTradeSharePreview({
      action,
      details,
      amountEth,
      ethUsdPrice: usdPrice,
      counterparty,
    });
    onOpenTradeSharePreview(preview);
  }, [details, getTradeShareUsdPrice, onOpenTradeSharePreview]);
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
      void openTradeSharePreview({
        action: "purchase",
        amountEth: marketMoneyToDecimal(sale),
        counterparty: {
          wallet: purchasedListing?.seller ?? effectiveOwner?.wallet ?? null,
          fid: effectiveOwner?.fid ?? null,
          farcasterUsername: (effectiveOwner as MarketSnapshot["owners"][string] | null)?.username ?? null,
        },
      });
    } catch (error) {
      handleTradeError("buy", error);
    } finally {
      setTradeBusyAction(null);
    }
  }, [details.id, effectiveCollectionOffer, effectiveFloor, effectiveItemOffer, effectiveListing, effectiveOwner, effectiveTopOffer, getProviderAndAccount, handleFreshMismatch, handleTradeError, onApplyPurchase, openTradeSharePreview, postTradeLog, refreshTradeState, showFirefoxWarningIfNeeded, showToast, viewerFid]);

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
      void openTradeSharePreview({
        action: "sale",
        amountEth: marketMoneyToDecimal(sale),
        counterparty: {
          wallet: acceptedBuyerWallet,
          fid: acceptedBuyerProfile?.fid ?? null,
          farcasterUsername: acceptedBuyerProfile?.username ?? null,
        },
      });
    } catch (error) {
      handleTradeError("accept_offer", error);
    } finally {
      setTradeBusyAction(null);
    }
  }, [assertConnectedOwnerWallet, details.id, effectiveCollectionOffer, effectiveFloor, effectiveItemOffer, effectiveTopOffer, farcasterFid, farcasterUsername, getProviderAndAccount, handleFreshMismatch, handleTradeError, market.owner, onApplyPurchase, onClearMarketSide, onMergeMarketSnapshot, openTradeSharePreview, postTradeLog, refreshTradeState, showFirefoxWarningIfNeeded, showToast, viewerFid, wallet]);

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
        body: JSON.stringify({
          actionId,
          fid: viewerFid,
          tokenId: details.id,
          wallet: account,
          priceRaw,
          payload: signed.payload,
        }),
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
      void openTradeSharePreview({
        action: "listing",
        amountEth: listingAmount ?? parseTradeAmount(listingPrice),
      });
    } catch (error) {
      handleTradeError("list", error);
    } finally {
      tradeBusyActionRef.current = null;
      setTradeBusyAction(null);
    }
  }, [assertConnectedOwnerWallet, details.id, effectiveTopOffer, getProviderAndAccount, handleTradeError, listingAmount, listingPrice, listingPriceIsAtOrBelowTopOffer, openTradeSharePreview, postTradeLog, refreshTradeState, showFirefoxWarningIfNeeded, showToast, viewerFid]);

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
          fid: viewerFid,
          tokenId: details.id,
          wallet: account,
          priceRaw,
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
      void openTradeSharePreview({
        action: "offer",
        amountEth: offerAmount ?? parseTradeAmount(offerPrice),
        counterparty: {
          wallet: effectiveOwner?.wallet ?? null,
          fid: effectiveOwner?.fid ?? null,
          farcasterUsername: (effectiveOwner as MarketSnapshot["owners"][string] | null)?.username ?? null,
        },
      });
    } catch (error) {
      handleTradeError("make_offer", error);
    } finally {
      setTradeBusyAction(null);
    }
  }, [applyOptimisticItemOffer, details.id, effectiveOwner, getProviderAndAccount, handleTradeError, offerAmount, offerPrice, openTradeSharePreview, postTradeLog, refreshTradeState, showFirefoxWarningIfNeeded, showToast, viewerFid]);

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
        return (
          <MarketValuePanel
            key={label}
            kind={kind}
            label={label}
            money={money}
            emptyValue={emptyValue}
            className="min-w-0 px-2 pb-2.5 pt-2"
            style={{ backgroundColor: styles.backgroundColor }}
          />
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
              placement="bottom"
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
          <Text className="min-w-0 truncate text-base font-bold" style={{ color: "rgb(139, 191, 139)" }}>
            <span style={{ color: "#00FF00" }}>{details.title}</span>
            {details.username && (
              <span> @{details.username}</span>
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
            <FavouriteButton
              active={isFavourited}
              title={isFavourited ? `Remove 10X Warplet #${details.id} from favourites` : `Add 10X Warplet #${details.id} to favourites`}
              variant="modal"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleFavourite(details.id);
              }}
            />
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
                return (
                  <MarketValuePanel
                    key={label}
                    kind={kind}
                    label={label}
                    money={money}
                    emptyValue={emptyValue}
                    className="min-w-0 rounded-xl border px-2 py-2"
                    style={{ borderColor: styles.borderColor, backgroundColor: styles.backgroundColor }}
                  />
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
                ownerFavouriteCount={ownerFavouriteCount}
                onOpenWarplet={onOpenRelatedWarplet}
                onSearchOwnerWallet={onSearchOwnerWallet}
                onSearchOwnerFavourites={onSearchOwnerFavourites}
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
  const [databaseLoadingMessage, setDatabaseLoadingMessage] = useState(DATABASE_LOADING_PREFIX);
  const [onboardingComplete, setOnboardingComplete] = useState(() => readOnboardingComplete());
  const [showOnboarding, setShowOnboarding] = useState(() => !readOnboardingComplete());
  const [notificationPromptPending, setNotificationPromptPending] = useState(false);
  const [viewerFid, setViewerFid] = useState<number | null>(null);
  const [viewerProfile, setViewerProfile] = useState<ViewerProfile | null>(null);
  const [showAddAppPrompt, setShowAddAppPrompt] = useState(false);
  const [notificationsOnlyPrompt, setNotificationsOnlyPrompt] = useState(false);
  const [pendingNotificationId, setPendingNotificationId] = useState<string | null>(null);
  const [actionSessionToken, setActionSessionToken] = useState<string | null>(null);
  const [notificationOpenSent, setNotificationOpenSent] = useState(false);
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
  const [activeWallet, setActiveWallet] = useState<string | null>(null);
  const [favouriteListsByWallet, setFavouriteListsByWallet] = useState<Record<string, number[]>>({});
  const [favouriteFilterWallet, setFavouriteFilterWallet] = useState<string | null>(null);
  const [sharePreview, setSharePreview] = useState<SharePreviewState | null>(null);
  const [searchToast, setSearchToast] = useState<TradeToast | null>(null);
  const [searchToastExiting, setSearchToastExiting] = useState(false);
  const dbRef = useRef<SqliteDatabase | null>(null);
  const searchRunRef = useRef(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const urlHydratedRef = useRef(false);
  const applyingUrlStateRef = useRef(false);
  const lastUrlSignatureRef = useRef("");
  const loadedFavouriteWalletsRef = useRef(new Set<string>());
  const favouriteListsByWalletRef = useRef<Record<string, number[]>>({});
  const shareCelebrationRef = useRef<{ pending: boolean; leftApp: boolean; fallbackTimer: number | null }>({
    pending: false,
    leftApp: false,
    fallbackTimer: null,
  });
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome("search");
  const selectedWarpletDetails = selectedWarpletDetailsStack.at(-1) ?? null;

  const closeSearchToast = useCallback(() => {
    if (!searchToast) return;
    setSearchToastExiting(true);
    window.setTimeout(() => {
      setSearchToast(null);
      setSearchToastExiting(false);
    }, TRADE_TOAST_EXIT_MS);
  }, [searchToast]);

  const showSearchToast = useCallback((kind: TradeToast["kind"], message: string, options: { manualClose?: boolean; minMs?: number } = {}) => {
    const id = Date.now();
    const toast: TradeToast = { id, kind, message, manualClose: options.manualClose };
    setSearchToastExiting(false);
    setSearchToast(toast);
    if (!options.manualClose) {
      window.setTimeout(() => {
        setSearchToastExiting(true);
        window.setTimeout(() => {
          setSearchToast((current) => (current?.id === id ? null : current));
          setSearchToastExiting(false);
        }, TRADE_TOAST_EXIT_MS);
      }, (options.minMs ?? 5000) + TRADE_TOAST_EXTRA_MS);
    }
  }, []);

  const clearShareCelebrationFallback = useCallback(() => {
    if (shareCelebrationRef.current.fallbackTimer != null) {
      window.clearTimeout(shareCelebrationRef.current.fallbackTimer);
      shareCelebrationRef.current.fallbackTimer = null;
    }
  }, []);

  const completeShareCelebration = useCallback(() => {
    if (!shareCelebrationRef.current.pending) return;
    shareCelebrationRef.current.pending = false;
    shareCelebrationRef.current.leftApp = false;
    clearShareCelebrationFallback();
    void hapticSuccess();
    showTradeConfetti();
  }, [clearShareCelebrationFallback]);

  const cancelShareCelebration = useCallback(() => {
    shareCelebrationRef.current.pending = false;
    shareCelebrationRef.current.leftApp = false;
    clearShareCelebrationFallback();
  }, [clearShareCelebrationFallback]);

  const beginShareCelebrationWatch = useCallback(() => {
    shareCelebrationRef.current.pending = true;
    shareCelebrationRef.current.leftApp = document.visibilityState === "hidden";
    clearShareCelebrationFallback();
    shareCelebrationRef.current.fallbackTimer = window.setTimeout(() => {
      if (shareCelebrationRef.current.pending && !shareCelebrationRef.current.leftApp) {
        completeShareCelebration();
      }
    }, 2500);
  }, [clearShareCelebrationFallback, completeShareCelebration]);

  useEffect(() => {
    const markLeftApp = () => {
      if (shareCelebrationRef.current.pending) {
        shareCelebrationRef.current.leftApp = true;
      }
    };
    const maybeCelebrateReturn = () => {
      if (shareCelebrationRef.current.pending && shareCelebrationRef.current.leftApp && document.visibilityState !== "hidden") {
        completeShareCelebration();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markLeftApp();
      } else {
        maybeCelebrateReturn();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", markLeftApp);
    window.addEventListener("pageshow", maybeCelebrateReturn);
    window.addEventListener("focus", maybeCelebrateReturn);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", markLeftApp);
      window.removeEventListener("pageshow", maybeCelebrateReturn);
      window.removeEventListener("focus", maybeCelebrateReturn);
      clearShareCelebrationFallback();
    };
  }, [clearShareCelebrationFallback, completeShareCelebration]);

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

  const openTradeShareTestPreview = useCallback(async (details: WarpletDetails, action: TradeShareAction) => {
    const market = marketSnapshot ? getMarketState(marketSnapshot, details.id) : null;
    const owner = market?.owner;
    const fallbackCounterparty: TradeShareCounterparty = {
      wallet: owner?.wallet ?? cellToString(details.row.warplet_wallet),
      fid: owner?.fid ?? cellToNumber(details.row.fid_value),
      farcasterUsername: owner?.username ?? cellToString(details.row.warplet_username_farcaster),
    };
    let ethUsdPrice: number | null = null;
    try {
      ethUsdPrice = await fetchEthUsdPrice();
    } catch (error) {
      console.warn("Failed to load ETH/USD for trade share test preview:", error);
    }

    const preview = await buildTradeSharePreview({
      action,
      details,
      amountEth: 0.1,
      ethUsdPrice,
      counterparty: action === "listing" ? null : fallbackCounterparty,
    });
    setSharePreview(preview);
  }, [marketSnapshot]);

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

        if (normalizedFid) {
          fetch("/api/warplet-status", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ fid: normalizedFid }),
          })
            .then((response) => response.ok ? response.json() : null)
            .then((payload: unknown) => {
              const record = payload && typeof payload === "object" ? payload as { actionSessionToken?: unknown } : null;
              if (typeof record?.actionSessionToken === "string") {
                setActionSessionToken(record.actionSessionToken);
              }
            })
            .catch((error) => console.warn("Search user status upsert failed:", error));
        }

        const location = (context as { location?: Record<string, unknown> }).location;
        if (location?.type === "notification") {
          const notificationId =
            typeof location.notificationId === "string"
              ? location.notificationId
              : typeof location.notification_id === "string"
                ? location.notification_id
                : null;
          if (notificationId) setPendingNotificationId(notificationId);
        }

        const client = (context as { client?: Record<string, unknown> }).client;
        const host = window.location.hostname.toLowerCase();
        const addDebug = new URLSearchParams(window.location.search).get("add") === "1";
        const isPromptHost =
          host === "search.10x.meme" ||
          host === "search-dev.10x.meme" ||
          host === "app.10x.meme";
        const hasAdded = client?.added === true;
        const hasNotifications = Boolean(client?.notificationDetails);
        const shouldPromptAddApp = (isPromptHost || addDebug) && (!hasAdded || !hasNotifications);
        if (shouldPromptAddApp) {
          setNotificationsOnlyPrompt(hasAdded && !hasNotifications);
          setNotificationPromptPending(true);
        }
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

  useEffect(() => {
    if (!pendingNotificationId || !viewerFid || !actionSessionToken || notificationOpenSent) return;
    setNotificationOpenSent(true);
    fetch("/api/notifications/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        notificationId: pendingNotificationId,
        fid: viewerFid,
        appSlug: "search",
        sessionToken: actionSessionToken,
      }),
    }).catch((error) => console.warn("Failed to record notification open:", error));
  }, [actionSessionToken, notificationOpenSent, pendingNotificationId, viewerFid]);

  const handleConfirmAddAppPrompt = useCallback(async () => {
    try {
      void hapticPrimaryTap();
      await sdk.actions.addMiniApp();
    } catch (error) {
      console.warn("Search add mini app prompt failed:", error);
    } finally {
      setShowAddAppPrompt(false);
    }
  }, []);

  const handleCompleteOnboarding = useCallback(() => {
    void hapticSuccess();
    writeOnboardingComplete();
    setOnboardingComplete(true);
    setShowOnboarding(false);
  }, []);

  useEffect(() => {
    const airdropClaimFlowComplete = true;
    if (!notificationPromptPending || !onboardingComplete || showOnboarding || !airdropClaimFlowComplete) return;
    setNotificationPromptPending(false);
    setShowAddAppPrompt(true);
  }, [notificationPromptPending, onboardingComplete, showOnboarding]);

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
    const shouldHapticDatabaseReady = readOnboardingComplete();

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
        if (shouldHapticDatabaseReady) void hapticSuccess();
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
    if (dbReady) {
      setDatabaseLoadingMessage(DATABASE_LOADING_PREFIX);
      return;
    }

    const startedAt = Date.now();
    setDatabaseLoadingMessage(getDatabaseLoadingMessage(0));
    const intervalId = window.setInterval(() => {
      setDatabaseLoadingMessage(getDatabaseLoadingMessage(Date.now() - startedAt));
    }, DATABASE_LOADING_ANIMATION_TICK_MS);

    return () => window.clearInterval(intervalId);
  }, [dbReady]);

  const setFavouriteListForWallet = useCallback((wallet: string, tokenIds: number[]) => {
    const normalizedWallet = normalizeWalletAddress(wallet);
    if (!normalizedWallet) return;
    const normalizedTokenIds = normalizeFavouriteTokenIds(tokenIds);
    writeCachedFavouriteTokenIds(normalizedWallet, normalizedTokenIds);
    favouriteListsByWalletRef.current = {
      ...favouriteListsByWalletRef.current,
      [normalizedWallet]: normalizedTokenIds,
    };
    setFavouriteListsByWallet((current) => ({
      ...current,
      [normalizedWallet]: normalizedTokenIds,
    }));
  }, []);

  const loadFavouriteList = useCallback(async (wallet: string, options: { useCache?: boolean } = {}) => {
    const normalizedWallet = normalizeWalletAddress(wallet);
    if (!normalizedWallet) return [];

    if (options.useCache !== false) {
      const cached = readCachedFavouriteTokenIds(normalizedWallet);
      if (cached.length > 0) {
        setFavouriteListForWallet(normalizedWallet, cached);
      }
    }

    const response = await fetch(`/api/warplet-favourites?wallet=${encodeURIComponent(normalizedWallet)}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Favourite list unavailable (${response.status})`);
    const payload = (await response.json()) as { wallet?: string; tokenIds?: unknown };
    const tokenIds = normalizeFavouriteTokenIds(payload.tokenIds);
    setFavouriteListForWallet(normalizedWallet, tokenIds);
    loadedFavouriteWalletsRef.current.add(normalizedWallet);
    return tokenIds;
  }, [setFavouriteListForWallet]);

  const ensureFavouriteListLoaded = useCallback((wallet: string | null | undefined) => {
    const normalizedWallet = normalizeWalletAddress(wallet);
    if (!normalizedWallet || loadedFavouriteWalletsRef.current.has(normalizedWallet)) return;
    loadedFavouriteWalletsRef.current.add(normalizedWallet);
    loadFavouriteList(normalizedWallet).catch((error) => {
      loadedFavouriteWalletsRef.current.delete(normalizedWallet);
      console.error("Failed to load favourite list:", error);
    });
  }, [loadFavouriteList]);

  const saveFavouriteList = useCallback(async (wallet: string, tokenIds: number[]) => {
    const normalizedWallet = normalizeWalletAddress(wallet);
    if (!normalizedWallet) throw new Error("Connect wallet to use favourites.");
    const normalizedTokenIds = normalizeFavouriteTokenIds(tokenIds);
    const response = await fetch("/api/warplet-favourites", {
      method: "PUT",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ wallet: normalizedWallet, tokenIds: normalizedTokenIds }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `Favourite update failed (${response.status})`);
    }
    const payload = (await response.json()) as { wallet?: string; tokenIds?: unknown };
    const savedTokenIds = normalizeFavouriteTokenIds(payload.tokenIds);
    setFavouriteListForWallet(normalizedWallet, savedTokenIds);
    loadedFavouriteWalletsRef.current.add(normalizedWallet);
    return savedTokenIds;
  }, [setFavouriteListForWallet]);

  const ensureActiveFavouriteWallet = useCallback(async () => {
    if (activeWallet) return activeWallet;
    const provider = (await sdk.wallet.getEthereumProvider()) as EthereumProvider | null;
    if (!provider) throw new Error("Farcaster wallet is not available.");
    const accounts = await getWalletAccounts(provider);
    const wallet = normalizeWalletAddress(accounts[0]);
    if (!wallet) throw new Error("No wallet account is connected.");
    setActiveWallet(wallet);
    void loadFavouriteList(wallet);
    return wallet;
  }, [activeWallet, loadFavouriteList]);

  useEffect(() => {
    let cancelled = false;
    const loadConnectedWallet = async () => {
      try {
        const provider = (await sdk.wallet.getEthereumProvider()) as EthereumProvider | null;
        if (!provider) return;
        const raw = await provider.request({ method: "eth_accounts" }).catch(() => []);
        const accounts = Array.isArray(raw) ? raw : [];
        const wallet = normalizeWalletAddress(accounts.find((account): account is string => typeof account === "string") ?? null);
        if (!cancelled && wallet) {
          setActiveWallet(wallet);
          const cached = readCachedFavouriteTokenIds(wallet);
          if (cached.length > 0) {
            setFavouriteListForWallet(wallet, cached);
          }
          void loadFavouriteList(wallet);
        }
      } catch (error) {
        console.error("Failed to load active wallet:", error);
      }
    };
    void loadConnectedWallet();
    return () => {
      cancelled = true;
    };
  }, [loadFavouriteList, setFavouriteListForWallet]);

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
              ? { warplet: rarestOwnedWarplet, label: "Your Rarest Warplet!" }
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
    const activeFavouriteWallet = normalizeWalletAddress(
      filterOverride && "favouriteWallet" in filterOverride
        ? filterOverride.favouriteWallet ?? null
        : favouriteFilterWallet,
    );
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

    if (!db || (!ftsQuery && !levelFilter && !hasAttributeOnlyFilter && !isWildcardSearch && !ownerWalletFilter && !activeFavouriteWallet)) {
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
      const ownerFilteredRows = filterRowsByOwnerWallet(
        mapRows(rows, Boolean(ftsQuery)),
        marketSnapshot,
        ownerWalletFilter,
      );
      const nextRows = filterRowsByFavourites(
        ownerFilteredRows,
        favouriteListsByWalletRef.current,
        activeFavouriteWallet,
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
  }, [favouriteFilterWallet, marketSnapshot, selectedAttributes, selectedLevels]);

  const applySearchUrlState = useCallback(async (state: SearchUrlState) => {
    if (!dbReady || !dbRef.current) return;

    applyingUrlStateRef.current = true;
    searchRunRef.current += 1;

    const nextState = {
      ...EMPTY_SEARCH_URL_STATE,
      ...state,
    };
    const nextRandom = nextState.random || activeExampleSearch;
    const nextFavouriteWallet = normalizeWalletAddress(nextState.fav);
    if (nextFavouriteWallet) {
      await loadFavouriteList(nextFavouriteWallet);
    }
    const nextSearchText = getEffectiveSearchText({
      ...nextState,
      random: nextRandom,
      fav: nextFavouriteWallet ?? "",
    });
    const hasLevelFilter = nextState.levels.length > 0;
    const hasAttributeFilter = nextState.attributes.length > 0;
    const nextAllWarpletsMode = nextState.search.trim() === "*" || Boolean(nextFavouriteWallet && !nextState.search && !nextState.random && !hasAttributeFilter && !hasLevelFilter);
    const isRandomMode = !nextAllWarpletsMode && !nextState.search && !nextFavouriteWallet && !hasAttributeFilter && !hasLevelFilter && Boolean(nextSearchText);

    setQuery(nextAllWarpletsMode ? "" : nextState.search);
    setIsAllWarpletsMode(nextAllWarpletsMode);
    setActiveExampleSearch(nextRandom);
    setSelectedAttributes(nextState.attributes);
    setSelectedLevels(nextState.levels);
    setFavouriteFilterWallet(nextFavouriteWallet);
    const parsedSearchText = parseOwnerWalletSearch(nextSearchText).searchText;
    const hasFtsQuery = Boolean(parsedSearchText.trim()) && parsedSearchText.trim() !== "*";
    const canUseRequestedRank = nextState.order !== "rank" || nextState.attributes.length === 1;
    const isFavouriteOnly = Boolean(nextFavouriteWallet && nextAllWarpletsMode && !nextState.search && !nextState.random && !hasAttributeFilter && !hasLevelFilter);
    const canUseRequestedFavourite = nextState.order !== "favourited" || isFavouriteOnly;
    const nextOrderBy = nextState.order && canUseRequestedRank && canUseRequestedFavourite
      ? nextState.order
      : getDefaultOrderBy(hasFtsQuery, nextState.attributes, isFavouriteOnly);
    setOrderBy(nextOrderBy);
    setOrderDirection(nextState.dir ?? (nextOrderBy === "favourited" ? "desc" : "asc"));
    setUserSelectedOrder(Boolean(nextState.order && canUseRequestedRank && canUseRequestedFavourite));
    setSelectedWarpletDetailsStack([]);
    setSearchError("");
    setIsSearching(false);

    if (nextSearchText || hasAttributeFilter || hasLevelFilter) {
      await runSearch(
        nextSearchText,
        0,
        { attributes: nextState.attributes, levels: nextState.levels, favouriteWallet: nextFavouriteWallet },
        isRandomMode && matchedWarpletCard ? PAGE_SIZE - 1 : PAGE_SIZE,
      );
    } else {
      setResults([]);
      setTotalResults(0);
      setVisibleCount(PAGE_SIZE);
      setSubmittedQuery("");
    }

    const tradeShareTestAction = parseTradeShareTestAction(new URLSearchParams(window.location.search).get("tradeShare"));
    if (nextState.warplet != null) {
      const details = await loadWarpletDetails(nextState.warplet);
      if (details) {
        setSelectedWarpletDetailsStack([details]);
        if (details.id === 1358 && tradeShareTestAction) {
          void openTradeShareTestPreview(details, tradeShareTestAction);
        }
      }
    }

    applyingUrlStateRef.current = false;
  }, [activeExampleSearch, dbReady, loadFavouriteList, loadWarpletDetails, matchedWarpletCard, openTradeShareTestPreview, runSearch]);

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
      const hasFavouriteFilter = Boolean(favouriteFilterWallet);
      const isExampleSearch = !isAllWarpletsMode && !hasQuery && !hasFavouriteFilter && !hasLevelFilter && selectedAttributes.length === 0;
      const nextQuery = hasQuery
        ? query
        : isAllWarpletsMode || hasFavouriteFilter
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
  }, [activeExampleSearch, dbReady, favouriteFilterWallet, isAllWarpletsMode, matchedWarpletCard, query, runSearch, selectedAttributes.length, selectedLevels.length]);

  useEffect(() => {
    if (!urlHydratedRef.current || applyingUrlStateRef.current) return;
    const parsedSearchText = parseOwnerWalletSearch(query.trim() || submittedQuery.trim()).searchText;
    const hasFtsQuery = !isAllWarpletsMode && Boolean(parsedSearchText.trim()) && parsedSearchText.trim() !== "*";
    const hasFavouriteFilter = Boolean(favouriteFilterWallet);
    const isFavouriteOnly = Boolean(hasFavouriteFilter && isAllWarpletsMode && !query.trim() && selectedAttributes.length === 0 && selectedLevels.length === 0);
    if (!userSelectedOrder || (orderBy === "rank" && selectedAttributes.length !== 1) || (orderBy === "favourited" && !isFavouriteOnly)) {
      const nextOrderBy = getDefaultOrderBy(hasFtsQuery, selectedAttributes, isFavouriteOnly);
      setOrderBy(nextOrderBy);
      setOrderDirection(nextOrderBy === "favourited" ? "desc" : "asc");
      setUserSelectedOrder(false);
    }
  }, [favouriteFilterWallet, isAllWarpletsMode, orderBy, query, selectedAttributes, selectedLevels.length, submittedQuery, userSelectedOrder]);

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
        favouriteFilterWallet,
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
    favouriteFilterWallet,
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
  const hasActiveFavouriteFilter = Boolean(favouriteFilterWallet);
  const hasTypedQuery = query.trim().length > 0;
  const isAllWarpletsSearchMode = isAllWarpletsMode && !hasTypedQuery;
  const isExampleSearchMode = !isAllWarpletsSearchMode && !hasTypedQuery && !hasActiveFavouriteFilter && !hasActiveAttributeFilter && !hasActiveLevelFilter;
  const favouriteOrderTokenIds = getFavouriteTokenIds(favouriteListsByWallet, favouriteFilterWallet);
  const parsedQuerySearchText = parseOwnerWalletSearch(query.trim() || submittedQuery.trim()).searchText;
  const hasFavouriteOnlySearchText = Boolean(parsedQuerySearchText.trim()) && parsedQuerySearchText.trim() !== "*";
  const isFavouriteOnlySearchState = Boolean(
    hasActiveFavouriteFilter &&
    isAllWarpletsSearchMode &&
    !hasFavouriteOnlySearchText &&
    !hasActiveAttributeFilter &&
    !hasActiveLevelFilter,
  );
  const showFavouriteOrderOption = isFavouriteOnlySearchState;
  const activeFavouriteTokenIds = getFavouriteTokenIds(favouriteListsByWallet, activeWallet);
  const activeFavouriteTokenIdSet = useMemo(
    () => new Set(activeFavouriteTokenIds),
    [activeFavouriteTokenIds],
  );
  const favouriteFilterIsActiveWallet = Boolean(
    favouriteFilterWallet &&
    activeWallet &&
    favouriteFilterWallet.toLowerCase() === activeWallet.toLowerCase(),
  );
  const favouriteFilterOwnerLabel = favouriteFilterWallet?.slice(0, 6) ?? "";
  const searchPlaceholder = isAllWarpletsSearchMode
      ? hasActiveFavouriteFilter
        ? favouriteFilterIsActiveWallet || !favouriteFilterOwnerLabel
        ? "My Favourite Warplets..."
        : `${favouriteFilterOwnerLabel} Favourite Warplets...`
      : "All Warplets..."
    : hasTypedQuery || hasActiveAttributeFilter || hasActiveLevelFilter
    ? "Search for Warplets..."
    : `${getRandomExampleDisplayLabel(activeExampleSearch)} Warplets...`;
  const shouldPrependMatchedWarplet = Boolean(
    isExampleSearchMode &&
    matchedWarpletCard &&
    hasMarketOrderValue(matchedWarpletCard.warplet, orderBy, marketSnapshot),
  );
  const rankAttribute = selectedAttributes.length === 1 ? selectedAttributes[0] : undefined;
  const marketFilteredResults = useMemo(
    () => results.filter((warplet) => hasMarketOrderValue(warplet, orderBy, marketSnapshot)),
    [marketSnapshot, orderBy, results],
  );
  const sortedResults = useMemo(
    () => sortWarplets(marketFilteredResults, orderBy, orderDirection, marketSnapshot, rankAttribute, favouriteOrderTokenIds),
    [favouriteOrderTokenIds, marketFilteredResults, marketSnapshot, orderBy, orderDirection, rankAttribute],
  );
  const visibleResults = sortedResults.slice(0, visibleCount);
  const displayedResults = shouldPrependMatchedWarplet && matchedWarpletCard
    ? [matchedWarpletCard.warplet, ...visibleResults]
    : visibleResults;
  const displayedTotalResults = marketFilteredResults.length + (shouldPrependMatchedWarplet ? 1 : 0);
  const canLoadMore = sortedResults.length > visibleCount;
  const hasActiveSearchOrFilter = Boolean(submittedQuery || hasTypedQuery || hasActiveAttributeFilter || hasActiveLevelFilter || hasActiveFavouriteFilter || isAllWarpletsSearchMode);
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
  const favouriteSharePrefix = favouriteFilterIsActiveWallet || !favouriteFilterOwnerLabel
    ? "My Favourite"
    : `${favouriteFilterOwnerLabel} Favourite`;
  const favouriteShareLabel = searchResultsShareLabel === "10X" ? "" : `${searchResultsShareLabel} `;
  const marketOrderShareMeta = getMarketOrderShareMeta(orderBy, orderDirection);
  const baseSearchResultsShareTitle = hasActiveFavouriteFilter
    ? `${favouriteSharePrefix} ${displayedTotalResults.toLocaleString("en-US")} ${isFavouriteOnlySearchState ? "" : favouriteShareLabel}Warplets...`
    : `${displayedTotalResults.toLocaleString("en-US")} ${searchResultsShareLabel} Warplets...`;
  const searchResultsShareTitle = `${baseSearchResultsShareTitle}${marketOrderShareMeta?.suffix ?? ""}`;
  const showResetSearchControl = Boolean(hasTypedQuery || hasActiveAttributeFilter || hasActiveLevelFilter || hasActiveFavouriteFilter || userSelectedOrder);

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
    setFavouriteFilterWallet(null);
    setVisibleCount(matchedWarpletCard ? PAGE_SIZE - 1 : PAGE_SIZE);
    setOrderBy("relevance");
    setOrderDirection("asc");
    setUserSelectedOrder(false);
    setSearchError("");
    if (dbReady) {
      void runSearch(
        nextExample,
        0,
        { attributes: [], levels: [], favouriteWallet: null },
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
    setFavouriteFilterWallet(null);
    setVisibleCount(matchedWarpletCard ? PAGE_SIZE - 1 : PAGE_SIZE);
    setOrderBy("relevance");
    setOrderDirection("asc");
    setUserSelectedOrder(false);
    if (dbReady) {
      void runSearch(
        nextExample,
        0,
        { attributes: [], levels: [], favouriteWallet: null },
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
    setFavouriteFilterWallet(null);
    setQuery(tag);
    void runSearch(tag, 0, { attributes: selectedAttributes, levels: selectedLevels, favouriteWallet: null });
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [runSearch, selectedAttributes, selectedLevels]);

  const handleLevelFilter = useCallback((attribute: LevelAttributeColumn, level: number) => {
    const nextAttributes = [attribute];
    const nextLevels = [level];
    setSelectedWarpletDetailsStack([]);
    setQuery("");
    setIsAllWarpletsMode(false);
    setSelectedAttributes(nextAttributes);
    setSelectedLevels(nextLevels);
    setFavouriteFilterWallet(null);
    void runSearch("", 0, { attributes: nextAttributes, levels: nextLevels, favouriteWallet: null });
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
    setFavouriteFilterWallet(null);
    setVisibleCount(PAGE_SIZE);
    setOrderBy("rarity");
    setOrderDirection("asc");
    setUserSelectedOrder(false);
    setSearchError("");
    if (dbReady) {
      void runSearch(normalizedWallet, 0, { attributes: [], levels: [], favouriteWallet: null }, PAGE_SIZE);
    }
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [dbReady, runSearch]);

  const handleToggleFavourite = useCallback(async (tokenId: number) => {
    void hapticPrimaryTap();
    let wallet: string;
    try {
      wallet = await ensureActiveFavouriteWallet();
    } catch (error) {
      void hapticError();
      showSearchToast("error", error instanceof Error ? error.message : String(error), { manualClose: true });
      return;
    }

    const previousTokenIds = getFavouriteTokenIds(favouriteListsByWallet, wallet);
    const isFavourite = previousTokenIds.includes(tokenId);
    const nextTokenIds = isFavourite
      ? previousTokenIds.filter((id) => id !== tokenId)
      : [...previousTokenIds, tokenId];
    const affectsActiveFavouriteResults = normalizeWalletAddress(favouriteFilterWallet) === wallet;
    const previousResults = affectsActiveFavouriteResults ? results : null;
    const previousTotalResults = totalResults;

    setFavouriteListForWallet(wallet, nextTokenIds);
    if (affectsActiveFavouriteResults && isFavourite) {
      setResults((current) => current.filter((warplet) => warplet.id !== tokenId));
      setTotalResults((current) => Math.max(0, current - 1));
    }
    try {
      await saveFavouriteList(wallet, nextTokenIds);
      void hapticSuccess();
    } catch (error) {
      setFavouriteListForWallet(wallet, previousTokenIds);
      if (previousResults) {
        setResults(previousResults);
        setTotalResults(previousTotalResults);
      }
      void hapticError();
      showSearchToast("error", error instanceof Error ? error.message : String(error), { manualClose: true });
    }
  }, [
    ensureActiveFavouriteWallet,
    favouriteFilterWallet,
    favouriteListsByWallet,
    results,
    saveFavouriteList,
    setFavouriteListForWallet,
    showSearchToast,
    totalResults,
  ]);

  const handleToggleFavouriteFilter = useCallback(async () => {
    void hapticPrimaryTap();
    if (favouriteFilterWallet) {
      setFavouriteFilterWallet(null);
      setVisibleCount(PAGE_SIZE);
      if (orderBy === "favourited") {
        setOrderBy(getDefaultOrderBy(Boolean(parseOwnerWalletSearch(query).searchText), selectedAttributes));
        setOrderDirection("asc");
        setUserSelectedOrder(false);
      }
      return;
    }

    try {
      const wallet = await ensureActiveFavouriteWallet();
      await loadFavouriteList(wallet);
      const isFavouriteOnly = !query.trim() && selectedAttributes.length === 0 && selectedLevels.length === 0;
      if (isFavouriteOnly) {
        setIsAllWarpletsMode(true);
        setOrderBy("favourited");
        setOrderDirection("desc");
        setUserSelectedOrder(false);
      } else if (orderBy === "favourited") {
        setOrderBy(getDefaultOrderBy(Boolean(parseOwnerWalletSearch(query).searchText), selectedAttributes));
        setOrderDirection("asc");
        setUserSelectedOrder(false);
      }
      setFavouriteFilterWallet(wallet);
      setVisibleCount(PAGE_SIZE);
    } catch (error) {
      void hapticError();
      showSearchToast("error", error instanceof Error ? error.message : String(error), { manualClose: true });
    }
  }, [
    ensureActiveFavouriteWallet,
    favouriteFilterWallet,
    loadFavouriteList,
    orderBy,
    query,
    selectedAttributes,
    selectedLevels.length,
    showSearchToast,
  ]);

  const handleSearchOwnerFavourites = useCallback(async (wallet: string) => {
    const normalizedWallet = normalizeWalletAddress(wallet);
    if (!normalizedWallet) return;
    void hapticPrimaryTap();
    try {
      await loadFavouriteList(normalizedWallet);
      setSelectedWarpletDetailsStack([]);
      setQuery("");
      setIsAllWarpletsMode(true);
      setSelectedAttributes([]);
      setSelectedLevels([]);
      setFavouriteFilterWallet(normalizedWallet);
      setVisibleCount(PAGE_SIZE);
      setOrderBy("favourited");
      setOrderDirection("desc");
      setUserSelectedOrder(false);
      setSearchError("");
      if (dbReady) {
        void runSearch("*", 0, { attributes: [], levels: [], favouriteWallet: normalizedWallet }, PAGE_SIZE);
      }
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    } catch (error) {
      void hapticError();
      showSearchToast("error", error instanceof Error ? error.message : String(error), { manualClose: true });
    }
  }, [dbReady, loadFavouriteList, runSearch, showSearchToast]);

  const handleShareWarpletDetails = useCallback((tokenId: number) => {
    const shareState = getSearchUrlStateFromAppState({
      query,
      isAllWarpletsMode,
      selectedAttributes,
      selectedLevels,
      activeExampleSearch,
      favouriteFilterWallet,
      selectedWarpletDetails,
      orderBy,
      orderDirection,
      userSelectedOrder,
    });
    shareState.warplet = tokenId;
    const shareUrl = buildSearchHref(shareState);
    const openSeaUrl = getOpenSeaUrl(tokenId);
    const text = `Check out 10X Warplet #${tokenId}`;
    const links = [shareUrl, openSeaUrl];
    updateSearchUrl(shareState, "replace");

    setSharePreview({
      title: `Share Warplet #${tokenId}`,
      text,
      links,
      images: [
        { src: getWarpletAssetUrl(tokenId, "gif"), alt: `10X Warplet #${tokenId} share image` },
        {
          src: getWarpletAssetUrl(tokenId, "gif"),
          alt: `OpenSea 10X Warplet #${tokenId} share image`,
          sourceUrl: openSeaUrl,
        },
      ],
      farcasterEmbeds: [shareUrl, openSeaUrl],
      twitterText: buildTwitterShareText(text, links),
    });
  }, [
    activeExampleSearch,
    favouriteFilterWallet,
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
      favouriteFilterWallet,
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
    const openSeaCollectionUrl = marketOrderShareMeta?.openSeaUrl ?? OPENSEA_COLLECTION_URL;
    const links = [shareUrl, openSeaCollectionUrl];

    setSharePreview({
      title: "Share Search Results",
      text: searchResultsShareTitle,
      links,
      images: [
        { src: getWarpletAssetUrl(firstWarpletId, "gif"), alt: `10X Warplet #${firstWarpletId} share image` },
        {
          src: "/menu/menu-opensea-10xwarplets.jpg",
          alt: "10X Warplets OpenSea collection share image",
          sourceUrl: openSeaCollectionUrl,
        },
      ],
      farcasterEmbeds: [shareUrl, openSeaCollectionUrl],
      twitterText: buildTwitterShareText(searchResultsShareTitle, links),
    });
  }, [
    activeExampleSearch,
    displayedResults,
    displayedTotalResults,
    favouriteFilterWallet,
    isAllWarpletsMode,
    marketOrderShareMeta,
    query,
    searchResultsShareTitle,
    selectedAttributes,
    selectedLevels,
    shouldPrependMatchedWarplet,
    orderBy,
    orderDirection,
    userSelectedOrder,
  ]);

  const handleSharePreviewFarcaster = useCallback(() => {
    if (!sharePreview) return;
    beginShareCelebrationWatch();
    sdk.actions.composeCast({
      text: sharePreview.farcasterText ?? sharePreview.text,
      embeds: sharePreview.farcasterEmbeds,
    })
      .then(() => {
        completeShareCelebration();
      })
      .catch((error) => {
        cancelShareCelebration();
        console.error("Failed to compose share cast:", error);
      });
  }, [beginShareCelebrationWatch, cancelShareCelebration, completeShareCelebration, sharePreview]);

  const handleSharePreviewTwitter = useCallback(() => {
    if (!sharePreview) return;
    const twitterText = sharePreview.twitterPostText
      ? buildTwitterShareText(sharePreview.twitterPostText, sharePreview.links)
      : sharePreview.twitterText;
    const intentUrl = `https://x.com/intent/post?${new URLSearchParams({
      text: twitterText,
      url: "",
    }).toString()}`;
    beginShareCelebrationWatch();
    sdk.actions.openUrl(intentUrl).catch((error) => {
      cancelShareCelebration();
      console.error("Failed to open X share intent:", error);
    });
  }, [beginShareCelebrationWatch, cancelShareCelebration, sharePreview]);

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
    for (const details of selectedWarpletDetailsStack) {
      const ownerWallet = getMarketState(marketSnapshot, details.id).owner?.wallet;
      ensureFavouriteListLoaded(ownerWallet);
    }
  }, [ensureFavouriteListLoaded, marketSnapshot, selectedWarpletDetailsStack]);

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

  const handleReturnToTop = useCallback(() => {
    void hapticPrimaryTap();
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.documentElement.scrollTo({ top: 0, behavior: "smooth" });
    document.body.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <MiniAppShell>
      {searchToast && (
        <TradeToastView toast={searchToast} exiting={searchToastExiting} onClose={closeSearchToast} />
      )}
      {showOnboarding && (
        <OnboardingCarousel onDone={handleCompleteOnboarding} />
      )}
      {showAddAppPrompt && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/80 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-[#00FF00]/35 bg-black p-4 shadow-2xl">
            <Text className="text-lg font-bold" style={{ color: "#00FF00" }}>
              Welcome to 10X Warplets
            </Text>
            <Text className="mt-3 text-sm leading-relaxed" style={{ color: "#8bbf8b" }}>
              {notificationsOnlyPrompt
                ? "Please turn on notifications so you don’t miss important 10X market updates."
                : "Please add this Mini App and enable notifications so you don’t miss important 10X market updates."}
            </Text>
            <div className="mt-4 flex">
              <button
                type="button"
                onClick={handleConfirmAddAppPrompt}
                className="flex-1 cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-4 py-3 text-sm font-bold text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000]"
              >
                Ok, let's go!
              </button>
            </div>
          </div>
        </div>
      )}
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
                className="min-w-0 flex-1 rounded-xl border border-[#00FF00] bg-black/70 py-3 pl-10 pr-28 text-base text-[#00FF00] outline-none transition-[border-color,box-shadow] placeholder:text-[#8bbf8b] focus:border-[#00FF00] focus:shadow-[0_0_10px_rgba(0,255,0,0.22)] disabled:cursor-wait disabled:opacity-60"
              />
              <div className="absolute bottom-1 right-1 top-1 flex items-center gap-1">
              {showResetSearchControl ? (
                <button
                  type="button"
                  onClick={handleResetSearch}
                  className="flex h-full cursor-pointer items-center px-2 text-xs font-bold text-[#00FF00] hover:text-[#8bbf8b]"
                >
                  Reset
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRandomExampleSearch}
                  disabled={!dbReady}
                  className="flex h-full cursor-pointer items-center px-2 text-xs font-bold text-[#00FF00] hover:text-[#8bbf8b] disabled:cursor-wait disabled:opacity-60"
                >
                  Random
                </button>
              )}
                <FavouriteButton
                  active={hasActiveFavouriteFilter}
                  title={hasActiveFavouriteFilter ? "Remove favourite filter" : "Filter by my favourites"}
                  className="-ml-0.5 mr-1.5 h-full w-9"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void handleToggleFavouriteFilter();
                  }}
                />
              </div>
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
                {databaseLoadingMessage}
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
                    showFavouriteOrder={showFavouriteOrderOption}
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
                      isFavourited={activeFavouriteTokenIdSet.has(warplet.id)}
                      onToggleFavourite={handleToggleFavourite}
                      labelOverride={shouldPrependMatchedWarplet && index === 0 ? matchedWarpletCard?.label : undefined}
                    />
                  ))}
                </div>

                <div ref={loadMoreRef} className="h-8" />
                {!canLoadMore && displayedTotalResults > 0 && (
                  <Text className="mt-2 text-center text-xs font-bold leading-5" style={{ color: "#8bbf8b" }}>
                    No more warplets.{" "}
                    <button
                      type="button"
                      onClick={handleReturnToTop}
                      className="cursor-pointer font-bold text-[#00FF00] underline decoration-[#00FF00] underline-offset-2 hover:text-[#8bbf8b] hover:decoration-[#8bbf8b]"
                    >
                      Return to top
                    </button>
                    .
                  </Text>
                )}
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
        const ownerWallet = normalizeWalletAddress(market.owner?.wallet);
        const ownerFavouriteCount = getFavouriteTokenIds(favouriteListsByWallet, ownerWallet).length;
        return (
          <WarpletDetailsModal
            key={`${details.id}-${index}`}
            details={details}
            onClose={handleCloseTopWarpletDetails}
            onShare={() => handleShareWarpletDetails(details.id)}
            isFavourited={activeFavouriteTokenIdSet.has(details.id)}
            onToggleFavourite={handleToggleFavourite}
            onSearchTag={handleSearchTag}
            onLevelFilter={handleLevelFilter}
            onOpenRelatedWarplet={handleOpenRelatedWarpletDetails}
            onSearchOwnerWallet={handleSearchOwnerWallet}
            onSearchOwnerFavourites={handleSearchOwnerFavourites}
            market={market}
            ownedTokenIds={getOwnedTokenIds(marketSnapshot, market.owner?.wallet, details.id)}
            ownerFavouriteCount={ownerFavouriteCount}
            isRefreshingMarket={marketRefreshTokenId === details.id}
            marketRefreshError={index === selectedWarpletDetailsStack.length - 1 ? marketRefreshError : ""}
            onRefreshMarket={handleRefreshSelectedMarket}
            viewerFid={viewerFid}
            onMergeMarketSnapshot={handleMergeMarketSnapshot}
            onClearMarketSide={handleClearMarketSide}
            onUpsertItemOffer={handleUpsertItemOffer}
            onApplyPurchase={handleApplyPurchase}
            onOpenTradeSharePreview={setSharePreview}
            stackIndex={index}
          />
        );
      })}
      {sharePreview && (
        <SharePreviewModal
          preview={sharePreview}
          onClose={() => setSharePreview(null)}
          onCopySuccess={() => showSearchToast("neutral", "Post has been copied to your clipboard.")}
          onShareFarcaster={handleSharePreviewFarcaster}
          onShareTwitter={handleSharePreviewTwitter}
        />
      )}
    </MiniAppShell>
  );
}
