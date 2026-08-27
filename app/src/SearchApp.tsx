import { CSSProperties, Component, Fragment, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode, Suspense, cloneElement, isValidElement, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { OverlayScrollbarsComponent, useOverlayScrollbars } from "overlayscrollbars-react";
import sdk from "@farcaster/miniapp-sdk";
import { Text } from "@neynar/ui/typography";
import {
  MiniAppHeader,
  MiniAppMenuPage,
  getHeaderTitle,
  useMiniAppChrome,
} from "./miniAppChrome.tsx";
import MiniAppShell from "./MiniAppShell";
import SiteFooter from "./SiteFooter";
import { detectMiniAppContext } from "./miniAppContext";
import { PERKS_DEFINITIONS, PERKS_MOCKUP_NOTICE_DISMISSED_KEY, type PerksSubpage } from "./perksMockData";
import { PERKS_SHARE_CONTENT, getPerksShareImageUrl } from "./perksShareContent";
import type { StatsShareCreateResponse, StatsShareRequest } from "./statsShare";
import { WebConnectModal } from "./WebConnectModal";
import type { FarcasterWebIdentity } from "./FarcasterSignInControl";
import { hasPendingFarcasterSignIn, restorePendingFarcasterSignIn } from "./farcasterSignInPersistence";
import {
  configureFarcasterWallet,
  connectFarcasterWallet,
  disconnectWallet,
  getConnectedProviderAndAccount,
  requestBaseAppWalletLogin,
  requestWebWalletConnection,
  restoreFarcasterWallet,
  restoreWebWallet,
  useWalletController,
} from "./walletController";
import { authenticateWallet, linkCurrentWalletAndIdentity, loadAppSession, verifyFarcasterQuickAuth, logoutAppPrincipal } from "./appSession";
import { resolveAppSurface } from "./appRuntime";
import { trackAppEvent } from "./analytics";
import { PwaControls } from "./PwaControls";
import { LocalOfferDiagnosticsPanel } from "./LocalOfferDiagnosticsPanel";
import { recordLocalOfferDiagnostic } from "./localOfferDiagnostics";
import { submitTraitOfferWithRetry } from "./traitOfferSubmit";
import { getMobileWalletHandoff, openMobileWalletHandoff, waitForForeground } from "./mobileWalletHandoff";
import { getExternalWalletReviewName } from "./walletReviewPrompt";
import { resolveEntryPoint, isBaseAppContext, isEmbeddedWebView, isLikelyBaseAppBrowser, isStandaloneDisplay, subscribeToWebPush } from "./pwa";
import { findRarestOwnedWarpletTokenId, resolveEffectiveWarpletOwner } from "./ownerResolution";
import { canPresentAirdrop, shouldCoverAppWhileResolvingOnboarding, shouldOpenOnboarding } from "./searchModalSequence";
import { SERVER_CACHE_RESET_PENDING_KEY } from "./localCacheReset";
import { writeSpaHistory } from "./spaHistory";
import ProgressiveNotificationImage from "./ProgressiveNotificationImage";
import {
  FARCASTER_NOTIFICATIONS_MANUAL_ENABLE_MESSAGE,
  composeFarcasterPost,
  configureAppSurface,
  getEmbeddedWalletProvider,
  openAppUrl,
  requestFarcasterNotifications,
  signalAppReady,
  viewFarcasterProfile,
} from "./surfaceAdapter";
import { buildSharePostText, buildTwitterShareText } from "./shareCopy";
import { getStatsFriendFilterWallet } from "./statsHolderFilter";

const FarcasterSignInControl = lazy(() => import("./FarcasterSignInControl"));
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
  combinePreparedOpenSeaTransactions,
  sendPreparedTransactionsAtomic,
  supportsAtomicBatchTransactions,
  buildSeaportCancelTransaction,
  getWalletErrorCode,
  getWalletErrorMessage,
  isOpaqueWalletConnectNullError,
  isUserRejected,
  readErc20Balance,
  readNativeBalance,
  sendPreparedTransaction,
  signTypedData,
  subscribeToWalletReviewRequests,
  waitForTransactionReceipt,
  wrapEthToWeth,
  type EthereumProvider,
  type NftApprovalRequirement,
  type PreparedTransaction,
  type SeaportCancelOrderParameters,
  type TokenApprovalRequirement,
} from "./walletTrade";
import {
  WARPLETS_APP_ORIGINS,
  WARPLETS_APP_PATH,
  WARPLETS_APP_SLUG,
} from "../shared/warpletsApp";

const DB_URL = "/db/warplets.v1.fts.sqlite.br";
const PAGE_SIZE = 20;
const SEARCH_RESULT_PAGE_SIZE = 100;
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
const ONBOARDING_DECISION_TIMEOUT_MS = 2500;
const ONBOARDING_COMPLETE_KEY = "warplets-search-onboarding-v1-complete";
const AIRDROP_CONGRATULATIONS_COMPLETE_KEY = "warplets-search-airdrop-v1-complete";
const RANDOM_EXAMPLE_SEARCHES_SEEN_KEY = "warplets-search-random-seen-v1";
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_RESULT_IMAGE_PRELOAD_TIMEOUT_MS = 250;
const STATUS_LINE_CLASS = "text-center text-xs uppercase leading-4";
const OPENSEA_COLLECTION_URL = "https://opensea.io/collection/10xwarplets";
const LAST_SEARCH_OFFERS_SUBPAGE_KEY = "warplets-search-last-offers-subpage-v1";
const LAST_SEARCH_STATS_SUBPAGE_KEY = "warplets-search-last-stats-subpage-v1";
const LAST_STATS_ACTIVITY_EVENT_KEY = "warplets-stats-activity-event-v1";
const LAST_ITEM_ACTIVITY_EVENT_KEY = "warplets-item-activity-event-v1";
const LAST_SEARCH_PERKS_SUBPAGE_KEY = "warplets-search-last-perks-subpage-v1";
const LAST_SEARCH_LISTED_LEVEL_KEY = "warplets-search-last-listed-level-v1";
const LISTED_SCOPE_KEY = "warplets-search-listed-scope-v1";
const MARKET_CACHE_KEY = "warplets-market-state-v4";
const MARKET_SNAPSHOT_STALE_MS = 10 * 60 * 1000;
const MARKET_DETAIL_STALE_MS = 30 * 60 * 1000;
const MARKET_CACHE_MAX_STALE_MS = 60 * 60 * 1000;
const BASE_WETH_TOKEN_ADDRESS = "0x4200000000000000000000000000000000000006";
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";
const WARPLETS_COLLECTION_CONTRACT = "0x780446dd12e080ae0db762fcd4daf313f3e359de";
const ERC721_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MIN_LISTING_ETH = 0.00000000000001;
const MAX_SWEEP_ITEMS = 50;
const TRADE_PRICE_DECIMAL_PLACES = 4;
const FORCED_AIRDROP_FALLBACK_TOKEN_ID = 5019;
const HEADER_FALLBACK_AVATAR_TOKEN_ID = 548;

type SearchCompletion = "onboarding" | "airdrop_modal";

type SearchOffersSubpage = "collection" | "trait" | "item";
type SearchStatsSubpage = "overview" | "market" | "social" | "holders";
type StatsRange = "7d" | "30d" | "90d" | "1y" | "all";
type StatsActivityEvent = "sale" | "listing" | "offer" | "send";
type StatsRouteDetail = "collection" | "launch" | "price" | "floor-price" | "volume" | "listings" | "offers" | "sales" | "sends" | "top10" | "top10friends";
const ACTIVITY_CHART_HEIGHT = 351;
type ListedLevelFilter = "all" | "10x" | "9x" | "8x" | "7x" | "6x" | "5x" | "4x" | "3x" | "2x" | "1x";
type ListedScopeFilter = "all" | "your" | "favourites" | "sweep";
type SearchRoute =
  | { page: "search" }
  | { page: "app-testing" }
  | { page: "warpmoji" }
  | { page: "listed"; listedLevel: ListedLevelFilter }
  | { page: "offers"; offersPage: SearchOffersSubpage }
  | { page: "perks"; perksPage: PerksSubpage }
  | { page: "stats"; statsPage: SearchStatsSubpage; statsRange?: StatsRange; statsDetail?: StatsRouteDetail };

const LISTED_LEVEL_TABS: Array<{ id: ListedLevelFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "10x", label: "10X" },
  { id: "9x", label: "9X" },
  { id: "8x", label: "8X" },
  { id: "7x", label: "7X" },
  { id: "6x", label: "6X" },
  { id: "5x", label: "5X" },
  { id: "4x", label: "4X" },
  { id: "3x", label: "3X" },
  { id: "2x", label: "2X" },
  { id: "1x", label: "1X" },
];

const LISTED_SCOPE_TABS = [
  { id: "all", label: "All" },
  { id: "your", label: "Your Listings" },
  { id: "favourites", label: "Favourites" },
  { id: "sweep", label: "Sweep" },
];

const OFFERS_FILTER_TABS = [
  { id: "all", label: "All Offers" },
  { id: "your", label: "Your Offers" },
];

const ITEM_OFFERS_FILTER_TABS = [
  ...OFFERS_FILTER_TABS,
  { id: "for_you", label: "For You" },
  { id: "favourites", label: "Favourites" },
];

const STATS_SUBPAGE_TABS: Array<{ id: SearchStatsSubpage; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "market", label: "Market" },
  { id: "social", label: "Activity" },
  { id: "holders", label: "Holders" },
];

const PERKS_SUBPAGE_TABS: Array<{ id: PerksSubpage; label: string }> = [
  { id: "memes", label: "Memes" },
  { id: "rwas", label: "RWAs" },
  { id: "nfts", label: "NFTs" },
  { id: "ai", label: "AI" },
  { id: "attention", label: "Attention" },
  { id: "alpha", label: "Alpha" },
];

const LazyPerksPage = lazy(() => import("./PerksPage"));
const LazyWarpmojiPage = lazy(() => import("./WarpmojiPage"));

const STATS_RANGE_TABS: Array<{ id: StatsRange; label: string }> = [
  { id: "all", label: "All" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "90d", label: "90D" },
  { id: "1y", label: "1Y" },
];

type SearchStatusPayload = {
  actionSessionToken?: unknown;
  searchOnboardingCompletedAt?: unknown;
  searchAirdropModalCompletedAt?: unknown;
  searchCompletionsReset?: unknown;
};

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

function isAirdropForced(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("airdrop") === "1";
}

function readOnboardingComplete(): boolean {
  if (typeof window === "undefined") return false;
  if (isOnboardingForced()) return false;
  if (isAirdropForced()) return true;
  return window.localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "1";
}

function writeOnboardingComplete(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ONBOARDING_COMPLETE_KEY, "1");
}

function readAirdropCongratulationsComplete(): boolean {
  if (typeof window === "undefined") return false;
  if (isAirdropForced()) return false;
  return window.localStorage.getItem(AIRDROP_CONGRATULATIONS_COMPLETE_KEY) === "1";
}

function writeAirdropCongratulationsComplete(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AIRDROP_CONGRATULATIONS_COMPLETE_KEY, "1");
}

function isCompletedAt(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
const RANDOM_EXAMPLE_SEARCH_POOL = Array.from(new Set<string>(EXAMPLE_SEARCHES));
const RANDOM_EXAMPLE_SEARCH_POOL_SET = new Set<string>(RANDOM_EXAMPLE_SEARCH_POOL);

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

type TraitCriterion = {
  traitType: string;
  traitValue: string;
};

type MarketSnapshot = {
  version: "opensea-market-v1" | "opensea-market-v2";
  generatedAt: string;
  maxAgeSeconds: number;
  collection?: {
    floor: MarketMoney | null;
    topOffer: MarketOrderMoney & { offerer?: string | null; source: "collection" } | null;
  };
  listings: Record<string, MarketOrderMoney & { seller?: string | null }>;
  offers: Record<string, MarketOrderMoney & { offerer?: string | null; source?: "item" }>;
  traitOffers?: Record<string, MarketOrderMoney & { offerer?: string | null; source: "trait"; traits: TraitCriterion[] }>;
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
  traitOffer?: NonNullable<MarketSnapshot["traitOffers"]>[string];
  collectionOffer?: NonNullable<MarketSnapshot["collection"]>["topOffer"] | null;
  offer?: (MarketOrderMoney & { offerer?: string | null; source?: "item" | "trait" | "collection"; traits?: TraitCriterion[] }) | null;
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
  traitOffer: (MarketOrderMoney & { offerer?: string | null; source: "trait"; traits: TraitCriterion[]; protocolData?: unknown }) | null;
  collectionOffer: (MarketOrderMoney & { offerer?: string | null; source: "collection"; protocolData?: unknown }) | null;
  topOffer: (MarketOrderMoney & { offerer?: string | null; source: "item" | "trait" | "collection"; traits?: TraitCriterion[]; protocolData?: unknown }) | null;
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

type PendingConfirmedPurchase = {
  owner: MarketSnapshot["owners"][string];
  sale: MarketSnapshot["sales"][string];
  expiresAt: number;
};

type ViewerProfile = {
  fid: number | null;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
};

type CollectionOfferBidder = {
  wallet: string;
  fid: number | null;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  xUsername: string | null;
  openseaUrl: string;
  farcasterUrl: string | null;
  xUrl: string | null;
  basescanUrl: string;
};

type CollectionOfferGroupOrder = {
  orderHash: string;
  protocolAddress: string | null;
  quantity: number;
  createdAt: string | null;
  bidder: CollectionOfferBidder;
};

type CollectionOfferGroup = {
  price: MarketMoney;
  volume: MarketMoney;
  offerCount: number;
  bidderCount: number;
  previewBidders: CollectionOfferBidder[];
  orders: CollectionOfferGroupOrder[];
  userOfferCount: number;
  userOrders: Array<{
    orderHash: string;
    protocolAddress: string | null;
    quantity: number;
  }>;
};

type CollectionOffersPayload = {
  generatedAt: string;
  refreshError?: string | null;
  wallet: string | null;
  topCollectionOffer: MarketMoney | null;
  stats: {
    count: number;
    value: MarketMoney;
  };
  groups: CollectionOfferGroup[];
};

type TraitOffersPayload = Omit<CollectionOffersPayload, "topCollectionOffer" | "groups"> & {
  level: string;
  attributes: string[];
  topTraitOffer: MarketMoney | null;
  groups: Array<CollectionOfferGroup & { traitType: string; traitValue: string }>;
};

type ItemOfferRow = {
  orderHash: string;
  tokenId: number;
  protocolAddress: string | null;
  price: MarketMoney;
  bidder: CollectionOfferBidder | null;
  isUserOffer: boolean;
};

type ItemOffersPayload = {
  generatedAt: string;
  refreshError?: string | null;
  wallet: string | null;
  tokenId: number | null;
  topItemOffer: MarketMoney | null;
  stats: { count: number; value: MarketMoney };
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    totalRows: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
  rows: ItemOfferRow[];
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
  levelValues: Partial<Record<LevelAttributeColumn, number | null>>;
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

type SqliteInitModule = typeof import("@sqlite.org/sqlite-wasm")["default"];
type SqliteDatabase = InstanceType<Awaited<ReturnType<SqliteInitModule>>["oo1"]["DB"]>;

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
  aspectRatio?: "square" | "landscape";
  waitForResolvedSource?: boolean;
  sourceResolved?: boolean;
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
  status?: "preparing" | "ready" | "error";
  statusMessage?: string;
};

function getInitialSharePreviewImages(images: SharePreviewImage[]): SharePreviewImage[] {
  return images.map((image) => ({ ...image, isLoading: true }));
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

function convertImageBlobToPng(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    const release = () => URL.revokeObjectURL(objectUrl);

    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context || canvas.width < 1 || canvas.height < 1) {
        release();
        reject(new Error("The share image could not be prepared for the clipboard."));
        return;
      }

      context.drawImage(image, 0, 0);
      canvas.toBlob((pngBlob) => {
        release();
        if (pngBlob) resolve(pngBlob);
        else reject(new Error("The share image could not be converted to PNG."));
      }, "image/png");
    };
    image.onerror = () => {
      release();
      reject(new Error("The share image could not be decoded."));
    };
    image.src = objectUrl;
  });
}

function resolveShareUrl(src: string): URL {
  const imageUrl = new URL(src, window.location.href);
  if (window.location.protocol === "https:" && imageUrl.protocol === "http:" && imageUrl.hostname === window.location.hostname) {
    imageUrl.protocol = "https:";
  }
  return imageUrl;
}

async function loadShareImageBlob(src: string): Promise<Blob> {
  const imageUrl = resolveShareUrl(src);
  const clipboardUrl = imageUrl.origin === window.location.origin
    ? imageUrl.href
    : `/api/share-image?url=${encodeURIComponent(imageUrl.href)}`;
  const response = await fetch(clipboardUrl);
  if (!response.ok) throw new Error(`The share image could not be loaded (${response.status}).`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("The share image response was not an image.");
  return blob;
}

async function copyImageToClipboard(src: string): Promise<string> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Copying images is not supported by this browser.");
  }

  const fetchedBlob = loadShareImageBlob(src);
  const pngBlob = fetchedBlob.then((blob) => blob.type === "image/png" ? blob : convertImageBlobToPng(blob));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
  return (await fetchedBlob).type;
}

async function openShareImageExternally(src: string): Promise<void> {
  await openAppUrl(resolveShareUrl(src).href);
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
const ATTRIBUTE_LEVEL_SELECT = LEVEL_ATTRIBUTES.map((attribute) => `w."${attribute.column}"`).join(",\n             ");
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
             ${ATTRIBUTE_RANK_SELECT},
             ${ATTRIBUTE_LEVEL_SELECT}`;

function readSeenRandomExampleSearches(): Set<string> {
  if (typeof window === "undefined") return new Set();

  try {
    const parsed = JSON.parse(window.localStorage.getItem(RANDOM_EXAMPLE_SEARCHES_SEEN_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((value): value is string =>
        typeof value === "string" && RANDOM_EXAMPLE_SEARCH_POOL_SET.has(value),
      ),
    );
  } catch {
    return new Set();
  }
}

function writeSeenRandomExampleSearches(seenSearches: Set<string>): void {
  if (typeof window === "undefined") return;
  if (seenSearches.size === 0 || seenSearches.size >= RANDOM_EXAMPLE_SEARCH_POOL.length) {
    window.localStorage.removeItem(RANDOM_EXAMPLE_SEARCHES_SEEN_KEY);
    return;
  }
  window.localStorage.setItem(
    RANDOM_EXAMPLE_SEARCHES_SEEN_KEY,
    JSON.stringify(RANDOM_EXAMPLE_SEARCH_POOL.filter((search) => seenSearches.has(search))),
  );
}

function recordSeenRandomExampleSearch(value: string): void {
  if (!RANDOM_EXAMPLE_SEARCH_POOL_SET.has(value)) return;
  const seenSearches = readSeenRandomExampleSearches();
  seenSearches.add(value);
  writeSeenRandomExampleSearches(seenSearches);
}

function getRandomExampleSearch(current?: string): string {
  const seenSearches = readSeenRandomExampleSearches();
  let candidates = RANDOM_EXAMPLE_SEARCH_POOL.filter((search) => search !== current && !seenSearches.has(search));
  if (candidates.length === 0) {
    writeSeenRandomExampleSearches(new Set());
    candidates = RANDOM_EXAMPLE_SEARCH_POOL.filter((search) => search !== current);
  }
  if (candidates.length === 0) return current || RANDOM_EXAMPLE_SEARCH_POOL[0] || "";
  return candidates[Math.floor(Math.random() * candidates.length)] ?? candidates[0] ?? "";
}

function getFreshRandomExampleSearch(current?: string): string {
  const next = getRandomExampleSearch(current);
  recordSeenRandomExampleSearch(next);
  return next;
}

function getRandomExampleDisplayLabel(value: string): string {
  const trimmed = value.trim();
  return trimmed.replace(/\s+Warplets?$/i, "").trim() || trimmed;
}

function normalizeFtsQuery(value: string): string {
  const trimmed = value.trim();
  const quotedPhrase = trimmed.match(/^(?:"([\s\S]*)"|“([\s\S]*)”|„([\s\S]*)“)$/u);
  const phrase = quotedPhrase?.slice(1).find((value): value is string => typeof value === "string");
  if (phrase != null) {
    const terms = phrase
      .trim()
      .replace(/["'“”„‘’]/gu, "")
      .split(/\s+/)
      .filter(Boolean);
    return terms.length > 0 ? `"${terms.join(" ")}"*` : "";
  }

  return value
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/["'“”„‘’]/gu, "").replace(/\+/g, " "))
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
    const levelOffset = rankOffset + LEVEL_ATTRIBUTES.length;
    const scoreOffset = levelOffset + LEVEL_ATTRIBUTES.length;
    const rankValues = LEVEL_ATTRIBUTES.reduce<Partial<Record<LevelAttributeColumn, number | null>>>(
      (current, attribute, attributeIndex) => {
        current[attribute.column] = cellToNumber(row[rankOffset + attributeIndex]);
        return current;
      },
      {},
    );
    const levelValues = LEVEL_ATTRIBUTES.reduce<Partial<Record<LevelAttributeColumn, number | null>>>(
      (current, attribute, attributeIndex) => {
        current[attribute.column] = cellToNumber(row[levelOffset + attributeIndex]);
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
      levelValues,
      rankValues,
      searchScore: hasSearchScore ? cellToNumber(row[scoreOffset]) : null,
      searchIndex: index,
    };
  });
}

function searchWarpletPickerPage(
  db: SqliteDatabase,
  query: string,
  favouriteTokenIds: number[] | null,
  requestedRows: number,
  allowedTokenIds: number[] | null = null,
): { rows: WarpletResult[]; total: number } {
  const trimmed = query.trim();
  const exactMatch = trimmed.match(/^#([1-9]\d{0,4})$/);
  const exactTokenId = exactMatch && Number(exactMatch[1]) <= 10000 ? Number(exactMatch[1]) : null;
  const ftsQuery = exactTokenId == null && trimmed && trimmed !== "*" ? normalizeFtsQuery(trimmed) : "";
  const conditions: string[] = [];
  const bind: Array<string | number> = [];
  if (exactTokenId != null) {
    conditions.push("w.id = ?");
    bind.push(exactTokenId);
  } else if (ftsQuery) {
    conditions.push("warplets_fts MATCH ?");
    bind.push(ftsQuery);
  }
  if (favouriteTokenIds) {
    if (favouriteTokenIds.length === 0) return { rows: [], total: 0 };
    conditions.push("w.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))");
    bind.push(JSON.stringify(favouriteTokenIds));
  }
  if (allowedTokenIds) {
    if (allowedTokenIds.length === 0) return { rows: [], total: 0 };
    conditions.push("w.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))");
    bind.push(JSON.stringify(allowedTokenIds));
  }
  const fromSql = ftsQuery
    ? "FROM warplets_fts JOIN warplets w ON w.id = warplets_fts.rowid"
    : "FROM warplets w";
  const whereSql = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const totalRows = db.exec(`SELECT COUNT(*) ${fromSql}${whereSql}`, {
    bind,
    rowMode: "array",
    returnValue: "resultRows",
  });
  const total = Number(totalRows[0]?.[0] ?? 0);
  const rows: unknown[][] = [];
  const target = Math.min(total, Math.max(PAGE_SIZE, requestedRows));
  for (let offset = 0; offset < target; offset += SEARCH_RESULT_PAGE_SIZE) {
    const limit = Math.min(SEARCH_RESULT_PAGE_SIZE, target - offset);
    rows.push(...db.exec(
      `SELECT ${RESULT_SELECT_COLUMNS}${ftsQuery ? ", bm25(warplets_fts) AS score" : ""}
       ${fromSql}${whereSql}
       ORDER BY ${ftsQuery ? `score, w."10x_rank" ASC, ` : `w."10x_rank" ASC, `}w.id ASC
       LIMIT ? OFFSET ?`,
      { bind: [...bind, limit, offset], rowMode: "array", returnValue: "resultRows" },
    ));
  }
  return { rows: mapRows(rows, Boolean(ftsQuery)), total };
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

function loadWarpletResultsByIds(db: SqliteDatabase, tokenIds: number[]): WarpletResult[] {
  const uniqueTokenIds = Array.from(new Set(
    tokenIds.filter((tokenId) => Number.isInteger(tokenId) && tokenId > 0),
  ));
  if (uniqueTokenIds.length === 0) return [];
  const placeholders = uniqueTokenIds.map(() => "?").join(", ");
  const rows = db.exec(
    `SELECT
       ${RESULT_SELECT_COLUMNS}
     FROM warplets w
     WHERE w.id IN (${placeholders})`,
    {
      bind: uniqueTokenIds,
      rowMode: "array",
      returnValue: "resultRows",
    },
  );
  const order = new Map(uniqueTokenIds.map((tokenId, index) => [tokenId, index]));
  return mapRows(rows).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

function findTraitOfferRepresentativeTokenId(
  db: SqliteDatabase | null,
  attributes: LevelAttributeColumn[],
  level: number,
): number {
  if (!db || attributes.length === 0) return 760;
  const where = attributes.map((column) => `w."${column}" = ?`).join(" AND ");
  const rows = db.exec(
    `SELECT w.id FROM warplets w WHERE ${where} ORDER BY w."10x_rank" ASC, w.id ASC LIMIT 1`,
    { bind: attributes.map(() => level), rowMode: "array", returnValue: "resultRows" },
  );
  const tokenId = Number(rows[0]?.[0]);
  return Number.isInteger(tokenId) && tokenId > 0 ? tokenId : 760;
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

function getForcedAirdropTokenId(): number {
  if (typeof window === "undefined") return FORCED_AIRDROP_FALLBACK_TOKEN_ID;
  const searchParams = new URLSearchParams(window.location.search);
  return (
    parseWarpletParam(searchParams.get("airdropToken")) ??
    parseWarpletParam(searchParams.get("warplet") ?? searchParams.get("tokenId")) ??
    FORCED_AIRDROP_FALLBACK_TOKEN_ID
  );
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
  const forceAddPrompt = url.searchParams.get("add") === "1";
  url.pathname = getSearchPathForRoute({ page: "search" });
  const serialized = serializeSearchUrlState(state);
  url.search = serialized ? `?${serialized}` : "";
  if (forceAddPrompt) url.searchParams.set("add", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

function buildSearchHref(state: SearchUrlState): string {
  return new URL(buildSearchUrl(state), window.location.origin).href;
}

function buildListedWarpletHref(route: Extract<SearchRoute, { page: "listed" }>, tokenId: number): string {
  const url = new URL(window.location.href);
  url.pathname = getSearchPathForRoute(route);
  url.search = "";
  url.searchParams.set("warplet", String(tokenId));
  return url.href;
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
  traitOffer: NonNullable<MarketSnapshot["traitOffers"]>[string] | undefined,
  collectionOffer: NonNullable<MarketSnapshot["collection"]>["topOffer"] | null | undefined,
): TokenMarketState["offer"] {
  let current: TokenMarketState["offer"] = null;
  for (const offer of [itemOffer, traitOffer, collectionOffer]) {
    if (!offer) continue;
    if (!current) {
      current = offer;
      continue;
    }
    if (compareOfferPriority(offer, current) < 0) {
      current = offer;
    }
  }
  return current;
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
  const traitOffer = snapshot?.traitOffers?.[key];
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
    traitOffer,
    collectionOffer,
    offer: chooseTopOffer(itemOffer, traitOffer, collectionOffer),
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

function getListedLevelNumber(level: ListedLevelFilter): number | null {
  if (level === "all") return null;
  const value = Number(level.replace(/x$/i, ""));
  return LEVEL_OPTIONS.includes(value) ? value : null;
}

function warpletMatchesListedLevel(warplet: WarpletResult, level: ListedLevelFilter): boolean {
  const levelNumber = getListedLevelNumber(level);
  if (levelNumber == null) return true;
  return LEVEL_ATTRIBUTES.some((attribute) => warplet.levelValues[attribute.column] === levelNumber);
}

function walletMatches(value: string | null | undefined, wallet: string | null | undefined): boolean {
  const left = normalizeWalletAddress(value);
  const right = normalizeWalletAddress(wallet);
  return Boolean(left && right && left === right);
}

function getListingGroupKey(listing: MarketOrderMoney): string {
  if (listing.rawAmount && listing.decimals != null) {
    return `${listing.tokenAddress?.toLowerCase() ?? listing.currencySymbol ?? "eth"}:${listing.decimals}:${listing.rawAmount}`;
  }
  return `eth:${listing.eth ?? 0}`;
}

function getPurchasedWarpletTransferIds(
  receipt: Record<string, unknown>,
  recipient: string,
): Set<number> {
  const recipientTopic = `0x${recipient.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  const transferredTokenIds = new Set<number>();
  for (const rawLog of Array.isArray(receipt.logs) ? receipt.logs : []) {
    if (!rawLog || typeof rawLog !== "object") continue;
    const log = rawLog as Record<string, unknown>;
    if (typeof log.address !== "string" || log.address.toLowerCase() !== WARPLETS_COLLECTION_CONTRACT) continue;
    const topics = Array.isArray(log.topics) ? log.topics : [];
    if (
      typeof topics[0] !== "string" || topics[0].toLowerCase() !== ERC721_TRANSFER_TOPIC ||
      typeof topics[2] !== "string" || topics[2].toLowerCase() !== recipientTopic ||
      typeof topics[3] !== "string"
    ) continue;
    const tokenId = Number(BigInt(topics[3]));
    if (Number.isSafeInteger(tokenId)) transferredTokenIds.add(tokenId);
  }
  return transferredTokenIds;
}

function compareMarketPriceAsc(left: MarketMoney | null | undefined, right: MarketMoney | null | undefined): number {
  const leftValue = getMarketNumber(left);
  const rightValue = getMarketNumber(right);
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  return leftValue - rightValue;
}

function sumMarketMoney(values: Array<MarketMoney | null | undefined>): MarketMoney | null {
  const present = values.filter((value): value is MarketMoney => Boolean(value));
  if (present.length === 0) return null;
  const first = present[0];
  const allRawCompatible = Boolean(first.rawAmount && first.decimals != null) &&
    present.every((value) =>
      value.rawAmount &&
      value.decimals === first.decimals &&
      (value.currencySymbol ?? null) === (first.currencySymbol ?? null) &&
      (value.tokenAddress ?? null) === (first.tokenAddress ?? null)
    );
  if (allRawCompatible) {
    const rawAmount = present.reduce((total, value) => total + BigInt(value.rawAmount ?? "0"), 0n).toString();
    return {
      eth: present.every((value) => value.eth != null) ? present.reduce((total, value) => total + (value.eth ?? 0), 0) : null,
      at: first.at ?? null,
      rawAmount,
      decimals: first.decimals,
      currencySymbol: first.currencySymbol ?? null,
      tokenAddress: first.tokenAddress ?? null,
    };
  }
  const decimalTotal = present.reduce((total, value) => total + (marketMoneyToDecimal(value) ?? 0), 0);
  return {
    eth: decimalTotal,
    at: first.at ?? null,
    currencySymbol: first.currencySymbol ?? "ETH",
    tokenAddress: first.tokenAddress ?? null,
    decimals: first.decimals ?? 18,
  };
}

function mergeTokenSnapshot(current: MarketSnapshot | null, tokenSnapshot: MarketSnapshot, tokenId: number): MarketSnapshot {
  const generatedAt = tokenSnapshot.generatedAt || new Date().toISOString();
  const key = String(tokenId);
  const listings = { ...(current?.listings ?? {}) };
  const offers = { ...(current?.offers ?? {}) };
  const traitOffers = { ...(current?.traitOffers ?? {}) };
  const sales = { ...(current?.sales ?? {}) };
  const owners = { ...(current?.owners ?? {}) };
  delete listings[key];
  delete offers[key];
  delete traitOffers[key];
  delete sales[key];
  delete owners[key];
  return {
    version: "opensea-market-v1",
    generatedAt,
    maxAgeSeconds: tokenSnapshot.maxAgeSeconds || 600,
    collection: tokenSnapshot.collection ?? current?.collection ?? { floor: null, topOffer: null },
    listings: { ...listings, ...tokenSnapshot.listings },
    offers: { ...offers, ...tokenSnapshot.offers },
    traitOffers: { ...traitOffers, ...(tokenSnapshot.traitOffers ?? {}) },
    sales: { ...sales, ...tokenSnapshot.sales },
    owners: { ...owners, ...tokenSnapshot.owners },
  };
}

function readCachedMarketSnapshot(): MarketSnapshot | null {
  try {
    const raw = window.localStorage.getItem(MARKET_CACHE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as MarketSnapshot;
    if (snapshot.version !== "opensea-market-v2") return null;
    const age = Date.now() - Date.parse(snapshot.generatedAt || "");
    if (!Number.isFinite(age) || age > MARKET_CACHE_MAX_STALE_MS) return null;
    const visibleSales = Object.fromEntries(
      Object.entries(snapshot.sales ?? {}).filter(([, sale]) => isEthLikeMarketMoney(sale)),
    ) as MarketSnapshot["sales"];
    if (Object.keys(visibleSales).length !== Object.keys(snapshot.sales ?? {}).length) {
      snapshot.sales = visibleSales;
      writeCachedMarketSnapshot(snapshot);
    }
    return snapshot;
  } catch {
    return null;
  }
}

function writeCachedMarketSnapshot(snapshot: MarketSnapshot): void {
  try {
    window.localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify({
      ...snapshot,
      version: "opensea-market-v2",
      owners: {},
    } satisfies MarketSnapshot));
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
  const fraction = fractionRaw.slice(0, remainingDigits).replace(/0+$/, "");
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

function getMarketTimeMs(value: MarketMoney | null | undefined): number | null {
  const timestamp = Date.parse(value?.at ?? "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareOfferPriority(left: MarketMoney | null | undefined, right: MarketMoney | null | undefined): number {
  const leftValue = getMarketNumber(left);
  const rightValue = getMarketNumber(right);
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  if (leftValue !== rightValue) return rightValue - leftValue;
  const leftTime = getMarketTimeMs(left);
  const rightTime = getMarketTimeMs(right);
  if (leftTime == null || rightTime == null || leftTime === rightTime) return 0;
  return leftTime - rightTime;
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

function getOfferSourceLabel(offer: TokenMarketState["offer"] | null | undefined): string {
  if (offer?.source === "trait") return "Trait Offer";
  if (offer?.source === "collection") return "Collection Offer";
  return "Item Offer";
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
  tone = "green",
  closeOnCheckboxChange = true,
}: {
  label: string;
  valueLabel: string;
  children: ReactNode;
  tone?: "green" | "blue";
  closeOnCheckboxChange?: boolean;
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
        className={`flex min-h-11 w-full cursor-pointer items-center justify-between rounded-xl border bg-black/70 px-3 py-2 text-left text-sm outline-none transition-[border-color,box-shadow] ${tone === "blue" ? "border-[#33AAFF]/35 text-[#33AAFF] focus-visible:border-[#33AAFF] focus-visible:shadow-[0_0_10px_rgba(51,170,255,0.22)]" : "border-[#00FF00]/25 text-[#00FF00] focus-visible:border-[#00FF00] focus-visible:shadow-[0_0_10px_rgba(0,255,0,0.18)]"}`}
      >
        <span>{label}</span>
        <span className={`ml-2 truncate text-xs ${tone === "blue" ? "text-[#8bcfff]" : "text-[#8bbf8b]"}`}>
          {valueLabel}
        </span>
      </button>
      {isOpen && (
        <div
          className={`absolute left-0 right-0 z-30 mt-2 overflow-visible rounded-xl border bg-black p-2 shadow-2xl ${tone === "blue" ? "border-[#33AAFF]/35" : "border-[#00FF00]/30"}`}
          onChange={(event) => {
            if (closeOnCheckboxChange && event.target instanceof HTMLInputElement && event.target.type === "checkbox") {
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

function InlineHoverTooltip({
  value,
  tooltip,
  className = "",
  tone = "green",
  wrap = false,
}: {
  value: string;
  tooltip: string;
  className?: string;
  tone?: "green" | "blue" | "yellow" | "purple" | "red" | "muted";
  wrap?: boolean;
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
  const referenceToneClass = tone === "blue"
    ? "focus:ring-[#33AAFF]/70"
    : tone === "yellow"
      ? "focus:ring-[#FFFF00]/70"
      : tone === "purple"
        ? "focus:ring-[#7959ff]/70"
      : tone === "red"
        ? "focus:ring-[#FF7777]/70"
        : tone === "muted"
          ? "focus:ring-[#8bbf8b]/60"
          : "focus:ring-[#00FF00]/70";
  const tooltipToneClass = tone === "blue"
    ? "border-[#33AAFF]/40 text-[#33AAFF]"
    : tone === "yellow"
      ? "border-[#FFFF00]/40 text-[#FFFF00]"
      : tone === "purple"
        ? "border-[#7959ff]/55 text-[#b9aaff]"
      : tone === "red"
        ? "border-[#FF7777]/45 text-[#FF9999]"
        : tone === "muted"
          ? "border-[#8bbf8b]/35 text-[#8bbf8b]"
          : "border-[#00FF00]/40 text-[#00FF00]";

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps({
          tabIndex: 0,
          "aria-label": tooltip,
          onClick: () => setIsOpen((current) => !current),
          className: `inline-flex cursor-help justify-center font-bold outline-none focus:ring-1 ${referenceToneClass} ${className}`,
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
              className: `z-[70] max-w-[min(92vw,520px)] rounded-lg border bg-black px-3 py-2 text-[11px] font-bold leading-snug shadow-2xl ${wrap ? "whitespace-normal break-words text-left" : "whitespace-nowrap"} ${tooltipToneClass}`,
            })}
          >
            {tooltip}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

function OfferPriceTooltipButton({
  price,
  ethUsdPrice,
  onClick,
}: {
  price: MarketMoney;
  ethUsdPrice: number | null;
  onClick: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const tooltip = formatUsdMoneyFromMarket(price, ethUsdPrice);
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
      <button
        ref={refs.setReference}
        type="button"
        {...getReferenceProps({
          "aria-label": `${formatMarketValue(price, { maxDigits: 5 })}, ${tooltip}. Use this price`,
          onClick,
          className: "flex cursor-pointer justify-center font-bold text-[#33AAFF] outline-none hover:text-[#70c6ff] hover:underline focus:ring-1 focus:ring-[#33AAFF]/70",
        })}
      >
        {formatMarketValue(price, { maxDigits: 5 })}
      </button>
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps({
              className: "z-[70] max-w-[min(92vw,520px)] whitespace-nowrap rounded-lg border border-[#33AAFF]/40 bg-black px-3 py-2 text-[11px] font-bold leading-snug text-[#33AAFF] shadow-2xl",
            })}
          >
            {tooltip}
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
  tooltipPrefix,
  showTooltip = true,
  className,
  style,
}: {
  kind: MarketKind;
  label: string;
  money: MarketMoney | null | undefined;
  emptyValue: string;
  tooltipPrefix?: string;
  showTooltip?: boolean;
  className: string;
  style?: CSSProperties;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const styles = getMarketKindStyles(kind);
  const hasValue = hasMarketValue(money);
  const value = hasValue ? formatMarketValue(money, { maxDigits: 8 }) : emptyValue;
  const timestamp = hasValue && money?.at ? formatMarketTimestamp(money.at) : label;
  const tooltip = hasValue && tooltipPrefix ? `${tooltipPrefix} ${timestamp}` : timestamp;
  const tooltipEnabled = showTooltip && hasValue;
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
  const { getReferenceProps, getFloatingProps } = useInteractions(tooltipEnabled ? [hover, focus, role] : []);

  return (
    <>
      <div
        ref={refs.setReference}
        {...getReferenceProps({
          tabIndex: tooltipEnabled ? 0 : undefined,
          "aria-label": tooltipEnabled ? `${label}: ${tooltip}` : undefined,
          onClick: tooltipEnabled ? () => setIsOpen((current) => !current) : undefined,
          className: `${tooltipEnabled ? "cursor-help" : ""} ${className}`,
          style: { ...style, backgroundColor: style?.backgroundColor ?? styles.backgroundColor },
        })}
      >
        <Text className="truncate text-center text-[10px] uppercase" style={{ color: styles.color }}>
          {label}
        </Text>
        <MarketValueChip kind={kind} value={value} tooltip={tooltip} showTooltip={false} align="center" className="mt-1 w-full text-xs" />
      </div>
      {tooltipEnabled && isOpen && (
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

function CompactAttributePreview({
  row,
  onLevelFilter,
  revealedAttributeCount,
}: {
  row: Record<string, unknown>;
  onLevelFilter?: (attribute: LevelAttributeColumn, level: number) => void;
  revealedAttributeCount?: number;
}) {
  const isRevealAnimated = typeof revealedAttributeCount === "number";

  return (
    <div className="overflow-hidden rounded-t-xl bg-[#041204]/60">
      <div className="grid grid-cols-10 border-b border-[#00FF00]/15">
        {ATTRIBUTE_LEVEL_SUMMARY.map((group, index) => {
          const isVisible = !isRevealAnimated || index < revealedAttributeCount;
          const revealClass = isRevealAnimated
            ? `transition-opacity duration-700 ease-out ${isVisible ? "opacity-100" : "opacity-0"}`
            : "";

          return (
            <div
              key={group.label}
              className={`flex min-h-9 items-center justify-center text-base ${revealClass}`}
            >
              <AttributeTooltip
                emoji={group.emoji}
                label={`${group.label} Level`}
                description={group.description}
                placement="bottom"
              />
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-10">
        {ATTRIBUTE_LEVEL_SUMMARY.map((group, index) => {
          const target = getLevelFilterTarget(group, row);
          const value = formatDetailValue(group.level, row[group.level]);
          const isVisible = !isRevealAnimated || index < revealedAttributeCount;
          const revealClass = isRevealAnimated
            ? `transition-opacity duration-700 ease-out ${isVisible ? "opacity-100" : "opacity-0"}`
            : "";
          return (
            <div
              key={group.label}
              className={`flex min-h-8 items-center justify-center border-r border-[#00FF00]/10 text-[10px] font-bold text-[#00FF00] last:border-r-0 ${revealClass}`}
            >
              {target && onLevelFilter ? (
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
}

function getWarpletImageUrl(tokenId: number): string {
  return `https://warplets.10x.meme/${tokenId}.png`;
}

function getWarpletPreviewImageUrl(tokenId: number): string {
  return `https://warplets.10x.meme/${tokenId}.jpg`;
}

function getWarpletAssetUrl(tokenId: number, extension: string): string {
  return `https://warplets.10x.meme/${tokenId}.${extension}`;
}

function getOpenSeaUrl(tokenId: number): string {
  return `https://opensea.io/item/base/0x780446dd12e080ae0db762fcd4daf313f3e359de/${tokenId}`;
}

function getSearchBasePath(): "" | typeof WARPLETS_APP_PATH {
  return window.location.pathname.startsWith(WARPLETS_APP_PATH) ? WARPLETS_APP_PATH : "";
}

function getSearchRouteKey(route: SearchRoute): string {
  if (route.page === "offers") return `offers:${route.offersPage}`;
  if (route.page === "perks") return `perks:${route.perksPage}`;
  return route.page;
}

function getSearchRouteStableKey(route: SearchRoute): string {
  if (route.page === "listed") return `listed:${route.listedLevel}`;
  if (route.page === "stats") return `stats:${route.statsPage}:${route.statsRange ?? "all"}:${route.statsDetail ?? "all"}`;
  return getSearchRouteKey(route);
}

function normalizeSearchPath(pathname: string): string {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  if (normalizedPath === WARPLETS_APP_PATH) return "/";
  if (normalizedPath.startsWith(`${WARPLETS_APP_PATH}/`)) return normalizedPath.slice(WARPLETS_APP_PATH.length) || "/";
  return normalizedPath;
}

function parseSearchRouteFromPath(pathname: string): SearchRoute {
  const path = normalizeSearchPath(pathname);
  if (path === "/app-testing" && window.location.hostname === new URL(WARPLETS_APP_ORIGINS.local).hostname) return { page: "app-testing" };
  if (path === "/warpmoji" && window.location.hostname === new URL(WARPLETS_APP_ORIGINS.local).hostname) return { page: "warpmoji" };
  if (path === "/listed") return { page: "listed", listedLevel: "all" };
  const listedMatch = path.match(/^\/listed\/(10x|9x|8x|7x|6x|5x|4x|3x|2x|1x)$/i);
  if (listedMatch) return { page: "listed", listedLevel: listedMatch[1].toLowerCase() as ListedLevelFilter };
  if (path === "/offers/trait") return { page: "offers", offersPage: "trait" };
  if (path === "/offers/item") return { page: "offers", offersPage: "item" };
  if (path === "/offers/collection") return { page: "offers", offersPage: "collection" };
  if (path === "/perks/rwas") return { page: "perks", perksPage: "rwas" };
  if (path === "/perks/nfts") return { page: "perks", perksPage: "nfts" };
  if (path === "/perks/ai") return { page: "perks", perksPage: "ai" };
  if (path === "/perks/attention") return { page: "perks", perksPage: "attention" };
  if (path === "/perks/alpha") return { page: "perks", perksPage: "alpha" };
  if (path === "/perks" || path === "/perks/memes") return { page: "perks", perksPage: "memes" };
  const statsOverviewMatch = path.match(/^\/stats\/overview\/(collection|launch)$/i);
  if (statsOverviewMatch) return { page: "stats", statsPage: "overview", statsDetail: statsOverviewMatch[1].toLowerCase() as StatsRouteDetail };
  const statsRangeMatch = path.match(/^\/stats\/(market|activity|social)\/(7d|30d|90d|1y|all)(?:\/(price|floor-price|volume|listings|offers|sales|sends))?$/i);
  if (statsRangeMatch) return {
    page: "stats",
    statsPage: statsRangeMatch[1].toLowerCase() === "market" ? "market" : "social",
    statsRange: statsRangeMatch[2].toLowerCase() as StatsRange,
    ...(statsRangeMatch[3] ? { statsDetail: statsRangeMatch[3].toLowerCase() as StatsRouteDetail } : {}),
  };
  if (path === "/stats/market") return { page: "stats", statsPage: "market", statsRange: readLegacyStatsRange() };
  if (path === "/stats/activity" || path === "/stats/social") return { page: "stats", statsPage: "social", statsRange: readLegacyStatsRange() };
  if (path === "/stats/holders/top10") return { page: "stats", statsPage: "holders", statsDetail: "top10" };
  if (path === "/stats/holders/top10friends") return { page: "stats", statsPage: "holders", statsDetail: "top10friends" };
  if (path === "/stats/holders") return { page: "stats", statsPage: "holders" };
  if (path === "/stats" || path === "/stats/overview") return { page: "stats", statsPage: "overview" };
  return { page: "search" };
}

function readLastSearchListedLevel(): ListedLevelFilter {
  if (typeof window === "undefined") return "all";
  const value = window.localStorage.getItem(LAST_SEARCH_LISTED_LEVEL_KEY);
  return LISTED_LEVEL_TABS.some((tab) => tab.id === value) ? value as ListedLevelFilter : "all";
}

function writeLastSearchListedLevel(value: ListedLevelFilter): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_SEARCH_LISTED_LEVEL_KEY, value);
}

function readListedScopeFilter(): ListedScopeFilter {
  if (typeof window === "undefined") return "all";
  const value = window.localStorage.getItem(LISTED_SCOPE_KEY);
  return value === "your" || value === "favourites" || value === "sweep" ? value : "all";
}

function writeListedScopeFilter(value: ListedScopeFilter): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LISTED_SCOPE_KEY, value);
}

function readLastSearchOffersSubpage(): SearchOffersSubpage {
  if (typeof window === "undefined") return "collection";
  const value = window.localStorage.getItem(LAST_SEARCH_OFFERS_SUBPAGE_KEY);
  return value === "trait" || value === "item" || value === "collection" ? value : "collection";
}

function writeLastSearchOffersSubpage(value: SearchOffersSubpage): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_SEARCH_OFFERS_SUBPAGE_KEY, value);
}

function readLastSearchPerksSubpage(): PerksSubpage {
  if (typeof window === "undefined") return "memes";
  const value = window.localStorage.getItem(LAST_SEARCH_PERKS_SUBPAGE_KEY);
  return value === "nfts" || value === "ai" || value === "attention" || value === "alpha" || value === "memes"
    ? value
    : "memes";
}

function writeLastSearchPerksSubpage(value: PerksSubpage): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_SEARCH_PERKS_SUBPAGE_KEY, value);
}

function readLastSearchStatsSubpage(): SearchStatsSubpage {
  if (typeof window === "undefined") return "overview";
  const value = window.localStorage.getItem(LAST_SEARCH_STATS_SUBPAGE_KEY);
  return value === "market" || value === "social" || value === "holders" || value === "overview"
    ? value
    : "overview";
}

function writeLastSearchStatsSubpage(value: SearchStatsSubpage): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_SEARCH_STATS_SUBPAGE_KEY, value);
}

function readLastStatsActivityEvent(): StatsActivityEvent {
  if (typeof window === "undefined") return "sale";
  const queryEvent = new URLSearchParams(window.location.search).get("event");
  if (queryEvent === "listing" || queryEvent === "offer" || queryEvent === "send" || queryEvent === "sale") return queryEvent;
  const value = window.localStorage.getItem(LAST_STATS_ACTIVITY_EVENT_KEY);
  return value === "listing" || value === "offer" || value === "send" || value === "sale"
    ? value
    : "sale";
}

function getStatsActivityEventFromRouteDetail(detail?: StatsRouteDetail): StatsActivityEvent | null {
  if (detail === "sales") return "sale";
  if (detail === "listings") return "listing";
  if (detail === "offers") return "offer";
  if (detail === "sends") return "send";
  return null;
}

function readLegacyStatsRange(): StatsRange {
  if (typeof window === "undefined") return "all";
  const value = new URLSearchParams(window.location.search).get("range");
  return value === "7d" || value === "30d" || value === "90d" || value === "1y" || value === "all" ? value : "all";
}

function readStatsDeepLinkWallet(): string | null {
  if (typeof window === "undefined") return null;
  return getStatsFriendFilterWallet(window.location.search);
}

function writeLastStatsActivityEvent(value: StatsActivityEvent): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_STATS_ACTIVITY_EVENT_KEY, value);
}

function readLastItemActivityEvent(): StatsActivityEvent {
  if (typeof window === "undefined") return "sale";
  const value = window.localStorage.getItem(LAST_ITEM_ACTIVITY_EVENT_KEY);
  return value === "listing" || value === "offer" || value === "send" || value === "sale"
    ? value
    : "sale";
}

function readItemActivityDeepLink(): { open: boolean; range: StatsRange; event: StatsActivityEvent | null } {
  if (typeof window === "undefined") return { open: false, range: "all", event: null };
  const params = new URLSearchParams(window.location.search);
  const range = params.get("range");
  const event = params.get("event");
  return {
    open: params.get("activity") === "1",
    range: range === "7d" || range === "30d" || range === "90d" || range === "1y" || range === "all" ? range : "all",
    event: event === "sale" || event === "listing" || event === "offer" || event === "send" ? event : null,
  };
}

function writeLastItemActivityEvent(value: StatsActivityEvent): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_ITEM_ACTIVITY_EVENT_KEY, value);
}

function getSearchPathForRoute(route: SearchRoute): string {
  const basePath = getSearchBasePath();
  const path =
    route.page === "search"
      ? "/"
      : route.page === "app-testing"
        ? "/app-testing"
      : route.page === "warpmoji"
        ? "/warpmoji"
      : route.page === "listed"
        ? route.listedLevel === "all" ? "/listed" : `/listed/${route.listedLevel}`
        : route.page === "perks"
          ? `/perks/${route.perksPage}`
        : route.page === "stats"
          ? route.statsPage === "overview"
            ? route.statsDetail ? `/stats/overview/${route.statsDetail}` : "/stats"
            : route.statsPage === "holders"
              ? route.statsDetail === "top10" || route.statsDetail === "top10friends"
                ? `/stats/holders/${route.statsDetail}`
                : "/stats/holders"
              : `/stats/${route.statsPage === "social" ? "activity" : "market"}/${route.statsRange ?? "all"}${route.statsDetail ? `/${route.statsDetail}` : ""}`
          : `/offers/${route.offersPage}`;
  if (!basePath) return path;
  return path === "/" ? basePath : `${basePath}${path}`;
}

function getSearchRouteTitle(route: SearchRoute): string {
  if (route.page === "app-testing") return "10X Warplets - App testing";
  if (route.page === "warpmoji") return "10X Warplets - Warpmoji";
  if (route.page === "listed") {
    return route.listedLevel === "all"
      ? "10X Warplets - Listed"
      : `10X Warplets - Listed ${route.listedLevel.toUpperCase()}`;
  }
  if (route.page === "stats") {
    const pageLabel = STATS_SUBPAGE_TABS.find((tab) => tab.id === route.statsPage)?.label ?? "Overview";
    return `10X Warplets - ${pageLabel} stats`;
  }
  if (route.page === "perks") {
    const pageLabel = PERKS_SUBPAGE_TABS.find((tab) => tab.id === route.perksPage)?.label ?? "Memes";
    return `10X Warplets - ${pageLabel} perks`;
  }
  if (route.page === "offers") {
    if (route.offersPage === "trait") return "10X Warplets - Trait offers";
    if (route.offersPage === "item") return "10X Warplets - Item offers";
    return "10X Warplets - Collection offers";
  }
  return "10X Warplets";
}

function unknownRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function SearchHeaderAccountControl({
  connected,
  walletConnected,
  walletAddress,
  walletAvatarUrl,
  identityConnected,
  identityLabel,
  identityAvatarUrl,
  simplifiedFarcaster,
  accountLabel,
  showDisconnect,
  open,
  centered,
  onOpenChange,
  onAvatarToggle,
  closeKey,
  onConnectWallet,
  onOpenSpreadsheet,
  onOpenAppTesting,
  onOpenWarpmoji,
  onViewMyWarplets,
  onViewOnboarding,
  onEnableNotifications,
  onInstallWebApp,
  onDisconnect,
}: {
  connected: boolean;
  walletConnected: boolean;
  walletAddress: string | null;
  walletAvatarUrl: string | null;
  identityConnected: boolean;
  identityLabel: string | null;
  identityAvatarUrl: string | null;
  simplifiedFarcaster: boolean;
  accountLabel: string;
  showDisconnect: boolean;
  open: boolean;
  centered: boolean;
  onOpenChange: (open: boolean) => void;
  onAvatarToggle: () => void;
  closeKey: string;
  onConnectWallet: () => void;
  onOpenSpreadsheet: () => void;
  onOpenAppTesting: () => void;
  onOpenWarpmoji: () => void;
  onViewMyWarplets?: () => void;
  onViewOnboarding: () => void;
  onEnableNotifications?: () => void;
  onInstallWebApp?: () => void;
  onDisconnect: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onOpenChange(false);
  }, [closeKey, onOpenChange]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      if (event.target instanceof Element && event.target.closest(".miniapp-header__title-badge")) return;
      onOpenChange(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  const runMenuAction = (action: () => void) => {
    onOpenChange(false);
    void hapticTap();
    action();
  };

  return (
    <div className="search-header-account" ref={rootRef}>
      {!connected ? (
        <button
          type="button"
          className="search-header-connect-button"
          title="Connect wallet or Farcaster identity"
          onClick={() => {
            void hapticTap();
            onConnectWallet();
          }}
        >
          Connect
        </button>
      ) : <button
        type="button"
        className="search-header-avatar-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={accountLabel}
        title={accountLabel}
        onClick={() => {
          void hapticTap();
          onAvatarToggle();
        }}
      >
        <span className="search-header-avatar-stack">
          {!simplifiedFarcaster && walletConnected && walletAvatarUrl && <span className="search-header-avatar-frame search-header-avatar-frame--wallet">
            <img src={walletAvatarUrl} alt="" className="search-header-avatar-image" loading="eager" />
          </span>}
          {identityConnected && <span className="search-header-avatar-frame search-header-avatar-frame--identity">
            <img src={identityAvatarUrl ?? getWarpletPreviewImageUrl(HEADER_FALLBACK_AVATAR_TOKEN_ID)} alt="" className="search-header-avatar-image" loading="eager" />
          </span>}
        </span>
      </button>}
      {open && (
        <div className={`search-header-account-menu${centered ? " search-header-account-menu--centered" : ""}`} role="menu">
          {!simplifiedFarcaster && <button type="button" role="menuitem" className="search-header-account-menu__connection" onClick={() => runMenuAction(onConnectWallet)}>
              {walletConnected && walletAvatarUrl
                ? <span className="search-header-account-menu__avatar-frame"><img src={walletAvatarUrl} alt="" /></span>
                : <span className="search-header-account-menu__avatar-frame"><img src="/base.webp" alt="" /></span>}
              <span>{walletConnected && walletAddress ? formatShortWallet(walletAddress) : "Connect wallet"}</span>
            </button>}
          <button type="button" role="menuitem" className="search-header-account-menu__connection" onClick={() => simplifiedFarcaster ? onOpenChange(false) : runMenuAction(onConnectWallet)}>
            {identityConnected
              ? <span className="search-header-account-menu__avatar-frame"><img src={identityAvatarUrl ?? getWarpletPreviewImageUrl(HEADER_FALLBACK_AVATAR_TOKEN_ID)} alt="" /></span>
              : <span className="search-header-account-menu__avatar-frame"><img src="/farcaster.webp" alt="" /></span>}
            <span>{identityConnected ? identityLabel : "Connect social"}</span>
          </button>
          {onViewMyWarplets && (
            <button type="button" role="menuitem" onClick={() => runMenuAction(onViewMyWarplets)}>
              My Warplets
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => runMenuAction(onViewOnboarding)}>
            View onboarding
          </button>
          {onEnableNotifications && (
            <button type="button" role="menuitem" onClick={() => runMenuAction(onEnableNotifications)}>
              Enable notifications
            </button>
          )}
          {onInstallWebApp && (
            <button type="button" role="menuitem" onClick={() => runMenuAction(onInstallWebApp)}>
              Install web app
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => runMenuAction(onOpenSpreadsheet)}>
            Warplets spreadsheet
          </button>
          {window.location.hostname === new URL(WARPLETS_APP_ORIGINS.local).hostname && (
            <>
              <a role="menuitem" href="/developer">Developer API</a>
              <button type="button" role="menuitem" onClick={() => runMenuAction(onOpenAppTesting)}>App testing</button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(onOpenWarpmoji)}>Warpmoji</button>
            </>
          )}
          {showDisconnect && !simplifiedFarcaster && (
            <button type="button" role="menuitem" onClick={() => runMenuAction(onDisconnect)}>
              Disconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SearchSegmentedTabs({
  options,
  activeId,
  onSelect,
  className = "",
  gridTemplateColumns,
  compact = false,
}: {
  options: Array<{ id: string; label: string }>;
  activeId: string;
  onSelect: (id: string) => void;
  className?: string;
  gridTemplateColumns?: string;
  compact?: boolean;
}) {
  const dense = options.length > 6 || compact;
  return (
    <div
      className={`grid ${dense ? "gap-1" : "gap-2"} rounded-lg border border-[#00FF00]/25 bg-black/60 p-1 ${className}`}
      style={{ gridTemplateColumns: gridTemplateColumns ?? `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.id === activeId;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              void hapticSelectionChanged();
              onSelect(option.id);
            }}
            className={`cursor-pointer whitespace-nowrap rounded-md ${compact ? "px-0.5 py-2 text-xs sm:text-sm" : dense ? "px-1 py-2 text-[10px] sm:text-xs" : "px-2 py-2 text-xs sm:text-sm"} font-bold transition-colors ${
              active
                ? "bg-[#00FF00] text-[rgb(0,80,0)]"
                : "text-[#00FF00] hover:bg-[#041204]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SearchPageNavigation({
  route,
  lastOffersSubpage,
  lastPerksSubpage,
  lastStatsSubpage,
  lastListedLevel,
  onNavigate,
}: {
  route: SearchRoute;
  lastOffersSubpage: SearchOffersSubpage;
  lastPerksSubpage: PerksSubpage;
  lastStatsSubpage: SearchStatsSubpage;
  lastListedLevel: ListedLevelFilter;
  onNavigate: (route: SearchRoute) => void;
}) {
  const activePrimary = route.page === "offers" ? "offers" : route.page;
  const activeOffer = route.page === "offers" ? route.offersPage : "collection";
  const activePerks = route.page === "perks" ? route.perksPage : "memes";
  const activeStats = route.page === "stats" ? route.statsPage : "overview";
  const activeListedLevel = route.page === "listed" ? route.listedLevel : "all";

  return (
    <div className="mx-auto w-full max-w-md px-4 pt-4">
      <SearchSegmentedTabs
        options={[
          { id: "search", label: "Search" },
          { id: "listed", label: "Listed" },
          { id: "offers", label: "Offers" },
          { id: "perks", label: "Perks" },
          { id: "stats", label: "Stats" },
        ]}
        activeId={activePrimary}
        onSelect={(id) => {
          if (id === "offers") {
            onNavigate({ page: "offers", offersPage: lastOffersSubpage });
          } else if (id === "listed") {
            onNavigate({ page: "listed", listedLevel: lastListedLevel });
          } else if (id === "perks") {
            onNavigate({ page: "perks", perksPage: lastPerksSubpage });
          } else if (id === "stats") {
            onNavigate({ page: "stats", statsPage: lastStatsSubpage });
          } else {
            onNavigate({ page: "search" });
          }
        }}
      />
      {route.page === "offers" && (
        <SearchSegmentedTabs
          className="mt-2"
          options={[
            { id: "collection", label: "Collection" },
            { id: "trait", label: "Trait" },
            { id: "item", label: "Item" },
          ]}
          activeId={activeOffer}
          onSelect={(id) => onNavigate({ page: "offers", offersPage: id as SearchOffersSubpage })}
        />
      )}
      {route.page === "listed" && (
        <SearchSegmentedTabs
          className="mt-2"
          options={LISTED_LEVEL_TABS}
          activeId={activeListedLevel}
          onSelect={(id) => onNavigate({ page: "listed", listedLevel: id as ListedLevelFilter })}
        />
      )}
      {route.page === "perks" && (
        <SearchSegmentedTabs
          className="mt-2"
          options={PERKS_SUBPAGE_TABS}
          activeId={activePerks}
          onSelect={(id) => onNavigate({ page: "perks", perksPage: id as PerksSubpage })}
          gridTemplateColumns="1fr 0.9fr 0.85fr 0.6fr 1.35fr 0.85fr"
          compact
        />
      )}
      {route.page === "stats" && (
        <SearchSegmentedTabs
          className="mt-2"
          options={STATS_SUBPAGE_TABS}
          activeId={activeStats}
          onSelect={(id) => onNavigate({ page: "stats", statsPage: id as SearchStatsSubpage })}
        />
      )}
    </div>
  );
}

function SearchPlaceholderPage({
  title,
  filterOptions,
}: {
  title: string;
  filterOptions?: Array<{ id: string; label: string }>;
}) {
  const [activeFilter, setActiveFilter] = useState(filterOptions?.[0]?.id ?? "");

  useEffect(() => {
    setActiveFilter(filterOptions?.[0]?.id ?? "");
  }, [filterOptions]);

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-10 pt-6">
      {filterOptions && filterOptions.length > 0 && (
        <SearchSegmentedTabs
          className="mb-4"
          options={filterOptions}
          activeId={activeFilter}
          onSelect={setActiveFilter}
        />
      )}
      <Text className="text-center text-sm font-bold" style={{ color: "#00FF00" }}>
        Placeholder: {title}
      </Text>
    </div>
  );
}

function OverlayScrollArea({
  children,
  className,
  scrollbarAutoHide = "leave",
}: {
  children: ReactNode;
  className: string;
  scrollbarAutoHide?: "never" | "scroll" | "leave" | "move";
}) {
  return (
    <OverlayScrollbarsComponent
      className={className}
      defer
      options={{
        scrollbars: {
          theme: "os-theme-10x-green",
          autoHide: scrollbarAutoHide,
        },
      }}
    >
      {children}
    </OverlayScrollbarsComponent>
  );
}

type StatsApiEnvelope = {
  asOf?: string | null;
  generatedAt?: string | null;
  range?: string | null;
  analyticsEpoch?: string | null;
  coverageStart?: string | null;
  baselineAsOf?: string | null;
  complete?: boolean;
  stale?: boolean;
  sources?: unknown;
  integrations?: {
    dune?: {
      status?: "live" | "stale" | "pending" | "disabled" | "unavailable" | "budget_paused" | string;
      configured?: boolean;
      asOf?: string | null;
      coverageStart?: string | null;
      coverageEnd?: string | null;
      lastError?: string | null;
      creditsThisMonth?: number | null;
    } | null;
    [key: string]: unknown;
  } | null;
  metrics?: Record<string, unknown>;
  series?: Record<string, unknown> | unknown[];
  summary?: Record<string, unknown>;
  floor?: unknown;
  rows?: unknown[];
  nextCursor?: string | null;
  friendFilter?: {
    wallet?: string | null;
    fid?: number | null;
    available?: boolean;
  } | null;
  error?: string;
  message?: string;
};

const STATS_CLIENT_CACHE_TTL_MS = 60_000;
const statsActivityChartCache = new Map<string, { payload: ActivityChartPayload | null; loadedAt: number }>();
const STATS_OVERVIEW_CACHE_KEY = "stats:overview:all:farcaster-holders-v1";
const STATS_OVERVIEW_URL = "/api/stats/overview?range=all&view=farcaster-holders-v1";
const STATS_BACKGROUND_PREFETCH_DELAY_MS = 750;

const STATS_LOADING_MESSAGES: Record<SearchStatsSubpage, string[]> = {
  overview: [
    "Counting every Warplet without waking them...",
    "Checking the floor for loose ETH...",
    "Measuring just how fairly the chaos was distributed...",
    "Polishing 10,000 tiny data points...",
  ],
  market: [
    "Following Warplets across Base...",
    "Asking the floor how low it can go...",
    "Comparing bids, sales and marketplace mischief...",
    "Teaching the charts about tiny decimals...",
  ],
  social: [
    "Matching wallets with Farcaster alter egos...",
    "Finding familiar faces in the onchain crowd...",
    "Tracing the community's latest Warplet adventures...",
    "Giving Top 100 Friends an extra glow...",
  ],
  holders: [
    "Ranking wallets without starting a whale fight...",
    "Finding each collector's rarest little monster...",
    "Counting stacks of Warplets...",
    "Preparing 10,000 holders, 100 at a time...",
  ],
};

type StatsEnvelopeCacheEntry = {
  payload: StatsApiEnvelope;
  loadedAt: number;
};

const statsEnvelopeCache = new Map<string, StatsEnvelopeCacheEntry>();
const statsEnvelopeRequests = new Map<string, Promise<StatsApiEnvelope>>();
const statsHolderViewerCache = new Map<string, { payload: Record<string, unknown> | null; loadedAt: number }>();
const statsHolderViewerRequests = new Map<string, Promise<Record<string, unknown> | null>>();
const statsSocialHighlightsCache = new Map<number, { payload: StatsApiEnvelope; loadedAt: number }>();

function readCachedStatsEnvelope(cacheKey: string): StatsApiEnvelope | null {
  const cached = statsEnvelopeCache.get(cacheKey);
  if (!cached || Date.now() - cached.loadedAt > STATS_CLIENT_CACHE_TTL_MS) return null;
  return cached.payload;
}

async function fetchCachedStatsEnvelope({
  cacheKey,
  url,
  force = false,
}: {
  cacheKey: string;
  url: string;
  force?: boolean;
}): Promise<StatsApiEnvelope> {
  if (!force) {
    const cached = readCachedStatsEnvelope(cacheKey);
    if (cached) return cached;
    const activeRequest = statsEnvelopeRequests.get(cacheKey);
    if (activeRequest) return activeRequest;
  }

  const requestKey = force ? `${cacheKey}:refresh` : cacheKey;
  const activeRequest = statsEnvelopeRequests.get(requestKey);
  if (activeRequest) return activeRequest;

  const request = (async () => {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
    const responseBody = await response.text();
    if (!responseBody) {
      throw new Error(`Stats service returned an empty response (${response.status}). Please try again.`);
    }
    let result: StatsApiEnvelope;
    try {
      result = JSON.parse(responseBody) as StatsApiEnvelope;
    } catch {
      throw new Error(`Stats service returned an invalid response (${response.status}). Please try again.`);
    }
    if (!response.ok) {
      throw new Error(result.message || result.error || `Stats failed (${response.status})`);
    }
    statsEnvelopeCache.set(cacheKey, { payload: result, loadedAt: Date.now() });
    return result;
  })();
  const trackedRequest = request.finally(() => {
    if (statsEnvelopeRequests.get(requestKey) === trackedRequest) {
      statsEnvelopeRequests.delete(requestKey);
    }
  });
  statsEnvelopeRequests.set(requestKey, trackedRequest);
  return trackedRequest;
}

async function fetchCachedStatsHolderViewer({
  cacheKey,
  url,
  force = false,
}: {
  cacheKey: string;
  url: string;
  force?: boolean;
}): Promise<Record<string, unknown> | null> {
  if (!force) {
    const cached = statsHolderViewerCache.get(cacheKey);
    if (cached && Date.now() - cached.loadedAt <= STATS_CLIENT_CACHE_TTL_MS) return cached.payload;
    const activeRequest = statsHolderViewerRequests.get(cacheKey);
    if (activeRequest) return activeRequest;
  }

  const requestKey = force ? `${cacheKey}:refresh` : cacheKey;
  const activeRequest = statsHolderViewerRequests.get(requestKey);
  if (activeRequest) return activeRequest;

  const request = (async () => {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
    if (response.status === 404) {
      statsHolderViewerCache.set(cacheKey, { payload: null, loadedAt: Date.now() });
      return null;
    }
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const envelope = result as StatsApiEnvelope;
      throw new Error(envelope.message || envelope.error || `Viewer rank failed (${response.status})`);
    }
    statsHolderViewerCache.set(cacheKey, { payload: result, loadedAt: Date.now() });
    return result;
  })();
  const trackedRequest = request.finally(() => {
    if (statsHolderViewerRequests.get(requestKey) === trackedRequest) {
      statsHolderViewerRequests.delete(requestKey);
    }
  });
  statsHolderViewerRequests.set(requestKey, trackedRequest);
  return trackedRequest;
}

function StatsLoadingState({ subpage }: { subpage: SearchStatsSubpage }) {
  const messages = STATS_LOADING_MESSAGES[subpage];
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    setMessageIndex(0);
    const interval = window.setInterval(() => {
      setMessageIndex((current) => (current + 1) % messages.length);
    }, 1_800);
    return () => window.clearInterval(interval);
  }, [messages]);

  return (
    <div
      className="overflow-hidden rounded-xl border border-[#00FF00]/25 bg-black/65 px-4 py-10 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex w-fit items-end gap-1" aria-hidden="true">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="h-2 w-2 animate-bounce rounded-full bg-[#00FF00] shadow-[0_0_7px_rgba(0,255,0,0.75)]"
            style={{ animationDelay: `${dot * 140}ms` }}
          />
        ))}
      </div>
      <Text className="mt-4 text-xs font-black text-[#00FF00]">
        Loading {STATS_SUBPAGE_TABS.find((tab) => tab.id === subpage)?.label ?? "Stats"}
      </Text>
      <Text key={`${subpage}-${messageIndex}`} className="mt-1.5 animate-pulse text-[10px] font-bold text-[#8bbf8b]">
        {messages[messageIndex]}
      </Text>
    </div>
  );
}

type StatsChartDatum = {
  label: string;
  timestamp?: string;
  avatarUrl?: string | null;
  isTopFriend?: boolean;
  isViewer?: boolean;
  tokenId?: number | null;
  wallet?: string | null;
  [key: string]: string | number | boolean | null | undefined;
};

type StatsChartSeries = {
  key: string;
  label: string;
  color: string;
  type: "line" | "bar";
  axis?: "left" | "right";
};

type StatsChartProps = {
  data: StatsChartDatum[];
  series: StatsChartSeries[];
  height?: number;
  socialKey?: string;
  onOpenToken?: (tokenId: number) => void;
  hideMarketplace?: boolean;
  hideEthSymbol?: boolean;
  socialRole?: "buyer" | "seller";
  onShowBucketSales?: (startAt: string, endAt: string) => void;
  onShowBucketActivity?: (event: MarketActivityRow["event"], startAt: string, endAt: string) => void;
  onSearchWallet?: (wallet: string) => void;
  flushMargins?: boolean;
  markerSeries?: Array<{ key: string; event: MarketActivityRow["event"]; color: string }>;
  isInMiniAppContext?: boolean;
  activeBucket?: { event: MarketActivityRow["event"]; startAt: string; endAt: string } | null;
  animateLinesLeftToRight?: boolean;
};

let statsChartAnimationId = 0;

async function loadStatsChart() {
  const {
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
    ResponsiveContainer,
    Scatter,
    Tooltip,
    XAxis,
    YAxis,
  } = await import("recharts");

  function SocialMarker(props: { forceActive?: boolean; revealReady?: boolean; revealCount?: number; selectedMarkerId?: string | null; onSelectMarker?: (point: StatsChartDatum) => void } & Record<string, unknown>) {
    const marker = unknownRecord(props);
    const payload = unknownRecord(marker?.payload);
    const cx = typeof marker?.cx === "number" ? marker.cx : 0;
    const cy = typeof marker?.cy === "number" ? marker.cy : 0;
    const markerIndex = typeof payload?.markerRevealIndex === "number"
      ? payload.markerRevealIndex
      : Number.POSITIVE_INFINITY;
    const revealReady = marker?.revealReady === true;
    const revealCount = typeof marker?.revealCount === "number" ? marker.revealCount : 0;
    const forceActive = marker?.forceActive === true;
    const selectedMarkerId = typeof marker?.selectedMarkerId === "string" ? marker.selectedMarkerId : null;
    const markerId = typeof payload?.markerId === "string" ? payload.markerId : String(markerIndex);
    const selected = markerId === selectedMarkerId;
    const saleCount = typeof payload?.eventCount === "number" ? payload.eventCount : typeof payload?.saleCount === "number" ? payload.saleCount : 0;
    const markerColor = typeof payload?.markerColor === "string" ? payload.markerColor : "#FF3333";
    const chipBackground = typeof payload?.markerChipBackground === "string" ? payload.markerChipBackground : "#250303";
    const avatarUrl =
      typeof payload?.avatarUrl === "string" &&
      payload?.showMarker !== false &&
      (payload?.showAvatar !== false || forceActive)
        ? payload.avatarUrl
        : null;
    const radius = forceActive ? 15 : 13;
    const clipId = `stats-avatar-${String(payload?.fid ?? payload?.wallet ?? `${cx}-${cy}`).replace(/[^a-zA-Z0-9_-]/g, "")}-${Math.round(cx)}-${Math.round(cy)}`;

    // Scatter can eagerly create every shape even when its data prop changes. Keep
    // unrevealed shapes out of the SVG entirely until the line animation is over.
    if (!revealReady || markerIndex >= revealCount) return <g />;

    const selectMarker = (event: React.MouseEvent<SVGGElement>) => {
      if (typeof marker?.onSelectMarker === "function" && Number.isFinite(markerIndex)) marker.onSelectMarker(payload as StatsChartDatum);
    };
    const countLabel = saleCount.toLocaleString("en-US");
    const countWidth = Math.max(25, 11 + countLabel.length * 7);

    return (
      <g onClick={selectMarker} className="stats-social-marker-pop" style={{ cursor: "pointer", transformBox: "fill-box", transformOrigin: "center" }}>
        {selected && <circle cx={cx} cy={cy} r={radius + 1} fill="none" stroke={markerColor} strokeWidth="2" style={{ filter: `drop-shadow(0 0 5px ${markerColor})` }} />}
        <defs>
          <clipPath id={clipId}>
            <circle cx={cx} cy={cy} r={radius} />
          </clipPath>
        </defs>
        {avatarUrl ? <image href={avatarUrl} x={cx - radius} y={cy - radius} width={radius * 2} height={radius * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} /> : <circle cx={cx} cy={cy} r={radius} fill="#00FF00" />}
        {saleCount > 0 && <g pointerEvents="none">
          <rect x={cx - countWidth / 2} y={cy - radius - 17} width={countWidth} height={14} rx={6} fill={chipBackground} stroke={markerColor} strokeWidth="1" />
          <text x={cx} y={cy - radius - 7} textAnchor="middle" fill={markerColor} fontSize="9" fontWeight="900">{countLabel}</text>
        </g>}
      </g>
    );
  }

  function StatsTooltipContent({
    active,
    payload,
    label,
    onOpenToken,
    hideMarketplace,
    hideEthSymbol,
    socialRole,
    onClose,
    onShowBucketSales,
    onShowBucketActivity,
    onSearchWallet,
    selectedPoint,
    isInMiniAppContext,
  }: {
    active?: boolean;
    payload?: Array<{
      name?: string;
      value?: unknown;
      color?: string;
      payload?: StatsChartDatum;
    }>;
    label?: unknown;
    onOpenToken?: (tokenId: number) => void;
    hideMarketplace?: boolean;
    hideEthSymbol?: boolean;
    socialRole?: "buyer" | "seller";
    onClose?: () => void;
    onShowBucketSales?: (startAt: string, endAt: string) => void;
    onShowBucketActivity?: (event: MarketActivityRow["event"], startAt: string, endAt: string) => void;
    onSearchWallet?: (wallet: string) => void;
    selectedPoint?: StatsChartDatum | null;
    isInMiniAppContext?: boolean;
  }) {
    if (!active || (!selectedPoint && !payload?.length)) return null;
    const point = selectedPoint ?? payload?.find((item) => item.payload)?.payload;
    const buyerUsername = typeof point?.buyerUsername === "string" ? point.buyerUsername : null;
    const sellerUsername = typeof point?.sellerUsername === "string" ? point.sellerUsername : null;
    const transactionHash = typeof point?.transactionHash === "string" ? point.transactionHash : null;
    const marketplace = typeof point?.marketplace === "string" ? point.marketplace : null;
    const count = typeof point?.eventCount === "number" ? point.eventCount : typeof point?.saleCount === "number" ? point.saleCount : null;
    const eventType = (statsString(point?.eventType) ?? "sale") as MarketActivityRow["event"];
    const tokenId = typeof point?.tokenId === "number" ? point.tokenId : null;
    const saleAmount = statsNumber(point?.eventAveragePrice ?? point?.salePrice ?? payload?.find((item) => typeof item.value === "number")?.value);
    const topSaleAmount = statsNumber(point?.topEventPrice ?? point?.topSalePrice);
    const buyerAvatarUrl = statsString(point?.toAvatarUrl ?? point?.buyerAvatarUrl);
    const sellerAvatarUrl = statsString(point?.fromAvatarUrl ?? point?.sellerAvatarUrl);
    const buyerWallet = statsString(point?.toWallet ?? point?.buyerWallet);
    const sellerWallet = statsString(point?.fromWallet ?? point?.sellerWallet);
    const toUsername = statsString(point?.toUsername ?? point?.buyerUsername);
    const fromUsername = statsString(point?.fromUsername ?? point?.sellerUsername);
    const toFid = statsInteger(point?.toFid ?? point?.buyerFid);
    const fromFid = statsInteger(point?.fromFid ?? point?.sellerFid);
    const saleDate = point?.timestamp
      ? new Date(point.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : typeof label === "string" ? label : point?.label;
    const bucketStartAt = statsString(point?.bucketStartAt);
    const bucketEndAt = statsString(point?.bucketEndAt);
    const bucketDateRange = bucketStartAt && bucketEndAt
      ? `${new Date(bucketStartAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(new Date(bucketEndAt).getTime() - 1).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : null;

    if (socialRole) {
      const formattedSaleAmount = saleAmount == null || eventType === "send"
        ? "—"
        : `${saleAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} Ξ`;
      const formattedTopSaleAmount = topSaleAmount == null || eventType === "send"
        ? "—"
        : `${topSaleAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} Ξ`;
      const eventLabel = eventType === "sale" ? "Sale" : eventType === "listing" ? "Listing" : eventType === "offer" ? "Offer" : "Send";
      const eventPlural = eventType === "sale" ? "Sales" : eventType === "listing" ? "Listings" : eventType === "offer" ? "Offers" : "Sends";
      const countChipClass = eventType === "sale"
        ? "border-[#FF3333] bg-[#250303] text-[#FF5555]"
        : eventType === "listing"
          ? "border-[#FFFF00] bg-[#252503] text-[#FFFF00]"
          : eventType === "offer"
            ? "border-[#33AAFF] bg-[#031825] text-[#33AAFF]"
            : "border-[#00FF00] bg-[#032503] text-[#00FF00]";
      const showActivity = onShowBucketActivity
        ? () => { onShowBucketActivity(eventType, bucketStartAt!, bucketEndAt!); onClose?.(); }
        : onShowBucketSales ? () => { onShowBucketSales(bucketStartAt!, bucketEndAt!); onClose?.(); } : undefined;
      const openFarcasterProfile = (fid: number | null, username: string | null) => {
        if (!fid && !username) return;
        void hapticTap();
        if (isInMiniAppContext && fid) {
          viewFarcasterProfile(fid).catch((error) => console.error("Failed to open activity profile:", error));
          return;
        }
        if (username) {
          openExternalAsset(`https://farcaster.xyz/${encodeURIComponent(username.replace(/^@/, ""))}`).catch((error) => console.error("Failed to open activity profile URL:", error));
        }
      };
      return (
        <div onClick={(event) => event.stopPropagation()} className="relative w-72 min-h-52 rounded-xl border border-[#00FF00]/55 bg-black px-4 py-3 text-[11px] shadow-[0_0_22px_rgba(0,255,0,0.2)]">
          {onClose && <button type="button" aria-label="Close activity details" onClick={(event) => { event.stopPropagation(); onClose(); }} className="absolute right-1.5 top-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[#00FF00]/35 bg-black text-[#00FF00] hover:bg-[#041204]"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>}
          <div className="pr-6 font-black">
            {eventType !== "send" && <><span className="text-[#00FF00]">{formattedSaleAmount} Average</span>{" "}</>}
            {bucketDateRange && showActivity ? <button type="button" onClick={showActivity} className="cursor-pointer text-white underline decoration-[#00FF00] underline-offset-2">{bucketDateRange}</button> : <span className="text-white">{bucketDateRange ?? saleDate}</span>}
          </div>
          <div className="mt-1 font-black">{eventType !== "send" && <span className="text-[#00FF00]">{formattedTopSaleAmount} </span>}<span className="text-white">{eventType === "send" ? "Latest Send..." : `Top ${eventLabel}...`}</span></div>
          <div className={`mt-2 grid ${eventType === "listing" ? "grid-cols-2" : "grid-cols-3"} gap-2 text-center`}>
            <div className="min-w-0">
              <span className="mb-1 block font-black text-[#8bbf8b]">Warplet</span>
              {tokenId ? (
                <>
                  <button type="button" onClick={() => onOpenToken?.(tokenId)} className="mx-auto block cursor-pointer">
                    <img src={getWarpletPreviewImageUrl(tokenId)} alt="" className="h-14 w-14 rounded-md object-cover" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenToken?.(tokenId)}
                    className="mt-1 cursor-pointer font-black text-[#00FF00] underline underline-offset-2"
                  >
                    #{tokenId}
                  </button>
                </>
              ) : <span className="text-[#8bbf8b]">—</span>}
            </div>
            {([
              { label: "From", fid: fromFid, username: fromUsername, avatarUrl: sellerAvatarUrl, wallet: sellerWallet },
              ...(eventType === "listing" ? [] : [{ label: "To", fid: toFid, username: toUsername, avatarUrl: buyerAvatarUrl, wallet: buyerWallet }]),
            ]).map((party) => (
              <div key={party.label} className="min-w-0">
                <span className="mb-1 block font-black text-[#8bbf8b]">{party.label}</span>
                {party.avatarUrl || party.wallet ? (
                  party.username ? <button type="button" onClick={() => openFarcasterProfile(party.fid, party.username)} className="mx-auto block h-14 w-14 cursor-pointer"><img src={party.avatarUrl ?? getWalletIdenticonDataUrl(party.wallet!)} alt="" className="h-14 w-14 rounded-full object-cover" /></button>
                    : <button type="button" onClick={() => party.wallet && onSearchWallet?.(party.wallet)} className="mx-auto block h-14 w-14 cursor-pointer"><img src={getWalletIdenticonDataUrl(party.wallet!)} alt="" className="h-14 w-14 rounded-full object-cover" /></button>
                ) : (
                  <span className="mx-auto block h-14 w-14 rounded-full bg-[#00FF00]" />
                )}
                {party.username ? (
                  <button
                    type="button"
                    onClick={() => openFarcasterProfile(party.fid, party.username)}
                    className="mt-1 block w-full cursor-pointer truncate text-center font-black text-[#00FF00] underline underline-offset-2"
                  >
                    @{party.username.replace(/^@/, "")}
                  </button>
                ) : party.wallet ? <button type="button" onClick={() => onSearchWallet?.(party.wallet!)} className="mt-1 block w-full cursor-pointer truncate text-[#8bbf8b] underline">{formatShortWallet(party.wallet)}</button> : <span className="mt-1 block truncate text-[#8bbf8b]">Unknown</span>}
              </div>
            ))}
          </div>
          {count != null && count > 0 && bucketStartAt && bucketEndAt && showActivity && <button type="button" onClick={showActivity} className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#00FF00]/45 bg-black px-2 py-2 font-black text-[#00FF00] hover:bg-[#041204]">Show <span className={`inline-flex min-w-6 items-center justify-center rounded-full border px-1.5 py-0.5 text-[10px] leading-none ${countChipClass}`}>{count.toLocaleString("en-US")}</span> {count === 1 ? eventLabel : eventPlural}</button>}
        </div>
      );
    }

    return (
      <div className="max-w-56 rounded-lg border border-[#00FF00]/45 bg-black px-3 py-2 text-[10px] shadow-2xl">
        <div className="font-black text-[#8bbf8b]">{typeof label === "string" ? label : point?.label}</div>
        {(payload ?? [])
          .filter((item, index) => item.value != null && (payload ?? []).findIndex((other) => other.name === item.name) === index)
          .map((item) => (
            <div key={item.name} className="mt-1 flex items-center justify-between gap-3 font-bold" style={{ color: item.color ?? "#00FF00" }}>
              <span>{item.name ?? "Value"}</span>
              <span>
                {typeof item.value === "number"
                  ? /price|volume|floor|eth|offer|^sale$/i.test(item.name ?? "")
                    ? hideEthSymbol
                      ? formatEthNumber(item.value, 8).replace(/\s*Ξ$/, "")
                      : formatEthNumber(item.value, 8)
                    : item.value.toLocaleString("en-US")
                  : String(item.value)}
              </span>
            </div>
          ))}
        {count && count > 1 && <div className="mt-1 font-black text-[#FFFF00]">Bulk purchase ×{count}</div>}
        {buyerUsername && socialRole !== "seller" && (
          <a
            href={`https://farcaster.xyz/${encodeURIComponent(buyerUsername.replace(/^@/, ""))}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block cursor-pointer font-bold text-[#00FF00] underline underline-offset-2"
          >
            Buyer @{buyerUsername.replace(/^@/, "")}
            {point?.isTopFriend ? " · Top 100 Friend" : ""}
          </a>
        )}
        {sellerUsername && socialRole !== "buyer" && (
          <a
            href={`https://farcaster.xyz/${encodeURIComponent(sellerUsername.replace(/^@/, ""))}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block cursor-pointer font-bold text-[#8bbf8b] underline underline-offset-2"
          >
            Seller @{sellerUsername.replace(/^@/, "")}
          </a>
        )}
        {!hideMarketplace && marketplace && <div className="mt-1 text-[#8bbf8b]">{marketplace}</div>}
        {tokenId && onOpenToken && (
          <button
            type="button"
            onClick={() => onOpenToken(tokenId)}
            className="mt-2 block cursor-pointer"
            aria-label={`Open Warplet #${tokenId} details`}
          >
            <img
              src={getWarpletPreviewImageUrl(tokenId)}
              alt={`Warplet #${tokenId}`}
              className="h-14 w-14 rounded-md object-cover"
            />
          </button>
        )}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {tokenId && onOpenToken && (
            <button
              type="button"
              onClick={() => onOpenToken(tokenId)}
              className="cursor-pointer font-black text-[#00FF00] underline underline-offset-2"
            >
              Warplet #{tokenId}
            </button>
          )}
          {transactionHash && (
            <a
              href={`https://basescan.org/tx/${encodeURIComponent(transactionHash)}`}
              target="_blank"
              rel="noreferrer"
              className="cursor-pointer font-black text-[#00FF00] underline underline-offset-2"
            >
              Transaction
            </a>
          )}
        </div>
      </div>
    );
  }

  function StatsChart({
    data,
    series,
    height = 210,
    socialKey,
    onOpenToken,
    hideMarketplace,
    hideEthSymbol,
    socialRole,
    onShowBucketSales,
    onShowBucketActivity,
    onSearchWallet,
    flushMargins,
    markerSeries,
    isInMiniAppContext,
    activeBucket,
    animateLinesLeftToRight,
  }: StatsChartProps) {
    const [chartAnimationId] = useState(() => {
      statsChartAnimationId += 1;
      return statsChartAnimationId;
    });
    const hasRightAxis = series.some((item) => item.axis === "right");
    let socialMarkerCount = 0;
    const effectiveMarkerSeries = markerSeries?.length
      ? markerSeries
      : socialKey ? [{ key: socialKey, event: "sale" as const, color: "#FF3333" }] : [];
    const primarySocialKey = effectiveMarkerSeries[0]?.key;
    // Scatter must retain the line's complete categorical sequence. Filtering it
    // down to avatar-bearing points makes Recharts redistribute those points over
    // the chart width, which visually detaches markers from their sale values.
    const revealIndexes = new Map<string, number>();
    data.forEach((point, index) => effectiveMarkerSeries.forEach((marker) => {
      if ((statsNumber(point[`${marker.event}Count`]) ?? 0) > 0 || (!markerSeries && point.showMarker !== false)) {
        revealIndexes.set(`${marker.event}:${index}`, socialMarkerCount++);
      }
    }));
    const markerDataSets = effectiveMarkerSeries.map((marker) => ({
      ...marker,
      data: data.map((point, index): StatsChartDatum => markerSeries ? {
        ...point,
        markerId: `${marker.event}:${index}`,
        markerRevealIndex: revealIndexes.get(`${marker.event}:${index}`) ?? Number.POSITIVE_INFINITY,
        markerColor: marker.color,
        markerChipBackground: marker.event === "sale" ? "#250303" : marker.event === "listing" ? "#252503" : marker.event === "offer" ? "#031825" : "#032503",
        eventType: marker.event,
        eventCount: point[`${marker.event}Count`] ?? 0,
        eventAveragePrice: point[marker.key] ?? null,
        topEventPrice: point[`${marker.event}TopPrice`] ?? null,
        tokenId: statsInteger(point[`${marker.event}TokenId`]),
        transactionHash: point[`${marker.event}TransactionHash`] ?? null,
        fromWallet: point[`${marker.event}FromWallet`] ?? null,
        fromFid: point[`${marker.event}FromFid`] ?? null,
        fromUsername: point[`${marker.event}FromUsername`] ?? null,
        fromAvatarUrl: point[`${marker.event}FromAvatarUrl`] ?? null,
        toWallet: point[`${marker.event}ToWallet`] ?? null,
        toFid: point[`${marker.event}ToFid`] ?? null,
        toUsername: point[`${marker.event}ToUsername`] ?? null,
        toAvatarUrl: point[`${marker.event}ToAvatarUrl`] ?? null,
        avatarUrl: statsString(point[`${marker.event}AvatarUrl`]),
        wallet: statsString(point[`${marker.event}Wallet`]),
        showMarker: (statsNumber(point[`${marker.event}Count`]) ?? 0) > 0,
        showAvatar: (statsNumber(point[`${marker.event}Count`]) ?? 0) > 0,
      } : {
        ...point,
        markerId: `sale:${index}`,
        markerRevealIndex: revealIndexes.get(`sale:${index}`) ?? Number.POSITIVE_INFINITY,
        markerColor: marker.color,
        eventType: "sale",
        eventCount: point.saleCount ?? 0,
        eventAveragePrice: point[marker.key] ?? null,
        topEventPrice: point.topSalePrice ?? null,
      }),
    }));
    const animationSignature = primarySocialKey
      ? markerDataSets.flatMap((set) => set.data.filter((point) => Number.isFinite(point.markerRevealIndex)).map((point) => `${point.markerId}:${point.timestamp ?? point.label}:${String(point[set.key] ?? "")}`)).join("|")
      : "";
    const lineDataSignature = series
      .filter((item) => item.type === "line")
      .map((item) => `${item.key}:${data.map((point) => `${point.timestamp ?? point.label}:${String(point[item.key] ?? "")}`).join(",")}`)
      .join("|");
    const [lineAnimationFinished, setLineAnimationFinished] = useState(false);
    const [visibleMarkerCount, setVisibleMarkerCount] = useState(0);
    const [selectedPoint, setSelectedPoint] = useState<StatsChartDatum | null>(null);
    const activeBucketMidpoint = activeBucket
      ? (Date.parse(activeBucket.startAt) + Date.parse(activeBucket.endAt)) / 2
      : Number.NaN;
    const activeBucketIndex = activeBucket
      ? data.findIndex((point) => {
          const pointStart = Date.parse(statsString(point.bucketStartAt) ?? "");
          const pointEnd = Date.parse(statsString(point.bucketEndAt) ?? "");
          return Number.isFinite(pointStart) && Number.isFinite(pointEnd)
            && activeBucketMidpoint >= pointStart && activeBucketMidpoint < pointEnd;
        })
      : -1;
    const activeBucketMarkerId = activeBucket && activeBucketIndex >= 0
      ? `${activeBucket.event}:${activeBucketIndex}`
      : null;
    const highlightedMarkerId = statsString(selectedPoint?.markerId) ?? activeBucketMarkerId;

    useEffect(() => {
      setLineAnimationFinished(false);
      setVisibleMarkerCount(0);
      setSelectedPoint(null);
      if (!primarySocialKey || socialMarkerCount === 0) return;
      // Fallback for browsers that fail to emit Recharts' animation-end callback.
      // The normal path below waits for the completed line and two painted frames.
      const lineGate = window.setTimeout(() => setLineAnimationFinished(true), 920);
      return () => window.clearTimeout(lineGate);
    }, [animationSignature, primarySocialKey]);

    useEffect(() => {
      if (!lineAnimationFinished || visibleMarkerCount >= socialMarkerCount) return;
      const timer = window.setTimeout(
        () => setVisibleMarkerCount((current) => Math.min(current + 1, socialMarkerCount)),
        visibleMarkerCount === 0 ? 10 : 90,
      );
      return () => window.clearTimeout(timer);
    }, [animationSignature, lineAnimationFinished, socialMarkerCount, visibleMarkerCount]);

    const axisUsesEth = (axis: "left" | "right") => series
      .filter((item) => (item.axis ?? "left") === axis)
      .some((item) => /price|volume|floor|eth|offer|sale/i.test(item.label));
    const formatAxisTick = (axis: "left" | "right", value: number) =>
      axisUsesEth(axis)
        ? Number(value).toLocaleString("en-US", { maximumFractionDigits: 6 })
        : Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
    const renderedHeight = socialKey ? Math.max(height, 260) : height;
    return (
      <div style={{ height: renderedHeight }} className="relative w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: flushMargins ? 0 : primarySocialKey ? 34 : 12, right: hasRightAxis ? 26 : 22, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgba(0,255,0,0.12)" strokeDasharray="3 5" vertical={false} />
            <XAxis
              dataKey="label"
              // Keep each observation in sequence even when several share a date
              // label. This matches the smooth Stats share chart while preserving
              // the live chart's dots, active markers, and tooltip payloads.
              allowDuplicatedCategory
              padding={primarySocialKey ? { left: 13, right: 13 } : undefined}
              tick={{ fill: "#8bbf8b", fontSize: 9 }}
              tickLine={false}
              axisLine={{ stroke: "rgba(0,255,0,0.2)" }}
              minTickGap={24}
            />
            <YAxis
              yAxisId="left"
              padding={primarySocialKey ? { bottom: 13 } : undefined}
              tick={{ fill: "#8bbf8b", fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              width={54}
              tickFormatter={(value: number) => formatAxisTick("left", value)}
            />
            {hasRightAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: "#8bcfff", fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                width={54}
                tickFormatter={(value: number) => formatAxisTick("right", value)}
              />
            )}
            <Tooltip
              active={primarySocialKey ? selectedPoint != null : undefined}
              trigger={primarySocialKey ? "click" : "hover"}
              cursor={{ stroke: "rgba(0,255,0,0.35)", strokeWidth: 1 }}
              content={
                <StatsTooltipContent
                  onOpenToken={onOpenToken}
                  hideMarketplace={hideMarketplace}
                  hideEthSymbol={hideEthSymbol}
                  socialRole={socialRole}
                  onClose={() => setSelectedPoint(null)}
                  onShowBucketSales={onShowBucketSales}
                  onShowBucketActivity={onShowBucketActivity}
                  onSearchWallet={onSearchWallet}
                  selectedPoint={selectedPoint}
                  isInMiniAppContext={isInMiniAppContext}
                />
              }
              wrapperStyle={{
                pointerEvents: "auto",
                zIndex: 20,
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
              }}
            />
            {series.map((item) => item.type === "bar" ? (
              <Bar
                key={item.key}
                dataKey={item.key}
                name={item.label}
                yAxisId={item.axis ?? "left"}
                fill={item.color}
                fillOpacity={0.58}
                radius={[3, 3, 0, 0]}
                maxBarSize={18}
              />
            ) : (
              (() => {
                const usesStrokeReveal = animateLinesLeftToRight || effectiveMarkerSeries.some((marker) => marker.key === item.key);
                return <Line
                key={`${item.key}-${chartAnimationId}-${lineDataSignature}-${animationSignature}`}
                type="monotone"
                dataKey={item.key}
                name={item.label}
                yAxisId={item.axis ?? "left"}
                stroke={item.color}
                strokeWidth={2}
                pathLength={1}
                className={usesStrokeReveal ? "stats-activity-line-animate" : undefined}
                dot={effectiveMarkerSeries.some((marker) => marker.key === item.key) ? false : { r: 2, fill: item.color, strokeWidth: 0 }}
                activeDot={effectiveMarkerSeries.some((marker) => marker.key === item.key) ? false : { r: 5, fill: item.color, stroke: "#000", strokeWidth: 2 }}
                connectNulls
                animationId={chartAnimationId}
                animationBegin={0}
                animationDuration={900}
                isAnimationActive={!usesStrokeReveal}
              />;
              })()
            ))}
            {primarySocialKey && lineAnimationFinished && visibleMarkerCount > 0 && markerDataSets.map((marker) => (
              <Scatter
                key={marker.event}
                name={series.find((item) => item.key === marker.key)?.label ?? marker.event}
                data={marker.data}
                dataKey={marker.key}
                yAxisId="left"
                fill={marker.color}
                shape={<SocialMarker revealReady={lineAnimationFinished} revealCount={visibleMarkerCount} selectedMarkerId={highlightedMarkerId} onSelectMarker={setSelectedPoint} />}
                activeShape={<SocialMarker forceActive revealReady={lineAnimationFinished} revealCount={visibleMarkerCount} selectedMarkerId={highlightedMarkerId} onSelectMarker={setSelectedPoint} />}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return { default: StatsChart };
}

const LazyStatsChart = lazy(loadStatsChart);

function statsRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function statsNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%<>\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  const record = statsRecord(value);
  if (!record) return null;
  for (const key of ["value", "eth", "amount", "count", "total", "percentage", "pct", "percent"]) {
    const parsed = statsNumber(record[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function statsInteger(value: unknown): number | null {
  const parsed = statsNumber(value);
  return parsed != null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function statsString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const record = statsRecord(value);
  if (!record) return null;
  for (const key of ["formatted", "display", "label", "value"]) {
    const text = statsString(record[key]);
    if (text) return text;
  }
  return null;
}

function statsMetric(payload: StatsApiEnvelope | null, ...keys: string[]): unknown {
  for (const key of keys) {
    if (payload?.metrics && Object.prototype.hasOwnProperty.call(payload.metrics, key)) return payload.metrics[key];
    if (payload?.summary && Object.prototype.hasOwnProperty.call(payload.summary, key)) return payload.summary[key];
    const root = payload as Record<string, unknown> | null;
    if (root && Object.prototype.hasOwnProperty.call(root, key)) return root[key];
  }
  return null;
}

function statsMetricUsd(value: unknown): number | null {
  const record = statsRecord(value);
  if (!record) return null;
  return statsNumber(record.usd ?? record.usdValue ?? record.usd_value);
}

function statsMetricSource(value: unknown): string | null {
  const record = statsRecord(value);
  if (!record) return null;
  const source = statsString(record.source);
  if (!source) return null;
  const normalized = source.toLowerCase();
  if (
    normalized.includes("opensea") ||
    normalized === "current_market"
  ) {
    return "OpenSea";
  }
  if (
    normalized.includes("observed") ||
    normalized.includes("normalized_sales") ||
    normalized.includes("activity_events") ||
    normalized === "market_state_latest"
  ) {
    return "Observed activity";
  }
  if (normalized.includes("dune") || normalized.includes("onchain")) {
    return "Onchain";
  }
  if (normalized.includes("holder_leaderboard") || normalized.includes("ownership")) {
    return "D1";
  }
  if (normalized.includes("metadata")) return "Collection";
  if (normalized === "unavailable") return "Unavailable";
  return source;
}

function statsSeries(payload: StatsApiEnvelope | null, ...keys: string[]): unknown[] {
  const series = payload?.series;
  if (Array.isArray(series)) return series;
  const record = statsRecord(series);
  if (!record) return [];
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function statsRows(payload: StatsApiEnvelope | null, ...keys: string[]): unknown[] {
  const nested = statsSeries(payload, ...keys);
  if (nested.length > 0) return nested;
  const root = payload as Record<string, unknown> | null;
  if (!root) return [];
  for (const key of keys) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  return [];
}

function statsDateLabel(value: unknown): string {
  const record = statsRecord(value);
  const raw = statsString(
    record?.label ??
    record?.date ??
    record?.day ??
    record?.bucket ??
    record?.timestamp ??
    record?.at,
  );
  if (!raw) return "-";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function normalizeStatsChartData(
  rows: unknown[],
  aliases: Record<string, string[]>,
): StatsChartDatum[] {
  return rows.map((value, index) => {
    const row = statsRecord(value) ?? {};
    const buyerProfile = statsRecord(row.buyerProfile ?? row.buyer_profile);
    const sellerProfile = statsRecord(row.sellerProfile ?? row.seller_profile);
    const point: StatsChartDatum = {
      label: statsDateLabel(row),
      timestamp: statsString(row.timestamp ?? row.at ?? row.date) ?? undefined,
      avatarUrl: statsString(row.avatarUrl ?? row.pfpUrl ?? row.pfp_url ?? buyerProfile?.pfpUrl ?? buyerProfile?.pfp_url),
      isTopFriend: row.isTopFriend === true || row.is_top_friend === true,
      isViewer: row.isViewer === true || row.is_viewer === true,
      tokenId: statsInteger(row.tokenId ?? row.token_id),
      wallet: statsString(row.wallet ?? row.buyerWallet ?? row.buyer_wallet),
      fid: statsInteger(row.fid ?? row.buyerFid ?? row.buyer_fid ?? buyerProfile?.fid),
      buyerUsername: statsString(row.buyerUsername ?? row.buyer_username ?? buyerProfile?.username),
      sellerUsername: statsString(row.sellerUsername ?? row.seller_username ?? sellerProfile?.username),
      buyerAvatarUrl: statsString(row.buyerAvatarUrl ?? row.buyer_avatar_url ?? buyerProfile?.pfpUrl ?? buyerProfile?.pfp_url),
      sellerAvatarUrl: statsString(row.sellerAvatarUrl ?? row.seller_avatar_url ?? sellerProfile?.pfpUrl ?? sellerProfile?.pfp_url),
      buyerFid: statsInteger(row.buyerFid ?? row.buyer_fid ?? buyerProfile?.fid),
      sellerFid: statsInteger(row.sellerFid ?? row.seller_fid ?? sellerProfile?.fid),
      transactionHash: statsString(row.transactionHash ?? row.transaction_hash ?? row.txHash ?? row.tx_hash),
      marketplace: statsString(row.marketplace ?? row.market),
      saleCount: statsInteger(row.count ?? row.saleCount ?? row.sale_count),
    };
    for (const [target, sourceKeys] of Object.entries(aliases)) {
      const sourceValue = sourceKeys.map((key) => row[key]).find((item) => item != null);
      point[target] = statsNumber(sourceValue);
    }
    if (point.label === "-") point.label = String(index + 1);
    return point;
  });
}

function statsMovingAverage(
  data: StatsChartDatum[],
  sourceKey: string,
  targetKey: string,
  windowSize = 3,
): StatsChartDatum[] {
  return data.map((point, index) => {
    const values = data
      .slice(Math.max(0, index - windowSize + 1), index + 1)
      .map((row) => statsNumber(row[sourceKey]))
      .filter((value): value is number => value != null);
    return {
      ...point,
      [targetKey]: values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null,
    };
  });
}

function statsStartEndChange(data: StatsChartDatum[], key: string): number | null {
  const values = data
    .map((point) => statsNumber(point[key]))
    .filter((value): value is number => value != null);
  const first = values[0];
  const last = values.at(-1);
  return first != null && last != null && first !== 0 ? ((last - first) / first) * 100 : null;
}

function statsHalfPeriodChange(data: StatsChartDatum[], key: string): number | null {
  const values = data.map((point) => statsNumber(point[key]) ?? 0);
  if (values.length < 2) return null;
  const midpoint = Math.ceil(values.length / 2);
  const first = values.slice(0, midpoint).reduce((sum, value) => sum + value, 0);
  const second = values.slice(midpoint).reduce((sum, value) => sum + value, 0);
  return first > 0 ? ((second - first) / first) * 100 : null;
}

function applySocialAvatarMarkerLimit(data: StatsChartDatum[]): StatsChartDatum[] {
  const knownAvatarIndexes = data
    .map((point, index) => point.avatarUrl ? index : -1)
    .filter((index) => index >= 0);
  const preferred = [...knownAvatarIndexes].sort((left, right) => {
    const leftPoint = data[left];
    const rightPoint = data[right];
    const priority = (point: StatsChartDatum) => point.isViewer ? 0 : point.isTopFriend ? 1 : 2;
    return priority(leftPoint) - priority(rightPoint) || right - left;
  });
  const visible = new Set(preferred.slice(0, 24));
  return data.map((point, index) => ({
    ...point,
    showAvatar: Boolean(point.avatarUrl && visible.has(index)),
    showMarker: Boolean(point.avatarUrl && visible.has(index)),
  }));
}

function formatStatsInteger(value: unknown): string {
  const number = statsNumber(value);
  return number == null ? "-" : Math.round(number).toLocaleString("en-US");
}

function formatStatsPercent(value: unknown, maxDigits = 1): string {
  const number = statsNumber(value);
  if (number == null) return "-";
  return `${number.toLocaleString("en-US", { maximumFractionDigits: maxDigits })}%`;
}

function formatStatsEth(value: unknown, symbol = "ETH", maxFractionDigits = 8): string {
  const number = statsNumber(value);
  if (number == null) return "-";
  return `${formatEthNumber(number, maxFractionDigits).replace(/\s*\u039e$/, "")} ${symbol}`;
}

function formatStatsUsd(value: unknown, ethUsdPrice: number | null): string | null {
  const explicit = statsMetricUsd(value);
  const amount = statsNumber(value);
  const usd = explicit ?? (amount != null && ethUsdPrice != null ? amount * ethUsdPrice : null);
  if (usd == null) return null;
  return usd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function StatsChartFallback() {
  return (
    <div className="flex h-[210px] items-center justify-center text-xs font-bold text-[#8bbf8b]">
      Loading chart...
    </div>
  );
}

class StatsChartErrorBoundary extends Component<
  { children: ReactNode; onRetry?: () => void },
  { failed: boolean; retryKey: number }
> {
  state = { failed: false, retryKey: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-[210px] flex-col items-center justify-center gap-2 px-4 text-center">
          <Text className="text-xs font-bold text-[#8bbf8b]">Chart temporarily unavailable.</Text>
          <button
            type="button"
            onClick={() => this.setState((current) => ({
              failed: false,
              retryKey: current.retryKey + 1,
            }), this.props.onRetry)}
            className="cursor-pointer text-xs font-black text-[#00FF00] underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      );
    }

    return <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>;
  }
}

function StatsChartPanel({
  id,
  title,
  description,
  headline,
  changePercent,
  data,
  series,
  socialKey,
  onOpenToken,
  hideMarketplace,
  hideEthSymbol,
  socialRole,
  animationKey,
  onShowBucketSales,
  onSearchWallet,
  onShare,
  animateLinesLeftToRight,
}: {
  id?: string;
  title: string;
  description?: string;
  headline?: string;
  changePercent?: number | null;
  data: StatsChartDatum[];
  series: StatsChartSeries[];
  socialKey?: string;
  onOpenToken?: (tokenId: number) => void;
  hideMarketplace?: boolean;
  hideEthSymbol?: boolean;
  socialRole?: "buyer" | "seller";
  animationKey?: string;
  onShowBucketSales?: (startAt: string, endAt: string) => void;
  onSearchWallet?: (wallet: string) => void;
  onShare?: () => void;
  animateLinesLeftToRight?: boolean;
}) {
  return (
    <section id={id} className="scroll-mt-4 overflow-hidden rounded-xl border border-[#00FF00]/25 bg-black/65">
      <div className="border-b border-[#00FF00]/15 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <span>
            <Text className="text-xs font-black uppercase text-[#00FF00]">{title}</Text>
            {headline && <span className="mt-1 block text-2xl font-black text-white">{headline}</span>}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-2">
            {onShare && <StatsShareButton label="Share" onClick={onShare} compact flat showIcon={false} />}
            {changePercent != null && Number.isFinite(changePercent) && (
              <span className={`text-xs font-black ${changePercent > 0 ? "text-[#00FF00]" : changePercent < 0 ? "text-[#FF5555]" : "text-[#8bbf8b]"}`}>
                {changePercent > 0 ? "+" : ""}{changePercent.toFixed(1)}%
              </span>
            )}
          </span>
        </div>
        {description && <Text className="mt-1 text-[10px] leading-4 text-[#8bbf8b]">{description}</Text>}
      </div>
      {data.length > 0 ? (
        <StatsChartErrorBoundary>
          <Suspense fallback={<StatsChartFallback />}>
            <LazyStatsChart
              key={animationKey}
              data={data}
              series={series}
              socialKey={socialKey}
              onOpenToken={onOpenToken}
              hideMarketplace={hideMarketplace}
              hideEthSymbol={hideEthSymbol}
              socialRole={socialRole}
              onShowBucketSales={onShowBucketSales}
              onSearchWallet={onSearchWallet}
              animateLinesLeftToRight={animateLinesLeftToRight}
            />
          </Suspense>
        </StatsChartErrorBoundary>
      ) : (
        <div className="flex h-36 items-center justify-center px-4 text-center text-xs font-bold text-[#8bbf8b]">
          No activity is available for this period.
        </div>
      )}
    </section>
  );
}

function StatsShareButton({ label, onClick, compact = false, flat = false, secondaryFlat = false, secondaryTone = "green", primary = false, primaryTone = "green", showIcon = true, disabled = false }: { label: string; onClick: () => void; compact?: boolean; flat?: boolean; secondaryFlat?: boolean; secondaryTone?: "green" | "purple"; primary?: boolean; primaryTone?: "green" | "purple"; showIcon?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { void hapticPrimaryTap(); onClick(); }}
      className={primary
        ? `inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[20px] border px-4 py-3 text-sm font-black transition-all duration-100 active:translate-x-[1px] active:translate-y-[3px] disabled:cursor-not-allowed disabled:opacity-40 ${primaryTone === "purple"
          ? "border-[#5d42d6] bg-[#7959ff] text-[#eeeaff] shadow-[3px_6px_0_#4b33b3] hover:bg-[#967fff] active:shadow-[1px_3px_0_#4b33b3]"
          : "border-[#009900] bg-[#00FF00] text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] hover:bg-[#33ff33] active:shadow-[1px_3px_0_#008000]"}`
        : secondaryFlat
          ? `inline-flex h-7 cursor-pointer items-center justify-center rounded-lg border px-2.5 text-[10px] font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${secondaryTone === "purple"
            ? "border-[#7959ff]/65 bg-[#160b38] text-[#b9aaff] hover:border-[#7959ff] hover:bg-[#21104f]"
            : "border-[#00FF00]/55 bg-[#041204] text-[#00FF00] hover:border-[#00FF00] hover:bg-[#071807]"}`
        : flat
          ? "inline-flex h-7 cursor-pointer items-center justify-center rounded-lg border border-[#00FF00]/55 bg-[#00FF00] px-2.5 text-[10px] font-black text-[rgb(0,80,0)] transition hover:bg-[#33ff33] disabled:cursor-not-allowed disabled:opacity-40"
        : `inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#00FF00]/45 bg-[#00FF00]/10 font-black text-[#00FF00] transition hover:border-[#00FF00] hover:bg-[#00FF00]/15 disabled:cursor-not-allowed disabled:opacity-40 ${compact ? "px-2 py-1 text-[9px]" : "px-3 py-2 text-[10px]"}`}
    >
      {!primary && showIcon && (
        <svg viewBox="0 0 24 24" className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
        </svg>
      )}
      {label}
    </button>
  );
}

function StatsMetricCard({
  label,
  value,
  tooltip,
  sublabel,
  source,
  tone = "green",
}: {
  label: string;
  value: string;
  tooltip?: string | null;
  sublabel?: string | null;
  source?: string | null;
  tone?: "green" | "blue" | "yellow" | "purple";
}) {
  const toneClasses = tone === "blue"
    ? "border-[#33AAFF]/35 bg-[rgba(51,170,255,0.08)] text-[#33AAFF]"
    : tone === "yellow"
      ? "border-[#FFFF00]/35 bg-[rgba(255,255,0,0.07)] text-[#FFFF00]"
      : tone === "purple"
        ? "border-[#7959ff]/55 bg-[rgba(93,66,214,0.16)] text-[#7959ff]"
      : "border-[#00FF00]/30 bg-[rgba(0,255,0,0.07)] text-[#00FF00]";
  const labelClass = tone === "blue"
    ? "text-[#8bcfff]"
    : tone === "yellow"
      ? "text-[#d6d682]"
      : tone === "purple"
        ? "text-[#a995ff]"
        : "text-[#8bbf8b]";

  return (
    <div className={`min-w-0 rounded-xl border p-3 ${toneClasses}`}>
      <Text className={`text-[10px] font-black uppercase ${labelClass}`}>{label}</Text>
      <div className="mt-1 min-w-0 text-xl font-black leading-tight">
        {tooltip ? (
          <InlineHoverTooltip value={value} tooltip={tooltip} className="max-w-full truncate" tone={tone} />
        ) : (
          <span className="block truncate">{value}</span>
        )}
      </div>
      {(sublabel || source) && (
        <Text className={`mt-1 truncate text-[9px] font-bold ${labelClass}`}>
          {[sublabel, source].filter(Boolean).join(" · ")}
        </Text>
      )}
    </div>
  );
}

type StatsDuneIntegrationDisplay = {
  label: string;
  title: string;
  toneClass: string;
  tooltipTone: "green" | "yellow" | "red" | "muted";
};

function getStatsDuneIntegrationDisplay(payload: StatsApiEnvelope | null): StatsDuneIntegrationDisplay | null {
  const integrations = statsRecord(payload?.integrations);
  if (!integrations || !Object.prototype.hasOwnProperty.call(integrations, "dune")) return null;

  const dune = statsRecord(integrations.dune);
  const rawStatus = statsString(dune?.status)?.toLowerCase().replace(/\s+/g, "_")
    ?? (dune?.configured === false ? "disabled" : "unavailable");
  const statusLabels: Record<string, string> = {
    live: "Live",
    stale: "Stale",
    pending: "Pending",
    disabled: "Disabled",
    unavailable: "Unavailable",
    budget_paused: "Budget paused",
  };
  const label = statusLabels[rawStatus] ?? rawStatus
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
  const toneClass = rawStatus === "live"
    ? "border-[#00FF00]/45 bg-[rgba(0,255,0,0.08)] text-[#00FF00]"
    : rawStatus === "stale" || rawStatus === "pending" || rawStatus === "budget_paused"
      ? "border-[#FFFF00]/45 bg-[rgba(255,255,0,0.08)] text-[#FFFF00]"
      : rawStatus === "unavailable"
        ? "border-[#FF7777]/45 bg-[rgba(255,85,85,0.08)] text-[#FF9999]"
        : "border-[#8bbf8b]/30 bg-[rgba(139,191,139,0.06)] text-[#8bbf8b]";
  const tooltipTone: StatsDuneIntegrationDisplay["tooltipTone"] = rawStatus === "live"
    ? "green"
    : rawStatus === "stale" || rawStatus === "pending" || rawStatus === "budget_paused"
      ? "yellow"
      : rawStatus === "unavailable"
        ? "red"
        : "muted";
  const details = [`Dune onchain data: ${label || "Unavailable"}`];
  const asOf = statsString(dune?.asOf);
  const coverageStart = statsString(dune?.coverageStart);
  const coverageEnd = statsString(dune?.coverageEnd);
  const lastError = statsString(dune?.lastError);
  const creditsThisMonth = statsInteger(dune?.creditsThisMonth);
  if (asOf) details.push(`updated ${formatMarketTimestamp(asOf)}`);
  if (coverageStart) {
    details.push(`coverage ${new Date(coverageStart).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${coverageEnd ? ` to ${new Date(coverageEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}`);
  }
  if (creditsThisMonth != null) {
    details.push(`${creditsThisMonth.toLocaleString("en-US")} credits this billing period`);
  }
  if (lastError) details.push(lastError);

  return {
    label: label || "Unavailable",
    title: details.join(". "),
    toneClass,
    tooltipTone,
  };
}

function StatsFreshness({
  payload,
  refreshing,
  onRefresh,
}: {
  payload: StatsApiEnvelope | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const asOf = payload?.asOf ?? payload?.generatedAt;
  const dune = getStatsDuneIntegrationDisplay(payload);
  return (
    <div className="mt-4 text-center text-[10px] leading-4 text-[#8bbf8b]">
      <div>
        Last updated: {asOf ? formatMarketTimestamp(asOf) : "Not yet"}
        {". "}
        <button
          type="button"
          disabled={refreshing}
          onClick={onRefresh}
          className="cursor-pointer font-black text-[#00FF00] underline-offset-2 hover:underline disabled:cursor-wait disabled:opacity-60"
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {dune && (
        <span className="sr-only" data-onchain-status={dune.label} data-onchain-details={dune.title}>
          Onchain data status: {dune.label}
        </span>
      )}
    </div>
  );
}

type StatsHolderRow = {
  rank: number | null;
  wallet: string;
  fid: number | null;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  ownedCount: number;
  ownedPct: number;
  bestRarityRank: number | null;
  previewTokenIds: number[];
  remainingCount: number;
  floorValueEth: number | null;
  averageHoldingDays: number | null;
  oldestCurrentHoldingAt: string | null;
  acquiredSinceEpoch: number | null;
  disposedSinceEpoch: number | null;
  isViewer: boolean;
  isTopFriend: boolean;
};

const STATS_HOLDER_INITIAL_RENDER_ROWS = 20;
const STATS_HOLDER_RENDER_BATCH = 20;

function parseStatsTokenIds(value: unknown): number[] {
  let values: unknown[] = [];
  if (Array.isArray(value)) {
    values = value;
  } else if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) values = parsed;
    } catch {
      values = value.split(",");
    }
  }
  return values
    .map((item) => statsInteger(item))
    .filter((item): item is number => item != null && item >= 1 && item <= 10000)
    .slice(0, 5);
}

function normalizeStatsHolderRow(value: unknown): StatsHolderRow | null {
  const row = statsRecord(value);
  const profile = statsRecord(row?.profile);
  const wallet = statsString(row?.wallet ?? row?.ownerWallet ?? row?.owner_wallet);
  if (!row || !wallet) return null;
  const ownedCount = statsInteger(row.ownedCount ?? row.owned_count ?? row.count) ?? 0;
  const previews = parseStatsTokenIds(
    row.previewTokenIds ??
    row.preview_token_ids ??
    row.previewTokenIdsJson ??
    row.preview_token_ids_json,
  );
  return {
    rank: statsInteger(row.rank ?? row.position),
    wallet: wallet.toLowerCase(),
    fid: statsInteger(row.fid ?? profile?.fid),
    username: statsString(row.username ?? profile?.username),
    displayName: statsString(row.displayName ?? row.display_name ?? profile?.displayName ?? profile?.display_name),
    pfpUrl: statsString(row.pfpUrl ?? row.pfp_url ?? profile?.pfpUrl ?? profile?.pfp_url),
    ownedCount,
    ownedPct: statsNumber(row.ownedPct ?? row.owned_pct ?? row.supplyPercentage ?? row.supply_percentage ?? row.supplyPct ?? row.supply_pct) ?? ownedCount / 100,
    bestRarityRank: statsInteger(row.bestRarityRank ?? row.best_rarity_rank),
    previewTokenIds: previews,
    remainingCount: statsInteger(row.remainingCount ?? row.remaining_count ?? row.remainingPreviewCount ?? row.remaining_preview_count) ?? Math.max(0, ownedCount - previews.length),
    floorValueEth: statsNumber(row.floorValueEth ?? row.floor_value_eth ?? row.floorValue ?? row.floor_value),
    averageHoldingDays: statsNumber(row.averageHoldingDays ?? row.average_holding_days ?? row.averageCurrentHoldingDays ?? row.average_current_holding_days),
    oldestCurrentHoldingAt: statsString(row.oldestCurrentHoldingAt ?? row.oldest_current_holding_at),
    acquiredSinceEpoch: statsInteger(row.acquiredSinceEpoch ?? row.acquired_since_epoch),
    disposedSinceEpoch: statsInteger(row.disposedSinceEpoch ?? row.disposed_since_epoch),
    isViewer: row.isViewer === true || row.is_viewer === true,
    isTopFriend: row.isTopFriend === true || row.is_top_friend === true,
  };
}

function getWalletIdenticonDataUrl(wallet: string): string {
  const normalized = wallet.toLowerCase();
  const hash = Array.from(normalized).reduce((total, character) => ((total << 5) - total + character.charCodeAt(0)) | 0, 0);
  const hue = Math.abs(hash) % 360;
  const cells: string[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const sourceColumn = column > 2 ? 4 - column : column;
      const active = ((hash >>> ((row * 3 + sourceColumn) % 28)) & 1) === 1;
      if (active) cells.push(`<rect x="${column}" y="${row}" width="1" height="1"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5"><rect width="5" height="5" fill="hsl(${hue} 45% 10%)"/><g fill="hsl(${hue} 85% 55%)">${cells.join("")}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function WalletIdenticon({ wallet, className = "" }: { wallet: string; className?: string }) {
  const hash = Array.from(wallet.toLowerCase()).reduce((total, character) => {
    return ((total << 5) - total + character.charCodeAt(0)) | 0;
  }, 0);
  const hue = Math.abs(hash) % 360;
  const cells: boolean[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      cells.push(((hash >>> ((row * 3 + column) % 28)) & 1) === 1);
    }
  }
  const mirroredCells = Array.from({ length: 25 }, (_, index) => {
    const row = Math.floor(index / 5);
    const column = index % 5;
    const sourceColumn = column > 2 ? 4 - column : column;
    return cells[row * 3 + sourceColumn];
  });

  return (
    <span
      aria-hidden="true"
      className={`grid grid-cols-5 overflow-hidden bg-black ${className}`}
      style={{ backgroundColor: `hsl(${hue} 45% 10%)` }}
    >
      {mirroredCells.map((active, index) => (
        <span
          key={index}
          style={{ backgroundColor: active ? `hsl(${hue} 85% 55%)` : "transparent" }}
        />
      ))}
    </span>
  );
}

function StatsHolderAvatar({ row }: { row: StatsHolderRow }) {
  const [failedPfpUrl, setFailedPfpUrl] = useState<string | null>(null);
  const ringClass = row.isViewer
    ? "border-[#FFFF00] shadow-[0_0_8px_rgba(255,255,0,0.75)]"
    : row.isTopFriend
      ? "border-[#7959ff] ring-2 ring-[#b9aaff] shadow-[0_0_9px_rgba(121,89,255,0.9)]"
      : "border-[#00FF00]/55";
  return row.pfpUrl && failedPfpUrl !== row.pfpUrl ? (
    <img
      src={row.pfpUrl}
      alt=""
      className={`h-10 w-10 shrink-0 rounded-full border-2 object-cover ${ringClass}`}
      loading="lazy"
      onError={() => setFailedPfpUrl(row.pfpUrl)}
    />
  ) : (
    <WalletIdenticon wallet={row.wallet} className={`h-10 w-10 shrink-0 rounded-full border-2 ${ringClass}`} />
  );
}

function StatsHolderRowView({
  row,
  pinned = false,
  ethUsdPrice,
  onSearchWallet,
  onOpenWarpletDetails,
}: {
  row: StatsHolderRow;
  pinned?: boolean;
  ethUsdPrice: number | null;
  onSearchWallet: (wallet: string) => void;
  onOpenWarpletDetails: (tokenId: number) => void;
}) {
  const highlightViewer = pinned || row.isViewer;
  const identity = row.username
    ? `@${row.username.replace(/^@/, "")}`
    : row.displayName || formatShortWallet(row.wallet);
  return (
    <article
      style={{ contentVisibility: "auto", containIntrinsicSize: "116px" }}
      tabIndex={0}
      role="button"
      aria-label={`Search Warplets owned by ${identity}`}
      onClick={() => onSearchWallet(row.wallet)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSearchWallet(row.wallet);
        }
      }}
      className={`group relative mb-2 w-full cursor-pointer rounded-xl border px-3 py-3 outline-none transition focus:ring-1 hover:-translate-y-px hover:border-2 ${
        highlightViewer
          ? "border-[#FFFF00]/35 bg-[rgba(255,255,0,0.055)] hover:border-[#FFFF00] hover:bg-[rgba(255,255,0,0.075)] hover:shadow-[0_0_16px_rgba(255,255,0,0.55)] focus:ring-[#FFFF00]"
          : row.isTopFriend
            ? "border-[#7959ff]/45 bg-[rgba(93,66,214,0.12)] hover:border-[#7959ff] hover:bg-[rgba(93,66,214,0.18)] hover:shadow-[0_0_16px_rgba(121,89,255,0.55)] focus:ring-[#7959ff]"
          : "border-[#00FF00]/25 bg-[#041204]/90 hover:border-[#00FF00] hover:bg-[#071807]/95 hover:shadow-[0_0_16px_rgba(0,255,0,0.55)] focus:ring-[#00FF00]"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className={`min-w-11 shrink-0 rounded-full border px-2 py-1 text-center text-xs font-black ${
          highlightViewer
            ? "border-[#FFFF00] bg-[rgba(255,255,0,0.12)] text-[#FFFF00]"
            : row.isTopFriend
              ? "border-[#7959ff] bg-[rgba(121,89,255,0.16)] text-[#b9aaff]"
            : "border-[#00FF00] bg-[rgba(0,255,0,0.1)] text-[#00FF00]"
        }`}>
          {row.rank ? `#${row.rank.toLocaleString("en-US")}` : "—"}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSearchWallet(row.wallet);
          }}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          aria-label={`Search Warplets owned by ${identity}`}
        >
          <StatsHolderAvatar row={row} />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={`truncate text-xs font-black ${
                highlightViewer ? "text-[#FFFF00]" : row.isTopFriend ? "text-[#b9aaff]" : "text-[#00FF00]"
              }`}>{identity}</span>
              {highlightViewer && <span className="rounded bg-[#FFFF00] px-1 py-0.5 text-[8px] font-black text-black">YOU</span>}
              {row.isTopFriend && !highlightViewer && <span title="Neynar-ranked Top 100 Friend" className="rounded border border-[#7959ff]/70 bg-[rgba(121,89,255,0.15)] px-1 py-0.5 text-[8px] font-black text-[#b9aaff]">FRIEND</span>}
            </span>
            {row.username && row.displayName && (
              <span className="mt-0.5 block truncate text-[9px] text-[#8bbf8b]">{row.displayName}</span>
            )}
          </span>
        </button>
        <span className="shrink-0 text-right">
          <span className="block text-base font-black text-[#00FF00]">{row.ownedCount.toLocaleString("en-US")}</span>
          <span className="block text-[9px] font-bold text-[#8bbf8b]">{formatStatsPercent(row.ownedPct, 2)}</span>
        </span>
      </div>
      <div className="mt-2 grid grid-cols-[44px_minmax(0,1fr)_auto] items-end gap-2">
        <span className="text-[9px] font-bold uppercase text-[#8bbf8b]">
          {row.bestRarityRank ? <>Best <strong className="block text-[#00FF00]">#{row.bestRarityRank.toLocaleString("en-US")}</strong></> : "Best —"}
        </span>
        <div className="flex min-w-0 gap-1">
          {row.previewTokenIds.map((tokenId) => (
            <button
              key={tokenId}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenWarpletDetails(tokenId);
              }}
              className="aspect-square min-w-0 max-w-10 flex-1 cursor-pointer overflow-hidden rounded-[3px] outline-none ring-[#00FF00] focus:ring-2"
              aria-label={`Open Warplet #${tokenId} details`}
            >
              <img
                src={getWarpletPreviewImageUrl(tokenId)}
                alt={`Warplet #${tokenId}`}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </button>
          ))}
          {row.remainingCount > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSearchWallet(row.wallet);
              }}
              className="flex aspect-square max-w-10 flex-1 cursor-pointer items-center justify-center rounded-[3px] bg-[#041204] text-[9px] font-black text-[#00FF00] outline-none ring-[#00FF00] focus:ring-2"
              aria-label={`View ${row.remainingCount} more Warplets`}
            >
              +{row.remainingCount}
            </button>
          )}
        </div>
        <span className="text-right">
          <span className="block text-[8px] font-bold uppercase text-[#8bbf8b]">Floor value</span>
          {row.floorValueEth == null ? (
            <span className="block text-[10px] font-black text-[#33AAFF]">—</span>
          ) : (
            <span onClick={(event) => event.stopPropagation()}>
              <InlineHoverTooltip
                value={`${formatEthNumber(row.floorValueEth, 6).replace(/\s*\u039e$/, "")} ETH`}
                tooltip={
                  ethUsdPrice == null
                    ? "USD value unavailable"
                    : (row.floorValueEth * ethUsdPrice).toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                }
                className="text-[10px] font-black text-[#33AAFF]"
                tone="blue"
              />
            </span>
          )}
        </span>
      </div>
    </article>
  );
}

function StatsHoldersPage({
  connectedWallet,
  friendFilterWallet,
  viewerFid,
  actionSessionToken,
  ethUsdPrice,
  onSearchWallet,
  onOpenWarpletDetails,
  onShareStats,
  onResetFriendFilter,
  initialFriendsOnly = false,
}: {
  connectedWallet: string | null;
  friendFilterWallet: string | null;
  viewerFid: number | null;
  actionSessionToken: string | null;
  ethUsdPrice: number | null;
  onSearchWallet: (wallet: string) => void;
  onOpenWarpletDetails: (tokenId: number) => void;
  onShareStats: (request: StatsShareRequest) => void;
  onResetFriendFilter: () => void;
  initialFriendsOnly?: boolean;
}) {
  const [payload, setPayload] = useState<StatsApiEnvelope | null>(null);
  const [rows, setRows] = useState<StatsHolderRow[]>([]);
  const [viewerRow, setViewerRow] = useState<StatsHolderRow | null>(null);
  const [viewerTotal, setViewerTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [renderedRowCount, setRenderedRowCount] = useState(STATS_HOLDER_INITIAL_RENDER_ROWS);
  const [topFriendFids, setTopFriendFids] = useState<Set<number>>(new Set());
  const [friendRows, setFriendRows] = useState<StatsHolderRow[]>([]);
  const [friendFilterFid, setFriendFilterFid] = useState<number | null>(null);
  const [friendsOnly, setFriendsOnly] = useState(initialFriendsOnly);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const loadViewer = useCallback(async (signal?: AbortSignal, refresh = false) => {
    if (!connectedWallet && !viewerFid) {
      setViewerRow(null);
      setViewerTotal(null);
      return;
    }
    const params = new URLSearchParams();
    if (connectedWallet) params.set("wallet", connectedWallet);
    if (viewerFid) params.set("fid", String(viewerFid));
    try {
      const query = params.toString();
      const result = await fetchCachedStatsHolderViewer({
        cacheKey: `stats:holders:viewer:${query}`,
        url: `/api/stats/holders/me?${query}`,
        force: refresh,
      });
      if (signal?.aborted) return;
      if (!result) {
        setViewerRow(null);
        return;
      }
      setViewerRow(normalizeStatsHolderRow(result.row ?? result.holder));
      setViewerTotal(statsInteger(result.totalHolders ?? result.total_holders));
    } catch (loadError) {
      if (signal?.aborted) return;
      console.warn("Stats viewer rank load failed:", loadError);
    }
  }, [connectedWallet, viewerFid]);

  const loadPage = useCallback(async ({
    cursor = null,
    append = false,
    refresh = false,
    signal,
  }: {
    cursor?: string | null;
    append?: boolean;
    refresh?: boolean;
    signal?: AbortSignal;
  } = {}) => {
    if (append) setLoadingMore(true);
    else if (refresh) setRefreshing(true);
    else {
      setLoading(true);
      setFriendFilterFid(null);
    }
    setError("");
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (cursor) params.set("cursor", cursor);
      if (refresh) params.set("refresh", "1");
      if (friendFilterWallet) params.set("friendsWallet", friendFilterWallet);
      const filterCacheKey = friendFilterWallet ? `friends:${friendFilterWallet}` : "all";
      const result = await fetchCachedStatsEnvelope({
        cacheKey: `stats:holders:${filterCacheKey}:${cursor ?? "first"}:100`,
        url: `/api/stats/holders?${params.toString()}`,
        force: refresh,
      });
      if (signal?.aborted) return;
      const nextRows = (Array.isArray(result.rows) ? result.rows : [])
        .map(normalizeStatsHolderRow)
        .filter((row): row is StatsHolderRow => Boolean(row));
      if (!append) setRenderedRowCount(STATS_HOLDER_INITIAL_RENDER_ROWS);
      setPayload(result);
      const friendFilter = statsRecord(result.friendFilter);
      setFriendFilterFid(statsInteger(friendFilter?.fid));
      setRows((current) => {
        const combined = append ? [...current, ...nextRows] : nextRows;
        const seen = new Set<string>();
        return combined.filter((row) => {
          if (seen.has(row.wallet)) return false;
          seen.add(row.wallet);
          return true;
        });
      });
      setNextCursor(typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : null);
    } catch (loadError) {
      if (signal?.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load holders");
    } finally {
      if (!signal?.aborted) {
        if (append) setLoadingMore(false);
        else if (refresh) setRefreshing(false);
        else setLoading(false);
      }
    }
  }, [friendFilterWallet]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      loadPage({ signal: controller.signal }),
      loadViewer(controller.signal),
    ]);
    return () => controller.abort();
  }, [loadPage, loadViewer]);

  useEffect(() => {
    if (friendFilterWallet || !viewerFid || !actionSessionToken) {
      setTopFriendFids(new Set());
      setFriendRows([]);
      setFriendsOnly(false);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      range: "30d",
      fid: String(viewerFid),
      holders: "1",
    });
    fetch(`/api/stats/social/highlights?${params.toString()}`, {
      headers: { accept: "application/json", authorization: `Bearer ${actionSessionToken}` },
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        setTopFriendFids(getStatsHighlightFids(result));
        const root = statsRecord(result);
        const holders = Array.isArray(root?.friendHolders) ? root.friendHolders : [];
        setFriendRows(
          holders
            .map(normalizeStatsHolderRow)
            .filter((row): row is StatsHolderRow => Boolean(row))
            .map((row) => ({ ...row, isTopFriend: true }))
            .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER)),
        );
      })
      .catch((highlightError) => {
        if (!(highlightError instanceof DOMException && highlightError.name === "AbortError")) {
          console.warn("Holder friend highlights failed:", highlightError);
        }
      });
    return () => controller.abort();
  }, [actionSessionToken, friendFilterWallet, viewerFid]);

  useEffect(() => {
    if (friendFilterWallet) {
      setFriendsOnly(false);
      return;
    }
    if (initialFriendsOnly && viewerFid && actionSessionToken) setFriendsOnly(true);
  }, [actionSessionToken, friendFilterWallet, initialFriendsOnly, viewerFid]);

  const effectiveFriendsOnly = !friendFilterWallet && friendsOnly;

  useEffect(() => {
    const target = loadMoreRef.current;
    const rankedRowCount = rows.length;
    const filteredRowCount = effectiveFriendsOnly ? friendRows.length : rankedRowCount;
    const hasBufferedRows = renderedRowCount < filteredRowCount;
    if (
      !target ||
      loadingMore ||
      (!hasBufferedRows && (effectiveFriendsOnly || !nextCursor))
    ) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        if (hasBufferedRows) {
          setRenderedRowCount((current) =>
            Math.min(current + STATS_HOLDER_RENDER_BATCH, filteredRowCount));
        } else if (!effectiveFriendsOnly && nextCursor) {
          void loadPage({ cursor: nextCursor, append: true });
        }
      }
    }, { rootMargin: "600px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [effectiveFriendsOnly, friendRows.length, loadPage, loadingMore, nextCursor, renderedRowCount, rows]);

  const summary = payload?.summary;
  const holderCount = statsInteger(summary?.holderCount ?? summary?.uniqueOwners ?? summary?.totalHolders) ?? viewerTotal;
  const rankedRows = effectiveFriendsOnly ? friendRows : rows;
  const visibleRows = rankedRows.slice(0, renderedRowCount);
  const hasBufferedRows = visibleRows.length < rankedRows.length;

  const refresh = () => {
    void Promise.all([
      loadPage({ refresh: true }),
      loadViewer(undefined, true),
    ]);
  };

  return (
    <div>
      <div>
        {(connectedWallet || viewerFid) && (
          <div className="mb-3">
            {viewerRow ? (
              <>
                <div className="mb-2 flex items-center justify-between gap-2 text-xs font-black uppercase text-[#FFFF00]">
                  <span>YOUR RANK: #{viewerRow.rank?.toLocaleString("en-US") ?? "—"} of {holderCount?.toLocaleString("en-US") ?? "—"}</span>
                  <StatsShareButton label="Share" compact flat showIcon={false} onClick={() => onShareStats({ kind: "holder-rank", ...(connectedWallet ? { wallet: connectedWallet } : {}), ...(viewerFid ? { fid: viewerFid } : {}) })} />
                </div>
                <StatsHolderRowView
                  row={{ ...viewerRow, isViewer: true }}
                  pinned
                  ethUsdPrice={ethUsdPrice}
                  onSearchWallet={onSearchWallet}
                  onOpenWarpletDetails={onOpenWarpletDetails}
                />
              </>
            ) : (
              <div className="rounded-xl border border-[#FFFF00]/25 bg-[rgba(255,255,0,0.055)] px-3 py-3 text-center text-[10px] font-bold text-[#d6d682]">
                You are not currently ranked.
              </div>
            )}
          </div>
        )}

        {friendFilterWallet && (
          <div className="mb-3 flex items-center gap-3 rounded-xl border border-[#7959ff]/70 bg-[rgba(121,89,255,0.14)] px-3 py-3 text-[#c9bcff]">
            <Text className="min-w-0 flex-1 break-all text-[10px] font-black leading-4">
              Leaderboard filtered to the friends of {friendFilterWallet}
            </Text>
            <button
              type="button"
              onClick={() => {
                void hapticSelectionChanged();
                onResetFriendFilter();
              }}
              className="shrink-0 cursor-pointer rounded-lg border border-[#b9aaff]/70 bg-black/35 px-3 py-2 text-[10px] font-black uppercase text-[#d6ceff] hover:bg-[#7959ff]/20"
            >
              Reset
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 py-2">
          <Text className="text-xs font-black uppercase text-[#00FF00]">Leaderboard</Text>
          <span className="ml-auto">
            <StatsShareButton
              compact
              secondaryFlat
              secondaryTone={friendFilterWallet || effectiveFriendsOnly ? "purple" : "green"}
              showIcon={false}
              label="Share Top 10"
              disabled={friendFilterWallet ? !friendFilterFid : effectiveFriendsOnly && !viewerFid}
              onClick={() => onShareStats(friendFilterWallet && friendFilterFid
                ? { kind: "holders-top10-friends", viewerFid: friendFilterFid, wallet: friendFilterWallet }
                : effectiveFriendsOnly && viewerFid
                  ? { kind: "holders-top10-friends", viewerFid, ...(connectedWallet ? { wallet: connectedWallet } : {}) }
                : { kind: "holders-top10", ...(connectedWallet ? { wallet: connectedWallet } : {}), ...(viewerFid ? { fid: viewerFid } : {}) })}
            />
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={effectiveFriendsOnly}
            disabled={Boolean(friendFilterWallet) || !viewerFid || !actionSessionToken}
            onClick={() => {
              setFriendsOnly((current) => !current);
              setRenderedRowCount(STATS_HOLDER_INITIAL_RENDER_ROWS);
              void hapticSelectionChanged();
            }}
            className={`flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-0 text-[10px] font-black uppercase transition disabled:cursor-not-allowed disabled:opacity-40 ${
              effectiveFriendsOnly
                ? "border-[#7959ff] bg-[#7959ff]/20 text-[#b9aaff]"
                : "border-[#7959ff]/45 bg-[#7959ff]/5 text-[#b9aaff] hover:border-[#7959ff]"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
              effectiveFriendsOnly
                  ? "border-[#b9aaff] bg-[#7959ff]/20 text-[#b9aaff]"
                  : "border-[#b9aaff] bg-black/35 text-transparent"
              }`}
            >
              <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.25">
                <path d="m2 6 2.4 2.4L10 3" />
              </svg>
            </span>
            Friends
          </button>
        </div>

        {loading ? (
          <div className="p-2">
            <StatsLoadingState subpage="holders" />
          </div>
        ) : error && rows.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <Text className="text-xs font-bold text-red-300">{error}</Text>
            <button type="button" onClick={refresh} className="mt-3 cursor-pointer text-xs font-black text-[#00FF00] underline">Try again</button>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs font-bold text-[#8bbf8b]">
            {friendFilterWallet
              ? `None of the cached friends for ${friendFilterWallet} currently hold a Warplet.`
              : effectiveFriendsOnly
                ? "None of your Top 100 Friends currently hold a Warplet."
                : "No ranked holders are available yet."}
          </div>
        ) : (
          visibleRows.map((row) => (
            <StatsHolderRowView
              key={row.wallet}
              row={{
                ...row,
                isViewer: row.isViewer || (
                  connectedWallet != null &&
                  row.wallet.toLowerCase() === connectedWallet.toLowerCase()
                ),
                isTopFriend: row.isTopFriend || (row.fid != null && topFriendFids.has(row.fid)),
              }}
              ethUsdPrice={ethUsdPrice}
              onSearchWallet={onSearchWallet}
              onOpenWarpletDetails={onOpenWarpletDetails}
            />
          ))
        )}
        <div ref={loadMoreRef} className="h-px" />
        {(hasBufferedRows || (!effectiveFriendsOnly && nextCursor)) && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => {
              if (hasBufferedRows) {
                setRenderedRowCount((current) =>
                  Math.min(current + STATS_HOLDER_RENDER_BATCH, rankedRows.length));
              } else if (!effectiveFriendsOnly && nextCursor) {
                void loadPage({ cursor: nextCursor, append: true });
              }
            }}
            className="w-full cursor-pointer border-t border-[#00FF00]/15 px-3 py-3 text-xs font-black text-[#00FF00] hover:bg-[#041204] disabled:cursor-wait disabled:opacity-60"
          >
            {hasBufferedRows
              ? `Show ${Math.min(STATS_HOLDER_RENDER_BATCH, rankedRows.length - visibleRows.length)} more`
              : loadingMore
                ? "Loading more holders..."
                : "Load 100 more"}
          </button>
        )}
        {!effectiveFriendsOnly && !hasBufferedRows && !nextCursor && rows.length > 0 && (
          <div className="border-t border-[#00FF00]/15 px-3 py-3 text-center text-[10px] font-bold text-[#8bbf8b]">
            All ranked holders loaded.
          </div>
        )}
      </div>
      {error && rows.length > 0 && <Text className="mt-2 text-center text-[10px] font-bold text-red-300">{error}</Text>}
      <StatsFreshness payload={payload} refreshing={refreshing} onRefresh={refresh} />
    </div>
  );
}

function StatsOverview({
  payload,
  ethUsdPrice,
  onShare,
}: {
  payload: StatsApiEnvelope;
  ethUsdPrice: number | null;
  onShare: (panel: "collection" | "fair-launch") => void;
}) {
  const items = statsMetric(payload, "items", "totalItems", "supply");
  const floor = statsMetric(payload, "floorPrice", "floor");
  const floorChange = statsMetric(payload, "floorChange1dPercent", "floorChange1dPct", "oneDayFloorChangePct", "floorChange24h");
  const topOffer = statsMetric(payload, "topOffer", "collectionTopOffer");
  const volume24h = statsMetric(payload, "volume24h", "oneDayVolume");
  const totalVolume = statsMetric(payload, "totalVolume", "totalVolumeSinceEpoch", "volumeSinceReset");
  const listed = statsMetric(payload, "listed", "listedCount");
  const listedRecord = statsRecord(listed);
  const listedCount = statsNumber(listedRecord?.count ?? statsMetric(payload, "listedCount"));
  const listedPct = statsNumber(listedRecord?.percentage ?? listedRecord?.pct ?? statsMetric(payload, "listedPct", "listedPercentage"));
  const owners = statsMetric(payload, "ownersUnique", "uniqueOwners", "owners");
  const ownersRecord = statsRecord(owners);
  const ownerCount = statsNumber(ownersRecord?.count ?? statsMetric(payload, "uniqueOwnerCount", "ownerCount") ?? owners);
  const ownerPct = statsNumber(ownersRecord?.percentage ?? ownersRecord?.pct ?? statsMetric(payload, "uniqueOwnerPct", "ownerPct"))
    ?? (ownerCount != null ? ownerCount / 100 : null);
  const farcasterHolders = statsRecord(statsMetric(payload, "farcasterHolders", "socialHolders"));
  const farcasterHolderCount = statsNumber(farcasterHolders?.count);
  const holderCoverage = statsRecord(statsMetric(payload, "identityCoverage"));
  const holderCoveragePercentage = statsNumber(
    holderCoverage?.percentage ??
    holderCoverage?.pct ??
    statsMetric(payload, "identityCoveragePct", "farcasterHolderPct"),
  );
  const floorUsd = formatStatsUsd(floor, ethUsdPrice);
  const topOfferUsd = formatStatsUsd(topOffer, ethUsdPrice);
  const volume24hUsd = formatStatsUsd(volume24h, ethUsdPrice);
  const totalVolumeUsd = formatStatsUsd(totalVolume, ethUsdPrice);
  const fair = statsRecord(statsMetric(payload, "fairOwnership")) ?? payload.summary ?? payload.metrics ?? {};

  return (
    <div>
      <section id="stats-deeplink-collection" className="scroll-mt-4 rounded-xl border border-[#00FF00]/55 bg-[rgba(0,255,0,0.055)] p-3 shadow-[0_0_14px_rgba(0,255,0,0.12)]">
        <Text className="text-xs font-black uppercase text-[#00FF00]">10X Warplets NFT Collection</Text>
        <Text className="mt-1 text-xs leading-4 text-[#b8e6b8]">Where Builders, Traders and Attention align.</Text>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatsMetricCard label="Items" value={formatStatsInteger(items ?? 10000)} />
          <StatsMetricCard label="Floor Price" value={formatStatsEth(floor, "ETH", 7)} tooltip={floorUsd} />
          <StatsMetricCard label="1D Floor %" value={formatStatsPercent(floorChange, 2)} />
          <StatsMetricCard label="Top Offer" value={formatStatsEth(topOffer)} tooltip={topOfferUsd} />
          <StatsMetricCard label="24H Volume" value={formatStatsEth(volume24h)} tooltip={volume24hUsd} />
          <StatsMetricCard label="Total Volume" value={formatStatsEth(totalVolume, "ETH", 6)} tooltip={totalVolumeUsd} />
          <StatsMetricCard
            label="Listed"
            value={`${listedCount?.toLocaleString("en-US") ?? "-"} (${
              listedPct != null && listedPct < 1 && listedPct > 0 ? "<1%" : formatStatsPercent(listedPct, 1)
            })`}
            tooltip={listedCount == null ? null : `${listedCount.toLocaleString("en-US")} of 10,000 Warplets`}
          />
          <StatsMetricCard
            label="Owners (Unique)"
            value={`${ownerCount?.toLocaleString("en-US") ?? "-"} (${formatStatsPercent(ownerPct, 1)})`}
          />
          <StatsMetricCard label="Farcaster Holders" value={formatStatsInteger(farcasterHolderCount)} />
          <StatsMetricCard label="Farcaster Holders %" value={formatStatsPercent(holderCoveragePercentage, 1)} />
        </div>
        <div className="mb-1.5 mt-3"><StatsShareButton label="Share NFT Collection" onClick={() => onShare("collection")} primary /></div>
      </section>

      <section id="stats-deeplink-launch" className="scroll-mt-4 mt-4 rounded-xl border border-[#7959ff]/55 bg-[rgba(93,66,214,0.12)] p-3 shadow-[0_0_14px_rgba(121,89,255,0.12)]">
        <Text className="text-xs font-black uppercase text-[#7959ff]">Fair Launch. Mass Distribution.</Text>
        <Text className="mt-1 text-xs leading-4 text-[#b9aaff]">
          The Warplets diamond hands. 10,000 wallet Farcaster airdrop.
        </Text>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatsMetricCard label="OG Warplet Sold" value="Never!" tone="purple" />
          <StatsMetricCard
            label="Airdrop Retention"
            value={formatStatsPercent(fair.cohortRetentionPercentage ?? fair.cohortRetentionPct ?? fair.jul2CohortRetentionPct ?? fair.cohort_retention_pct, 2)}
            tone="purple"
          />
          <StatsMetricCard label="Airdrop Followers" value="48,891,855" tone="purple" />
          <StatsMetricCard label="Airdrop NFTs" value="$1,269,859" tone="purple" />
          <StatsMetricCard label="Airdrop Portfolios" value="$4,945,633" tone="purple" />
          <StatsMetricCard label="Airdrop Volume" value="$2.7B" tone="purple" />
          <StatsMetricCard label="Hold Exactly One" value={formatStatsInteger(fair.exactlyOneWallets ?? fair.singleItemHolders ?? fair.single_item_holders ?? fair.holdersWithOne)} tone="purple" />
          <StatsMetricCard label="Hold Multiple" value={formatStatsInteger(fair.multipleWallets ?? fair.multiItemHolders ?? fair.multi_item_holders ?? fair.holdersWithMultiple)} tone="purple" />
          <StatsMetricCard label="Top 10 Own" value={formatStatsPercent(fair.top10Percentage ?? fair.top10Pct ?? fair.top_10_pct, 2)} tone="purple" />
          <StatsMetricCard label="Top 100 Own" value={formatStatsPercent(fair.top100Percentage ?? fair.top100Pct ?? fair.top_100_pct, 2)} tone="purple" />
        </div>
        <div className="mb-1.5 mt-3"><StatsShareButton label="Share Fair Launch" onClick={() => onShare("fair-launch")} primary primaryTone="purple" /></div>
      </section>
    </div>
  );
}

function StatsMarket({
  payload,
  ethUsdPrice,
  range,
  onShareStats,
}: {
  payload: StatsApiEnvelope;
  ethUsdPrice: number | null;
  range: StatsRange;
  onShareStats: (request: StatsShareRequest) => void;
}) {
  const volume = statsMetric(payload, "volume", "periodVolume", "totalVolume");
  const sales = statsMetric(payload, "sales", "saleCount");
  const activityMix = statsRecord(statsMetric(payload, "activityMix"));
  const listActivity = statsRecord(activityMix?.list);
  const offerActivity = statsRecord(activityMix?.offer);
  const saleActivity = statsRecord(activityMix?.sale);
  const listCount = statsNumber(statsMetric(payload, "listingActivity")) ?? statsNumber(listActivity?.count) ?? 0;
  const offerCount = statsNumber(statsMetric(payload, "offerActivity")) ?? statsNumber(offerActivity?.count) ?? 0;
  const saleCount = statsNumber(saleActivity?.count) ?? 0;
  const activityCount = listCount + offerCount + saleCount;
  const activitySegments = [
    { id: "list", label: "Listings", color: "#FFFF00", count: listCount, value: listActivity?.valueEth },
    { id: "offer", label: "Offers", color: "#33AAFF", count: offerCount, value: offerActivity?.valueEth },
    { id: "sale", label: "Sales", color: "#FF3333", count: saleCount, value: saleActivity?.valueEth },
  ];
  const dailyRows = statsSeries(payload, "daily", "dailyActivity", "salesVolume", "market");
  const salePriceRows = statsSeries(payload, "salePrices", "prices", "priceHistory", "salesAndFloor");
  const floorRows = statsSeries(payload, "floor", "floorHistory");
  const marketActivityRows = statsSeries(payload, "listings", "offers");
  const dailyData = normalizeStatsChartData(dailyRows, {
    sales: ["sales", "saleCount", "count"],
    volume: ["volume", "volumeEth", "eth"],
  });
  const salePriceData = normalizeStatsChartData(salePriceRows, {
    salePrice: ["salePrice", "priceEth", "price", "medianSalePrice", "averagePrice"],
  });
  const floorData = normalizeStatsChartData(floorRows, {
    floorPrice: ["floorPrice", "floorEth", "floor"],
  });
  const marketActivityData = normalizeStatsChartData(marketActivityRows, {
    listings: ["listings", "listingCount"],
    offers: ["offers", "offerCount"],
  });
  const movingPriceData = statsMovingAverage(salePriceData, "salePrice", "movingPrice");
  const latestMovingPrice = statsNumber(movingPriceData.at(-1)?.movingPrice);
  const latestFloorPrice = statsNumber(floorData.at(-1)?.floorPrice);
  const priceChange = statsStartEndChange(movingPriceData, "movingPrice");
  const floorChange = statsStartEndChange(floorData, "floorPrice");
  const volumeChange = statsHalfPeriodChange(dailyData, "volume");
  const salesChange = statsHalfPeriodChange(dailyData, "sales");
  const listingsChange = statsHalfPeriodChange(marketActivityData, "listings");
  const offersChange = statsHalfPeriodChange(marketActivityData, "offers");

  return (
    <div>
      {activityCount > 0 && (
        <section className="mt-3 overflow-hidden rounded-xl border border-[#00FF00]/30 bg-[rgba(0,255,0,0.07)] p-3">
          <div className="flex h-7 w-full overflow-hidden bg-black">
            {activitySegments.map((segment) => segment.count > 0 && (
              <div
                key={segment.id}
                className={`h-full min-w-[4px] border-2 ${
                  segment.id === "list" ? "rounded-l-full" : segment.id === "sale" ? "rounded-r-full" : ""
                }`}
                style={{
                  width: `${(segment.count / activityCount) * 100}%`,
                  borderColor: segment.color,
                  backgroundColor: `color-mix(in srgb, ${segment.color} 28%, black)`,
                  boxShadow: `inset 0 0 5px color-mix(in srgb, ${segment.color} 35%, transparent)`,
                }}
              />
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-bold">
            {activitySegments.map((segment, index) => (
              <div
                key={segment.id}
                className={index === 1 ? "text-center" : index === 2 ? "text-right" : ""}
                style={{ color: segment.color }}
              >
                <span className="block font-black">{formatStatsInteger(segment.count)} {segment.label}</span>
                <span className="block">{formatStatsEth(segment.value)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="mt-4 space-y-3">
        <StatsChartPanel
          id="stats-deeplink-price"
          title="Price"
          animateLinesLeftToRight
          description="Moving average of observed sale prices."
          headline={formatStatsEth(latestMovingPrice).replace(/\s*Ξ$/, "")}
          changePercent={priceChange}
          data={movingPriceData}
          hideMarketplace
          hideEthSymbol
          series={[{ key: "movingPrice", label: "Price ETH", color: "#00FF00", type: "line" }]}
          onShare={() => onShareStats({ kind: "market", metric: "price", range })}
        />
        <StatsChartPanel
          id="stats-deeplink-floor-price"
          title="Floor Price"
          animateLinesLeftToRight
          headline={formatStatsEth(latestFloorPrice).replace(/\s*Ξ$/, "")}
          changePercent={floorChange}
          data={floorData}
          hideEthSymbol
          series={[{ key: "floorPrice", label: "Floor ETH", color: "#00FF00", type: "line" }]}
          onShare={() => onShareStats({ kind: "market", metric: "floor", range })}
        />
        <StatsChartPanel
          id="stats-deeplink-volume"
          title="Volume"
          animateLinesLeftToRight
          headline={formatStatsEth(volume).replace(/\s*Ξ$/, "")}
          changePercent={volumeChange}
          data={dailyData}
          hideEthSymbol
          series={[{ key: "volume", label: "Volume ETH", color: "#00FF00", type: "line" }]}
          onShare={() => onShareStats({ kind: "market", metric: "volume", range })}
        />
        <StatsChartPanel
          id="stats-deeplink-listings"
          title="Listings"
          animateLinesLeftToRight
          headline={formatStatsInteger(listCount)}
          changePercent={listingsChange}
          data={marketActivityData}
          hideEthSymbol
          series={[{ key: "listings", label: "Listings", color: "#00FF00", type: "line" }]}
          onShare={() => onShareStats({ kind: "market", metric: "listings", range })}
        />
        <StatsChartPanel
          id="stats-deeplink-offers"
          title="Offers"
          animateLinesLeftToRight
          headline={formatStatsInteger(offerCount)}
          changePercent={offersChange}
          data={marketActivityData}
          hideEthSymbol
          series={[{ key: "offers", label: "Offers", color: "#00FF00", type: "line" }]}
          onShare={() => onShareStats({ kind: "market", metric: "offers", range })}
        />
        <StatsChartPanel
          id="stats-deeplink-sales"
          title="Sales"
          animateLinesLeftToRight
          headline={formatStatsInteger(sales)}
          changePercent={salesChange}
          data={dailyData}
          hideEthSymbol
          series={[{ key: "sales", label: "Sales", color: "#00FF00", type: "line" }]}
          onShare={() => onShareStats({ kind: "market", metric: "sales", range })}
        />
      </div>
      <div className="mb-1.5 mt-4"><StatsShareButton label="Share All Market Stats" onClick={() => onShareStats({ kind: "market-all", range })} primary /></div>
    </div>
  );
}

function getStatsHighlightFids(value: unknown): Set<number> {
  const payload = statsRecord(value);
  const candidates =
    payload?.matchedFids ??
    payload?.matched_fids ??
    payload?.friends ??
    payload?.topFriendFids ??
    payload?.top_friend_fids ??
    payload?.fids ??
    payload?.highlights;
  const rows = Array.isArray(candidates) ? candidates : [];
  return new Set(rows
    .map((item) => statsInteger(statsRecord(item)?.fid ?? item))
    .filter((fid): fid is number => fid != null));
}

const ACTIVITY_EVENT_OPTIONS: Array<{ value: ActivityEventFilter; label: string; textClass: string; activeClass: string; previewClass: string }> = [
  { value: "all", label: "All", textClass: "text-[#00FF00]", activeClass: "border-[#00FF00]/45 bg-[#00FF00]/10", previewClass: "text-[#8bbf8b]" },
  { value: "sale", label: "Sale", textClass: "text-[#FF5555]", activeClass: "border-[#FF3333]/65 bg-[#FF3333]/15", previewClass: "text-[#FF7777]" },
  { value: "listing", label: "Listing", textClass: "text-[#FFFF00]", activeClass: "border-[#FFFF00]/65 bg-[#FFFF00]/15", previewClass: "text-[#FFFF77]" },
  { value: "offer", label: "Offer", textClass: "text-[#33AAFF]", activeClass: "border-[#33AAFF]/65 bg-[#33AAFF]/15", previewClass: "text-[#8bcfff]" },
  { value: "send", label: "Send", textClass: "text-[#00FF00]", activeClass: "border-[#00FF00]/65 bg-[#00FF00]/15", previewClass: "text-[#8bbf8b]" },
];

function ActivityEventDropdown({ value, onChange }: { value: ActivityEventFilter; onChange: (value: ActivityEventFilter) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = ACTIVITY_EVENT_OPTIONS.find((option) => option.value === value) ?? ACTIVITY_EVENT_OPTIONS[0]!;
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return <div ref={rootRef} className="relative min-w-0">
    <button type="button" onClick={() => setOpen((current) => !current)} className="flex min-h-11 w-full cursor-pointer items-center justify-between rounded-xl border border-[#00FF00]/25 bg-black/70 px-3 py-2 text-left text-xs text-[#00FF00]"><span className="truncate">Event</span><span className={`ml-2 min-w-0 truncate text-[11px] ${selected.previewClass}`}>{selected.label}</span></button>
    {open && <div className="absolute left-0 right-0 z-40 mt-2 min-w-[104px] rounded-xl border border-[#00FF00]/30 bg-black p-2 shadow-2xl">{ACTIVITY_EVENT_OPTIONS.map((option) => {
      const active = option.value === value;
      return <button key={option.value} type="button" onClick={() => { onChange(option.value); setOpen(false); void hapticSelectionChanged(); }} className={`mb-1 flex w-full cursor-pointer items-center rounded-lg border px-2 py-2 text-left text-xs last:mb-0 ${option.textClass} ${active ? `font-black ${option.activeClass}` : "border-transparent bg-transparent hover:bg-[#041204]"}`}>{option.label}</button>;
    })}</div>}
  </div>;
}

function ActivityDateTimeInput({ value, placeholder, onChange }: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState("");
  const [draftTime, setDraftTime] = useState("");
  const displayValue = value
    ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : placeholder;
  const openPicker = () => {
    const now = new Date();
    const [currentDate = "", currentTime = ""] = value.split("T");
    setDraftDate(currentDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
    setDraftTime((currentTime || `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`).slice(0, 5));
    setOpen(true);
    void hapticTap();
  };
  const applyPicker = () => {
    if (draftDate) onChange(`${draftDate}T${draftTime || "00:00"}`);
    setOpen(false);
    void hapticSelectionChanged();
  };
  return <div className="relative min-h-11 min-w-0">
    <button type="button" aria-label={placeholder} onClick={openPicker} className="flex min-h-11 w-full cursor-pointer items-center gap-1.5 rounded-xl border border-[#00FF00]/25 bg-black/70 px-2.5 pr-7 text-left text-[11px] font-bold outline-none focus:border-[#00FF00] focus:shadow-[0_0_8px_rgba(0,255,0,0.2)]">
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>
      <span className={`truncate ${value ? "text-[#00FF00]" : "text-[#8bbf8b]"}`}>{displayValue}</span>
    </button>
    {value && <button type="button" aria-label={`Clear ${placeholder.toLowerCase()}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onChange(""); }} className="absolute right-1.5 top-1/2 z-10 grid h-5 w-5 -translate-y-1/2 cursor-pointer place-items-center rounded text-[#8bbf8b] hover:text-[#00FF00]">×</button>}
    {open && <div role="dialog" aria-modal="true" aria-label={placeholder} onClick={() => setOpen(false)} className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-3 sm:items-center">
      <div onClick={(event) => event.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-[#00FF00]/45 bg-black p-4 shadow-[0_0_28px_rgba(0,255,0,0.2)]">
        <div className="mb-3 text-sm font-black uppercase text-[#00FF00]">{placeholder}</div>
        <div className="grid grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-2">
          <label className="min-w-0"><span className="mb-1 block text-[10px] font-black uppercase text-[#8bbf8b]">Date</span><input type="date" value={draftDate} onChange={(event) => setDraftDate(event.target.value)} className="h-12 w-full min-w-0 rounded-xl border border-[#00FF00]/35 bg-[#031003] px-2 text-base font-bold text-[#00FF00] outline-none focus:border-[#00FF00]" /></label>
          <label className="min-w-0"><span className="mb-1 block text-[10px] font-black uppercase text-[#8bbf8b]">Time</span><input type="time" value={draftTime} onChange={(event) => setDraftTime(event.target.value)} className="h-12 w-full min-w-0 rounded-xl border border-[#00FF00]/35 bg-[#031003] px-2 text-base font-bold text-[#00FF00] outline-none focus:border-[#00FF00]" /></label>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-xs font-black">
          <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="min-h-11 cursor-pointer rounded-xl border border-[#00FF00]/30 bg-black text-[#8bbf8b]">Clear</button>
          <button type="button" onClick={() => setOpen(false)} className="min-h-11 cursor-pointer rounded-xl border border-[#00FF00]/30 bg-black text-[#00FF00]">Cancel</button>
          <button type="button" onClick={applyPicker} className="min-h-11 cursor-pointer rounded-xl border border-[#00FF00] bg-[#00FF00] text-black">Done</button>
        </div>
      </div>
    </div>}
  </div>;
}

function ActivityFilterControls({ event, start, end, error, onEventChange, onStartChange, onEndChange }: {
  event: ActivityEventFilter;
  start: string;
  end: string;
  error: string;
  onEventChange: (value: ActivityEventFilter) => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}) {
  return <div className="mb-3">
    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.85fr)_minmax(0,0.85fr)] gap-1.5">
      <ActivityEventDropdown value={event} onChange={onEventChange} />
      <ActivityDateTimeInput value={start} placeholder="Start date" onChange={onStartChange} />
      <ActivityDateTimeInput value={end} placeholder="End date" onChange={onEndChange} />
    </div>
    {error && <div className="mt-1.5 text-[10px] font-bold text-red-300">{error}</div>}
  </div>;
}

function CollectionActivity({ range, tokenId, showItem = true, refreshKey, viewerFid, actionSessionToken, friendsAvailable, friendsOnly, onFriendsOnlyChange, favouritesAvailable = false, favouritesOnly = false, favouriteWallet = null, favouritesRevision = "", onFavouritesOnlyChange, ethUsdPrice, onSearchWallet, onOpenToken, requestedBucket, onBucketWindowChange, onScrollToEvents, chart, selectedEvents, onSelectedEventsChange, onShareChart }: {
  range: StatsRange;
  tokenId?: number;
  showItem?: boolean;
  refreshKey?: string;
  viewerFid: number | null;
  actionSessionToken: string | null;
  friendsAvailable: boolean;
  friendsOnly: boolean;
  onFriendsOnlyChange: (value: boolean) => void;
  favouritesAvailable?: boolean;
  favouritesOnly?: boolean;
  favouriteWallet?: string | null;
  favouritesRevision?: string;
  onFavouritesOnlyChange?: (value: boolean) => void;
  ethUsdPrice: number | null;
  onSearchWallet: (wallet: string) => void;
  onOpenToken: (tokenId: number) => void;
  requestedBucket: { event: MarketActivityRow["event"]; startAt: string; endAt: string; nonce: number } | null;
  onBucketWindowChange: (window: { event: MarketActivityRow["event"]; startAt: string; endAt: string } | null) => void;
  onScrollToEvents?: (target: HTMLElement) => void;
  chart?: ReactNode;
  selectedEvents: MarketActivityRow["event"][];
  onSelectedEventsChange: (events: MarketActivityRow["event"][]) => void;
  onShareChart?: () => void;
}) {
  const [payload, setPayload] = useState<MarketActivityPayload | null>(null);
  const [eventCounts, setEventCounts] = useState<Partial<Record<MarketActivityRow["event"], number>>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [bucketWindow, setBucketWindow] = useState<{ startAt: string; endAt: string } | null>(null);
  const tableRef = useRef<HTMLElement | null>(null);
  const eventsHeaderRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRef = useRef(false);

  const load = useCallback(async (cursor?: string) => {
    const params = new URLSearchParams({ range, limit: "20" });
    if (tokenId != null) params.set("tokenId", String(tokenId));
    if (refreshKey) params.set("v", refreshKey);
    params.set("events", selectedEvents.length > 0 ? selectedEvents.join(",") : "none");
    if (bucketWindow) {
      params.set("start", bucketWindow.startAt);
      params.set("end", bucketWindow.endAt);
    }
    if (cursor) params.set("cursor", cursor);
    if (friendsOnly && viewerFid) {
      params.set("friends", "1");
      params.set("fid", String(viewerFid));
    }
    if (favouritesOnly && favouriteWallet) params.set("favouritesWallet", favouriteWallet);
    const response = await fetch(`/api/stats/activity?${params}`, {
      headers: {
        accept: "application/json",
        ...(friendsOnly && actionSessionToken ? { authorization: `Bearer ${actionSessionToken}` } : {}),
      },
      credentials: "same-origin",
    });
    const next = await response.json() as MarketActivityPayload;
    if (!response.ok) throw new Error(`Collection activity failed (${response.status})`);
    setPayload((current) => cursor && current ? {
      ...current,
      rows: [...(current.rows ?? []), ...(next.rows ?? [])],
      hasMore: next.hasMore,
      nextCursor: next.nextCursor,
    } : next);
  }, [actionSessionToken, bucketWindow, favouriteWallet, favouritesOnly, favouritesRevision, friendsOnly, range, refreshKey, selectedEvents, tokenId, viewerFid]);

  useEffect(() => {
    setBucketWindow(null);
    onBucketWindowChange(null);
  }, [range]);

  useEffect(() => {
    if (!requestedBucket) return;
    onSelectedEventsChange([requestedBucket.event]);
    setBucketWindow({ startAt: requestedBucket.startAt, endAt: requestedBucket.endAt });
    onBucketWindowChange({ event: requestedBucket.event, startAt: requestedBucket.startAt, endAt: requestedBucket.endAt });
    pendingScrollRef.current = true;
  }, [requestedBucket]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setPayload(null);
    load().catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load collection activity");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [load]);

  useEffect(() => {
    if (!loading && payload && pendingScrollRef.current) {
      pendingScrollRef.current = false;
      const target = eventsHeaderRef.current;
      if (target && onScrollToEvents) onScrollToEvents(target);
      else target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loading, payload]);

  useEffect(() => {
    if (!payload?.eventCounts) return;
    setEventCounts((current) => {
      const next = payload.eventCounts!;
      return (["sale", "listing", "offer", "send"] as const).every((event) => current[event] === next[event])
        ? current
        : next;
    });
  }, [payload?.eventCounts]);

  useEffect(() => {
    if (!friendsAvailable && friendsOnly) onFriendsOnlyChange(false);
  }, [friendsAvailable, friendsOnly, onFriendsOnlyChange]);

  useEffect(() => {
    if (!favouritesAvailable && favouritesOnly) onFavouritesOnlyChange?.(false);
  }, [favouritesAvailable, favouritesOnly, onFavouritesOnlyChange]);

  const loadMore = async () => {
    if (!payload?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try { await load(payload.nextCursor); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load more activity"); }
    finally { setLoadingMore(false); }
  };
  const bucketWindowDisplayLabel = bucketWindow
    ? [
        new Date(bucketWindow.startAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        new Date(new Date(bucketWindow.endAt).getTime() - 1).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      ].join(" \u2013 ")
    : null;
  const selectedEvent = selectedEvents[0] ?? "sale";
  const bucketWindowChipClass = selectedEvent === "sale"
    ? "border-[#FF3333] bg-[#250303] text-[#FF7777]"
    : selectedEvent === "listing"
      ? "border-[#FFFF00] bg-[#252503] text-[#FFFF00]"
      : selectedEvent === "offer"
        ? "border-[#33AAFF] bg-[#031825] text-[#8bcfff]"
        : "border-[#00FF00] bg-[#032503] text-[#00FF00]";

  return (
    <section ref={tableRef} className="scroll-mt-4">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Activity chart event" className="isolate flex h-8 min-h-8 max-h-8 min-w-0 shrink">
        {([
          { value: "sale", label: "Sales", active: "border-[#FF3333] bg-[#FF3333]/20 text-[#FF7777]", idle: "border-[#FF3333]/45 bg-[#FF3333]/5 text-[#FF7777]" },
          { value: "listing", label: "Listings", active: "border-[#FFFF00] bg-[#FFFF00]/20 text-[#FFFF00]", idle: "border-[#FFFF00]/45 bg-[#FFFF00]/5 text-[#FFFF77]" },
          { value: "offer", label: "Offers", active: "border-[#33AAFF] bg-[#33AAFF]/20 text-[#8bcfff]", idle: "border-[#33AAFF]/45 bg-[#33AAFF]/5 text-[#8bcfff]" },
          { value: "send", label: "Sends", active: "border-[#00FF00] bg-[#00FF00]/20 text-[#00FF00]", idle: "border-[#00FF00]/45 bg-[#00FF00]/5 text-[#8bbf8b]" },
        ] as const).map((option) => {
          const active = selectedEvents.includes(option.value);
          const count = eventCounts[option.value] ?? 0;
          return <button key={option.value} type="button" role="radio" aria-checked={active} onClick={() => { setBucketWindow(null); onBucketWindowChange(null); if (!active) onSelectedEventsChange([option.value]); void hapticSelectionChanged(); }} className={`relative box-border flex h-8 min-h-8 max-h-8 shrink-0 cursor-pointer items-center justify-center border text-center transition first:rounded-l-lg last:rounded-r-lg ${tokenId != null ? "px-1.5 text-[10px] font-semibold" : "px-[7px] text-[11px] font-bold"} ${active ? option.active : option.idle}`}>
            <span>{count.toLocaleString("en-US")} {option.label}</span>
          </button>;
        })}
        </div>
        {onShareChart && <button type="button" onClick={() => { void hapticPrimaryTap(); onShareChart(); }} className={`box-border h-8 min-h-8 max-h-8 shrink-0 cursor-pointer rounded-lg border border-[#00FF00]/55 bg-[#00FF00] text-xs font-bold leading-none text-[rgb(0,80,0)] hover:bg-[#33ff33] ${tokenId != null ? "px-2.5" : "px-3"}`}>Share</button>}
      </div>
      {chart}
      <div ref={eventsHeaderRef} className="scroll-mt-4 flex items-center justify-between gap-2 py-2">
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          <Text className="shrink-0 text-xs font-black uppercase text-[#00FF00]">Events</Text>
          {bucketWindowDisplayLabel && (
            <button
              type="button"
              aria-label={`Clear ${bucketWindowDisplayLabel} date filter`}
              onClick={() => {
                setBucketWindow(null);
                onBucketWindowChange(null);
                void hapticSelectionChanged();
              }}
              className={`flex min-w-0 cursor-pointer items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black ${bucketWindowChipClass}`}
            >
              <span className="truncate">{bucketWindowDisplayLabel}</span>
              <svg aria-hidden="true" viewBox="0 0 12 12" className="h-2.5 w-2.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M2 2l8 8M10 2 2 10" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
        {tokenId == null && (
          <button
            type="button"
            role="switch"
            aria-checked={favouritesOnly}
            disabled={!favouritesAvailable}
            onClick={() => {
              onFavouritesOnlyChange?.(!favouritesOnly);
              void hapticSelectionChanged();
            }}
            className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-black uppercase transition-[background-color,box-shadow,opacity,color] disabled:cursor-not-allowed disabled:opacity-40 ${
              favouritesOnly
                ? "border-[#00FF00] bg-[#00FF00]/20 text-[#00FF00]"
                : "border-[#00FF00]/35 bg-transparent text-[#00FF00] hover:bg-[#041204]"
            }`}
          >
            <HeartIcon filled={favouritesOnly} className="h-3.5 w-3.5" strokeWidth={2.2} />
            Favourites
          </button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={friendsOnly}
          disabled={!friendsAvailable}
          onClick={() => {
            onFriendsOnlyChange(!friendsOnly);
            void hapticSelectionChanged();
          }}
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-black uppercase transition disabled:cursor-not-allowed disabled:opacity-40 ${
            friendsOnly
              ? "border-[#7959ff] bg-[#7959ff]/20 text-[#b9aaff]"
              : "border-[#7959ff]/45 bg-[#7959ff]/5 text-[#b9aaff] hover:border-[#7959ff]"
          }`}
        >
          <span
            aria-hidden="true"
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
              friendsOnly
                ? "border-[#b9aaff] bg-[#7959ff]/20 text-[#b9aaff]"
                : "border-[#b9aaff] bg-black/35 text-transparent"
            }`}
          >
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.25">
              <path d="m2 6 2.4 2.4L10 3" />
            </svg>
          </span>
          Friends
        </button>
        </div>
      </div>
      {loading ? <div className="py-8 text-center text-[10px] font-bold text-[#8bbf8b]">{tokenId != null ? "Loading item activity..." : "Loading collection activity..."}</div>
        : <MarketActivityTable rows={payload?.rows ?? []} ethUsdPrice={ethUsdPrice} showItem={showItem} hasMore={Boolean(payload?.hasMore)} loadingMore={loadingMore} onLoadMore={() => void loadMore()} onSearchWallet={onSearchWallet} onOpenToken={onOpenToken} />}
      {error && <div className="mt-2 text-center text-[9px] font-bold text-red-300">{error}</div>}
    </section>
  );
}

function StatsSocial({
  payload,
  highlights,
  favouriteWallet,
  favouriteTokenIds,
  viewerFid,
  actionSessionToken,
  range,
  detail,
  ethUsdPrice,
  onSearchWallet,
  onOpenWarpletDetails,
  isInMiniAppContext,
  onShareStats,
}: {
  payload: StatsApiEnvelope;
  highlights: unknown;
  favouriteWallet: string | null;
  favouriteTokenIds: number[];
  viewerFid: number | null;
  actionSessionToken: string | null;
  range: StatsRange;
  detail?: StatsRouteDetail;
  ethUsdPrice: number | null;
  onSearchWallet: (wallet: string) => void;
  onOpenWarpletDetails: (tokenId: number) => void;
  isInMiniAppContext: boolean;
  onShareStats: (request: StatsShareRequest) => void;
}) {
  const [activityChart, setActivityChart] = useState<ActivityChartPayload | null>(null);
  const [activityChartLoading, setActivityChartLoading] = useState(true);
  const [requestedBucket, setRequestedBucket] = useState<{ event: MarketActivityRow["event"]; startAt: string; endAt: string; nonce: number } | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<MarketActivityRow["event"][]>(() => [readLastStatsActivityEvent()]);
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const favouritesRevision = useMemo(() => favouriteTokenIds.join(","), [favouriteTokenIds]);
  const [activeBucketWindow, setActiveBucketWindow] = useState<{ event: MarketActivityRow["event"]; startAt: string; endAt: string } | null>(null);
  const selectActivityEvents = useCallback((events: MarketActivityRow["event"][]) => {
    const event = events[0] ?? "sale";
    setSelectedEvents([event]);
    writeLastStatsActivityEvent(event);
  }, []);
  useEffect(() => {
    const event = getStatsActivityEventFromRouteDetail(detail);
    if (event) selectActivityEvents([event]);
  }, [detail, selectActivityEvents]);
  useEffect(() => {
    const controller = new AbortController();
    const personalized = friendsOnly && viewerFid != null && actionSessionToken != null;
    const favouriteFilterWallet = favouritesOnly ? favouriteWallet : null;
    const cacheKey = `${personalized ? `friends:${viewerFid}` : "public"}:${favouriteFilterWallet ? `favourites:${favouriteFilterWallet}:${favouritesRevision}` : "all-items"}:${range}`;
    const cached = statsActivityChartCache.get(cacheKey);
    if (cached && Date.now() - cached.loadedAt <= STATS_CLIENT_CACHE_TTL_MS) {
      setActivityChart(cached.payload);
      setActivityChartLoading(false);
      return () => controller.abort();
    }
    setActivityChart(null);
    setActivityChartLoading(true);
    const params = new URLSearchParams({ range, limit: "1", chart: "1" });
    if (personalized) {
      params.set("friends", "1");
      params.set("fid", String(viewerFid));
    }
    if (favouriteFilterWallet) params.set("favouritesWallet", favouriteFilterWallet);
    fetch(`/api/stats/activity?${params.toString()}`, {
      headers: {
        accept: "application/json",
        ...(personalized ? { authorization: `Bearer ${actionSessionToken}` } : {}),
      },
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json() as MarketActivityPayload;
        if (!response.ok) throw new Error(`Sales chart failed (${response.status})`);
        const chart = result.chart ?? null;
        statsActivityChartCache.set(cacheKey, { payload: chart, loadedAt: Date.now() });
        setActivityChart(chart);
      })
      .catch((chartError) => {
        if (!(chartError instanceof DOMException && chartError.name === "AbortError")) console.warn("Aggregated social chart failed:", chartError);
      })
      .finally(() => { if (!controller.signal.aborted) setActivityChartLoading(false); });
    return () => controller.abort();
  }, [actionSessionToken, favouriteWallet, favouritesOnly, favouritesRevision, friendsOnly, range, viewerFid]);
  const multiChartData = activityMultiChartData(activityChart);
  const hasChartActivity = hasActivityForEvents(activityChart, selectedEvents);
  const showBucketActivity = useCallback((event: MarketActivityRow["event"], startAt: string, endAt: string) => {
    selectActivityEvents([event]);
    setActiveBucketWindow({ event, startAt, endAt });
    setRequestedBucket({ event, startAt, endAt, nonce: Date.now() });
  }, [selectActivityEvents]);
  const purchaseRows = statsRows(payload, "recentActivity", "recent", "events");
  const listingRows = statsRows(payload, "recentListings", "listings");
  const recentRows = [...purchaseRows, ...listingRows].sort((left, right) => {
    const leftRow = statsRecord(left) ?? {};
    const rightRow = statsRecord(right) ?? {};
    const leftAt = statsString(leftRow.at ?? leftRow.soldAt ?? leftRow.listedAt ?? leftRow.timestamp) ?? "";
    const rightAt = statsString(rightRow.at ?? rightRow.soldAt ?? rightRow.listedAt ?? rightRow.timestamp) ?? "";
    return rightAt.localeCompare(leftAt);
  });

  return (
    <div>
      {(friendsOnly || favouritesOnly) && (
        <Text className="mb-2 text-right text-[9px] font-bold leading-3 text-[#8bbf8b]">
          The shared chart uses collection-wide data; Friends and Favourites are not included.
        </Text>
      )}
      <div id={detail ? `stats-deeplink-${detail}` : undefined} className="scroll-mt-4">
      <CollectionActivity
        range={range}
        viewerFid={viewerFid}
        actionSessionToken={actionSessionToken}
        friendsAvailable={getStatsHighlightFids(highlights).size > 0}
        friendsOnly={friendsOnly}
        onFriendsOnlyChange={setFriendsOnly}
        favouritesAvailable={Boolean(favouriteWallet && favouriteTokenIds.length > 0)}
        favouritesOnly={favouritesOnly}
        favouriteWallet={favouriteWallet}
        favouritesRevision={favouritesRevision}
        onFavouritesOnlyChange={setFavouritesOnly}
        ethUsdPrice={ethUsdPrice}
        onSearchWallet={onSearchWallet}
        onOpenToken={onOpenWarpletDetails}
        requestedBucket={requestedBucket}
        onBucketWindowChange={setActiveBucketWindow}
        selectedEvents={selectedEvents}
        onSelectedEventsChange={selectActivityEvents}
        onShareChart={() => onShareStats({ kind: "activity", event: selectedEvents[0] ?? "sale", range })}
        chart={activityChartLoading
          ? <div style={{ height: ACTIVITY_CHART_HEIGHT }} className="flex items-center justify-center text-xs font-bold text-[#8bbf8b]">Loading buyer activity...</div>
          : activityChart && !hasChartActivity
            ? <div style={{ height: ACTIVITY_CHART_HEIGHT }} className="flex items-center justify-center text-xs font-bold text-[#8bbf8b]">No activity found.</div>
          : <div style={{ minHeight: ACTIVITY_CHART_HEIGHT }} className="-mx-2 w-[calc(100%+1rem)]">
            <StatsChartErrorBoundary>
              <Suspense fallback={<StatsChartFallback />}>
                <LazyStatsChart
                  key={`social-activity-${range}-${selectedEvents[0] ?? "sale"}-${friendsOnly ? "friends" : "all"}-${favouritesOnly ? "favourites" : "all-items"}`}
                  data={multiChartData}
                  series={([
                    { event: "sale", key: "salePrice", label: "Sales", color: "#FF3333" },
                    { event: "listing", key: "listingPrice", label: "Listings", color: "#FFFF00" },
                    { event: "offer", key: "offerPrice", label: "Offers", color: "#33AAFF" },
                    { event: "send", key: "sendPrice", label: "Sends", color: "#00FF00" },
                  ] as const).filter((item) => selectedEvents.includes(item.event)).map((item) => ({ ...item, type: "line" as const }))}
                  markerSeries={([
                    { event: "sale", key: "salePrice", color: "#FF3333" },
                    { event: "listing", key: "listingPrice", color: "#FFFF00" },
                    { event: "offer", key: "offerPrice", color: "#33AAFF" },
                    { event: "send", key: "sendPrice", color: "#00FF00" },
                  ] as const).filter((item) => selectedEvents.includes(item.event))}
                  socialRole="buyer"
                  hideMarketplace
                  height={ACTIVITY_CHART_HEIGHT}
                  onOpenToken={onOpenWarpletDetails}
                  onSearchWallet={onSearchWallet}
                  onShowBucketActivity={showBucketActivity}
                  isInMiniAppContext={isInMiniAppContext}
                  activeBucket={activeBucketWindow}
                />
              </Suspense>
            </StatsChartErrorBoundary>
          </div>}
      />
      </div>

      {false && recentRows.length > 0 && (
        <section className="mt-3 overflow-hidden rounded-xl border border-[#00FF00]/25 bg-black/65">
          <div className="border-b border-[#00FF00]/15 px-3 py-3">
            <Text className="text-xs font-black uppercase text-[#00FF00]">Recent Social Activity</Text>
          </div>
          {recentRows.slice(0, 20).map((value, index) => {
            const event = statsRecord(value) ?? {};
            const buyerProfile = statsRecord(event.buyerProfile ?? event.profile);
            const tokenId = statsInteger(event.tokenId ?? event.token_id);
            const username = statsString(event.username ?? event.buyerUsername ?? event.buyer_username ?? buyerProfile?.username);
            const action = statsString(event.action ?? event.type)
              ?? (event.listingEth != null || event.listing_eth != null ? "listed" : "purchased");
            const normalizedAction = action.toLowerCase();
            const actionChipClass = normalizedAction.includes("list")
              ? "border-[#FFFF00]/60 bg-[rgba(255,255,0,0.12)] text-[#FFFF00]"
              : normalizedAction.includes("offer") || normalizedAction.includes("bid")
                ? "border-[#33AAFF]/60 bg-[rgba(51,170,255,0.12)] text-[#33AAFF]"
                : normalizedAction.includes("purchas") || normalizedAction.includes("bought")
                  ? "border-[#00FF00]/60 bg-[rgba(0,255,0,0.12)] text-[#00FF00]"
                  : "border-[#FF5555]/60 bg-[rgba(255,85,85,0.12)] text-[#FF7777]";
            const at = statsString(event.at ?? event.soldAt ?? event.listedAt ?? event.timestamp);
            return (
              <button
                key={`${tokenId ?? "event"}-${at ?? index}`}
                type="button"
                disabled={!tokenId}
                onClick={() => tokenId && onOpenWarpletDetails(tokenId)}
                className="flex w-full cursor-pointer items-center gap-2 border-t border-[#00FF00]/10 px-3 py-2 text-left first:border-t-0 disabled:cursor-default"
              >
                {tokenId ? (
                  <img src={getWarpletPreviewImageUrl(tokenId)} alt="" className="h-9 w-9 rounded-[3px] object-cover" loading="lazy" />
                ) : (
                  <span className="h-9 w-9 rounded-[3px] bg-[#041204]" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-black text-[#00FF00]">
                    {username ? `@${username.replace(/^@/, "")}` : "Farcaster collector"}
                  </span>
                  <span className="mt-0.5 block text-[9px] text-[#8bbf8b]">
                    {tokenId ? `Warplet #${tokenId}` : "Collection activity"}{at ? ` · ${formatMarketTimestamp(at)}` : ""}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-black uppercase ${actionChipClass}`}>
                  {action}
                </span>
              </button>
            );
          })}
        </section>
      )}
    </div>
  );
}

function StatsPage({
  subpage,
  range,
  detail,
  onRangeChange,
  connectedWallet,
  friendFilterWallet,
  favouriteWallet,
  favouriteTokenIds,
  viewerFid,
  actionSessionToken,
  onSearchWallet,
  onOpenWarpletDetails,
  isInMiniAppContext,
  onShareStats,
  onResetFriendFilter,
}: {
  subpage: SearchStatsSubpage;
  range: StatsRange;
  detail?: StatsRouteDetail;
  onRangeChange: (range: StatsRange) => void;
  connectedWallet: string | null;
  friendFilterWallet: string | null;
  favouriteWallet: string | null;
  favouriteTokenIds: number[];
  viewerFid: number | null;
  actionSessionToken: string | null;
  onSearchWallet: (wallet: string) => void;
  onOpenWarpletDetails: (tokenId: number) => void;
  isInMiniAppContext: boolean;
  onShareStats: (request: StatsShareRequest) => void;
  onResetFriendFilter: () => void;
}) {
  const [payload, setPayload] = useState<StatsApiEnvelope | null>(null);
  const [highlights, setHighlights] = useState<unknown>(null);
  const [ethUsdPrice, setEthUsdPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(subpage !== "holders");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchEthUsdPrice().then(setEthUsdPrice).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!detail || !payload || loading) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`stats-deeplink-${detail}`)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detail, loading, payload]);

  useEffect(() => {
    if (!payload || loading) return;
    const currentRange = subpage === "overview" ? "all" : range;
    const currentCacheKey = subpage === "overview"
      ? STATS_OVERVIEW_CACHE_KEY
      : `stats:${subpage}:${currentRange}`;
    const siblingRangeRequests = subpage === "market" || subpage === "social"
      ? STATS_RANGE_TABS
          .filter((option) => option.id !== range)
          .map((option) => ({
            cacheKey: `stats:${subpage}:${option.id}`,
            url: `/api/stats/${subpage}?range=${option.id}`,
          }))
      : [];
    const remainingPageRequests = [
      {
        cacheKey: STATS_OVERVIEW_CACHE_KEY,
        url: STATS_OVERVIEW_URL,
      },
      {
        cacheKey: "stats:market:30d",
        url: "/api/stats/market?range=30d",
      },
      {
        cacheKey: "stats:social:30d",
        url: "/api/stats/social?range=30d",
      },
      {
        cacheKey: "stats:holders:first:100",
        url: "/api/stats/holders?limit=100",
      },
    ];
    const seenCacheKeys = new Set([currentCacheKey]);
    const backgroundRequests = [...siblingRangeRequests, ...remainingPageRequests]
      .filter((request) => {
        if (seenCacheKeys.has(request.cacheKey)) return false;
        seenCacheKeys.add(request.cacheKey);
        return true;
      });
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (
      document.visibilityState !== "visible" ||
      connection?.saveData ||
      connection?.effectiveType === "slow-2g" ||
      connection?.effectiveType === "2g"
    ) return;

    let cancelled = false;
    let timeout: number | null = null;
    let idleCallback: number | null = null;
    const warm = () => {
      void (async () => {
        for (const request of backgroundRequests) {
          if (cancelled || document.visibilityState !== "visible") return;
          try {
            await fetchCachedStatsEnvelope(request);
          } catch {
            // Background warming is optional; the destination page retries normally.
          }
        }
      })();
    };
    timeout = window.setTimeout(() => {
      timeout = null;
      if ("requestIdleCallback" in window) {
        idleCallback = window.requestIdleCallback(warm, { timeout: 4000 });
      } else {
        warm();
      }
    }, STATS_BACKGROUND_PREFETCH_DELAY_MS);
    return () => {
      cancelled = true;
      if (timeout != null) window.clearTimeout(timeout);
      if (idleCallback != null && "cancelIdleCallback" in window) window.cancelIdleCallback(idleCallback);
    };
  }, [loading, payload, range, subpage]);

  const load = useCallback(async ({
    refresh = false,
    signal,
  }: {
    refresh?: boolean;
    signal?: AbortSignal;
  } = {}) => {
    if (subpage === "holders") return;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ range: subpage === "overview" ? "all" : range });
      if (refresh) params.set("refresh", "1");
      const effectiveRange = subpage === "overview" ? "all" : range;
      const result = await fetchCachedStatsEnvelope({
        cacheKey: subpage === "overview" ? STATS_OVERVIEW_CACHE_KEY : `stats:${subpage}:${effectiveRange}`,
        url: subpage === "overview"
          ? `${STATS_OVERVIEW_URL}${refresh ? "&refresh=1" : ""}`
          : `/api/stats/${subpage}?${params.toString()}`,
        force: refresh,
      });
      if (signal?.aborted) return;
      setPayload(result);
    } catch (loadError) {
      if (signal?.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load Stats");
    } finally {
      if (!signal?.aborted) {
        if (refresh) setRefreshing(false);
        else setLoading(false);
      }
    }
  }, [range, subpage]);

  useEffect(() => {
    if (subpage === "holders") return;
    const controller = new AbortController();
    const effectiveRange = subpage === "overview" ? "all" : range;
    setPayload(readCachedStatsEnvelope(
      subpage === "overview" ? STATS_OVERVIEW_CACHE_KEY : `stats:${subpage}:${effectiveRange}`,
    ));
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [load, range, subpage]);

  useEffect(() => {
    if (subpage !== "social" || !viewerFid || !actionSessionToken) {
      setHighlights(null);
      return;
    }
    const cached = statsSocialHighlightsCache.get(viewerFid);
    if (cached && Date.now() - cached.loadedAt <= STATS_CLIENT_CACHE_TTL_MS) {
      setHighlights(cached.payload);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      range: "all",
      fid: String(viewerFid),
    });
    fetch(`/api/stats/social/highlights?${params.toString()}`, {
      headers: { accept: "application/json", authorization: `Bearer ${actionSessionToken}` },
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (result) {
          statsSocialHighlightsCache.set(viewerFid, { payload: result, loadedAt: Date.now() });
        }
        setHighlights(result);
      })
      .catch((highlightError) => {
        if (!(highlightError instanceof DOMException && highlightError.name === "AbortError")) {
          console.warn("Stats social highlights failed:", highlightError);
        }
      });
    return () => controller.abort();
  }, [actionSessionToken, subpage, viewerFid]);

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-10 pt-4">
      {subpage !== "holders" && subpage !== "overview" && (
        <SearchSegmentedTabs
          className="mb-4"
          options={STATS_RANGE_TABS}
          activeId={range}
          onSelect={(id) => onRangeChange(id as StatsRange)}
          gridTemplateColumns="repeat(5, minmax(0, 1fr))"
        />
      )}
      {subpage === "holders" ? (
        <StatsHoldersPage
          connectedWallet={connectedWallet}
          friendFilterWallet={friendFilterWallet}
          viewerFid={viewerFid}
          actionSessionToken={actionSessionToken}
          ethUsdPrice={ethUsdPrice}
          onSearchWallet={onSearchWallet}
          onOpenWarpletDetails={onOpenWarpletDetails}
          onShareStats={onShareStats}
          onResetFriendFilter={onResetFriendFilter}
          initialFriendsOnly={detail === "top10friends" && !friendFilterWallet}
        />
      ) : loading && !payload ? (
        <StatsLoadingState subpage={subpage} />
      ) : error && !payload ? (
        <div className="rounded-xl border border-red-400/35 bg-red-950/20 px-4 py-8 text-center">
          <Text className="text-xs font-bold text-red-300">{error}</Text>
          <button type="button" onClick={() => void load()} className="mt-3 cursor-pointer text-xs font-black text-[#00FF00] underline">Try again</button>
        </div>
      ) : payload ? (
        <>
          {subpage === "overview" && <StatsOverview payload={payload} ethUsdPrice={ethUsdPrice} onShare={(panel) => onShareStats({ kind: "overview", panel, ...(connectedWallet ? { wallet: connectedWallet } : {}), ...(viewerFid ? { fid: viewerFid } : {}) })} />}
          {subpage === "market" && <StatsMarket payload={payload} ethUsdPrice={ethUsdPrice} range={range} onShareStats={onShareStats} />}
          {subpage === "social" && (
            <StatsSocial
              payload={payload}
              highlights={highlights}
              favouriteWallet={favouriteWallet}
              favouriteTokenIds={favouriteTokenIds}
              viewerFid={viewerFid}
              actionSessionToken={actionSessionToken}
              range={range}
              detail={detail}
              ethUsdPrice={ethUsdPrice}
              onSearchWallet={onSearchWallet}
              onOpenWarpletDetails={onOpenWarpletDetails}
              isInMiniAppContext={isInMiniAppContext}
              onShareStats={onShareStats}
            />
          )}
          {error && <Text className="mt-3 text-center text-[10px] font-bold text-red-300">{error}</Text>}
          <StatsFreshness payload={payload} refreshing={refreshing} onRefresh={() => void load({ refresh: true })} />
        </>
      ) : null}
    </div>
  );
}

type MarketActivityParty = {
  wallet?: string | null;
  fid?: number | null;
  username?: string | null;
  displayName?: string | null;
  pfpUrl?: string | null;
};

type MarketActivityRow = {
  key: string;
  event: StatsActivityEvent;
  tokenId: number;
  priceEth: number | null;
  transactionHash?: string | null;
  orderHash?: string | null;
  at: string;
  from?: MarketActivityParty | null;
  to?: MarketActivityParty | null;
};

type ActivityEventFilter = "all" | MarketActivityRow["event"];

type ActivityChartBucket = {
  index: number;
  startAt: string;
  endAt: string;
  saleCount: number;
  averagePriceEth: number | null;
  representativeSale: null | {
    key: string;
    tokenId: number;
    priceEth: number;
    at: string;
    transactionHash?: string | null;
    buyer?: MarketActivityParty | null;
    seller?: MarketActivityParty | null;
  };
  events?: Partial<Record<MarketActivityRow["event"], {
    count: number;
    averagePriceEth: number | null;
    representativeEvent: null | {
      key: string;
      tokenId: number;
      priceEth: number | null;
      at: string;
      transactionHash?: string | null;
      from?: MarketActivityParty | null;
      to?: MarketActivityParty | null;
    };
  }>>;
};

type ActivityChartPayload = {
  rangeStart: string;
  rangeEnd: string;
  bucketCount: number;
  buckets: ActivityChartBucket[];
};

type MarketActivityPayload = {
  rows?: MarketActivityRow[];
  chart?: ActivityChartPayload;
  eventCounts?: Partial<Record<MarketActivityRow["event"], number>>;
  hasMore?: boolean;
  nextCursor?: string | null;
  complete?: boolean;
};

function toLocalDateTimeInput(value: string, roundUp = false): string {
  const original = new Date(value);
  const date = roundUp && original.getTime() % 1000 !== 0
    ? new Date(original.getTime() + (1000 - original.getTime() % 1000))
    : original;
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

function localDateTimeInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function activityChartData(chart: ActivityChartPayload | null | undefined, role: "buyer" | "seller"): StatsChartDatum[] {
  const buckets = chart?.buckets ?? [];
  const firstSaleIndex = buckets.findIndex((bucket) => bucket.saleCount > 0 && bucket.averagePriceEth != null);
  return buckets.map((bucket, index) => {
    const sale = bucket.representativeSale;
    const party = role === "buyer" ? sale?.buyer : sale?.seller;
    const wallet = normalizeWalletAddress(party?.wallet);
    return {
      label: new Date(bucket.startAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      timestamp: bucket.startAt,
      // Give long ranges their honest full scale: the line begins at zero before
      // observed history, then connects continuously across later inactive buckets.
      salePrice: bucket.averagePriceEth ?? (firstSaleIndex > 0 && index < firstSaleIndex ? 0 : null),
      topSalePrice: sale?.priceEth ?? null,
      saleCount: bucket.saleCount,
      bucketStartAt: bucket.startAt,
      bucketEndAt: bucket.endAt,
      markerRevealIndex: bucket.index,
      tokenId: sale?.tokenId ?? null,
      transactionHash: sale?.transactionHash ?? null,
      buyerWallet: sale?.buyer?.wallet ?? null,
      buyerFid: sale?.buyer?.fid ?? null,
      buyerUsername: sale?.buyer?.username ?? null,
      buyerAvatarUrl: sale?.buyer?.pfpUrl ?? null,
      sellerWallet: sale?.seller?.wallet ?? null,
      sellerFid: sale?.seller?.fid ?? null,
      sellerUsername: sale?.seller?.username ?? null,
      sellerAvatarUrl: sale?.seller?.pfpUrl ?? null,
      wallet,
      avatarUrl: party?.pfpUrl ?? (wallet ? getWalletIdenticonDataUrl(wallet) : null),
      showMarker: bucket.saleCount > 0,
      showAvatar: bucket.saleCount > 0,
    };
  });
}

function activityMultiChartData(chart: ActivityChartPayload | null | undefined): StatsChartDatum[] {
  const buckets = chart?.buckets ?? [];
  const eventTypes: MarketActivityRow["event"][] = ["sale", "listing", "offer", "send"];
  const firstIndexes = new Map(eventTypes.map((event) => [event, buckets.findIndex((bucket) => (bucket.events?.[event]?.count ?? 0) > 0)]));
  return buckets.map((bucket, index) => {
    const point: StatsChartDatum = {
      label: new Date(bucket.startAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      timestamp: bucket.startAt,
      bucketStartAt: bucket.startAt,
      bucketEndAt: bucket.endAt,
    };
    eventTypes.forEach((event) => {
      const data = bucket.events?.[event];
      const representative = data?.representativeEvent;
      const markerParty = event === "sale" ? representative?.to : representative?.from;
      const markerWallet = normalizeWalletAddress(markerParty?.wallet);
      const firstIndex = firstIndexes.get(event) ?? -1;
      const lineValue = event === "send"
        ? firstIndex >= 0 ? 0 : null
        : data?.averagePriceEth ?? (firstIndex > 0 && index < firstIndex ? 0 : null);
      point[`${event}Price`] = lineValue;
      point[`${event}Count`] = data?.count ?? 0;
      point[`${event}TopPrice`] = representative?.priceEth ?? null;
      point[`${event}TokenId`] = representative?.tokenId ?? null;
      point[`${event}TransactionHash`] = representative?.transactionHash ?? null;
      point[`${event}FromWallet`] = representative?.from?.wallet ?? null;
      point[`${event}FromFid`] = representative?.from?.fid ?? null;
      point[`${event}FromUsername`] = representative?.from?.username ?? null;
      point[`${event}FromAvatarUrl`] = representative?.from?.pfpUrl ?? (representative?.from?.wallet ? getWalletIdenticonDataUrl(representative.from.wallet) : null);
      point[`${event}ToWallet`] = representative?.to?.wallet ?? null;
      point[`${event}ToFid`] = representative?.to?.fid ?? null;
      point[`${event}ToUsername`] = representative?.to?.username ?? null;
      point[`${event}ToAvatarUrl`] = representative?.to?.pfpUrl ?? (representative?.to?.wallet ? getWalletIdenticonDataUrl(representative.to.wallet) : null);
      point[`${event}Wallet`] = markerWallet;
      point[`${event}AvatarUrl`] = markerParty?.pfpUrl ?? (markerWallet ? getWalletIdenticonDataUrl(markerWallet) : null);
    });
    return point;
  });
}

function hasActivityForEvents(
  chart: ActivityChartPayload | null | undefined,
  events: MarketActivityRow["event"][],
): boolean {
  return Boolean(chart?.buckets.some((bucket) =>
    events.some((event) => (bucket.events?.[event]?.count ?? 0) > 0),
  ));
}

function ActivityPartyCell({ party, onSearchWallet }: {
  party?: MarketActivityParty | null;
  onSearchWallet: (wallet: string) => void;
}) {
  const wallet = normalizeWalletAddress(party?.wallet);
  const username = party?.username?.trim().replace(/^@/, "") || null;
  const label = username ? `@${username}` : wallet ? formatShortWallet(wallet) : "—";
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: tooltipOpen,
    onOpenChange: setTooltipOpen,
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(7), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const hover = useHover(context, { delay: { open: 0, close: 60 }, move: false });
  const focus = useFocus(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, role]);
  if (!wallet) return <span className="text-[#587458]">—</span>;
  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        {...getReferenceProps({
          "aria-label": `Search Warplets owned by ${label}`,
          onClick: () => onSearchWallet(wallet),
          className: "mx-auto block h-7 w-7 cursor-pointer overflow-hidden rounded-full outline-none ring-[#00FF00] focus:ring-1",
        })}
      >
        {party?.pfpUrl ? (
          <img src={party.pfpUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <WalletIdenticon wallet={wallet} className="h-full w-full rounded-full" />
        )}
      </button>
      {tooltipOpen && <FloatingPortal><div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps({ className: "z-[100] max-w-[90vw] rounded-lg border border-[#00FF00]/40 bg-black px-2 py-1.5 text-[9px] font-bold text-[#00FF00] shadow-2xl" })}><span className="block">{label}</span><span className="block text-[8px] text-[#8bbf8b]">{wallet}</span></div></FloatingPortal>}
    </>
  );
}

function MarketActivityTable({ rows, ethUsdPrice, showItem, hasMore, loadingMore, onLoadMore, onSearchWallet, onOpenToken }: {
  rows: MarketActivityRow[];
  ethUsdPrice: number | null;
  showItem: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSearchWallet: (wallet: string) => void;
  onOpenToken?: (tokenId: number) => void;
}) {
  const chipClass = (event: MarketActivityRow["event"]) => event === "sale"
    ? "border-[#FF3333]/65 bg-[#FF3333]/15 text-[#FF5555]"
    : event === "listing"
      ? "border-[#FFFF00]/65 bg-[#FFFF00]/15 text-[#FFFF00]"
      : event === "offer"
        ? "border-[#33AAFF]/65 bg-[#33AAFF]/15 text-[#33AAFF]"
        : "border-[#00FF00]/65 bg-[#00FF00]/15 text-[#00FF00]";
  return (
    <div className="w-full overflow-hidden rounded-xl border border-[#00FF00]/20 bg-black/65">
      <table className="w-full table-fixed border-collapse text-center text-[11px]">
        <colgroup>
          {showItem && <col className="w-[19%]" />}
          <col className={showItem ? "w-[18%]" : "w-[24%]"} />
          <col className={showItem ? "w-[19%]" : "w-[24%]"} />
          <col className={showItem ? "w-[11%]" : "w-[14%]"} />
          <col className={showItem ? "w-[11%]" : "w-[14%]"} />
          <col className={showItem ? "w-[22%]" : "w-[24%]"} />
        </colgroup>
        <thead className="bg-[#041204] text-[9px] font-black uppercase text-[#8bbf8b]">
          <tr>
            {showItem && <th className="px-0.5 py-2">Item</th>}
            <th className="px-0.5 py-2">Event</th><th className="px-0.5 py-2">Price</th>
            <th className="px-0.5 py-2">From</th><th className="px-0.5 py-2">To</th><th className="px-0.5 py-2">Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const shortDate = new Date(row.at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
            const fullDate = new Date(row.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
            const price = row.event === "send" || row.priceEth == null ? null : row.priceEth;
            return (
              <tr key={row.key} className="border-t border-[#00FF00]/10">
                {showItem && <td className="px-0.5 py-1.5">
                  <button type="button" onClick={() => onOpenToken?.(row.tokenId)} className="mx-auto flex cursor-pointer flex-col items-center text-[#00FF00]">
                    <img src={getWarpletPreviewImageUrl(row.tokenId)} alt="" className="h-8 w-8 rounded-[3px] object-cover" loading="lazy" decoding="async" />
                    <span className="mt-0.5 text-[9px] font-black">#{row.tokenId}</span>
                  </button>
                </td>}
                <td className="px-0.5 py-1.5"><span className={`inline-flex rounded-full border px-1 py-0.5 text-[9px] font-black uppercase ${chipClass(row.event)}`}>{row.event === "offer" ? "Offer" : row.event}</span></td>
                <td className="px-0.5 py-1.5 font-black text-[#00FF00]">{price == null ? "—" : <InlineHoverTooltip value={`${formatEthNumber(price, 6).replace(/\s*Ξ$/, "")} Ξ`} tooltip={formatUsdMoneyFromMarket({ eth: price, at: row.at, rawAmount: null, decimals: 18, currencySymbol: "ETH", tokenAddress: null }, ethUsdPrice)} className="text-[11px]" />}</td>
                <td className="px-0.5 py-1.5"><ActivityPartyCell party={row.from} onSearchWallet={onSearchWallet} /></td>
                <td className="px-0.5 py-1.5"><ActivityPartyCell party={row.to} onSearchWallet={onSearchWallet} /></td>
                <td className="px-0.5 py-1.5">{row.transactionHash ? <a href={`https://basescan.org/tx/${encodeURIComponent(row.transactionHash)}`} target="_blank" rel="noreferrer" className="cursor-pointer underline decoration-[#00FF00] underline-offset-2"><InlineHoverTooltip value={shortDate} tooltip={fullDate} className="text-[11px] text-[#8bbf8b]" tone="muted" /></a> : <InlineHoverTooltip value={shortDate} tooltip={fullDate} className="text-[11px] text-[#8bbf8b]" tone="muted" />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <div className="px-3 py-8 text-center text-[10px] font-bold text-[#8bbf8b]">No activity found.</div>}
      {hasMore && <button type="button" disabled={loadingMore} onClick={onLoadMore} className={`w-full cursor-pointer border-t border-[#00FF00]/15 px-3 py-3 text-[10px] font-black text-[#00FF00] disabled:cursor-wait disabled:opacity-60 ${showItem ? "" : "underline decoration-[#00FF00] underline-offset-2"}`}>{loadingMore ? "Loading..." : "Load More..."}</button>}
    </div>
  );
}

function WarpletItemActivity({
  tokenId,
  viewerFid,
  actionSessionToken,
  onSearchWallet,
  onOpenToken,
  refreshKey,
  isInMiniAppContext,
  onScrollToEvents,
  onShareStats,
}: {
  tokenId: number;
  viewerFid: number | null;
  actionSessionToken: string | null;
  onSearchWallet: (wallet: string) => void;
  onOpenToken: (tokenId: number) => void;
  refreshKey: string;
  isInMiniAppContext: boolean;
  onScrollToEvents: (target: HTMLElement) => void;
  onShareStats: (request: StatsShareRequest) => void;
}) {
  const [open, setOpen] = useState(() => readItemActivityDeepLink().open);
  const [range, setRange] = useState<StatsRange>(() => readItemActivityDeepLink().range);
  const [selectedEvents, setSelectedEvents] = useState<MarketActivityRow["event"][]>(() => [readItemActivityDeepLink().event ?? readLastItemActivityEvent()]);
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [activityChart, setActivityChart] = useState<ActivityChartPayload | null>(null);
  const [activityChartLoading, setActivityChartLoading] = useState(false);
  const [ethUsdPrice, setEthUsdPrice] = useState<number | null>(null);
  const [requestedBucket, setRequestedBucket] = useState<{ event: MarketActivityRow["event"]; startAt: string; endAt: string; nonce: number } | null>(null);
  const [activeBucketWindow, setActiveBucketWindow] = useState<{ event: MarketActivityRow["event"]; startAt: string; endAt: string } | null>(null);

  const selectActivityEvents = useCallback((events: MarketActivityRow["event"][]) => {
    const event = events[0] ?? "sale";
    setSelectedEvents([event]);
    writeLastItemActivityEvent(event);
  }, []);

  useEffect(() => {
    const deepLink = readItemActivityDeepLink();
    setOpen(deepLink.open);
    setRange(deepLink.range);
    if (deepLink.event) selectActivityEvents([deepLink.event]);
    setFriendsOnly(false);
    setRequestedBucket(null);
    setActiveBucketWindow(null);
  }, [selectActivityEvents, tokenId]);

  useEffect(() => {
    if (open && ethUsdPrice == null) fetchEthUsdPrice().then(setEthUsdPrice).catch(() => undefined);
  }, [ethUsdPrice, open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const personalized = friendsOnly && viewerFid != null && actionSessionToken != null;
    const cacheKey = `item:${tokenId}:${personalized ? `friends:${viewerFid}` : "public"}:${range}:${refreshKey}`;
    const cached = statsActivityChartCache.get(cacheKey);
    if (cached && Date.now() - cached.loadedAt <= STATS_CLIENT_CACHE_TTL_MS) {
      setActivityChart(cached.payload);
      setActivityChartLoading(false);
      return () => controller.abort();
    }
    setActivityChart(null);
    setActivityChartLoading(true);
    const params = new URLSearchParams({ tokenId: String(tokenId), range, limit: "1", chart: "1", v: refreshKey });
    if (personalized) {
      params.set("friends", "1");
      params.set("fid", String(viewerFid));
    }
    fetch(`/api/stats/activity?${params.toString()}`, {
      headers: {
        accept: "application/json",
        ...(personalized ? { authorization: `Bearer ${actionSessionToken}` } : {}),
      },
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async (response) => {
      const result = await response.json() as MarketActivityPayload;
      if (!response.ok) throw new Error(`Item activity chart failed (${response.status})`);
      const chart = result.chart ?? null;
      statsActivityChartCache.set(cacheKey, { payload: chart, loadedAt: Date.now() });
      setActivityChart(chart);
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) console.warn("Item activity chart failed:", error);
    }).finally(() => {
      if (!controller.signal.aborted) setActivityChartLoading(false);
    });
    return () => controller.abort();
  }, [actionSessionToken, friendsOnly, open, range, refreshKey, tokenId, viewerFid]);

  const showBucketActivity = useCallback((event: MarketActivityRow["event"], startAt: string, endAt: string) => {
    selectActivityEvents([event]);
    setActiveBucketWindow({ event, startAt, endAt });
    setRequestedBucket({ event, startAt, endAt, nonce: Date.now() });
  }, [selectActivityEvents]);
  const multiChartData = activityMultiChartData(activityChart);
  const hasChartActivity = hasActivityForEvents(activityChart, selectedEvents);

  return (
    <section className="mt-3 overflow-hidden rounded-xl border border-[#00FF00]/20 bg-[#041204]/60">
      <button
        type="button"
        onClick={() => {
          void hapticSelectionChanged();
          setOpen((current) => !current);
        }}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-3 text-left"
        aria-expanded={open}
      >
        <span className="block text-[10px] font-black uppercase text-[#00FF00]">Item Activity</span>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#00FF00] text-[rgb(0,80,0)]">
          <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="border-t border-[#00FF00]/15 px-2 pb-3 pt-2">
          <SearchSegmentedTabs className="mb-4" options={STATS_RANGE_TABS} activeId={range} onSelect={(id) => setRange(id as StatsRange)} gridTemplateColumns="repeat(5,minmax(0,1fr))" />
          {friendsOnly && <Text className="mb-2 text-right text-[9px] font-bold leading-3 text-[#8bbf8b]">The shared chart uses all activity for this item; Friends are not included.</Text>}
          <CollectionActivity
            range={range}
            tokenId={tokenId}
            showItem={false}
            refreshKey={refreshKey}
            viewerFid={viewerFid}
            actionSessionToken={actionSessionToken}
            friendsAvailable={Boolean(viewerFid && actionSessionToken)}
            friendsOnly={friendsOnly}
            onFriendsOnlyChange={setFriendsOnly}
            ethUsdPrice={ethUsdPrice}
            onSearchWallet={onSearchWallet}
            onOpenToken={onOpenToken}
            requestedBucket={requestedBucket}
            onBucketWindowChange={setActiveBucketWindow}
            onScrollToEvents={onScrollToEvents}
            selectedEvents={selectedEvents}
            onSelectedEventsChange={selectActivityEvents}
            onShareChart={() => onShareStats({ kind: "activity", event: selectedEvents[0] ?? "sale", range, tokenId })}
            chart={activityChartLoading
              ? <div style={{ height: ACTIVITY_CHART_HEIGHT }} className="flex items-center justify-center text-xs font-bold text-[#8bbf8b]">Loading item activity...</div>
              : activityChart && !hasChartActivity
                ? <div style={{ height: ACTIVITY_CHART_HEIGHT }} className="flex items-center justify-center text-xs font-bold text-[#8bbf8b]">No activity found.</div>
              : <div style={{ minHeight: ACTIVITY_CHART_HEIGHT }} className="-mx-2 w-[calc(100%+1rem)]">
                <StatsChartErrorBoundary>
                  <Suspense fallback={<StatsChartFallback />}>
                    <LazyStatsChart
                      key={`item-activity-${tokenId}-${range}-${selectedEvents[0]}-${friendsOnly}-${refreshKey}`}
                      data={multiChartData}
                      series={([
                        { event: "sale", key: "salePrice", label: "Sales", color: "#FF3333" },
                        { event: "listing", key: "listingPrice", label: "Listings", color: "#FFFF00" },
                        { event: "offer", key: "offerPrice", label: "Offers", color: "#33AAFF" },
                        { event: "send", key: "sendPrice", label: "Sends", color: "#00FF00" },
                      ] as const).filter((item) => selectedEvents.includes(item.event)).map((item) => ({ ...item, type: "line" as const }))}
                      markerSeries={([
                        { event: "sale", key: "salePrice", color: "#FF3333" },
                        { event: "listing", key: "listingPrice", color: "#FFFF00" },
                        { event: "offer", key: "offerPrice", color: "#33AAFF" },
                        { event: "send", key: "sendPrice", color: "#00FF00" },
                      ] as const).filter((item) => selectedEvents.includes(item.event))}
                      socialRole="buyer"
                      hideMarketplace
                      height={ACTIVITY_CHART_HEIGHT}
                      onOpenToken={onOpenToken}
                      onSearchWallet={onSearchWallet}
                      onShowBucketActivity={showBucketActivity}
                      isInMiniAppContext={isInMiniAppContext}
                      activeBucket={activeBucketWindow}
                    />
                  </Suspense>
                </StatsChartErrorBoundary>
              </div>}
          />
        </div>
      )}
    </section>
  );
}

function LegacyWarpletItemActivity({
  tokenId,
  viewerFid,
  actionSessionToken,
  onSearchWallet,
  onOpenToken,
  refreshKey,
  isInMiniAppContext,
}: {
  tokenId: number;
  viewerFid: number | null;
  actionSessionToken: string | null;
  onSearchWallet: (wallet: string) => void;
  onOpenToken: (tokenId: number) => void;
  refreshKey: string;
  isInMiniAppContext: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<MarketActivityPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [ethUsdPrice, setEthUsdPrice] = useState<number | null>(null);
  const [chartRetryKey, setChartRetryKey] = useState(0);
  const [range, setRange] = useState<StatsRange>("all");
  const [eventFilter, setEventFilter] = useState<ActivityEventFilter>("all");
  const [startFilter, setStartFilter] = useState("");
  const [endFilter, setEndFilter] = useState("");
  const tableRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRef = useRef(false);
  const filterError = startFilter && endFilter && new Date(startFilter).getTime() >= new Date(endFilter).getTime()
    ? "Start must be earlier than End."
    : "";

  useEffect(() => {
    setOpen(false);
    setPayload(null);
    setError("");
    setRange("all");
    setEventFilter("all");
    setStartFilter("");
    setEndFilter("");
  }, [tokenId]);

  useEffect(() => {
    if (open && ethUsdPrice == null) fetchEthUsdPrice().then(setEthUsdPrice).catch(() => undefined);
  }, [ethUsdPrice, open]);

  const loadActivity = useCallback(async (cursor?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ tokenId: String(tokenId), range, limit: "20", event: eventFilter });
    if (!cursor) params.set("chart", "1");
    if (cursor) params.set("cursor", cursor);
    const startIso = localDateTimeInputToIso(startFilter);
    const endIso = localDateTimeInputToIso(endFilter);
    if (filterError) throw new Error(filterError);
    if (startIso) params.set("start", startIso);
    if (endIso) params.set("end", endIso);
    params.set("v", refreshKey);
    const response = await fetch(`/api/stats/activity?${params}`, { headers: { accept: "application/json" }, signal });
    const responseText = await response.text();
    const result = responseText.trim() ? JSON.parse(responseText) as MarketActivityPayload : null;
    if (!response.ok || !result) throw new Error(`Item activity failed (${response.status})`);
    setPayload((current) => cursor && current ? { ...current, rows: [...(current.rows ?? []), ...(result.rows ?? [])], hasMore: result.hasMore, nextCursor: result.nextCursor } : result);
  }, [endFilter, eventFilter, filterError, range, refreshKey, startFilter, tokenId]);

  useEffect(() => {
    if (!open || filterError) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setPayload(null);
    const loadPriceHistory = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await loadActivity(undefined, controller.signal);
          return;
        } catch (loadError) {
          if (attempt > 0 || (loadError instanceof DOMException && loadError.name === "AbortError")) throw loadError;
          await new Promise((resolve) => window.setTimeout(resolve, 300));
        }
      }
    };
    void loadPriceHistory()
      .catch((loadError) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError(loadError instanceof Error ? loadError.message : "Could not load item activity");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filterError, loadActivity, open]);

  const chartData = activityChartData(payload?.chart, "buyer");
  const ItemActivityChart = useMemo(() => lazy(loadStatsChart), [chartRetryKey]);

  const loadMore = async () => {
    if (!payload?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await loadActivity(payload.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load more activity");
    } finally {
      setLoadingMore(false);
    }
  };
  const showBucketSales = useCallback((startAt: string, endAt: string) => {
    setEventFilter("sale");
    setStartFilter(toLocalDateTimeInput(startAt));
    setEndFilter(toLocalDateTimeInput(endAt, true));
    pendingScrollRef.current = true;
  }, []);
  useEffect(() => {
    if (!loading && payload && pendingScrollRef.current) {
      pendingScrollRef.current = false;
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loading, payload]);

  return (
    <section className="mt-3 overflow-hidden rounded-xl border border-[#00FF00]/20 bg-[#041204]/60">
      <button
        type="button"
        onClick={() => {
          void hapticSelectionChanged();
          setOpen((current) => !current);
        }}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-3 text-left"
        aria-expanded={open}
      >
        <span className="block text-[10px] font-black uppercase text-[#00FF00]">Item Activity</span>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#00FF00] text-[rgb(0,80,0)]">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="border-t border-[#00FF00]/15 px-2 pb-3 pt-2">
          {loading ? (
            <div className="py-8 text-center text-[10px] font-bold text-[#8bbf8b]">Loading item activity...</div>
          ) : error ? (
            <div className="py-6 text-center text-[10px] font-bold text-red-300">{error}</div>
          ) : false ? (
            <div className="py-8 text-center text-[10px] font-bold text-[#8bbf8b]">No observed sales since Jul 2, 2026.</div>
          ) : (
            <>
              <Text className="mb-1 px-1 text-[10px] font-black uppercase text-[#00FF00]">Item Sales</Text>
              <SearchSegmentedTabs className="mb-3" options={STATS_RANGE_TABS} activeId={range} onSelect={(id) => { setRange(id as StatsRange); setEventFilter("all"); setStartFilter(""); setEndFilter(""); }} gridTemplateColumns="repeat(5,minmax(0,1fr))" />
              <div className="mb-3">
                <StatsChartErrorBoundary onRetry={() => setChartRetryKey((current) => current + 1)}>
                  <Suspense fallback={<StatsChartFallback />}>
                    <ItemActivityChart
                      key={`item-sales-${tokenId}-${chartRetryKey}-${refreshKey}`}
                      data={chartData}
                      series={[{ key: "salePrice", label: "Sale", color: "#00FF00", type: "line" }]}
                      socialKey="salePrice"
                      socialRole="buyer"
                      hideMarketplace
                      height={180}
                      onOpenToken={onOpenToken}
                      onSearchWallet={onSearchWallet}
                        onShowBucketSales={showBucketSales}
                        isInMiniAppContext={isInMiniAppContext}
                    />
                  </Suspense>
                </StatsChartErrorBoundary>
              </div>
              <div ref={tableRef} className="scroll-mt-4">
              <ActivityFilterControls event={eventFilter} start={startFilter} end={endFilter} error={filterError} onEventChange={setEventFilter} onStartChange={setStartFilter} onEndChange={setEndFilter} />
              <MarketActivityTable
                rows={payload?.rows ?? []}
                ethUsdPrice={ethUsdPrice}
                showItem={false}
                hasMore={Boolean(payload?.hasMore)}
                loadingMore={loadingMore}
                onLoadMore={() => void loadMore()}
                onSearchWallet={onSearchWallet}
              />
              </div>
              {false && <div className="hidden">
                {([] as unknown[]).slice(-5).reverse().map((value, index) => {
                  const sale = statsRecord(value) ?? {};
                  const amount = statsNumber(sale.salePrice ?? sale.price ?? sale.priceEth ?? sale.eth ?? sale.amount);
                  const at = statsString(sale.at ?? sale.timestamp ?? sale.date);
                  const txHash = statsString(sale.txHash ?? sale.tx_hash ?? sale.transactionHash);
                  const marketplace = statsString(sale.marketplace ?? sale.market) ?? "Sale";
                  const pfpUrl = statsString(sale.avatarUrl ?? sale.pfpUrl ?? sale.buyerPfpUrl);
                  const buyer = statsString(sale.buyerUsername ?? sale.username);
                  const buyerFid = statsInteger(sale.buyerFid ?? sale.buyer_fid);
                  const isTopFriend = sale.isTopFriend === true || sale.is_top_friend === true;
                  const content = (
                    <>
                      {pfpUrl ? (
                        <img
                          src={pfpUrl}
                          alt=""
                          className={`h-7 w-7 rounded-full border-2 object-cover ${isTopFriend ? "border-[#00FF00] ring-1 ring-[#CCFFCC] shadow-[0_0_6px_#00FF00]" : "border-[#00FF00]/45"}`}
                          loading="lazy"
                        />
                      ) : (
                        <span className="h-2.5 w-2.5 rounded-full bg-[#00FF00]" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[10px] font-black text-[#00FF00]">
                          {amount == null
                            ? "Sale"
                            : `${formatEthNumber(amount, 8).replace(/\s*\u039e$/, "")} ETH`} · {marketplace}
                        </span>
                        <span className="block truncate text-[9px] text-[#8bbf8b]">
                          {buyer ? `@${buyer.replace(/^@/, "")}` : "Unknown buyer"}{at ? ` · ${formatMarketTimestamp(at)}` : ""}
                        </span>
                      </span>
                    </>
                  );
                  return txHash ? (
                    <button
                      key={`${txHash}-${index}`}
                      type="button"
                      onClick={() => void openExternalAsset(`https://basescan.org/tx/${txHash}`)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-[#00FF00]/10 bg-black/45 px-2 py-1.5 text-left hover:border-[#00FF00]/35"
                    >
                      {content}
                    </button>
                  ) : (
                    <div key={`${at ?? index}-${index}`} className="flex items-center gap-2 rounded-lg border border-[#00FF00]/10 bg-black/45 px-2 py-1.5">
                      {content}
                    </div>
                  );
                })}
              </div>}
              <div className="hidden">
                {payload?.complete === false ? "Partial history" : "History complete"} · D1 observed activity
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function formatUsdMoneyFromMarket(value: MarketMoney | null | undefined, ethUsdPrice: number | null): string {
  const amount = marketMoneyToDecimal(value);
  if (amount == null || ethUsdPrice == null) return "USD loading...";
  return (amount * ethUsdPrice).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getCollectionOfferOrdersForQuantity(
  orders: CollectionOfferGroup["userOrders"],
  quantity: number,
): CollectionOfferGroup["userOrders"] {
  const selected: CollectionOfferGroup["userOrders"] = [];
  let remaining = Math.max(1, Math.floor(quantity));
  for (const order of orders) {
    if (remaining <= 0) break;
    selected.push(order);
    remaining -= Math.max(1, order.quantity);
  }
  return selected;
}

function getCollectionOfferOrderQuantity(orders: CollectionOfferGroup["userOrders"]): number {
  return orders.reduce((total, order) => total + Math.max(1, Math.floor(order.quantity)), 0);
}

function getCollectionOfferCancellableTotals(orders: CollectionOfferGroup["userOrders"]): number[] {
  const totals: number[] = [];
  let runningTotal = 0;
  for (const order of orders) {
    runningTotal += Math.max(1, Math.floor(order.quantity));
    if (!totals.includes(runningTotal)) totals.push(runningTotal);
  }
  return totals;
}

function snapCollectionOfferCancelQuantity(orders: CollectionOfferGroup["userOrders"], requestedQuantity: number): number {
  const requested = Math.max(1, Math.floor(requestedQuantity));
  const totals = getCollectionOfferCancellableTotals(orders);
  return totals.find((total) => total >= requested) ?? totals[totals.length - 1] ?? requested;
}

function stepCollectionOfferCancelQuantity(totals: number[], currentQuantity: number, direction: -1 | 1): number {
  if (totals.length === 0) return Math.max(1, currentQuantity);
  const currentIndex = totals.findIndex((total) => total >= currentQuantity);
  const baseIndex = currentIndex < 0 ? totals.length - 1 : currentIndex;
  const nextIndex = Math.max(0, Math.min(totals.length - 1, baseIndex + direction));
  return totals[nextIndex] ?? totals[0];
}

function formatCollectionBidderTitlePrice(value: MarketMoney | null | undefined): string {
  const amount = marketMoneyToDecimal(value);
  return amount == null ? "-" : formatEthNumber(amount, 8);
}

function formatCollectionBidderWallet(value: string | null | undefined): string {
  const wallet = value?.trim();
  if (!wallet) return "-";
  return wallet.length > 6 ? `${wallet.slice(0, 6)}...` : wallet;
}

function CollectionBiddersModal({
  group,
  isInMiniAppContext,
  offerLabel = "Collection",
  offerEmoji,
  offerLevel,
  showPrice = true,
  titleOverride,
  onClose,
}: {
  group: CollectionOfferGroup;
  isInMiniAppContext: boolean;
  offerLabel?: string;
  offerEmoji?: string;
  offerLevel?: string;
  showPrice?: boolean;
  titleOverride?: string;
  onClose: () => void;
}) {
  const handleOpenFarcaster = useCallback((bidder: CollectionOfferBidder) => {
    void hapticTap();
    if (isInMiniAppContext && bidder.fid) {
      viewFarcasterProfile(bidder.fid).catch((error) => {
        console.error("Failed to open Farcaster bidder profile:", error);
      });
      return;
    }
    if (bidder.farcasterUrl) {
      openExternalAsset(bidder.farcasterUrl).catch((error) => {
        console.error("Failed to open Farcaster bidder URL:", error);
      });
    }
  }, [isInMiniAppContext]);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80 p-4 sm:items-center">
      <div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-[#00FF00]/35 bg-black shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[#00FF00]/20 px-4 py-3">
          <Text className="text-base font-bold text-[#d7ffd7]">
            {showPrice && <span className="text-[#00FF00]">{formatCollectionBidderTitlePrice(group.price)} </span>}
            {titleOverride ?? `${offerEmoji ? `${offerEmoji} ` : ""}${offerLevel ? `${offerLevel} ` : ""}${offerLabel} bidders`}
          </Text>
          <button
            type="button"
            onClick={() => {
              void hapticTap();
              onClose();
            }}
            className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-[#00FF00]/35 text-sm font-bold text-[#00FF00] hover:bg-[#041204]"
            aria-label={`Close ${offerLabel.toLowerCase()} bidders`}
          >
            X
          </button>
        </div>
        <OverlayScrollArea className="max-h-[68vh] overflow-auto">
          <div className="w-full min-w-0">
            <div className="grid w-full grid-cols-[104px_42px_repeat(3,minmax(0,1fr))] items-center gap-0.5 border-b border-[#00FF00]/20 bg-[#041204] px-2 py-2 text-center text-[10px] font-bold uppercase text-[#8bbf8b]">
              <span>Wallet</span>
              <span>Offers</span>
              <span>OpenSea</span>
              <span>Farcaster</span>
              <span>Twitter</span>
            </div>
            {group.orders.map((order) => {
              const bidder = order.bidder;
              return (
                <div
                  key={order.orderHash}
                  className="grid w-full grid-cols-[104px_42px_repeat(3,minmax(0,1fr))] items-center gap-0.5 border-b border-[#00FF00]/10 px-2 py-2 text-center text-xs"
                >
                  <button
                    type="button"
                    onClick={() => {
                      void hapticTap();
                      openExternalAsset(bidder.basescanUrl).catch(() => undefined);
                    }}
                    className="flex min-w-0 items-center gap-1.5 text-left font-bold text-[#00FF00] hover:text-[#66ff66]"
                    title={`Open ${formatShortWallet(bidder.wallet)} on Basescan`}
                  >
                    <img
                      src={bidder.pfpUrl || getWalletIdenticonDataUrl(bidder.wallet)}
                      alt=""
                      className="h-6 w-6 shrink-0 rounded-full border border-[#00FF00]/45 object-cover"
                      loading="lazy"
                    />
                    <span className="truncate">{formatCollectionBidderWallet(bidder.wallet)}</span>
                  </button>
                  <span className="font-bold text-[#8bbf8b]">{order.quantity}</span>
                  <button
                    type="button"
                    onClick={() => {
                      void hapticTap();
                      openExternalAsset(bidder.openseaUrl).catch(() => undefined);
                    }}
                    className="mx-auto flex h-7 w-[62px] items-center justify-center rounded-md border border-[#33AAFF]/45 px-1 text-[0px] font-bold text-[#33AAFF] after:text-[9px] after:content-['OpenSea'] hover:bg-[rgba(51,170,255,0.12)]"
                    aria-label="Open bidder on OpenSea"
                    title="OpenSea"
                  >
                    ⛵
                  </button>
                  {bidder.farcasterUrl || bidder.fid ? (
                    <button
                      type="button"
                      onClick={() => handleOpenFarcaster(bidder)}
                      className="mx-auto flex h-7 w-[62px] items-center justify-center rounded-md border border-[#8B5CF6]/45 px-1 text-[0px] font-bold text-[#c4b5fd] after:text-[9px] after:content-['Farcaster'] hover:bg-[rgba(139,92,246,0.14)]"
                      aria-label="Open bidder on Farcaster"
                      title="Farcaster"
                    >
                      ⛩️
                    </button>
                  ) : (
                    <span className="font-bold text-[#536b53]">-</span>
                  )}
                  {bidder.xUrl ? (
                    <button
                      type="button"
                      onClick={() => {
                        void hapticTap();
                        openExternalAsset(bidder.xUrl ?? "").catch(() => undefined);
                      }}
                      className="mx-auto flex h-7 w-[62px] items-center justify-center rounded-md border border-[#999]/45 px-1 text-[0px] font-bold text-[#d0d0d0] after:text-[9px] after:content-['Twitter'] hover:bg-white/10"
                      aria-label="Open bidder on X"
                      title="X (Twitter)"
                    >
                      🐦
                    </button>
                  ) : (
                    <span className="font-bold text-[#536b53]">-</span>
                  )}
                </div>
              );
            })}
          </div>
        </OverlayScrollArea>
      </div>
    </div>
  );
}

function CollectionOffersPage({
  connectedWallet,
  viewerFid,
  isInMiniAppContext,
  getProviderAndAccount,
  showToast,
  onShareOffer,
}: {
  connectedWallet: string | null;
  viewerFid: number | null;
  isInMiniAppContext: boolean;
  getProviderAndAccount: () => Promise<{ provider: EthereumProvider; account: string }>;
  showToast: (kind: TradeToast["kind"], message: string, options?: { manualClose?: boolean; minMs?: number }) => void;
  onShareOffer: (amountEth: number | null, quantity: number) => void;
}) {
  const [scope, setScope] = useState<"all" | "your">("all");
  const [payload, setPayload] = useState<CollectionOffersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<"offer" | "cancel" | null>(null);
  const [collectionBusyLabel, setCollectionBusyLabel] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [ethUsdPrice, setEthUsdPrice] = useState<number | null>(null);
  const [cancelGroup, setCancelGroup] = useState<CollectionOfferGroup | null>(null);
  const [biddersGroup, setBiddersGroup] = useState<CollectionOfferGroup | null>(null);
  const [cancelQuantity, setCancelQuantity] = useState(1);
  const [cancelRequestedQuantity, setCancelRequestedQuantity] = useState(1);
  const formRef = useRef<HTMLDivElement | null>(null);
  const collectionSubmitTimersRef = useRef<number[]>([]);
  const normalizedWallet = normalizeWalletAddress(connectedWallet);

  const clearCollectionSubmitTimers = useCallback(() => {
    collectionSubmitTimersRef.current.forEach((timerId) => window.clearInterval(timerId));
    collectionSubmitTimersRef.current = [];
  }, []);

  const beginOpenSeaSubmitLabels = useCallback((showCollectionOfferCountdown = false) => {
    clearCollectionSubmitTimers();
    const labels = [
      "Submitting to OpenSea...",
      "Waiting for OpenSea...",
      "OpenSea is building your offer...",
      "Waiting for OpenSea validation...",
      "Still waiting on OpenSea...",
      "Checking the offer submission...",
      "OpenSea is taking a little longer...",
      "Waiting for order confirmation...",
      "Still working on your offer...",
    ];
    let labelIndex = 0;
    setCollectionBusyLabel(labels[labelIndex]);
    const timers = [window.setInterval(() => {
      labelIndex = (labelIndex + 1) % labels.length;
      setCollectionBusyLabel(labels[labelIndex]);
    }, 10000)];
    if (showCollectionOfferCountdown) {
      let remainingSeconds = 120;
      const showCountdown = () => showToast(
        "neutral",
        `OpenSea Collection Offers can take ~2 minutes, please wait... ${remainingSeconds}`,
        { manualClose: true },
      );
      showCountdown();
      const countdownTimer = window.setInterval(() => {
        remainingSeconds = Math.max(0, remainingSeconds - 1);
        showCountdown();
        if (remainingSeconds === 0) window.clearInterval(countdownTimer);
      }, 1000);
      timers.push(countdownTimer);
    }
    collectionSubmitTimersRef.current = timers;
  }, [clearCollectionSubmitTimers, showToast]);

  useEffect(() => clearCollectionSubmitTimers, [clearCollectionSubmitTimers]);

  const loadOffers = useCallback(async (options: { refresh?: boolean } = {}) => {
    if (options.refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams();
      if (normalizedWallet) params.set("wallet", normalizedWallet);
      if (scope === "your") params.set("scope", "your");
      if (options.refresh) params.set("refresh", "1");
      const response = await fetch(`/api/collection-offers?${params.toString()}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Collection offers failed (${response.status})`);
      setPayload(await response.json() as CollectionOffersPayload);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Collection offers failed.", { manualClose: true });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [normalizedWallet, scope, showToast]);

  useEffect(() => {
    void loadOffers();
  }, [loadOffers]);

  useEffect(() => {
    fetchEthUsdPrice()
      .then(setEthUsdPrice)
      .catch((error) => console.warn("Failed to fetch ETH/USD for collection offers:", error));
  }, []);

  const setPriceFromMarket = useCallback((value: MarketMoney | null | undefined) => {
    const amount = marketMoneyToDecimal(value);
    if (amount != null && amount > 0) setPrice(formatTradePriceInput(amount));
  }, []);

  const formPriceRaw = decimalEthToWeiString(price);
  const priceIsValid = Boolean(formPriceRaw && BigInt(formPriceRaw) > 0n);
  const clampedQuantity = Math.min(10000, Math.max(1, Math.floor(quantity)));
  const topOfferPrice = defaultOfferPrice(payload?.topCollectionOffer);
  const cancelTotals = useMemo(
    () => cancelGroup ? getCollectionOfferCancellableTotals(cancelGroup.userOrders) : [],
    [cancelGroup],
  );
  const selectedCancelOrders = useMemo(
    () => cancelGroup ? getCollectionOfferOrdersForQuantity(cancelGroup.userOrders, cancelQuantity) : [],
    [cancelGroup, cancelQuantity],
  );
  const actualCancelQuantity = useMemo(() => getCollectionOfferOrderQuantity(selectedCancelOrders), [selectedCancelOrders]);

  const setRequestedCancelQuantity = useCallback((requestedQuantity: number) => {
    if (!cancelGroup) {
      const fallback = Math.max(1, Math.floor(requestedQuantity));
      setCancelRequestedQuantity(fallback);
      setCancelQuantity(fallback);
      return;
    }
    const requested = Math.min(cancelGroup.userOfferCount, Math.max(1, Math.floor(requestedQuantity)));
    setCancelRequestedQuantity(requested);
    setCancelQuantity(snapCollectionOfferCancelQuantity(cancelGroup.userOrders, requested));
  }, [cancelGroup]);

  const stepCancelQuantity = useCallback((direction: -1 | 1) => {
    if (!cancelGroup) return;
    const next = stepCollectionOfferCancelQuantity(cancelTotals, cancelQuantity, direction);
    setCancelRequestedQuantity(next);
    setCancelQuantity(next);
  }, [cancelGroup, cancelQuantity, cancelTotals]);

  const runMakeCollectionOffer = useCallback(async () => {
    const priceRaw = decimalEthToWeiString(price);
    if (!priceRaw || BigInt(priceRaw) <= 0n) {
      showToast("error", "Enter a valid collection offer price.", { manualClose: true });
      return;
    }
    const actionId = crypto.randomUUID();
    recordLocalOfferDiagnostic("collection_offer.started", {
      actionId,
      quantity: clampedQuantity,
      priceRaw,
      viewerFid,
    });
    setBusy("offer");
    setCollectionBusyLabel("Preparing...");
    try {
      void hapticPrimaryTap();
      const { provider, account } = await getProviderAndAccount();
      const initialChainId = await provider.request({ method: "eth_chainId" }).catch((error) => {
        recordLocalOfferDiagnostic("collection_offer.chain_read_failed", { actionId, error });
        return null;
      });
      recordLocalOfferDiagnostic("collection_offer.wallet_ready", {
        actionId,
        connector: provider.connectorId ?? (provider.isBaseAccount ? "base-account" : "unknown"),
        isBaseAccount: Boolean(provider.isBaseAccount),
        account,
        chainId: initialChainId,
      });
      recordLocalOfferDiagnostic("collection_offer.prepare_started", { actionId });
      const response = await fetch("/api/collection-offers/prepare", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          actionId,
          fid: viewerFid,
          wallet: account,
          priceRaw,
          quantity: clampedQuantity,
          durationSeconds: DEFAULT_TRADE_DURATION_SECONDS,
        }),
      });
      const prepared = await response.json().catch(() => ({})) as {
        protocolAddress?: string;
        parameters?: unknown;
        typedData?: unknown;
        chainIdHex?: string;
        wethApproval?: TokenApprovalRequirement;
        totalRaw?: string;
        message?: string;
      };
      recordLocalOfferDiagnostic("collection_offer.prepare_received", {
        actionId,
        status: response.status,
        ok: response.ok,
        hasParameters: Boolean(prepared.parameters),
        hasTypedData: Boolean(prepared.typedData),
        protocolAddress: prepared.protocolAddress ?? null,
        chainIdHex: prepared.chainIdHex ?? null,
        totalRaw: prepared.totalRaw ?? null,
        wethApproval: prepared.wethApproval ?? null,
        message: prepared.message ?? null,
      });
      if (!response.ok) throw new Error(prepared.message || `Collection offer prepare failed (${response.status})`);
      if (prepared.wethApproval) {
        await ensureBaseChain(provider, prepared.chainIdHex ?? undefined);
        const requiredWeth = BigInt(prepared.wethApproval.amount);
        const currentWeth = await readErc20Balance(prepared.wethApproval.tokenAddress, account);
        recordLocalOfferDiagnostic("collection_offer.funds_checked", {
          actionId,
          account,
          requiredWeth: requiredWeth.toString(),
          currentWeth: currentWeth.toString(),
          wrapRequired: currentWeth < requiredWeth,
        });
        if (currentWeth < requiredWeth) {
          const missingWeth = requiredWeth - currentWeth;
          const nativeEth = await readNativeBalance(account);
          if (nativeEth <= missingWeth) {
            throw new Error(
              `Offer requires ${formatWeiTokenAmount(requiredWeth, "WETH")}. Wallet has ${formatWeiTokenAmount(currentWeth, "WETH")} and ${formatWeiTokenAmount(nativeEth, "ETH")}.`,
            );
          }
          setCollectionBusyLabel("Waiting for wallet...");
          if (!getExternalWalletReviewName(provider)) {
            showToast("neutral", `Wrap ${formatWeiTokenAmount(missingWeth, "ETH")} to WETH to make this offer...`, { minMs: 5000 });
          }
          await wrapEthToWeth(provider, account, prepared.wethApproval.tokenAddress, missingWeth);
          showToast("neutral", "ETH wrapped to WETH. Continuing offer...", { minMs: 5000 });
        }
        setCollectionBusyLabel("Waiting for wallet...");
        await ensureErc20Approval(provider, account, prepared.wethApproval);
      }
      if (!prepared.typedData || !prepared.parameters || !prepared.protocolAddress) {
        throw new Error("OpenSea did not return collection offer signature data");
      }
      setCollectionBusyLabel("Waiting for wallet...");
      if (!getExternalWalletReviewName(provider)) {
        showToast("neutral", "Check your wallet to confirm the collection offer...", { minMs: 5000 });
      }
      recordLocalOfferDiagnostic("collection_offer.signing_started", { actionId });
      const signature = await signTypedData(provider, account, prepared.typedData);
      recordLocalOfferDiagnostic("collection_offer.signing_complete", { actionId, signatureLength: signature.length });
      beginOpenSeaSubmitLabels(true);
      const submitBody = JSON.stringify({
          actionId,
          fid: viewerFid,
          wallet: account,
          priceRaw,
          quantity: clampedQuantity,
          payload: {
            parameters: prepared.parameters,
            protocol_address: prepared.protocolAddress,
            signature,
          },
        });
      const { response: submit, responseText, attempts } = await submitTraitOfferWithRetry(submitBody, {
        endpoint: "/api/collection-offers/submit",
        onRetry: ({ attempt, nextAttempt, delayMs, status, responseText: retryResponseText, error }) => {
          setCollectionBusyLabel("Confirming submitted offer...");
          recordLocalOfferDiagnostic("collection_offer.submit_retry_scheduled", {
            actionId,
            attempt,
            nextAttempt,
            delayMs,
            status,
            error,
            responsePreview: retryResponseText.slice(0, 1000),
          });
        },
      });
      recordLocalOfferDiagnostic("collection_offer.submit_received", {
        actionId,
        status: submit.status,
        ok: submit.ok,
        attempts,
      });
      if (!submit.ok) {
        let failure: { message?: string } = {};
        try { failure = responseText ? JSON.parse(responseText) as { message?: string } : {}; } catch { /* Preserve status fallback. */ }
        throw new Error(failure.message || `Collection offer submit failed (${submit.status})`);
      }
      clearCollectionSubmitTimers();
      void hapticSuccess();
      showTradeConfetti();
      showToast("success", "Collection offer successfully made", { minMs: 5000 });
      onShareOffer(parseTradeAmount(price), clampedQuantity);
      setCollectionBusyLabel("Refreshing offers...");
      await loadOffers();
    } catch (error) {
      recordLocalOfferDiagnostic("collection_offer.failed", { actionId, error });
      void hapticError();
      showToast("error", error instanceof Error ? error.message : "Collection offer failed.", { manualClose: true });
    } finally {
      clearCollectionSubmitTimers();
      setCollectionBusyLabel(null);
      setBusy(null);
    }
  }, [beginOpenSeaSubmitLabels, clampedQuantity, clearCollectionSubmitTimers, getProviderAndAccount, loadOffers, onShareOffer, price, showToast, viewerFid]);

  const runCancelCollectionOffers = useCallback(async () => {
    if (!cancelGroup) return;
    const orders = selectedCancelOrders
      .filter((order) => order.orderHash && order.protocolAddress);
    if (orders.length === 0) {
      showToast("error", "No collection offers are available to cancel.", { manualClose: true });
      return;
    }
    const actionId = crypto.randomUUID();
    setBusy("cancel");
    setCollectionBusyLabel("Preparing...");
    try {
      void hapticPrimaryTap();
      const { provider, account } = await getProviderAndAccount();
      const response = await fetch("/api/collection-offers/cancel-prepare", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ actionId, fid: viewerFid, orders }),
      });
      const prepared = await response.json().catch(() => ({})) as {
        protocolAddress?: string;
        orderParameters?: SeaportCancelOrderParameters[];
        chainIdHex?: string;
        message?: string;
      };
      if (!response.ok) throw new Error(prepared.message || `Collection offer cancel prepare failed (${response.status})`);
      if (!prepared.protocolAddress || !prepared.orderParameters?.length) throw new Error("OpenSea did not return cancel transaction data");
      await ensureBaseChain(provider, prepared.chainIdHex ?? undefined);
      setCollectionBusyLabel("Waiting for wallet...");
      if (!getExternalWalletReviewName(provider)) {
        showToast("neutral", "Check your wallet to confirm cancellation...", { minMs: 5000 });
      }
      await sendPreparedTransaction(
        provider,
        account,
        buildSeaportCancelTransaction(prepared.protocolAddress, prepared.orderParameters),
      );
      beginOpenSeaSubmitLabels();
      const submit = await fetch("/api/collection-offers/cancel", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ actionId, fid: viewerFid, orders }),
      });
      if (!submit.ok) {
        const failure = await submit.json().catch(() => ({})) as { message?: string };
        throw new Error(failure.message || `Collection offer cancel failed (${submit.status})`);
      }
      clearCollectionSubmitTimers();
      setCancelGroup(null);
      void hapticSuccess();
      showTradeConfetti();
      showToast("success", "Collection offer successfully canceled", { minMs: 5000 });
      setCollectionBusyLabel("Refreshing offers...");
      await loadOffers();
    } catch (error) {
      void hapticError();
      showToast("error", error instanceof Error ? error.message : "Collection offer cancellation failed.", { manualClose: true });
    } finally {
      clearCollectionSubmitTimers();
      setCollectionBusyLabel(null);
      setBusy(null);
    }
  }, [beginOpenSeaSubmitLabels, cancelGroup, clearCollectionSubmitTimers, getProviderAndAccount, loadOffers, selectedCancelOrders, showToast, viewerFid]);

  const stats = payload?.stats;
  const rows = payload?.groups ?? [];

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-10 pt-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-[#00FF00]/30 bg-[rgba(0,255,0,0.08)] p-3">
          <Text className="text-[11px] font-bold uppercase text-[#8bbf8b]">Count</Text>
          <div className="mt-1 text-2xl font-bold text-[#00FF00]">{stats?.count ?? 0}</div>
        </div>
        <div className="rounded-lg border border-[#33AAFF]/30 bg-[rgba(51,170,255,0.08)] p-3">
          <Text className="text-[11px] font-bold uppercase text-[#8bcfff]">Value</Text>
          <div className="mt-1 text-2xl font-bold text-[#33AAFF]"><InlineHoverTooltip value={formatMarketValue(stats?.value, { maxDigits: 8 })} tooltip={formatUsdMoneyFromMarket(stats?.value, ethUsdPrice)} className="text-[#33AAFF]" tone="blue"/></div>
        </div>
      </div>

      <div ref={formRef} className="mt-4 rounded-xl border border-[#33AAFF]/35 bg-[rgba(51,170,255,0.12)] p-3">
        <label className="block text-[11px] font-bold uppercase text-[#8bcfff]">
          <span className="flex items-center justify-between gap-3">
            <span>Offered at</span>
            <span className="text-right text-[11px] text-[#8bcfff]">
              {formatUsdEstimate(price, ethUsdPrice, payload?.topCollectionOffer)}
            </span>
          </span>
          <div className="mt-1 flex items-center rounded-lg border-2 border-[#33AAFF]/35 bg-black/60 px-3 py-2 transition-[border-color,box-shadow] focus-within:border-[#33AAFF] focus-within:shadow-[0_0_10px_rgba(51,170,255,0.22)]">
            <input
              data-no-focus-ring
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(sanitizeTradePriceInput(event.target.value))}
              placeholder="0.0001"
              className="min-w-0 flex-1 appearance-none border-0 bg-transparent text-base font-bold text-[#33AAFF] outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0"
            />
            <span className="text-sm font-bold text-[#33AAFF]">WETH</span>
          </div>
        </label>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex shrink-0 items-center gap-2">
            <img
              src={getWarpletPreviewImageUrl(760)}
              alt=""
              className="h-8 w-8 shrink-0 rounded-md border border-[#33AAFF]/35 object-cover"
              loading="lazy"
            />
            <span className="shrink-0 text-sm font-bold text-[#33AAFF]">10X Warplets</span>
          </div>
          <button
            type="button"
            onClick={() => {
              void hapticTap();
              setQuantity((current) => Math.max(1, current - 1));
            }}
            className="h-8 w-8 cursor-pointer rounded-md border border-[#33AAFF]/35 text-lg font-bold text-[#33AAFF] hover:bg-[#061827]"
          >
            -
          </button>
          <div className="flex min-w-0 flex-1 items-center rounded-lg border-2 border-[#33AAFF]/35 bg-black/60 px-3 py-1.5 transition-[border-color,box-shadow] focus-within:border-[#33AAFF] focus-within:shadow-[0_0_10px_rgba(51,170,255,0.22)]">
            <input
              data-no-focus-ring
              type="number"
              min={1}
              max={10000}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(Math.min(10000, Math.max(1, Math.floor(Number(event.target.value) || 1))))}
              className="min-w-0 flex-1 appearance-none border-0 bg-transparent text-center text-base font-bold text-[#33AAFF] outline-none ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              void hapticTap();
              setQuantity((current) => Math.min(10000, current + 1));
            }}
            className="h-8 w-8 cursor-pointer rounded-md border border-[#33AAFF]/35 text-lg font-bold text-[#33AAFF] hover:bg-[#061827]"
          >
            +
          </button>
        </div>
        <p className="mt-2 text-[11px] font-bold text-[#8bcfff]">
          Offer will be on OpenSea. Set price to{" "}
          <button
            type="button"
            disabled={!topOfferPrice}
            onClick={() => {
              void hapticTap();
              if (payload?.topCollectionOffer) setPriceFromMarket(payload.topCollectionOffer);
            }}
            className="cursor-pointer text-[#33AAFF] underline underline-offset-2 hover:text-[#70c6ff] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Top Collection Offer
          </button>
          .
        </p>
        <button
          type="button"
          onClick={() => void runMakeCollectionOffer()}
          disabled={busy !== null || !priceIsValid}
          className="mt-3 w-full cursor-pointer rounded-[20px] border border-[#1c78b3] bg-[#33AAFF] px-5 py-3 text-base font-bold leading-normal text-[rgb(0,54,80)] shadow-[3px_6px_0_#1c78b3] transition-all duration-100 hover:bg-[#70c6ff] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#1c78b3] disabled:cursor-wait disabled:opacity-70"
        >
          {busy === "offer" ? (collectionBusyLabel ?? "Preparing...") : "Review collection offer"}
        </button>
      </div>

      <SearchSegmentedTabs
        className="mt-4"
        options={OFFERS_FILTER_TABS}
        activeId={scope}
        onSelect={(id) => setScope(id === "your" ? "your" : "all")}
      />

      <div className="mt-4 overflow-hidden rounded-lg border border-[#00FF00]/25">
        <div className="grid grid-cols-[1fr_1fr_56px_72px_72px] items-center gap-1 bg-[#041204] px-2 py-2 text-center text-[10px] font-bold uppercase text-[#8bbf8b]">
          <span>Price</span>
          <span>Volume</span>
          <span>Offers</span>
          <span>Bidders</span>
          <span>Action</span>
        </div>
        {loading ? (
          <div className="px-3 py-6 text-center text-sm font-bold text-[#8bbf8b]">Loading offers...</div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm font-bold text-[#8bbf8b]">No collection offers.</div>
        ) : rows.map((group) => (
          <div key={group.price.rawAmount ?? String(group.price.eth)} className="grid grid-cols-[1fr_1fr_56px_72px_72px] items-center gap-1 border-t border-[#00FF00]/15 px-2 py-2 text-center text-xs">
            <OfferPriceTooltipButton
              price={group.price}
              ethUsdPrice={ethUsdPrice}
              onClick={() => {
                void hapticTap();
                setPriceFromMarket(group.price);
                setQuantity(1);
                formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            />
            <span className="flex justify-center">
              <InlineHoverTooltip
                value={formatMarketValue(group.volume, { maxDigits: 5 })}
                tooltip={formatUsdMoneyFromMarket(group.volume, ethUsdPrice)}
                className="text-[#00FF00]"
              />
            </span>
            <span className="text-center font-bold text-[#8bbf8b]">{group.offerCount}</span>
            <button
              type="button"
              disabled={group.orders.length === 0}
              onClick={() => {
                void hapticTap();
                setBiddersGroup(group);
              }}
              className="flex w-full cursor-pointer justify-center -space-x-2 disabled:cursor-default disabled:opacity-60"
              title="View collection bidders"
            >
              {group.previewBidders.slice(0, 3).map((bidder) => (
                <span
                  key={bidder.wallet}
                  className="h-7 w-7 overflow-hidden rounded-full border-2 border-[#00FF00] bg-black"
                >
                  <img src={bidder.pfpUrl || getWalletIdenticonDataUrl(bidder.wallet)} alt="" className="h-full w-full object-cover" loading="lazy" />
                </span>
              ))}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                void hapticTap();
                if (group.userOfferCount > 0) {
                  setCancelGroup(group);
                  setCancelRequestedQuantity(group.userOfferCount);
                  setCancelQuantity(snapCollectionOfferCancelQuantity(group.userOrders, group.userOfferCount));
                  return;
                }
                setPriceFromMarket(group.price);
                setQuantity(1);
                formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={`cursor-pointer justify-self-center rounded-md border px-2 py-1.5 text-xs font-bold disabled:cursor-wait ${group.userOfferCount > 0 ? "border-[#FF5555]/55 text-[#FF7777] hover:bg-[rgba(255,85,85,0.12)]" : "border-[#33AAFF]/55 text-[#33AAFF] hover:bg-[rgba(51,170,255,0.12)]"}`}
            >
              {group.userOfferCount > 0 ? "Cancel" : "Offer"}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 text-center text-[11px] leading-4 text-[#8bbf8b]">
        Last updated: {payload?.generatedAt ? formatMarketTimestamp(payload.generatedAt) : "Not yet"}
        {". "}
        <span
          role="button"
          tabIndex={refreshing || busy !== null ? -1 : 0}
          aria-disabled={refreshing || busy !== null}
          onClick={() => {
            if (refreshing || busy !== null) return;
            void hapticPrimaryTap();
            void loadOffers({ refresh: true });
          }}
          onKeyDown={(event) => {
            if (refreshing || busy !== null) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void hapticPrimaryTap();
              void loadOffers({ refresh: true });
            }
          }}
          className={`font-bold text-[#00FF00] ${refreshing || busy !== null ? "cursor-wait opacity-60" : "cursor-pointer"}`}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </span>
        {payload?.refreshError && (
          <span className="block text-red-300">{payload.refreshError}</span>
        )}
      </div>

      {cancelGroup && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-xl border border-[#FF5555]/45 bg-black p-4 shadow-2xl">
            <Text className="text-base font-bold text-[#FF7777]">Cancel collection offers</Text>
            <p className="mt-2 text-sm font-bold text-[#d9b0b0]">
              Cancel up to {cancelGroup.userOfferCount} collection offers at {formatMarketValue(cancelGroup.price, { maxDigits: 8 })}.
            </p>
            <div className="mt-3 flex items-center rounded-lg border-2 border-[#FF5555]/35 bg-black/60 px-2 py-1.5">
              <button type="button" onClick={() => stepCancelQuantity(-1)} className="h-8 w-8 rounded-md border border-[#FF5555]/35 text-lg font-bold text-[#FF7777]">-</button>
              <input
                data-no-focus-ring
                type="number"
                min={1}
                max={cancelGroup.userOfferCount}
                step={1}
                value={cancelRequestedQuantity}
                onChange={(event) => setRequestedCancelQuantity(Number(event.target.value) || 1)}
                className="mx-2 min-w-0 flex-1 appearance-none border-0 bg-transparent text-center text-base font-bold text-[#FF7777] outline-none ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button type="button" onClick={() => stepCancelQuantity(1)} className="h-8 w-8 rounded-md border border-[#FF5555]/35 text-lg font-bold text-[#FF7777]">+</button>
            </div>
            <p className="mt-2 text-[11px] font-bold text-[#d9b0b0]">
              Cancellable totals: {cancelTotals.length > 0 ? cancelTotals.join(", ") : cancelGroup.userOfferCount}.
            </p>
            {actualCancelQuantity > cancelRequestedQuantity && selectedCancelOrders.length > 0 && (
              <p className="mt-2 rounded-lg border border-[#FFAA33]/40 bg-[rgba(255,170,51,0.12)] px-3 py-2 text-xs font-bold text-[#ffd599]">
                Cancel {cancelRequestedQuantity} requested. This will cancel {actualCancelQuantity} offers across {selectedCancelOrders.length} OpenSea orders.
              </p>
            )}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void runCancelCollectionOffers()}
              className="mt-4 w-full cursor-pointer rounded-[20px] border border-[#a83232] bg-[#FF5555] px-5 py-3 text-base font-bold text-[#2c0000] shadow-[3px_6px_0_#8a2222] transition-all duration-100 hover:bg-[#ff7777] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#8a2222] disabled:cursor-wait disabled:opacity-70"
            >
              {busy === "cancel" ? (collectionBusyLabel ?? "Preparing...") : "Review cancellation"}
            </button>
            <button
              type="button"
              onClick={() => setCancelGroup(null)}
              className="mx-auto mt-2 block cursor-pointer px-4 py-2 text-xs font-bold text-[#FF7777] underline underline-offset-4 hover:text-[#ff9999]"
            >
              Keep offers
            </button>
          </div>
        </div>
      )}
      {biddersGroup && (
        <CollectionBiddersModal
          group={biddersGroup}
          isInMiniAppContext={isInMiniAppContext}
          onClose={() => setBiddersGroup(null)}
        />
      )}
    </div>
  );
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
  await Promise.all(results.map((result) => preloadImage(getWarpletPreviewImageUrl(result.id))));
}

async function preloadResultImagesWithTimeout(results: WarpletResult[]): Promise<void> {
  let timeoutId: number | null = null;
  try {
    await Promise.race([
      preloadResultImages(results),
      new Promise<void>((resolve) => {
        timeoutId = window.setTimeout(resolve, SEARCH_RESULT_IMAGE_PRELOAD_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}

async function openExternalAsset(url: string) {
  await openAppUrl(url);
}

function ProgressiveWarpletImage({
  tokenId,
  alt = "",
  loading = "lazy",
  className = "",
  imageClassName = "",
}: {
  tokenId: number;
  alt?: string;
  loading?: "eager" | "lazy";
  className?: string;
  imageClassName?: string;
}) {
  const [isPreviewLoaded, setIsPreviewLoaded] = useState(false);
  const [isFullQualityLoaded, setIsFullQualityLoaded] = useState(false);

  useEffect(() => {
    setIsPreviewLoaded(false);
    setIsFullQualityLoaded(false);
  }, [tokenId]);

  return (
    <span className={`relative block overflow-hidden ${className}`}>
      {!isPreviewLoaded && (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#00FF00]/25 border-t-[#00FF00]" />
        </span>
      )}
      <img
        src={getWarpletPreviewImageUrl(tokenId)}
        alt={alt}
        loading={loading}
        onLoad={() => setIsPreviewLoaded(true)}
        onError={() => setIsPreviewLoaded(true)}
        className={`absolute inset-0 h-full w-full object-cover ${imageClassName}`}
      />
      {isPreviewLoaded && (
        <img
          src={getWarpletImageUrl(tokenId)}
          alt=""
          aria-hidden="true"
          loading="eager"
          onLoad={() => setIsFullQualityLoaded(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-out ${isFullQualityLoaded ? "opacity-100" : "opacity-0"} ${imageClassName}`}
        />
      )}
    </span>
  );
}

function WarpletDetailsMedia({ tokenId }: { tokenId: number }) {
  const [isPngReady, setIsPngReady] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);

  useEffect(() => {
    setIsPngReady(false);
    setIsVideoReady(false);
  }, [tokenId]);

  return (
    <div className="relative aspect-square w-full overflow-hidden bg-[rgba(0,255,0,0.12)]">
      {!isPngReady && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#00FF00]/25 border-t-[#00FF00]" aria-label="Loading 10X Warplet image" />
        </div>
      )}
      <img
        src={getWarpletImageUrl(tokenId)}
        alt=""
        loading="eager"
        onLoad={() => setIsPngReady(true)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${isPngReady ? "opacity-100" : "opacity-0"}`}
      />
      {isPngReady && (
        <video
          src={getWarpletAssetUrl(tokenId, "mp4")}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
          onCanPlay={() => setIsVideoReady(true)}
          onLoadedData={() => setIsVideoReady(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-out ${isVideoReady ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
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
    onOpen(warplet.id);
  };

  return (
    <div
      style={{ contentVisibility: "auto", containIntrinsicSize: "420px" }}
      role="button"
      tabIndex={0}
      onClick={openCard}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openCard();
        }
      }}
      className="group relative flex w-full min-w-0 cursor-pointer flex-col rounded-[10px] border border-[#00FF00]/25 bg-[#041204]/90 p-0 text-left transition hover:-translate-y-px hover:border-2 hover:border-[#00FF00] hover:bg-[#071807]/95 hover:shadow-[0_0_16px_rgba(0,255,0,0.55)]"
    >
      <ProgressiveWarpletImage
        tokenId={warplet.id}
        alt=""
        loading="eager"
        className="aspect-square w-full rounded-t-[9px] bg-[rgba(0,255,0,0.12)]"
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

type ListedWarpletRow = {
  warplet: WarpletResult;
  market: TokenMarketState;
  groupKey: string;
};

type ListedWarpletGroup = {
  key: string;
  price: MarketOrderMoney;
  rows: ListedWarpletRow[];
};

function TraitOffersPage({
  connectedWallet,
  showBaseWalletWarning,
  viewerFid,
  isInMiniAppContext,
  getProviderAndAccount,
  showToast,
  onMarketChanged,
  onShareOffer,
  onOpenConnect,
}: {
  connectedWallet: string | null;
  showBaseWalletWarning: boolean;
  viewerFid: number | null;
  isInMiniAppContext: boolean;
  getProviderAndAccount: () => Promise<{ provider: EthereumProvider; account: string }>;
  showToast: (kind: TradeToast["kind"], message: string, options?: { manualClose?: boolean; minMs?: number }) => void;
  onMarketChanged: () => Promise<void>;
  onShareOffer: (input: { amountEth: number | null; quantity: number; attributes: LevelAttributeColumn[]; level: number }) => void;
  onOpenConnect: () => void;
}) {
  const [scope, setScope] = useState<"all" | "your">("all");
  const [selectedAttributes, setSelectedAttributes] = useState<LevelAttributeColumn[]>(() => LEVEL_ATTRIBUTES.map((item) => item.column));
  const [level, setLevel] = useState(10);
  const [payload, setPayload] = useState<TraitOffersPayload | null>(null);
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<"offer" | "cancel" | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [ethUsdPrice, setEthUsdPrice] = useState<number | null>(null);
  const [cancelGroup, setCancelGroup] = useState<(CollectionOfferGroup & { traitType: string; traitValue: string }) | null>(null);
  const [cancelQuantity, setCancelQuantity] = useState(1);
  const [cancelRequestedQuantity, setCancelRequestedQuantity] = useState(1);
  const [biddersGroup, setBiddersGroup] = useState<CollectionOfferGroup | null>(null);
  const [mobileSignaturePrompt, setMobileSignaturePrompt] = useState<{
    walletName: string;
    index: number;
    total: number;
    open: () => void;
    cancel: () => void;
  } | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const normalizedWallet = normalizeWalletAddress(connectedWallet);
  const attributeIds = selectedAttributes.map((column) => LEVEL_ATTRIBUTES.find((item) => item.column === column)?.label.toLowerCase()).filter((value): value is string => Boolean(value));

  const loadOffers = useCallback(async (options: { refresh?: boolean; silent?: boolean } = {}) => {
    if (!options.silent) {
      options.refresh ? setRefreshing(true) : setLoading(true);
    }
    try {
      const params = new URLSearchParams({ level: `${level}X`, attributes: attributeIds.join(",") });
      if (normalizedWallet) params.set("wallet", normalizedWallet);
      if (scope === "your") params.set("scope", "your");
      if (options.refresh) params.set("refresh", "1");
      const response = await fetch(`/api/trait-offers?${params.toString()}`, { headers: { accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(`Trait offers failed (${response.status})`);
      setPayload(await response.json() as TraitOffersPayload);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Trait offers failed.", { manualClose: true });
    } finally {
      if (!options.silent) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [attributeIds.join(","), level, normalizedWallet, scope, showToast]);

  useEffect(() => { void loadOffers(); }, [loadOffers]);
  useEffect(() => { fetchEthUsdPrice().then(setEthUsdPrice).catch(() => undefined); }, []);

  const setPriceFromMarket = (money: MarketMoney | null | undefined) => {
    const amount = marketMoneyToDecimal(money);
    if (amount != null && amount > 0) setPrice(formatTradePriceInput(amount));
  };
  const toggleAttribute = (column: LevelAttributeColumn) => {
    void hapticSelectionChanged();
    setSelectedAttributes((current) => {
      if (current.includes(column) && current.length > 1) return current.filter((item) => item !== column);
      if (current.includes(column)) return current;
      return [...current, column];
    });
  };
  const formPriceRaw = decimalEthToWeiString(price);
  const priceIsValid = Boolean(formPriceRaw && BigInt(formPriceRaw) > 0n);
  const clampedQuantity = Math.min(10000, Math.max(1, Math.floor(quantity)));
  const cancelTotals = useMemo(() => cancelGroup ? getCollectionOfferCancellableTotals(cancelGroup.userOrders) : [], [cancelGroup]);
  const selectedCancelOrders = useMemo(() => cancelGroup ? getCollectionOfferOrdersForQuantity(cancelGroup.userOrders, cancelQuantity) : [], [cancelGroup, cancelQuantity]);
  const actualCancelQuantity = useMemo(() => getCollectionOfferOrderQuantity(selectedCancelOrders), [selectedCancelOrders]);
  const selectedLabel = selectedAttributes.length === LEVEL_ATTRIBUTES.length
    ? "All"
    : selectedAttributes.length === 1
      ? LEVEL_ATTRIBUTES.find((item) => item.column === selectedAttributes[0])?.label ?? "1"
      : `${selectedAttributes.length} selected`;
  const ctaLabel = selectedAttributes.length === 1 ? "Review trait offer" : `Review ${selectedAttributes.length} trait offers`;

  const requestTraitOfferSignature = useCallback((
    provider: EthereumProvider,
    account: string,
    typedData: unknown,
    index: number,
    total: number,
  ): Promise<string> => {
    const handoff = getMobileWalletHandoff(provider);
    if (!handoff) return signTypedData(provider, account, typedData);
    recordLocalOfferDiagnostic("wallet.mobile_handoff_requested", { walletName: handoff.walletName, index, total });
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const clear = () => setMobileSignaturePrompt(null);
      const cancel = () => {
        if (settled) return;
        settled = true;
        clear();
        reject(Object.assign(new Error("Wallet signature request was cancelled."), { code: 4001 }));
      };
      const open = () => {
        if (settled) return;
        settled = true;
        clear();
        // Start the WalletConnect request while this button click still has a
        // live user gesture, then immediately hand iOS to the selected wallet.
        const signature = signTypedData(provider, account, typedData);
        openMobileWalletHandoff(handoff);
        signature.then(resolve, reject);
      };
      setMobileSignaturePrompt({ walletName: handoff.walletName, index, total, open, cancel });
    });
  }, []);

  const runMakeOffers = useCallback(async () => {
    const priceRaw = decimalEthToWeiString(price);
    if (!priceRaw || BigInt(priceRaw) <= 0n) return;
    setBusy("offer");
    setBusyLabel("Preparing...");
    let submitted = 0;
    const attemptId = crypto.randomUUID();
    recordLocalOfferDiagnostic("trait_offer.started", {
      attemptId,
      attributes: attributeIds,
      level: `${level}X`,
      quantity: clampedQuantity,
      priceRaw,
      viewerFid,
    });
    try {
      void hapticPrimaryTap();
      const { provider, account } = await getProviderAndAccount();
      const initialChainId = await provider.request({ method: "eth_chainId" }).catch((error) => {
        recordLocalOfferDiagnostic("trait_offer.chain_read_failed", { attemptId, error });
        return null;
      });
      recordLocalOfferDiagnostic("trait_offer.wallet_ready", {
        attemptId,
        connector: provider.connectorId ?? (provider.isBaseAccount ? "base-account" : "unknown"),
        isBaseAccount: Boolean(provider.isBaseAccount),
        account,
        chainId: initialChainId,
      });
      const prepared: Array<{ actionId: string; attribute: string; parameters?: unknown; typedData?: unknown; protocolAddress?: string; chainIdHex?: string; criteriaSource?: string; wethApproval?: TokenApprovalRequirement; totalRaw?: string; requiredWethRaw?: string; message?: string }> = [];
      for (const [attributeIndex, attribute] of attributeIds.entries()) {
        setBusyLabel(`Preparing ${attributeIndex + 1} of ${attributeIds.length}...`);
        const actionId = crypto.randomUUID();
        recordLocalOfferDiagnostic("trait_offer.prepare_started", { attemptId, actionId, attribute, index: attributeIndex + 1, total: attributeIds.length });
        const requestBody = JSON.stringify({ actionId, fid: viewerFid, wallet: account, priceRaw, quantity: clampedQuantity, durationSeconds: DEFAULT_TRADE_DURATION_SECONDS, attribute, level: `${level}X` });
        let response: Response | null = null;
        let responseText = "";
        let transportError: unknown = null;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (attempt > 0) {
            setBusyLabel(`Retrying ${attributeIndex + 1} of ${attributeIds.length}...`);
            await new Promise((resolve) => window.setTimeout(resolve, 1000 * (2 ** (attempt - 1))));
          }
          try {
            response = await fetch("/api/trait-offers/prepare", {
              method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
              body: requestBody,
            });
            responseText = await response.text();
            transportError = null;
            if (![502, 503, 504].includes(response.status)) break;
          } catch (error) {
            transportError = error;
            response = null;
            responseText = "";
          }
        }
        if (!response) throw transportError instanceof Error ? transportError : new Error(`Could not prepare ${attribute} trait offer`);
        let item: { actionId?: string; attribute?: string; parameters?: unknown; typedData?: unknown; protocolAddress?: string; chainIdHex?: string; criteriaSource?: string; wethApproval?: TokenApprovalRequirement; totalRaw?: string; requiredWethRaw?: string; message?: string } = {};
        try { item = JSON.parse(responseText) as typeof item; } catch { /* Preserve the HTTP response below. */ }
        recordLocalOfferDiagnostic("trait_offer.prepare_received", {
          attemptId,
          actionId,
          attribute,
          status: response.status,
          ok: response.ok,
          hasParameters: Boolean(item.parameters),
          hasTypedData: Boolean(item.typedData),
          protocolAddress: item.protocolAddress ?? null,
          chainIdHex: item.chainIdHex ?? null,
          criteriaSource: item.criteriaSource ?? null,
          totalRaw: item.totalRaw ?? null,
          requiredWethRaw: item.requiredWethRaw ?? null,
          wethApproval: item.wethApproval ?? null,
          message: item.message ?? null,
          responsePreview: response.ok ? null : responseText.slice(0, 500),
        });
        if (!response.ok || !item.parameters || !item.typedData || !item.protocolAddress || !item.attribute || !item.wethApproval) {
          const httpError = responseText && !responseText.trimStart().startsWith("<") ? responseText.slice(0, 500) : "";
          throw new Error(item.message || httpError || `Could not prepare ${attribute} trait offer (${response.status})`);
        }
        prepared.push({ ...item, actionId, attribute });
        if (attributeIndex + 1 < attributeIds.length) {
          await new Promise((resolve) => window.setTimeout(resolve, 750));
        }
      }
      await ensureBaseChain(provider, prepared[0]?.chainIdHex);
      const aggregateRaw = prepared.reduce(
        (total, item) => total + BigInt(item.requiredWethRaw ?? item.wethApproval?.amount ?? item.totalRaw ?? "0"),
        0n,
      );
      const wethToken = prepared[0].wethApproval!.tokenAddress;
      const currentWeth = await readErc20Balance(wethToken, account);
      const nativeBalance = await readNativeBalance(account);
      recordLocalOfferDiagnostic("trait_offer.funds_checked", {
        attemptId,
        account,
        aggregateRequiredWeth: aggregateRaw.toString(),
        currentWeth: currentWeth.toString(),
        nativeBalance: nativeBalance.toString(),
        wrapRequired: currentWeth < aggregateRaw,
      });
      if (currentWeth < aggregateRaw) {
        const missing = aggregateRaw - currentWeth;
        if (nativeBalance <= missing) throw new Error(`Offers require ${formatWeiTokenAmount(aggregateRaw, "WETH")}.`);
        setBusyLabel("Waiting for wallet...");
        recordLocalOfferDiagnostic("trait_offer.wrap_requested", { attemptId, missing: missing.toString(), wethToken });
        await wrapEthToWeth(provider, account, wethToken, missing);
        recordLocalOfferDiagnostic("trait_offer.wrap_complete", { attemptId, missing: missing.toString() });
      }
      await ensureErc20Approval(provider, account, { ...prepared[0].wethApproval!, amount: aggregateRaw.toString() });
      for (const item of prepared) {
        try {
          setBusyLabel(`Signing ${submitted + 1} of ${prepared.length}...`);
          recordLocalOfferDiagnostic("trait_offer.signing_started", { attemptId, actionId: item.actionId, attribute: item.attribute, index: submitted + 1, total: prepared.length });
          const mobileHandoff = getMobileWalletHandoff(provider);
          let signature: string;
          try {
            signature = await requestTraitOfferSignature(provider, account, item.typedData, submitted + 1, prepared.length);
          } catch (error) {
            if (provider.connectorId !== "trustconnect-walletconnect" || !isOpaqueWalletConnectNullError(error)) throw error;
            recordLocalOfferDiagnostic("trait_offer.signature_walletconnect_retry", {
              attemptId,
              actionId: item.actionId,
              attribute: item.attribute,
              error,
            });
            setBusyLabel(`Retrying signature ${submitted + 1} of ${prepared.length}...`);
            signature = await requestTraitOfferSignature(provider, account, item.typedData, submitted + 1, prepared.length);
          }
          recordLocalOfferDiagnostic("trait_offer.signing_complete", { attemptId, actionId: item.actionId, attribute: item.attribute, signatureLength: signature.length });
          if (mobileHandoff && document.visibilityState !== "visible") {
            setBusyLabel("Return to Safari to submit...");
            await waitForForeground();
          }
          setBusyLabel(`Submitting ${submitted + 1} of ${prepared.length}...`);
          const submitBody = JSON.stringify({ actionId: item.actionId, fid: viewerFid, wallet: account, priceRaw, quantity: clampedQuantity, attribute: item.attribute, level: `${level}X`, payload: { parameters: item.parameters, protocol_address: item.protocolAddress, signature } });
          const { response, responseText, attempts } = await submitTraitOfferWithRetry(submitBody, {
            onRetry: ({ attempt, nextAttempt, delayMs, status, responseText: retryResponseText, error }) => {
              setBusyLabel(`Retrying submission ${submitted + 1} of ${prepared.length}...`);
              recordLocalOfferDiagnostic("trait_offer.submit_retry_scheduled", {
                attemptId,
                actionId: item.actionId,
                attribute: item.attribute,
                attempt,
                nextAttempt,
                delayMs,
                status,
                error,
                responsePreview: retryResponseText.slice(0, 1000),
              });
            },
          });
          let responsePayload: { message?: string } = {};
          try {
            responsePayload = responseText ? JSON.parse(responseText) as { message?: string } : {};
          } catch {
            responsePayload = {};
          }
          recordLocalOfferDiagnostic("trait_offer.submit_received", {
            attemptId,
            actionId: item.actionId,
            attribute: item.attribute,
            status: response.status,
            ok: response.ok,
            attempts,
            message: responsePayload.message ?? null,
            responsePreview: response.ok ? null : responseText.slice(0, 1000),
          });
          if (!response.ok) {
            throw new Error(responsePayload.message || `Trait offer submission failed (${response.status})`);
          }
          submitted += 1;
          setBusyLabel(`Refreshing ${submitted} of ${prepared.length}...`);
          await Promise.all([
            loadOffers({ silent: true }),
            onMarketChanged(),
          ]);
        } catch (error) {
          if (submitted === 0) throw error;
          showToast("warning", `Submitted ${submitted} of ${prepared.length} trait offers`, { minMs: 8000 });
          break;
        }
      }
      if (submitted === prepared.length) {
        const celebrate = () => { void hapticSuccess(); showTradeConfetti(); };
        celebrate();
        window.setTimeout(celebrate, 400);
        window.setTimeout(celebrate, 800);
        showToast("success", submitted === 1 ? "Trait offer successfully made" : `${submitted} trait offers successfully made`, { minMs: 6000 });
        onShareOffer({ amountEth: parseTradeAmount(price), quantity: submitted * clampedQuantity, attributes: selectedAttributes, level });
      } else {
        void hapticWarning();
      }
      setBusyLabel("Refreshing offers...");
      await Promise.all([
        loadOffers({ silent: true }),
        onMarketChanged(),
      ]);
    } catch (error) {
      recordLocalOfferDiagnostic("trait_offer.failed", { attemptId, submitted, error });
      void hapticError();
      showToast("error", error instanceof Error ? error.message : "Trait offer failed.", { manualClose: true });
    } finally {
      setMobileSignaturePrompt(null);
      setBusy(null);
      setBusyLabel(null);
    }
  }, [attributeIds.join(","), clampedQuantity, getProviderAndAccount, level, loadOffers, onMarketChanged, onShareOffer, price, requestTraitOfferSignature, selectedAttributes, showToast, viewerFid]);

  const runCancel = useCallback(async () => {
    if (!cancelGroup) return;
    const orders = selectedCancelOrders
      .filter((order) => Boolean(order.orderHash))
      .map((order) => ({ orderHash: order.orderHash, protocolAddress: order.protocolAddress }));
    if (orders.length === 0) return;
    setBusy("cancel");
    try {
      const { provider, account } = await getProviderAndAccount();
      const prepare = await fetch("/api/trait-offers/cancel-prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actionId: crypto.randomUUID(), orders }) });
      const data = await prepare.json().catch(() => ({})) as { protocolAddress?: string; orderParameters?: SeaportCancelOrderParameters[]; chainIdHex?: string; message?: string; error?: string };
      if (!prepare.ok || !data.protocolAddress || !data.orderParameters?.length) throw new Error(data.message || data.error || "Could not prepare trait offer cancellation");
      await ensureBaseChain(provider, data.chainIdHex);
      await sendPreparedTransaction(provider, account, buildSeaportCancelTransaction(data.protocolAddress, data.orderParameters));
      const submit = await fetch("/api/trait-offers/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orders }) });
      if (!submit.ok) throw new Error("Trait offer cancellation failed");
      setCancelGroup(null);
      void hapticSuccess();
      showTradeConfetti();
      showToast("success", "Trait offers successfully canceled", { minMs: 5000 });
      await loadOffers();
    } catch (error) {
      void hapticError();
      showToast("error", error instanceof Error ? error.message : "Trait offer cancellation failed.", { manualClose: true });
    } finally { setBusy(null); }
  }, [cancelGroup, getProviderAndAccount, loadOffers, selectedCancelOrders, showToast]);

  const stats = payload?.stats;
  const rows = payload?.groups ?? [];
  const emojiForTrait = (traitType: string) => LEVEL_ATTRIBUTES.find((item) => `${item.label} Level`.toLowerCase() === traitType.toLowerCase())?.emoji ?? "";

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-10 pt-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-[#00FF00]/30 bg-[rgba(0,255,0,0.08)] p-3"><Text className="text-[11px] font-bold uppercase text-[#8bbf8b]">Count</Text><div className="mt-1 text-2xl font-bold text-[#00FF00]">{stats?.count ?? 0}</div></div>
        <div className="rounded-lg border border-[#33AAFF]/30 bg-[rgba(51,170,255,0.08)] p-3"><Text className="text-[11px] font-bold uppercase text-[#8bcfff]">Value</Text><div className="mt-1 text-2xl font-bold text-[#33AAFF]"><InlineHoverTooltip value={formatMarketValue(stats?.value, { maxDigits: 8 })} tooltip={formatUsdMoneyFromMarket(stats?.value, ethUsdPrice)} className="text-[#33AAFF]" tone="blue"/></div></div>
      </div>
      <div ref={formRef} className="mt-4 rounded-xl border border-[#33AAFF]/35 bg-[rgba(51,170,255,0.12)] p-3">
        <div className="grid grid-cols-2 gap-2">
          <FilterDropdown label="Attributes" valueLabel={selectedLabel} tone="blue" closeOnCheckboxChange={false}>{LEVEL_ATTRIBUTES.map((attribute) => <label key={attribute.column} className="flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-[#33AAFF] hover:bg-[#061827]"><input type="checkbox" checked={selectedAttributes.includes(attribute.column)} onChange={() => toggleAttribute(attribute.column)} className="h-4 w-4 appearance-none rounded border border-[#33AAFF] bg-[rgba(51,170,255,0.12)] outline-none checked:appearance-auto checked:accent-[#33AAFF] focus-visible:shadow-[0_0_8px_rgba(51,170,255,0.65)]"/><span>{attribute.emoji}</span>{attribute.label}</label>)}</FilterDropdown>
          <FilterDropdown label="Level" valueLabel={`${level}X`} tone="blue">{LEVEL_FILTER_OPTIONS.map((option) => <label key={option} className="flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-[#33AAFF] hover:bg-[#061827]"><input type="radio" name="trait-level" checked={level === option} onChange={() => { void hapticSelectionChanged(); setLevel(option); }} className="h-4 w-4 appearance-none rounded-full border border-[#33AAFF] bg-[rgba(51,170,255,0.12)] outline-none checked:appearance-auto checked:accent-[#33AAFF] focus-visible:shadow-[0_0_8px_rgba(51,170,255,0.65)]"/>{option}X</label>)}</FilterDropdown>
        </div>
        <label className="mt-3 block text-[11px] font-bold uppercase text-[#8bcfff]"><span className="flex justify-between gap-3"><span>Offered at</span><span>{formatUsdEstimate(price, ethUsdPrice, payload?.topTraitOffer)}</span></span><div className="mt-1 flex items-center rounded-lg border-2 border-[#33AAFF]/35 bg-black/60 px-3 py-2 transition-[border-color,box-shadow] focus-within:border-[#33AAFF] focus-within:shadow-[0_0_10px_rgba(51,170,255,0.22)]"><input data-no-focus-ring type="text" inputMode="decimal" value={price} onChange={(event) => setPrice(sanitizeTradePriceInput(event.target.value))} placeholder="0.0001" className="min-w-0 flex-1 border-0 bg-transparent text-base font-bold text-[#33AAFF] outline-none"/><span className="text-sm font-bold text-[#33AAFF]">WETH</span></div></label>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex shrink-0 items-center gap-2">
            <img src={getWarpletPreviewImageUrl(760)} alt="" className="h-8 w-8 shrink-0 rounded-md border border-[#33AAFF]/35 object-cover" loading="lazy" />
            <span className="shrink-0 text-sm font-bold text-[#33AAFF]">10X Warplets</span>
          </div>
          <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} className="h-8 w-8 cursor-pointer rounded-md border border-[#33AAFF]/35 text-lg font-bold text-[#33AAFF] hover:bg-[#061827]">-</button>
          <div className="flex min-w-0 flex-1 items-center rounded-lg border-2 border-[#33AAFF]/35 bg-black/60 px-3 py-1.5 transition-[border-color,box-shadow] focus-within:border-[#33AAFF] focus-within:shadow-[0_0_10px_rgba(51,170,255,0.22)]">
            <input data-no-focus-ring type="number" min={1} max={10000} step={1} value={quantity} onChange={(event) => setQuantity(Math.min(10000, Math.max(1, Math.floor(Number(event.target.value) || 1))))} className="min-w-0 flex-1 appearance-none border-0 bg-transparent text-center text-base font-bold text-[#33AAFF] outline-none ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
          </div>
          <button type="button" onClick={() => setQuantity((value) => Math.min(10000, value + 1))} className="h-8 w-8 cursor-pointer rounded-md border border-[#33AAFF]/35 text-lg font-bold text-[#33AAFF] hover:bg-[#061827]">+</button>
        </div>
        <p className="mt-2 text-[11px] font-bold text-[#8bcfff]">{selectedAttributes.length === 1 && "Offer will be on OpenSea. "}Set price to <button type="button" disabled={!payload?.topTraitOffer} onClick={() => setPriceFromMarket(payload?.topTraitOffer)} className="cursor-pointer text-[#33AAFF] underline disabled:cursor-not-allowed disabled:opacity-50">Top Trait Offer</button>.</p>
        {selectedAttributes.length > 1 && <p className="mt-3 rounded-lg border border-[#33AAFF]/35 bg-[rgba(51,170,255,0.12)] px-3 py-2 text-xs font-bold text-[#8bcfff]">This will submit {selectedAttributes.length} offers on OpenSea, one for each selected Attribute with Level: {level}X.</p>}
        {showBaseWalletWarning && (
          <div role="status" className="mt-3 rounded-lg border border-[#FFFF00]/55 bg-[rgba(255,255,0,0.1)] px-3 py-2 text-xs font-bold leading-relaxed text-[#FFFF99]">
            Base Wallet currently doesn&apos;t support Trait Offers. It returns &quot;Error Generating message&quot;. Please try connecting a{" "}
            <button type="button" onClick={onOpenConnect} className="cursor-pointer font-bold text-[#FFFF00] underline underline-offset-2 hover:text-white">
              different wallet
            </button>.
          </div>
        )}
        <button type="button" disabled={busy !== null || !priceIsValid} onClick={() => void runMakeOffers()} className="mt-3 w-full cursor-pointer rounded-[20px] border border-[#1c78b3] bg-[#33AAFF] px-5 py-3 text-base font-bold text-[rgb(0,54,80)] shadow-[3px_6px_0_#1c78b3] disabled:cursor-wait disabled:opacity-70">{busy === "offer" ? busyLabel ?? "Preparing..." : ctaLabel}</button>
      </div>
      <SearchSegmentedTabs className="mt-4" options={OFFERS_FILTER_TABS} activeId={scope} onSelect={(id) => setScope(id === "your" ? "your" : "all")}/>
      <div className="mt-4 overflow-hidden rounded-lg border border-[#00FF00]/25">
        <div className="grid grid-cols-[1fr_1fr_56px_72px_72px] items-center gap-1 bg-[#041204] px-2 py-2 text-center text-[10px] font-bold uppercase text-[#8bbf8b]"><span>Price</span><span>Volume</span><span>Offers</span><span>Bidders</span><span>Action</span></div>
        {loading ? <div className="px-3 py-6 text-center text-sm font-bold text-[#8bbf8b]">Loading offers...</div> : rows.length === 0 ? <div className="px-3 py-6 text-center text-sm font-bold text-[#8bbf8b]">No trait offers.</div> : rows.map((group) => <div key={`${group.traitType}|${group.traitValue}|${group.price.rawAmount ?? group.price.eth}`} className="grid grid-cols-[1fr_1fr_56px_72px_72px] items-center gap-1 border-t border-[#00FF00]/15 px-2 py-2 text-center text-xs"><OfferPriceTooltipButton price={group.price} ethUsdPrice={ethUsdPrice} onClick={() => { setPriceFromMarket(group.price); formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}/><span className="flex justify-center"><InlineHoverTooltip value={formatMarketValue(group.volume, { maxDigits: 5 })} tooltip={formatUsdMoneyFromMarket(group.volume, ethUsdPrice)} className="text-[#00FF00]"/></span><span className="flex justify-center"><InlineHoverTooltip value={`${emojiForTrait(group.traitType)} ${group.offerCount}`} tooltip={`${group.traitType}: ${group.traitValue}`} className="font-bold text-[#8bbf8b]"/></span><button type="button" onClick={() => setBiddersGroup(group)} className="flex cursor-pointer justify-center -space-x-2">{group.previewBidders.slice(0, 3).map((bidder) => <img key={bidder.wallet} src={bidder.pfpUrl || getWalletIdenticonDataUrl(bidder.wallet)} alt="" className="h-7 w-7 rounded-full border-2 border-[#00FF00] object-cover"/>)}</button><button type="button" disabled={busy !== null} onClick={() => { if (group.userOfferCount > 0) { setCancelGroup(group); setCancelRequestedQuantity(group.userOfferCount); setCancelQuantity(snapCollectionOfferCancelQuantity(group.userOrders, group.userOfferCount)); } else { const attribute = LEVEL_ATTRIBUTES.find((item) => `${item.label} Level`.toLowerCase() === group.traitType.toLowerCase()); setPriceFromMarket(group.price); if (attribute) setSelectedAttributes([attribute.column]); formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } }} className={`cursor-pointer justify-self-center rounded-md border px-2 py-1.5 text-xs font-bold disabled:cursor-wait ${group.userOfferCount > 0 ? "border-[#FF5555]/55 text-[#FF7777]" : "border-[#33AAFF]/55 text-[#33AAFF]"}`}>{group.userOfferCount > 0 ? "Cancel" : "Offer"}</button></div>)}
      </div>
      <div className="mt-3 text-center text-[11px] text-[#8bbf8b]">Last updated: {payload?.generatedAt ? formatMarketTimestamp(payload.generatedAt) : "Not yet"}. <button type="button" disabled={refreshing || busy !== null} onClick={() => void loadOffers({ refresh: true })} className="font-bold text-[#00FF00]">{refreshing ? "Refreshing..." : "Refresh"}</button>{payload?.refreshError && <span className="block text-red-300">{payload.refreshError}</span>}</div>
      <LocalOfferDiagnosticsPanel />
      {mobileSignaturePrompt && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/80 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-xl border border-[#33AAFF]/50 bg-black p-4 text-center shadow-[0_0_24px_rgba(51,170,255,0.18)]">
            <Text className="text-base font-bold text-[#33AAFF]">Sign trait offer {mobileSignaturePrompt.index} of {mobileSignaturePrompt.total}</Text>
            <p className="mt-2 text-sm font-bold leading-relaxed text-[#8bcfff]">Open {mobileSignaturePrompt.walletName} to approve the signature. After signing, return to this original Safari tab.</p>
            <button type="button" onClick={mobileSignaturePrompt.open} className="mt-4 w-full cursor-pointer rounded-[20px] border border-[#1c78b3] bg-[#33AAFF] px-5 py-3 text-base font-bold text-[rgb(0,54,80)] shadow-[3px_6px_0_#1c78b3]">Open {mobileSignaturePrompt.walletName}</button>
            <button type="button" onClick={mobileSignaturePrompt.cancel} className="mx-auto mt-3 block px-4 py-2 text-xs font-bold text-[#8bcfff] underline">Cancel</button>
          </div>
        </div>
      )}
      {cancelGroup && <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80 p-4 sm:items-center"><div className="w-full max-w-sm rounded-xl border border-[#FF5555]/45 bg-black p-4"><Text className="text-base font-bold text-[#FF7777]">Cancel trait offers</Text><p className="mt-2 text-sm font-bold text-[#d9b0b0]">Cancel up to {cancelGroup.userOfferCount} {emojiForTrait(cancelGroup.traitType)} {cancelGroup.traitValue} trait offers at {formatMarketValue(cancelGroup.price, { maxDigits: 8 })}.</p><div className="mt-3 flex items-center rounded-lg border-2 border-[#FF5555]/35 bg-black/60 px-2 py-1.5"><button type="button" onClick={() => { const next = stepCollectionOfferCancelQuantity(cancelTotals, cancelQuantity, -1); setCancelRequestedQuantity(next); setCancelQuantity(next); }} className="h-8 w-8 text-lg font-bold text-[#FF7777]">-</button><input type="number" min={1} max={cancelGroup.userOfferCount} value={cancelRequestedQuantity} onChange={(event) => { const requested = Math.min(cancelGroup.userOfferCount, Math.max(1, Number(event.target.value) || 1)); setCancelRequestedQuantity(requested); setCancelQuantity(snapCollectionOfferCancelQuantity(cancelGroup.userOrders, requested)); }} className="mx-2 min-w-0 flex-1 appearance-none bg-transparent text-center font-bold text-[#FF7777] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"/><button type="button" onClick={() => { const next = stepCollectionOfferCancelQuantity(cancelTotals, cancelQuantity, 1); setCancelRequestedQuantity(next); setCancelQuantity(next); }} className="h-8 w-8 text-lg font-bold text-[#FF7777]">+</button></div>{actualCancelQuantity > cancelRequestedQuantity && <p className="mt-2 text-xs font-bold text-[#ffd599]">This cancels {actualCancelQuantity} offers across {selectedCancelOrders.length} OpenSea orders.</p>}<button type="button" disabled={busy !== null} onClick={() => void runCancel()} className="mt-4 w-full cursor-pointer rounded-[20px] border border-[#a83232] bg-[#FF5555] px-5 py-3 text-base font-bold text-[#2c0000] shadow-[3px_6px_0_#8a2222] transition-all duration-100 hover:bg-[#ff7777] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#8a2222] disabled:cursor-wait disabled:opacity-70">{busy === "cancel" ? "Working..." : "Review cancellation"}</button><button type="button" onClick={() => setCancelGroup(null)} className="mx-auto mt-2 block px-4 py-2 text-xs font-bold text-[#FF7777] underline">Keep offers</button></div></div>}
      {biddersGroup && (
        <CollectionBiddersModal
          group={biddersGroup}
          isInMiniAppContext={isInMiniAppContext}
          offerLabel="Trait"
          offerEmoji={emojiForTrait((biddersGroup as CollectionOfferGroup & { traitType: string }).traitType)}
          offerLevel={(biddersGroup as CollectionOfferGroup & { traitValue: string }).traitValue}
          onClose={() => setBiddersGroup(null)}
        />
      )}
    </div>
  );
}

function ItemOffersPage({
  db,
  favouriteTokenIds,
  connectedWallet,
  viewerFid,
  isInMiniAppContext,
  getProviderAndAccount,
  showToast,
  onOpenWarpletDetails,
  onApplyPurchase,
  refreshRevision,
  onShareTrade,
}: {
  db: SqliteDatabase | null;
  favouriteTokenIds: number[];
  connectedWallet: string | null;
  viewerFid: number | null;
  isInMiniAppContext: boolean;
  getProviderAndAccount: () => Promise<{ provider: EthereumProvider; account: string }>;
  showToast: (kind: TradeToast["kind"], message: string, options?: { manualClose?: boolean; minMs?: number }) => void;
  onOpenWarpletDetails: (tokenId: number) => void;
  onApplyPurchase: (tokenId: number, update: OptimisticPurchaseUpdate) => void;
  refreshRevision: number;
  onShareTrade: (input: { tokenId: number; action: "offer" | "sale"; amountEth: number | null; sellerWallet?: string | null; counterparty?: TradeShareCounterparty | null }) => void;
}) {
  const [scope, setScope] = useState<"all" | "your" | "for_you" | "favourites">("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [pickerVisibleCount, setPickerVisibleCount] = useState(PAGE_SIZE);
  const [payload, setPayload] = useState<ItemOffersPayload | null>(null);
  const [price, setPrice] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<"offer" | "cancel" | "accept" | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [ethUsdPrice, setEthUsdPrice] = useState<number | null>(null);
  const [bidderRow, setBidderRow] = useState<ItemOfferRow | null>(null);
  const [page, setPage] = useState(0);
  const loadRequestRef = useRef(0);
  const appliedRefreshRevisionRef = useRef(0);
  const pendingItemOffersRef = useRef(new Map<string, ItemOfferRow>());
  const pickerRootRef = useRef<HTMLDivElement | null>(null);
  const pickerEndRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const normalizedWallet = normalizeWalletAddress(connectedWallet);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedQuery(query); setPickerVisibleCount(PAGE_SIZE); }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);
  const pickerPage = useMemo(() => {
    if (!db || (!debouncedQuery.trim() && !favouritesOnly)) return { rows: [], total: 0 };
    const requestedRows = Math.ceil(pickerVisibleCount / SEARCH_RESULT_PAGE_SIZE) * SEARCH_RESULT_PAGE_SIZE;
    return searchWarpletPickerPage(
      db,
      debouncedQuery || "*",
      favouritesOnly ? favouriteTokenIds : null,
      requestedRows,
    );
  }, [db, debouncedQuery, favouriteTokenIds, favouritesOnly, pickerVisibleCount]);
  const visiblePickerResults = pickerPage.rows.slice(0, pickerVisibleCount);

  useEffect(() => {
    const target = pickerEndRef.current;
    if (!pickerOpen || !target || pickerVisibleCount >= pickerPage.total) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setPickerVisibleCount((current) => Math.min(current + PAGE_SIZE, pickerPage.total));
    }, { threshold: 0.1 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [pickerOpen, pickerPage.total, pickerVisibleCount]);

  const loadOffers = useCallback(async (options: { refresh?: boolean; silent?: boolean } = {}) => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    if (!options.silent) {
      options.refresh ? setRefreshing(true) : setLoading(true);
    }
    try {
      const params = new URLSearchParams();
      if (normalizedWallet) params.set("wallet", normalizedWallet);
      // Marketplace ownership and "your" scopes follow the transaction
      // signer. FID is only a fallback while the embedded Mini App wallet is
      // being restored; it must not broaden a connected web wallet's assets.
      if (!normalizedWallet && isInMiniAppContext && viewerFid != null) params.set("fid", String(viewerFid));
      if (scope !== "all") params.set("scope", scope);
      if (selectedTokenId != null) params.set("tokenId", String(selectedTokenId));
      params.set("page", String(page));
      if (options.refresh) params.set("refresh", "1");
      const response = await fetch(`/api/item-offers?${params.toString()}`, { headers: { accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(`Item offers failed (${response.status})`);
      const nextPayload = await response.json() as ItemOffersPayload;
      if (loadRequestRef.current !== requestId) return;
      const serverOrderHashes = new Set(nextPayload.rows.map((row) => row.orderHash));
      serverOrderHashes.forEach((orderHash) => pendingItemOffersRef.current.delete(orderHash));
      const favouriteTokenIdSet = new Set(favouriteTokenIds);
      const pendingRows = page === 0
        ? [...pendingItemOffersRef.current.values()].filter((row) => {
            if (selectedTokenId != null && row.tokenId !== selectedTokenId) return false;
            if (scope === "for_you") return false;
            if (scope === "your" && normalizeWalletAddress(row.bidder?.wallet) !== normalizedWallet) return false;
            if (scope === "favourites" && !favouriteTokenIdSet.has(row.tokenId)) return false;
            return !serverOrderHashes.has(row.orderHash);
          })
        : [];
      const reconciledPayload = pendingRows.length === 0 ? nextPayload : (() => {
        const rows = [...pendingRows, ...nextPayload.rows]
          .sort((left, right) => (right.price.eth ?? 0) - (left.price.eth ?? 0))
          .slice(0, nextPayload.pagination.pageSize);
        const value = pendingRows.reduce(
          (current, row) => sumMarketMoney([current, row.price]) ?? current,
          nextPayload.stats.value,
        );
        const topPendingOffer = pendingRows.reduce<MarketMoney | null>(
          (top, row) => !top || (row.price.eth ?? 0) > (top.eth ?? 0) ? row.price : top,
          null,
        );
        const topItemOffer = topPendingOffer && (!nextPayload.topItemOffer || (topPendingOffer.eth ?? 0) > (nextPayload.topItemOffer.eth ?? 0))
          ? topPendingOffer
          : nextPayload.topItemOffer;
        const totalRows = nextPayload.pagination.totalRows + pendingRows.length;
        return {
          ...nextPayload,
          topItemOffer,
          stats: { count: nextPayload.stats.count + pendingRows.length, value },
          pagination: {
            ...nextPayload.pagination,
            totalRows,
            totalPages: Math.max(1, Math.ceil(totalRows / nextPayload.pagination.pageSize)),
          },
          rows,
        };
      })();
      setPayload(reconciledPayload);
      if (nextPayload.pagination.page !== page) setPage(nextPayload.pagination.page);
    } catch (error) {
      if (loadRequestRef.current !== requestId) return;
      showToast("error", error instanceof Error ? error.message : "Item offers failed.", { manualClose: true });
    } finally {
      if (loadRequestRef.current === requestId && !options.silent) { setLoading(false); setRefreshing(false); }
    }
  }, [favouriteTokenIds, isInMiniAppContext, normalizedWallet, page, scope, selectedTokenId, showToast, viewerFid]);
  useEffect(() => {
    void loadOffers();
  }, [loadOffers]);
  useEffect(() => {
    if (refreshRevision <= appliedRefreshRevisionRef.current) return;
    appliedRefreshRevisionRef.current = refreshRevision;
    void loadOffers({ refresh: true, silent: true });
  }, [loadOffers, refreshRevision]);
  useEffect(() => { setPage(0); }, [scope, selectedTokenId]);
  useEffect(() => { fetchEthUsdPrice().then(setEthUsdPrice).catch(() => undefined); }, []);

  const selectWarplet = useCallback((tokenId: number) => {
    void hapticSelectionChanged();
    setSelectedTokenId(tokenId);
    setQuery(`#${tokenId}`);
    setDebouncedQuery(`#${tokenId}`);
    setPickerOpen(false);
  }, []);
  const resetPicker = () => {
    setQuery(""); setDebouncedQuery(""); setSelectedTokenId(null); setFavouritesOnly(false); setPickerOpen(false); setPickerVisibleCount(PAGE_SIZE);
  };
  const setPriceFromMarket = (money: MarketMoney | null | undefined) => {
    const amount = marketMoneyToDecimal(money);
    if (amount != null && amount > 0) setPrice(formatTradePriceInput(amount));
  };
  const priceRaw = decimalEthToWeiString(price);
  const priceIsValid = Boolean(priceRaw && BigInt(priceRaw) > 0n);

  const applyOptimisticItemOffer = useCallback((
    orderHash: string,
    tokenId: number,
    account: string,
    protocolAddress: string,
    normalizedPriceRaw: string,
  ) => {
    const now = new Date().toISOString();
    const optimisticPrice: MarketMoney = {
      eth: Number(price),
      rawAmount: normalizedPriceRaw,
      decimals: 18,
      currencySymbol: "WETH",
      tokenAddress: BASE_WETH_TOKEN_ADDRESS,
      at: now,
    };
    const bidder: CollectionOfferBidder = {
      wallet: account,
      fid: viewerFid,
      username: null,
      displayName: null,
      pfpUrl: null,
      xUsername: null,
      openseaUrl: `https://opensea.io/${account}`,
      farcasterUrl: viewerFid != null ? `https://farcaster.xyz/~/profiles/${viewerFid}` : null,
      xUrl: null,
      basescanUrl: `https://basescan.org/address/${account}`,
    };
    const optimisticRow: ItemOfferRow = {
      orderHash,
      tokenId,
      protocolAddress,
      price: optimisticPrice,
      bidder,
      isUserOffer: true,
    };
    pendingItemOffersRef.current.set(orderHash, optimisticRow);
    setPayload((current) => {
      if (!current || current.tokenId !== tokenId) return current;
      const alreadyPresent = current.rows.some((row) => row.orderHash === orderHash);
      const rows = [optimisticRow, ...current.rows.filter((row) => row.orderHash !== orderHash)]
        .sort((left, right) => (right.price.eth ?? 0) - (left.price.eth ?? 0))
        .slice(0, current.pagination.pageSize);
      const value = alreadyPresent
        ? current.stats.value
        : sumMarketMoney([current.stats.value, optimisticPrice]) ?? current.stats.value;
      const topItemOffer = !current.topItemOffer || (optimisticPrice.eth ?? 0) > (current.topItemOffer.eth ?? 0)
        ? optimisticPrice
        : current.topItemOffer;
      return {
        ...current,
        generatedAt: now,
        topItemOffer,
        stats: {
          count: current.stats.count + (alreadyPresent ? 0 : 1),
          value,
        },
        pagination: {
          ...current.pagination,
          totalRows: current.pagination.totalRows + (alreadyPresent ? 0 : 1),
          totalPages: Math.max(1, Math.ceil((current.pagination.totalRows + (alreadyPresent ? 0 : 1)) / current.pagination.pageSize)),
        },
        rows,
      };
    });
  }, [price, viewerFid]);

  const runMakeOffer = useCallback(async () => {
    const normalizedPriceRaw = decimalEthToWeiString(price);
    if (!selectedTokenId || !normalizedPriceRaw || BigInt(normalizedPriceRaw) <= 0n) return;
    const actionId = crypto.randomUUID();
    recordLocalOfferDiagnostic("item_offer.started", { actionId, tokenId: selectedTokenId, priceRaw: normalizedPriceRaw, viewerFid });
    setBusy("offer");
    setBusyLabel("Preparing...");
    try {
      void hapticPrimaryTap();
      const { provider, account } = await getProviderAndAccount();
      recordLocalOfferDiagnostic("item_offer.wallet_ready", {
        actionId,
        connector: provider.connectorId ?? (provider.isBaseAccount ? "base-account" : "unknown"),
        isBaseAccount: Boolean(provider.isBaseAccount),
        account,
        chainId: await provider.request({ method: "eth_chainId" }).catch(() => null),
      });
      const prepare = await fetch("/api/warplet-trade/offer/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actionId, fid: viewerFid, tokenId: selectedTokenId, wallet: account, priceRaw: normalizedPriceRaw, durationSeconds: DEFAULT_TRADE_DURATION_SECONDS }) });
      const data = await prepare.json().catch(() => ({})) as { protocol?: string; protocolAddress?: string; parameters?: unknown; typedData?: unknown; chainIdHex?: string; wethApproval?: TokenApprovalRequirement; message?: string };
      recordLocalOfferDiagnostic("item_offer.prepare_received", { actionId, status: prepare.status, ok: prepare.ok, protocol: data.protocol, protocolAddress: data.protocolAddress, chainIdHex: data.chainIdHex, wethApproval: data.wethApproval, message: data.message });
      if (!prepare.ok) throw new Error(data.message || `Offer prepare failed (${prepare.status})`);
      if (data.wethApproval) {
        await ensureBaseChain(provider, data.chainIdHex);
        const required = BigInt(data.wethApproval.amount);
        const current = await readErc20Balance(data.wethApproval.tokenAddress, account);
        if (current < required) {
          const missing = required - current;
          const native = await readNativeBalance(account);
          if (native <= missing) throw new Error(`Offer requires ${formatWeiTokenAmount(required, "WETH")}.`);
          setBusyLabel("Waiting for wallet...");
          await wrapEthToWeth(provider, account, data.wethApproval.tokenAddress, missing);
        }
        await ensureErc20Approval(provider, account, data.wethApproval);
      }
      if (!data.typedData || !data.parameters || !data.protocolAddress) throw new Error("OpenSea did not return item offer signature data");
      setBusyLabel("Waiting for wallet...");
      const signature = await signTypedData(provider, account, data.typedData);
      recordLocalOfferDiagnostic("item_offer.signing_complete", { actionId, signatureLength: signature.length });
      setBusyLabel("Submitting to OpenSea...");
      const submit = await fetch("/api/warplet-trade/offer/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actionId, fid: viewerFid, tokenId: selectedTokenId, wallet: account, priceRaw: normalizedPriceRaw, protocol: data.protocol ?? "seaport", payload: { parameters: data.parameters, protocol_address: data.protocolAddress, signature } }) });
      const submittedOffer = await submit.json().catch(() => ({})) as { orderHash?: string | null; message?: string };
      recordLocalOfferDiagnostic("item_offer.submit_received", { actionId, status: submit.status, ok: submit.ok, orderHash: submittedOffer.orderHash, message: submittedOffer.message });
      if (!submit.ok) throw new Error(submittedOffer.message || `Offer submit failed (${submit.status})`);
      applyOptimisticItemOffer(submittedOffer.orderHash || `pending:${actionId}`, selectedTokenId, account, data.protocolAddress, normalizedPriceRaw);
      void hapticSuccess(); showTradeConfetti(); showToast("success", "Item offer successfully made", { minMs: 5000 });
      onShareTrade({ tokenId: selectedTokenId, action: "offer", amountEth: parseTradeAmount(price) });
      window.setTimeout(() => { void loadOffers({ refresh: true, silent: true }); }, 750);
    } catch (error) {
      recordLocalOfferDiagnostic("item_offer.failed", { actionId, error });
      void hapticError(); showToast("error", error instanceof Error ? error.message : "Item offer failed.", { manualClose: true });
    } finally { setBusy(null); setBusyLabel(null); }
  }, [applyOptimisticItemOffer, getProviderAndAccount, loadOffers, onShareTrade, price, selectedTokenId, showToast, viewerFid]);

  const runCancelOffer = useCallback(async (row: ItemOfferRow) => {
    if (!row.protocolAddress) { showToast("error", "This offer is missing its OpenSea protocol address.", { manualClose: true }); return; }
    const actionId = crypto.randomUUID();
    setBusy("cancel");
    try {
      const { provider, account } = await getProviderAndAccount();
      const prepare = await fetch("/api/warplet-trade/offer/cancel-prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actionId, fid: viewerFid, tokenId: row.tokenId, wallet: account, orderHash: row.orderHash, protocolAddress: row.protocolAddress }) });
      const data = await prepare.json().catch(() => ({})) as { protocolAddress?: string; orderParameters?: SeaportCancelOrderParameters; chainIdHex?: string; message?: string };
      if (!prepare.ok || !data.protocolAddress || !data.orderParameters) throw new Error(data.message || "Could not prepare item offer cancellation");
      await ensureBaseChain(provider, data.chainIdHex);
      await sendPreparedTransaction(provider, account, buildSeaportCancelTransaction(data.protocolAddress, [data.orderParameters]));
      const submit = await fetch("/api/warplet-trade/offer/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actionId, fid: viewerFid, tokenId: row.tokenId, wallet: account, orderHash: row.orderHash, protocolAddress: data.protocolAddress }) });
      if (!submit.ok) {
        const failure = await submit.json().catch(() => ({})) as { message?: string };
        throw new Error(failure.message || `Item offer cancellation sync failed (${submit.status})`);
      }
      pendingItemOffersRef.current.delete(row.orderHash);
      setPayload((current) => current ? { ...current, rows: current.rows.filter((offer) => offer.orderHash !== row.orderHash) } : current);
      void hapticSuccess(); showTradeConfetti(); showToast("success", "Item offer successfully canceled", { minMs: 5000 });
      await loadOffers();
    } catch (error) {
      void hapticError(); showToast("error", error instanceof Error ? error.message : "Item offer cancellation failed.", { manualClose: true });
    } finally { setBusy(null); }
  }, [getProviderAndAccount, loadOffers, showToast, viewerFid]);

  const runAcceptOffer = useCallback(async (row: ItemOfferRow) => {
    if (!row.bidder?.wallet || !row.orderHash || !row.price.rawAmount) {
      showToast("error", "This item offer is missing fulfillment details.", { manualClose: true });
      return;
    }
    const actionId = crypto.randomUUID();
    setBusy("accept");
    try {
      void hapticPrimaryTap();
      const { provider, account } = await getProviderAndAccount();
      const response = await fetch("/api/warplet-trade/offer/accept/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionId,
          fid: viewerFid,
          tokenId: row.tokenId,
          wallet: account,
          expectedOrderHash: row.orderHash,
          expectedRawAmount: row.price.rawAmount,
          exactItemOffer: true,
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        status?: string;
        fulfillment?: unknown;
        chainIdHex?: string;
        nftApproval?: NftApprovalRequirement;
        message?: string;
      };
      if (response.status === 409 || payload.status === "mismatch") {
        throw new Error("This offer changed or is no longer available. Refresh and try again.");
      }
      if (!response.ok) throw new Error(payload.message || `Accept offer prepare failed (${response.status})`);
      await ensureBaseChain(provider, payload.chainIdHex);
      showToast("neutral", "Note: Received ETH excludes OpenSea fees.", { minMs: 5000 });
      if (payload.nftApproval) await ensureErc721ApprovalForAll(provider, account, payload.nftApproval);
      const transaction = extractFulfillmentTransaction(payload.fulfillment);
      if (!transaction) throw new Error("OpenSea did not return an offer fulfillment transaction");
      const hash = await sendPreparedTransaction(provider, account, transaction);
      const now = new Date().toISOString();
      const buyerWallet = row.bidder.wallet.toLowerCase();
      const sale: MarketSnapshot["sales"][string] = {
        eth: row.price.eth,
        at: now,
        rawAmount: row.price.rawAmount,
        decimals: row.price.decimals,
        currencySymbol: row.price.currencySymbol,
        tokenAddress: row.price.tokenAddress,
        txHash: hash,
        seller: account.toLowerCase(),
      };
      await fetch("/api/warplet-trade/log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionId,
          actionName: "accept_offer",
          status: "confirmed",
          phase: "confirmed",
          fid: viewerFid,
          tokenId: row.tokenId,
          walletFrom: account,
          walletTo: buyerWallet,
          orderHash: row.orderHash,
          protocolAddress: row.protocolAddress,
          transactionHash: hash,
          expectedPriceRaw: row.price.rawAmount,
          actualPriceRaw: row.price.rawAmount,
        }),
      }).catch(() => null);
      onApplyPurchase(row.tokenId, {
        buyerWallet,
        buyerFid: row.bidder.fid,
        buyerProfile: {
          wallet: buyerWallet,
          fid: row.bidder.fid,
          username: row.bidder.username,
          displayName: row.bidder.displayName,
          pfpUrl: row.bidder.pfpUrl,
        },
        sale,
      });
      setPayload((current) => current ? {
        ...current,
        rows: current.rows.filter((offer) => offer.tokenId !== row.tokenId),
      } : current);
      void hapticSuccess();
      showTradeConfetti();
      showToast("success", `Offer accepted for Warplet #${row.tokenId}`, { minMs: 5000 });
      onShareTrade({
        tokenId: row.tokenId,
        action: "sale",
        amountEth: row.price.eth,
        sellerWallet: account,
        counterparty: { wallet: buyerWallet, fid: row.bidder.fid, farcasterUsername: row.bidder.username },
      });
      await loadOffers({ refresh: true, silent: true });
    } catch (error) {
      void hapticError();
      showToast("error", error instanceof Error ? error.message : "Accept offer failed.", { manualClose: true });
    } finally {
      setBusy(null);
    }
  }, [getProviderAndAccount, loadOffers, onApplyPurchase, onShareTrade, showToast, viewerFid]);

  const bidderGroup = bidderRow?.bidder ? {
    price: bidderRow.price, volume: bidderRow.price, offerCount: 1, bidderCount: 1,
    previewBidders: [bidderRow.bidder], orders: [{ orderHash: bidderRow.orderHash, protocolAddress: bidderRow.protocolAddress, quantity: 1, createdAt: bidderRow.price.at, bidder: bidderRow.bidder }],
    userOfferCount: bidderRow.isUserOffer ? 1 : 0, userOrders: bidderRow.isUserOffer ? [{ orderHash: bidderRow.orderHash, protocolAddress: bidderRow.protocolAddress, quantity: 1 }] : [],
  } satisfies CollectionOfferGroup : null;
  const rows = payload?.rows ?? [];

  return <div className="mx-auto w-full max-w-md px-4 pb-10 pt-6">
    <div className="grid grid-cols-2 gap-3"><div className="rounded-lg border border-[#00FF00]/30 bg-[rgba(0,255,0,0.08)] p-3"><Text className="text-[11px] font-bold uppercase text-[#8bbf8b]">Count</Text><div className="mt-1 text-2xl font-bold text-[#00FF00]">{payload?.stats.count ?? 0}</div></div><div className="rounded-lg border border-[#33AAFF]/30 bg-[rgba(51,170,255,0.08)] p-3"><Text className="text-[11px] font-bold uppercase text-[#8bcfff]">Value</Text><div className="mt-1 text-2xl font-bold text-[#33AAFF]"><InlineHoverTooltip value={formatMarketValue(payload?.stats.value, { maxDigits: 8 })} tooltip={formatUsdMoneyFromMarket(payload?.stats.value, ethUsdPrice)} className="text-[#33AAFF]" tone="blue"/></div></div></div>
    <div ref={formRef} className="mt-4 rounded-xl border border-[#33AAFF]/35 bg-[rgba(51,170,255,0.12)] p-3">
      <div ref={pickerRootRef} className="relative">
        <div className="flex h-11 items-center rounded-xl border-2 border-[#33AAFF]/35 bg-black/70 focus-within:border-[#33AAFF] focus-within:shadow-[0_0_10px_rgba(51,170,255,0.22)]">
          {selectedTokenId ? <button type="button" onClick={() => onOpenWarpletDetails(selectedTokenId)} aria-label={`Open Warplet #${selectedTokenId} details`} className="flex h-full w-11 shrink-0 cursor-pointer items-center"><img src={getWarpletPreviewImageUrl(selectedTokenId)} alt={`Warplet #${selectedTokenId}`} className="h-full aspect-square rounded-l-[10px] object-cover"/></button> : <span className="flex h-full w-11 shrink-0 items-center justify-center text-[#33AAFF]"><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg></span>}
          <input data-no-focus-ring value={query} placeholder="Select a Warplet..." onFocus={() => { if (query.trim() || favouritesOnly) setPickerOpen(true); }} onChange={(event) => { setSelectedTokenId(null); setQuery(event.target.value); setPickerOpen(Boolean(event.target.value.trim()) || favouritesOnly); }} className={`min-w-0 flex-1 bg-transparent py-0 pr-2 text-base font-bold text-[#33AAFF] outline-none ${selectedTokenId ? "pl-2" : "pl-0"}`}/>
          <button type="button" onClick={() => { if (query || selectedTokenId || favouritesOnly) resetPicker(); else { const random = getFreshRandomExampleSearch(); setQuery(random); setDebouncedQuery(random); setPickerOpen(true); } }} className="h-full cursor-pointer px-2 text-xs font-bold text-[#33AAFF]">{query || selectedTokenId || favouritesOnly ? "Reset" : "Random"}</button>
          <FavouriteButton active={favouritesOnly} title="Filter picker by my favourites" className="mr-1 h-full w-9 !text-[#33AAFF]" onClick={(event) => { event.preventDefault(); setFavouritesOnly((current) => !current); setSelectedTokenId(null); setPickerOpen(true); }}/>
        </div>
        {pickerOpen && <div className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-xl border border-[#33AAFF]/35 bg-black shadow-2xl"><OverlayScrollArea className="aspect-[8/7] w-full overflow-y-auto" scrollbarAutoHide="never"><div className="grid grid-cols-4 gap-1.5 p-2">{visiblePickerResults.map((warplet) => <button key={warplet.id} type="button" onClick={() => selectWarplet(warplet.id)} title={`Select #${warplet.id}`} className="aspect-square cursor-pointer overflow-hidden rounded-[3px]"><img src={getWarpletPreviewImageUrl(warplet.id)} alt={`Warplet #${warplet.id}`} className="h-full w-full object-cover" loading="lazy" decoding="async"/></button>)}</div>{pickerPage.total === 0 && <div className="px-3 py-10 text-center text-xs font-black text-[#33AAFF]">NO WARPLETS FOUND</div>}{pickerPage.total > 0 && pickerVisibleCount >= pickerPage.total && <button type="button" onClick={() => { const viewport = pickerRootRef.current?.querySelector<HTMLElement>("[data-overlayscrollbars-viewport]"); viewport?.scrollTo({ top: 0, behavior: "smooth" }); }} className="w-full cursor-pointer px-3 py-3 text-center text-[11px] font-bold text-[#8bcfff]">No more warplets. <span className="text-[#33AAFF] underline decoration-[#33AAFF] underline-offset-2 hover:text-[#8bcfff] hover:decoration-[#8bcfff]">Return to top</span></button>}<div ref={pickerEndRef} className="h-px"/></OverlayScrollArea></div>}
      </div>
      <label className="mt-3 block text-[11px] font-bold uppercase text-[#8bcfff]"><span className="flex justify-between"><span>Offered at</span><span>{formatUsdEstimate(price, ethUsdPrice, payload?.topItemOffer)}</span></span><div className="mt-1 flex items-center rounded-lg border-2 border-[#33AAFF]/35 bg-black/60 px-3 py-2 focus-within:border-[#33AAFF] focus-within:shadow-[0_0_10px_rgba(51,170,255,0.22)]"><input data-no-focus-ring value={price} inputMode="decimal" onChange={(event) => setPrice(sanitizeTradePriceInput(event.target.value))} placeholder="0.0001" className="min-w-0 flex-1 bg-transparent text-base font-bold text-[#33AAFF] outline-none"/><span className="font-bold text-[#33AAFF]">WETH</span></div></label>
      <p className="mt-2 text-[11px] font-bold text-[#8bcfff]">Offer will be on OpenSea. Set price to <button type="button" disabled={!payload?.topItemOffer} onClick={() => setPriceFromMarket(payload?.topItemOffer)} className="cursor-pointer text-[#33AAFF] underline disabled:cursor-not-allowed disabled:opacity-50">Top Item Offer</button>.</p>
      <button type="button" disabled={busy !== null || !selectedTokenId || !priceIsValid} onClick={() => void runMakeOffer()} className="mt-3 w-full cursor-pointer rounded-[20px] border border-[#1c78b3] bg-[#33AAFF] px-5 py-3 text-base font-bold text-[rgb(0,54,80)] shadow-[3px_6px_0_#1c78b3] disabled:cursor-not-allowed disabled:opacity-70">{busy === "offer" ? busyLabel ?? "Preparing..." : "Review item offer"}</button>
    </div>
    <SearchSegmentedTabs className="mt-4" options={ITEM_OFFERS_FILTER_TABS} activeId={scope} onSelect={(id) => setScope(id === "your" ? "your" : id === "for_you" ? "for_you" : id === "favourites" ? "favourites" : "all")}/>
    <div className="mt-4 overflow-hidden rounded-lg border border-[#00FF00]/25"><div className="grid grid-cols-5 items-center gap-1 bg-[#041204] px-2 py-2 text-center text-[10px] font-bold uppercase text-[#8bbf8b]"><span>Price</span><span>Warplet</span><span>NFT</span><span>Bidder</span><span>Action</span></div>{loading && busy !== "accept" ? <div className="px-3 py-6 text-center text-sm font-bold text-[#8bbf8b]">Loading offers...</div> : rows.length === 0 ? <div className="px-3 py-6 text-center text-sm font-bold text-[#8bbf8b]">{scope === "your" ? "You've made no item offers." : scope === "favourites" ? "No item offers for your favourites." : scope === "for_you" ? "No offers for your Warplets." : "No item offers."}</div> : rows.map((row) => <div key={row.orderHash} className="grid grid-cols-5 items-center gap-1 border-t border-[#00FF00]/15 px-2 py-2 text-center text-xs"><OfferPriceTooltipButton price={row.price} ethUsdPrice={ethUsdPrice} onClick={() => setPriceFromMarket(row.price)}/><button type="button" onClick={() => selectWarplet(row.tokenId)} className="cursor-pointer font-bold text-[#00FF00]">#{row.tokenId}</button><button type="button" onClick={() => onOpenWarpletDetails(row.tokenId)} className="mx-auto h-9 w-9 cursor-pointer overflow-hidden rounded-[3px] border-2 border-[#00FF00]"><img src={getWarpletPreviewImageUrl(row.tokenId)} alt={`Warplet #${row.tokenId}`} className="h-full w-full object-cover" loading="lazy"/></button><button type="button" disabled={!row.bidder} onClick={() => setBidderRow(row)} className="mx-auto cursor-pointer disabled:cursor-default">{row.bidder && <img src={row.bidder.pfpUrl || getWalletIdenticonDataUrl(row.bidder.wallet)} alt="" className="h-7 w-7 rounded-full border-2 border-[#00FF00] object-cover"/>}</button>{scope === "for_you" ? <button type="button" disabled={busy !== null} onClick={() => void runAcceptOffer(row)} className="cursor-pointer rounded-md border border-[#b3b300] px-2 py-1.5 text-xs font-bold text-[#FFFF00] disabled:cursor-wait disabled:opacity-60">Accept</button> : <button type="button" disabled={busy !== null} onClick={() => row.isUserOffer ? void runCancelOffer(row) : (selectWarplet(row.tokenId), setPriceFromMarket(row.price), formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))} className={`cursor-pointer rounded-md border px-2 py-1.5 text-xs font-bold disabled:cursor-wait ${row.isUserOffer ? "border-[#FF5555]/55 text-[#FF7777]" : "border-[#33AAFF]/55 text-[#33AAFF]"}`}>{row.isUserOffer ? "Cancel" : "Offer"}</button>}</div>)}</div>
    {(payload?.pagination.totalPages ?? 1) > 1 && <div className="mt-3 flex items-center justify-center gap-3 text-xs font-bold text-[#8bbf8b]"><button type="button" disabled={loading || !payload?.pagination.hasPrevious} onClick={() => setPage((current) => Math.max(0, current - 1))} className="cursor-pointer rounded-md border border-[#00FF00]/40 px-3 py-1.5 text-[#00FF00] disabled:cursor-not-allowed disabled:opacity-40">Previous</button><span>Page {(payload?.pagination.page ?? 0) + 1} of {payload?.pagination.totalPages ?? 1}</span><button type="button" disabled={loading || !payload?.pagination.hasNext} onClick={() => setPage((current) => current + 1)} className="cursor-pointer rounded-md border border-[#00FF00]/40 px-3 py-1.5 text-[#00FF00] disabled:cursor-not-allowed disabled:opacity-40">Next</button></div>}
    <div className="mt-3 text-center text-[11px] text-[#8bbf8b]">Last updated: {payload?.generatedAt ? formatMarketTimestamp(payload.generatedAt) : "Not yet"}. <button type="button" disabled={refreshing || busy !== null} onClick={() => void loadOffers({ refresh: true })} className="cursor-pointer font-bold text-[#00FF00] disabled:cursor-wait">{refreshing ? "Refreshing..." : "Refresh"}</button>{payload?.refreshError && <span className="block text-red-300">{payload.refreshError}</span>}</div>
    <LocalOfferDiagnosticsPanel />
    {bidderGroup && bidderRow && <CollectionBiddersModal group={bidderGroup} isInMiniAppContext={isInMiniAppContext} titleOverride={`#${bidderRow.tokenId} Item bidder`} onClose={() => setBidderRow(null)}/>}
  </div>;
}

function ListedPriceHeader({ price, ethUsdPrice }: { price: MarketOrderMoney; ethUsdPrice: number | null }) {
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [isSticky, setIsSticky] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = headerRef.current?.getBoundingClientRect();
      const next = Boolean(rect && rect.top <= 0.5 && rect.top > -rect.height + 0.5);
      setIsSticky((current) => current === next ? current : next);
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    document.addEventListener("scroll", scheduleUpdate, { passive: true, capture: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      document.removeEventListener("scroll", scheduleUpdate, { capture: true });
      window.removeEventListener("resize", scheduleUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={headerRef}
      className={`sticky top-0 z-20 -mx-4 flex items-center justify-center gap-2 whitespace-nowrap border-y px-4 py-2 shadow-[0_8px_18px_rgba(0,0,0,0.45)] transition-colors ${
        isSticky
          ? "border-[#FFFF00]/50 bg-[rgba(32,32,0,0.98)]"
          : "border-[#FFFF00]/25 bg-black/95"
      }`}
    >
      <Text className={`text-xs font-black uppercase tracking-normal ${isSticky ? "text-[#FFFF00]" : "text-[#e6e68a]"}`}>Price</Text>
      <MarketValueChip kind="price" value={formatMarketValue(price, { maxDigits: 8 })} tooltip="Listing price" showTooltip={false} className="text-xs" />
      <span className={`text-xs font-black ${isSticky ? "text-[#FFFF00]" : "text-[#e6e68a]"}`}>({formatUsdMoneyFromMarket(price, ethUsdPrice)})</span>
    </div>
  );
}

function ListedStatPanel({
  kind,
  label,
  value,
}: {
  kind: "count" | "value";
  label: string;
  value: ReactNode;
}) {
  const isValue = kind === "value";
  return (
    <div
      className={`rounded-lg border p-3 ${
        isValue
          ? "border-[#FFFF00]/30 bg-[rgba(255,255,0,0.08)]"
          : "border-[#00FF00]/30 bg-[rgba(0,255,0,0.08)]"
      }`}
    >
      <Text className={`text-[11px] font-bold uppercase ${isValue ? "text-[#e6e68a]" : "text-[#8bbf8b]"}`}>
        {label}
      </Text>
      <div className={`mt-1 text-2xl font-bold ${isValue ? "text-[#FFFF00]" : "text-[#00FF00]"}`}>
        {value}
      </div>
    </div>
  );
}

function ListedAttributeChip({
  attribute,
  level,
}: {
  attribute: (typeof LEVEL_ATTRIBUTES)[number];
  level: number | null | undefined;
}) {
  return (
    <span className="flex h-full min-h-0 min-w-0 items-center justify-center gap-1 rounded-md border border-[#00FF00]/25 bg-black/70 px-1.5 text-[10px] font-bold leading-none text-[#00FF00]">
      <span aria-hidden="true">{attribute.emoji}</span>
      <span>{level == null ? "-" : `${level}X`}</span>
    </span>
  );
}

function ListedAttributePreview({ warplet }: { warplet: WarpletResult }) {
  return (
    <div className="grid h-full min-h-0 grid-cols-2 grid-rows-5 gap-1">
      {LEVEL_ATTRIBUTES.map((attribute) => (
        <ListedAttributeChip
          key={attribute.column}
          attribute={attribute}
          level={warplet.levelValues[attribute.column]}
        />
      ))}
    </div>
  );
}

function ListedMarketPanel({
  kind,
  label,
  money,
  emptyValue,
}: {
  kind: MarketKind;
  label: string;
  money: MarketMoney | null | undefined;
  emptyValue: string;
}) {
  const styles = getMarketKindStyles(kind);
  const value = hasMarketValue(money) ? formatMarketValue(money, { maxDigits: 8 }) : emptyValue;
  return (
    <div
      className="flex min-h-0 min-w-0 flex-col items-center justify-center rounded-lg border p-[3px]"
      style={{ backgroundColor: styles.backgroundColor, borderColor: styles.borderColor }}
    >
      <Text className="max-w-full truncate text-center text-[10px] uppercase" style={{ color: styles.color }}>
        {label}
      </Text>
      <span className="mt-0.5 max-w-full truncate text-center text-[11px] font-bold leading-none" style={{ color: styles.color }}>
        {value}
      </span>
    </div>
  );
}

function ListedWarpletCard({
  row,
  isOwned,
  isFavourited,
  isSweepSelected,
  isShaking,
  onOpen,
  onToggleFavourite,
  onToggleSweep,
}: {
  row: ListedWarpletRow;
  isOwned: boolean;
  isFavourited: boolean;
  isSweepSelected: boolean;
  isShaking: boolean;
  onOpen: (tokenId: number) => void;
  onToggleFavourite: (tokenId: number) => void;
  onToggleSweep: (tokenId: number) => void;
}) {
  const { warplet, market } = row;

  const openCard = () => onOpen(warplet.id);

  return (
    <div
      style={{ contentVisibility: "auto", containIntrinsicSize: "190px" }}
      role="button"
      tabIndex={0}
      onClick={openCard}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openCard();
        }
      }}
      className={`group grid w-full cursor-pointer grid-cols-[calc(50%_-_6px)_minmax(0,1fr)] overflow-hidden rounded-[10px] border border-[#00FF00]/25 bg-[#041204]/90 text-left transition hover:-translate-y-px hover:border-2 hover:border-[#00FF00] hover:bg-[#071807]/95 hover:shadow-[0_0_16px_rgba(0,255,0,0.55)] ${isShaking ? "listed-card-shake" : ""}`}
    >
      <ProgressiveWarpletImage
        tokenId={warplet.id}
        alt=""
        loading="lazy"
        className="aspect-square w-full self-start bg-[rgba(0,255,0,0.12)]"
      />
      <div className="flex min-w-0 flex-col">
        <div className="flex h-[34px] min-w-0 items-center border-b border-[#00FF00]/20 bg-black pl-2 text-[0.75rem] font-bold">
          <span className="block min-w-0 flex-1 truncate pr-1">
            <span className="text-[#00FF00]">#{warplet.id}</span>
            {warplet.farcasterUsername && <span className="text-[#8bbf8b]"> @{warplet.farcasterUsername}</span>}
          </span>
          <FavouriteButton
            active={isFavourited}
            title={isFavourited ? `Remove 10X Warplet #${warplet.id} from favourites` : `Add 10X Warplet #${warplet.id} to favourites`}
            variant="card"
            className="!text-[#00FF00]"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleFavourite(warplet.id);
            }}
          />
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,13fr)_minmax(0,12fr)] gap-1 p-1.5">
          <ListedAttributePreview warplet={warplet} />
          <div className="grid min-h-0 min-w-0 grid-rows-3 gap-[7px]">
            <ListedMarketPanel
              kind="offer"
              label="Top Offer"
              money={market.offer}
              emptyValue="No offers"
            />
            <ListedMarketPanel
              kind="sold"
              label="Latest Sale"
              money={market.sale}
              emptyValue="No sales"
            />
            <button
              type="button"
              aria-pressed={isOwned ? undefined : isSweepSelected}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (isOwned) {
                  onOpen(warplet.id);
                  return;
                }
                onToggleSweep(warplet.id);
              }}
              className={`flex ${isOwned ? "h-full" : "h-[calc(100%_-_3px)]"} w-full cursor-pointer self-start items-center justify-center gap-1 rounded-lg border text-xs font-bold transition-all duration-100 ${
                isOwned
                  ? "border-[#00FF00]/45 bg-black text-[#00FF00] hover:border-[#00FF00] hover:bg-[#041204]"
                  : isSweepSelected
                  ? "border-[#990000] bg-[#ff3333] text-[rgb(80,0,0)] shadow-[2px_3px_0_#800000] hover:bg-[#ff5555] active:shadow-[1px_1px_0_#800000]"
                  : "border-[#009900] bg-[#00FF00] text-[rgb(0,80,0)] shadow-[2px_3px_0_#008000] hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[1.5px] active:shadow-[1px_1px_0_#008000]"
              }`}
            >
              {isOwned ? null : isSweepSelected ? (
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 4 16 16" />
                  <path d="M16 4 4 16" />
                </svg>
              ) : (
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 10 7.5 15.5 18 4.5" />
                </svg>
              )}
              {isOwned ? "Owned" : isSweepSelected ? "Cancel" : "Buy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ListedListingForm({
  db,
  ownedWarplets,
  favouriteTokenIds,
  marketSnapshot,
  ethUsdPrice,
  onOpenWarplet,
  onList,
}: {
  db: SqliteDatabase | null;
  ownedWarplets: WarpletResult[];
  favouriteTokenIds: Set<number>;
  marketSnapshot: MarketSnapshot | null;
  ethUsdPrice: number | null;
  onOpenWarplet: (tokenId: number) => void;
  onList: (tokenId: number, price: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [pickerVisibleCount, setPickerVisibleCount] = useState(PAGE_SIZE);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const pickerRootRef = useRef<HTMLDivElement | null>(null);
  const pickerEndRef = useRef<HTMLDivElement | null>(null);
  const autoSelectedOwnerSignatureRef = useRef("");
  const ownedTokenIds = useMemo(() => ownedWarplets.map((warplet) => warplet.id), [ownedWarplets]);
  const listableTokenIds = useMemo(
    () => ownedTokenIds.filter((tokenId) => !getMarketState(marketSnapshot, tokenId).listing),
    [marketSnapshot, ownedTokenIds],
  );
  const favouriteIds = useMemo(() => Array.from(favouriteTokenIds), [favouriteTokenIds]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
      setPickerVisibleCount(PAGE_SIZE);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const pickerPage = useMemo(() => {
    if (!db) return { rows: [], total: 0 };
    const requestedRows = Math.ceil(pickerVisibleCount / SEARCH_RESULT_PAGE_SIZE) * SEARCH_RESULT_PAGE_SIZE;
    return searchWarpletPickerPage(
      db,
      debouncedQuery || "*",
      favouritesOnly ? favouriteIds : null,
      requestedRows,
      listableTokenIds,
    );
  }, [db, debouncedQuery, favouriteIds, favouritesOnly, listableTokenIds, pickerVisibleCount]);
  const visiblePickerResults = pickerPage.rows.slice(0, pickerVisibleCount);

  useEffect(() => {
    const signature = listableTokenIds.join(",");
    if (ownedTokenIds.length !== 1 || listableTokenIds.length !== 1 || autoSelectedOwnerSignatureRef.current === signature) return;
    autoSelectedOwnerSignatureRef.current = signature;
    const tokenId = listableTokenIds[0];
    setSelectedTokenId(tokenId);
    setQuery(`#${tokenId}`);
    setDebouncedQuery(`#${tokenId}`);
    setPickerOpen(false);
  }, [listableTokenIds, ownedTokenIds.length]);

  useEffect(() => {
    if (selectedTokenId == null || listableTokenIds.includes(selectedTokenId)) return;
    setQuery("");
    setDebouncedQuery("");
    setSelectedTokenId(null);
    setFavouritesOnly(false);
    setPickerOpen(false);
    setPickerVisibleCount(PAGE_SIZE);
  }, [listableTokenIds, selectedTokenId]);

  useEffect(() => {
    const target = pickerEndRef.current;
    if (!pickerOpen || !target || pickerVisibleCount >= pickerPage.total) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setPickerVisibleCount((current) => Math.min(current + PAGE_SIZE, pickerPage.total));
    }, { threshold: 0.1 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [pickerOpen, pickerPage.total, pickerVisibleCount]);

  useEffect(() => {
    if (!pickerOpen) return;
    const closePicker = (event: PointerEvent) => {
      if (!pickerRootRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("pointerdown", closePicker);
    return () => document.removeEventListener("pointerdown", closePicker);
  }, [pickerOpen]);

  const selectWarplet = useCallback((tokenId: number) => {
    void hapticSelectionChanged();
    setSelectedTokenId(tokenId);
    setQuery(`#${tokenId}`);
    setDebouncedQuery(`#${tokenId}`);
    setPickerOpen(false);
  }, []);
  const resetPicker = useCallback(() => {
    void hapticTap();
    setQuery("");
    setDebouncedQuery("");
    setSelectedTokenId(null);
    setFavouritesOnly(false);
    setPickerOpen(false);
    setPickerVisibleCount(PAGE_SIZE);
  }, []);

  const selectedMarket = selectedTokenId ? getMarketState(marketSnapshot, selectedTokenId) : null;
  const floor = marketSnapshot?.collection?.floor ?? null;
  const topOffer = selectedMarket?.offer ?? null;
  const priceRaw = decimalEthToWeiString(price);
  const priceIsValid = Boolean(priceRaw && BigInt(priceRaw) >= 10000n);
  const listingAmount = parseTradeAmount(price);
  const topOfferAmount = marketMoneyToDecimal(topOffer);
  const priceAtOrBelowTopOffer = listingAmount != null && topOfferAmount != null && listingAmount <= topOfferAmount;
  const setPriceFromMarket = (money: MarketMoney | null | undefined) => {
    const amount = marketMoneyToDecimal(money);
    if (amount != null && amount > 0) setPrice(formatTradePriceInput(amount));
  };

  return (
    <div className="mt-4 rounded-xl border border-[#FFFF00]/35 bg-[rgba(255,255,0,0.12)] p-3">
      <div ref={pickerRootRef} className="relative">
        <div className="flex h-11 items-center rounded-xl border-2 border-[#FFFF00]/35 bg-black/70 transition-[border-color,box-shadow] focus-within:border-[#FFFF00] focus-within:shadow-[0_0_10px_rgba(255,255,0,0.2)]">
          {selectedTokenId ? (
            <button type="button" onClick={() => onOpenWarplet(selectedTokenId)} aria-label={`Open Warplet #${selectedTokenId} details`} className="flex h-full w-11 shrink-0 cursor-pointer items-center">
              <img src={getWarpletPreviewImageUrl(selectedTokenId)} alt={`Warplet #${selectedTokenId}`} className="aspect-square h-full rounded-l-[10px] object-cover" />
            </button>
          ) : (
            <span className="flex h-full w-11 shrink-0 items-center justify-center text-[#FFFF00]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>
            </span>
          )}
          <input
            data-no-focus-ring
            value={query}
            placeholder="Select a Warplet..."
            onFocus={() => setPickerOpen(true)}
            onChange={(event) => {
              setSelectedTokenId(null);
              setQuery(event.target.value);
              setPickerOpen(true);
            }}
            className={`min-w-0 flex-1 bg-transparent py-0 pr-2 text-base font-bold text-[#FFFF00] outline-none ${selectedTokenId ? "pl-2" : "pl-0"}`}
          />
          <button type="button" onClick={resetPicker} className="h-full cursor-pointer px-2 text-xs font-bold text-[#FFFF00]">Reset</button>
          <FavouriteButton
            active={favouritesOnly}
            title="Filter picker by my favourites"
            className="mr-1 h-full w-9 !text-[#FFFF00]"
            onClick={(event) => {
              event.preventDefault();
              setFavouritesOnly((current) => !current);
              setSelectedTokenId(null);
              setPickerOpen(true);
            }}
          />
        </div>
        {pickerOpen && (
          <div className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-xl border border-[#FFFF00]/35 bg-black shadow-2xl">
            <OverlayScrollArea className="aspect-[8/7] w-full overflow-y-auto" scrollbarAutoHide="never">
              <div className="grid grid-cols-4 gap-1.5 p-2">
                {visiblePickerResults.map((warplet) => (
                  <button key={warplet.id} type="button" onClick={() => selectWarplet(warplet.id)} title={`Select #${warplet.id}`} className="aspect-square cursor-pointer overflow-hidden rounded-[3px]">
                    <img src={getWarpletPreviewImageUrl(warplet.id)} alt={`Warplet #${warplet.id}`} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
              {pickerPage.total === 0 && (
                <div className="px-3 py-10 text-center text-xs font-black text-[#FFFF00]">
                  {ownedTokenIds.length === 0 ? "TIME TO BUY A WARPLET" : "NO WARPLETS FOUND"}
                </div>
              )}
              {pickerPage.total > 0 && pickerVisibleCount >= pickerPage.total && (
                <button type="button" onClick={() => pickerRootRef.current?.querySelector<HTMLElement>("[data-overlayscrollbars-viewport]")?.scrollTo({ top: 0, behavior: "smooth" })} className="w-full cursor-pointer px-3 py-3 text-center text-[11px] font-bold text-[#e6e68a]">
                  No more warplets. <span className="text-[#FFFF00] underline decoration-[#FFFF00] underline-offset-2">Return to top</span>
                </button>
              )}
              <div ref={pickerEndRef} className="h-px" />
            </OverlayScrollArea>
          </div>
        )}
      </div>
      <label className="mt-3 block text-[11px] font-bold uppercase text-[#e6e68a]">
        <span className="flex items-center justify-between gap-3"><span>Listed as</span><span>{formatUsdEstimate(price, ethUsdPrice, floor)}</span></span>
        <div className="mt-1 flex items-center rounded-lg border-2 border-[#FFFF00]/35 bg-black/60 px-3 py-2 transition-[border-color,box-shadow] focus-within:border-[#FFFF00] focus-within:shadow-[0_0_10px_rgba(255,255,0,0.2)]">
          <input data-no-focus-ring type="text" inputMode="decimal" value={price} onChange={(event) => setPrice(sanitizeTradePriceInput(event.target.value))} placeholder="0.0" className="min-w-0 flex-1 appearance-none border-0 bg-transparent text-base font-bold text-[#FFFF00] outline-none" />
          <span className="text-sm font-bold text-[#FFFF00]">ETH</span>
        </div>
      </label>
      <p className="mt-1 text-[11px] font-bold text-[#e6e68a]">
        Listing will be on OpenSea. Received ETH excludes fees.
        {floor && <><br />Set price to <button type="button" onClick={() => setPriceFromMarket(floor)} className="cursor-pointer text-[#FFFF00] underline underline-offset-2">Floor</button>.</>}
        {topOffer && <> Set price to <button type="button" onClick={() => setPriceFromMarket(topOffer)} className="cursor-pointer text-[#FFFF00] underline underline-offset-2">Top Offer</button>.</>}
      </p>
      {priceAtOrBelowTopOffer && topOffer && (
        <p className="mt-2 rounded-lg border border-[#FFFF00]/35 bg-[rgba(255,255,0,0.12)] px-3 py-2 text-xs font-bold text-[#e6e68a]">
          Suggestion: Listing price should be above the current Top Offer of {formatMarketEthForTradeCopy(topOffer)}.
        </p>
      )}
      <button
        type="button"
        disabled={busy || !selectedTokenId || !priceIsValid}
        onClick={() => {
          if (!selectedTokenId) return;
          setBusy(true);
          void onList(selectedTokenId, price)
            .then((success) => {
              if (!success) return;
              setPrice("");
              setQuery("");
              setDebouncedQuery("");
              setSelectedTokenId(null);
              setFavouritesOnly(false);
              setPickerOpen(false);
              setPickerVisibleCount(PAGE_SIZE);
            })
            .finally(() => setBusy(false));
        }}
        className="mt-3 w-full cursor-pointer rounded-[20px] border border-[#b3b300] bg-[#FFFF00] px-5 py-3 text-base font-bold text-[rgb(80,80,0)] shadow-[3px_6px_0_#b3b300] transition-all duration-100 hover:bg-[#ffff66] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#b3b300] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {busy ? "Working..." : "Review item listing"}
      </button>
    </div>
  );
}

function ListedSweepMedia({ tokenId }: { tokenId: number }) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isMediaReady, setIsMediaReady] = useState(false);
  const [useMp4, setUseMp4] = useState(() => window.matchMedia("(hover: none) and (pointer: coarse)").matches);

  useEffect(() => {
    const media = window.matchMedia("(hover: none) and (pointer: coarse)");
    const update = () => setUseMp4(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const target = rootRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(Boolean(entry?.isIntersecting)),
      { threshold: 0.05 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setIsMediaReady(false);
  }, [isVisible, tokenId, useMp4]);

  return (
    <span ref={rootRef} className="relative block aspect-square w-full overflow-hidden rounded-lg bg-black">
      <img
        src={getWarpletPreviewImageUrl(tokenId)}
        alt=""
        loading="lazy"
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {isVisible && (useMp4 ? (
        <video
          key={`${tokenId}-mp4`}
          src={getWarpletAssetUrl(tokenId, "mp4")}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          onCanPlay={() => setIsMediaReady(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${isMediaReady ? "opacity-100" : "opacity-0"}`}
        />
      ) : (
        <img
          key={`${tokenId}-avif`}
          src={getWarpletAssetUrl(tokenId, "avif")}
          alt=""
          loading="eager"
          decoding="async"
          draggable={false}
          onLoad={() => setIsMediaReady(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${isMediaReady ? "opacity-100" : "opacity-0"}`}
        />
      ))}
    </span>
  );
}

function ListedSweepFooter({
  rows,
  ethUsdPrice,
  busy,
  expanded,
  onRemove,
  onBuy,
  onExpand,
  onClose,
}: {
  rows: ListedWarpletRow[];
  ethUsdPrice: number | null;
  busy: boolean;
  expanded: boolean;
  onRemove: (tokenId: number) => void;
  onBuy: () => void;
  onExpand: () => void;
  onClose: () => void;
}) {
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const carouselDragRef = useRef({ active: false, pointerId: -1, startX: 0, scrollLeft: 0 });
  const [initializeCarousel, getCarousel] = useOverlayScrollbars({
    options: {
      overflow: { x: "scroll", y: "hidden" },
      scrollbars: { theme: "os-theme-10x", autoHide: "never", clickScroll: true },
    },
    defer: true,
  });

  useEffect(() => {
    const target = carouselRef.current;
    if (!target) return;
    target.setAttribute("data-overlayscrollbars-initialize", "");
    initializeCarousel(target);
    return () => {
      getCarousel()?.destroy();
      target.removeAttribute("data-overlayscrollbars-initialize");
    };
  }, [expanded, getCarousel, initializeCarousel]);

  const handleCarouselPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || (event.target as Element).closest("button")) return;
    const viewport = getCarousel()?.elements().viewport;
    if (!viewport) return;
    carouselDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: viewport.scrollLeft,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleCarouselPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = carouselDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const viewport = getCarousel()?.elements().viewport;
    if (!viewport) return;
    viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
    event.preventDefault();
  };

  const finishCarouselDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = carouselDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    carouselDragRef.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const totalEth = rows.reduce((total, row) => total + (marketMoneyToDecimal(row.market.listing) ?? 0), 0);
  const totalUsd = ethUsdPrice == null ? null : totalEth * ethUsdPrice;
  const paymentSymbols = Array.from(new Set(rows.map((row) => {
    const listing = row.market.listing;
    const symbol = listing?.currencySymbol?.toUpperCase();
    return symbol === "WETH" || listing?.tokenAddress?.toLowerCase() === BASE_WETH_TOKEN_ADDRESS ? "WETH" : "ETH";
  })));
  const paymentSymbol = paymentSymbols.join(" + ");

  if (!expanded) {
    return (
      <div className="fixed bottom-0 left-1/2 z-50 w-full max-w-[500px] -translate-x-1/2 px-4">
        <div className="rounded-t-2xl border border-b-0 border-[#00FF00]/35 bg-black px-4 pb-4 pt-3 shadow-[0_-12px_28px_rgba(0,0,0,0.75)]">
        <button
          type="button"
          onClick={() => {
            void hapticPrimaryTap();
            onExpand();
          }}
          className="mb-1.5 w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-4 py-3 text-sm font-black text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000]"
        >
          Buy {rows.length.toLocaleString("en-US")} for {totalEth.toLocaleString("en-US", { maximumFractionDigits: 8 })} {paymentSymbol}
        </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-1/2 z-50 w-full max-w-[500px] -translate-x-1/2 px-4">
    <div className="overflow-hidden rounded-t-2xl border border-b-0 border-[#00FF00]/35 bg-black shadow-[0_-12px_28px_rgba(0,0,0,0.75)]">
      <div className="flex items-center justify-between gap-3 border-b border-[#00FF00]/20 bg-black px-4 py-3">
        <Text className="min-w-0 truncate text-base font-bold text-[#8bbf8b]">
          <span className="text-[#00FF00]">{rows.length === 1 ? "Buy" : "Bulk Buy"}</span>{" "}
          {rows.length.toLocaleString("en-US")} {rows.length === 1 ? "NFT" : "NFTs"}
        </Text>
        <button
          type="button"
          aria-label="Close bulk buy"
          title="Close"
          onClick={() => {
            void hapticTap();
            onClose();
          }}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#00FF00]/35 text-[#00FF00] hover:bg-[#041204]"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="px-4 pb-4 pt-3">
      <div
        ref={carouselRef}
        className="mb-3 max-w-full pb-3"
      >
        <div
          className="flex w-max min-w-full cursor-grab select-none gap-2 px-1 pb-1 pt-1 active:cursor-grabbing"
          onPointerDown={handleCarouselPointerDown}
          onPointerMove={handleCarouselPointerMove}
          onPointerUp={finishCarouselDrag}
          onPointerCancel={finishCarouselDrag}
          onDragStart={(event) => event.preventDefault()}
        >
          {rows.map((row) => {
            const priceEth = marketMoneyToDecimal(row.market.listing) ?? 0;
            const priceUsd = ethUsdPrice == null ? null : priceEth * ethUsdPrice;
            const listingSymbol = row.market.listing?.currencySymbol?.toUpperCase() === "WETH" || row.market.listing?.tokenAddress?.toLowerCase() === BASE_WETH_TOKEN_ADDRESS ? "WETH" : "ETH";
            return (
              <div key={row.warplet.id} className="w-[76px] shrink-0 text-center">
                <div className="relative">
                  <ListedSweepMedia tokenId={row.warplet.id} />
                  <button
                    type="button"
                    onClick={() => onRemove(row.warplet.id)}
                    className="absolute -right-1 -top-1 z-20 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-[#ff3333] text-[#730000]"
                    aria-label={`Remove Warplet #${row.warplet.id} from sweep`}
                  >
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                      <path d="M3 3 13 13" />
                      <path d="M13 3 3 13" />
                    </svg>
                  </button>
                </div>
                <div className="mt-1 truncate text-[10px] font-bold text-[#FFFF00]">{priceEth.toLocaleString("en-US", { maximumFractionDigits: 6 })} {listingSymbol}</div>
                <div className="truncate text-[9px] text-[#8bbf8b]">{priceUsd == null ? "USD loading..." : `~$${priceUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</div>
              </div>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onBuy}
        className="mb-1.5 w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-4 py-3 text-sm font-black text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:cursor-wait disabled:opacity-60"
      >
        {busy
          ? "Preparing Bulk Buy..."
          : `Buy for ${totalEth.toLocaleString("en-US", { maximumFractionDigits: 8 })} ${paymentSymbol} (${totalUsd == null ? "USD loading..." : `~$${totalUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`})`}
      </button>
      </div>
    </div>
    </div>
  );
}

function ListedPage({
  db,
  level,
  scope,
  listedWarplets,
  ownedWarplets,
  marketSnapshot,
  connectedWallet,
  favouriteTokenIds,
  loading,
  loadError,
  marketRefreshError,
  onScopeChange,
  onLevelChange,
  onOpenWarpletDetails,
  onToggleFavourite,
  onRefreshMarket,
  onListWarplet,
  onBulkBuy,
}: {
  db: SqliteDatabase | null;
  level: ListedLevelFilter;
  scope: ListedScopeFilter;
  listedWarplets: WarpletResult[];
  ownedWarplets: WarpletResult[];
  marketSnapshot: MarketSnapshot | null;
  connectedWallet: string | null;
  favouriteTokenIds: Set<number>;
  loading: boolean;
  loadError: string;
  marketRefreshError: string;
  onScopeChange: (scope: ListedScopeFilter) => void;
  onLevelChange: (level: ListedLevelFilter) => void;
  onOpenWarpletDetails: (tokenId: number) => void;
  onToggleFavourite: (tokenId: number) => void;
  onRefreshMarket: () => Promise<void>;
  onListWarplet: (tokenId: number, price: string) => Promise<boolean>;
  onBulkBuy: (rows: ListedWarpletRow[]) => Promise<number[]>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [sweepTokenIds, setSweepTokenIds] = useState<number[]>([]);
  const [shakingTokenIds, setShakingTokenIds] = useState<Set<number>>(() => new Set());
  const [sweepBusy, setSweepBusy] = useState(false);
  const [sweepEthUsdPrice, setSweepEthUsdPrice] = useState<number | null>(null);
  const [sweepFooterExpanded, setSweepFooterExpanded] = useState(false);
  const [sweepSelectionError, setSweepSelectionError] = useState("");
  const normalizedWallet = normalizeWalletAddress(connectedWallet);
  const ownedTokenIdSet = useMemo(() => new Set(ownedWarplets.map((warplet) => warplet.id)), [ownedWarplets]);
  const levelFilteredOwnedWarplets = useMemo(
    () => ownedWarplets.filter((warplet) => warpletMatchesListedLevel(warplet, level)),
    [level, ownedWarplets],
  );
  const listedRows = useMemo<ListedWarpletRow[]>(() => {
    const selectedForSweep = new Set(sweepTokenIds);
    const rows = listedWarplets
      .filter((warplet) => warpletMatchesListedLevel(warplet, level))
      .map((warplet) => ({
        warplet,
        market: getMarketState(marketSnapshot, warplet.id),
        groupKey: "",
      }))
      .filter((row) => row.market.listing)
      .filter((row) => scope !== "your" || walletMatches(row.market.listing?.seller, normalizedWallet))
      .filter((row) => scope !== "favourites" || favouriteTokenIds.has(row.warplet.id))
      .filter((row) => scope !== "sweep" || selectedForSweep.has(row.warplet.id))
      .map((row) => ({
        ...row,
        groupKey: getListingGroupKey(row.market.listing as MarketOrderMoney),
      }))
      .sort((a, b) => {
        const priceCompare = compareMarketPriceAsc(a.market.listing, b.market.listing);
        if (priceCompare !== 0) return priceCompare;
        const aTime = getMarketTimeMs(a.market.listing);
        const bTime = getMarketTimeMs(b.market.listing);
        if (aTime != null && bTime != null && aTime !== bTime) return aTime - bTime;
        return a.warplet.id - b.warplet.id;
      });
    return rows;
  }, [favouriteTokenIds, level, listedWarplets, marketSnapshot, normalizedWallet, scope, sweepTokenIds]);

  const listingGroups = useMemo<ListedWarpletGroup[]>(() => {
    const groups: ListedWarpletGroup[] = [];
    const groupLookup = new Map<string, ListedWarpletGroup>();
    for (const row of listedRows) {
      const listing = row.market.listing;
      if (!listing) continue;
      const group = groupLookup.get(row.groupKey);
      if (group) {
        group.rows.push(row);
      } else {
        const nextGroup = { key: row.groupKey, price: listing, rows: [row] };
        groupLookup.set(row.groupKey, nextGroup);
        groups.push(nextGroup);
      }
    }
    return groups;
  }, [listedRows]);

  const sweepRows = useMemo<ListedWarpletRow[]>(() => {
    const selected = new Set(sweepTokenIds);
    return listedWarplets
      .filter((warplet) => selected.has(warplet.id))
      .map((warplet) => ({ warplet, market: getMarketState(marketSnapshot, warplet.id), groupKey: "" }))
      .filter((row) => Boolean(row.market.listing));
  }, [listedWarplets, marketSnapshot, sweepTokenIds]);

  useEffect(() => {
    if (sweepEthUsdPrice != null) return;
    fetchEthUsdPrice().then(setSweepEthUsdPrice).catch((error) => {
      console.warn("Failed to load ETH/USD price for sweep:", error);
    });
  }, [sweepEthUsdPrice]);

  useEffect(() => {
    if (sweepRows.length === 0) setSweepFooterExpanded(false);
  }, [sweepRows.length]);

  useEffect(() => {
    setSweepTokenIds((current) => current.filter((tokenId) => !ownedTokenIdSet.has(tokenId)));
  }, [ownedTokenIdSet]);

  useEffect(() => {
    if (!sweepSelectionError) return;
    const timeout = window.setTimeout(() => setSweepSelectionError(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [sweepSelectionError]);

  const toggleSweep = useCallback((tokenId: number) => {
    const isSelected = sweepTokenIds.includes(tokenId);
    if (!isSelected && sweepTokenIds.length >= MAX_SWEEP_ITEMS) {
      void hapticWarning();
      setSweepSelectionError(`You can select up to ${MAX_SWEEP_ITEMS} NFTs per bulk buy.`);
      return;
    }
    void hapticSelectionChanged();
    setSweepTokenIds((current) => current.includes(tokenId)
      ? current.filter((id) => id !== tokenId)
      : [...current, tokenId]);
    setShakingTokenIds((current) => new Set(current).add(tokenId));
    window.setTimeout(() => {
      setShakingTokenIds((current) => {
        const next = new Set(current);
        next.delete(tokenId);
        return next;
      });
    }, 340);
    setSweepSelectionError("");
  }, [sweepTokenIds]);

  const runBulkBuy = useCallback(async () => {
    if (sweepBusy || sweepRows.length === 0) return;
    setSweepBusy(true);
    try {
      const purchasedTokenIds = new Set(await onBulkBuy(sweepRows));
      if (purchasedTokenIds.size > 0) {
        setSweepTokenIds((current) => current.filter((tokenId) => !purchasedTokenIds.has(tokenId)));
        if (purchasedTokenIds.size === sweepRows.length) setSweepFooterExpanded(false);
      }
    } finally {
      setSweepBusy(false);
    }
  }, [onBulkBuy, sweepBusy, sweepRows]);

  const totalListingValue = useMemo(
    () => sumMarketMoney(listedRows.map((row) => row.market.listing)),
    [listedRows],
  );
  const refreshLabel = marketSnapshot?.generatedAt ? formatMarketTimestamp(marketSnapshot.generatedAt) : "Not yet";

  const runRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefreshMarket();
    } finally {
      setRefreshing(false);
    }
  }, [onRefreshMarket, refreshing]);

  return (
    <div className={`mx-auto w-full max-w-md px-4 pt-6 ${sweepRows.length > 0 ? (sweepFooterExpanded ? "pb-72" : "pb-24") : "pb-10"}`}>
      <div className="grid grid-cols-2 gap-3">
        <ListedStatPanel kind="count" label="Count" value={listedRows.length.toLocaleString("en-US")} />
        <ListedStatPanel kind="value" label="Value" value={<InlineHoverTooltip value={formatMarketValue(totalListingValue, { maxDigits: 8 })} tooltip={formatUsdMoneyFromMarket(totalListingValue, sweepEthUsdPrice)} className="text-[#FFFF00]" tone="yellow"/>} />
      </div>

      <ListedListingForm
        db={db}
        ownedWarplets={ownedWarplets}
        favouriteTokenIds={favouriteTokenIds}
        marketSnapshot={marketSnapshot}
        ethUsdPrice={sweepEthUsdPrice}
        onOpenWarplet={onOpenWarpletDetails}
        onList={async (tokenId, price) => {
          const success = await onListWarplet(tokenId, price);
          if (success) {
            onScopeChange("your");
            onLevelChange("all");
          }
          return success;
        }}
      />

      <SearchSegmentedTabs
        className="mt-4"
        options={LISTED_SCOPE_TABS}
        activeId={scope}
        onSelect={(id) => onScopeChange(id as ListedScopeFilter)}
        gridTemplateColumns="52px minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 0.9fr)"
      />
      {sweepSelectionError && (
        <Text className="mt-2 text-center text-[11px] font-bold text-red-300">
          {sweepSelectionError}
        </Text>
      )}

      {loading && (
        <Text className={`mt-6 ${STATUS_LINE_CLASS}`} style={{ color: "#00FF00" }}>
          Loading listings...
        </Text>
      )}
      {loadError && (
        <Text className="mt-4 text-center text-xs font-bold text-red-300">
          {loadError}
        </Text>
      )}
      {!loading && !loadError && listedRows.length === 0 && (
        <Text className={`mt-6 ${STATUS_LINE_CLASS}`} style={{ color: "#00FF00" }}>
          {scope === "sweep" ? "No items selected to buy." : "No active listings."}
        </Text>
      )}

      <div className="mt-4">
        {listingGroups.map((group) => (
          <section key={group.key}>
            <ListedPriceHeader price={group.price} ethUsdPrice={sweepEthUsdPrice} />
            <div className="space-y-3.5 py-3">
              {group.rows.map((row) => (
                <ListedWarpletCard
                  key={row.warplet.id}
                  row={row}
                  isOwned={ownedTokenIdSet.has(row.warplet.id)}
                  isFavourited={favouriteTokenIds.has(row.warplet.id)}
                  isSweepSelected={sweepTokenIds.includes(row.warplet.id)}
                  isShaking={shakingTokenIds.has(row.warplet.id)}
                  onOpen={onOpenWarpletDetails}
                  onToggleFavourite={onToggleFavourite}
                  onToggleSweep={toggleSweep}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-5 text-center text-[11px] leading-4 text-[#8bbf8b]">
        Last updated: {refreshLabel}
        {". "}
        <span
          role="button"
          tabIndex={refreshing ? -1 : 0}
          aria-disabled={refreshing}
          onClick={() => {
            if (refreshing) return;
            void hapticPrimaryTap();
            void runRefresh();
          }}
          onKeyDown={(event) => {
            if (refreshing) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void hapticPrimaryTap();
              void runRefresh();
            }
          }}
          className={`font-bold text-[#00FF00] ${refreshing ? "cursor-wait opacity-60" : "cursor-pointer"}`}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </span>
        {marketRefreshError && (
          <span className="block text-red-300">{marketRefreshError}</span>
        )}
      </div>
      {sweepRows.length > 0 && (
        <ListedSweepFooter
          rows={sweepRows}
          ethUsdPrice={sweepEthUsdPrice}
          busy={sweepBusy}
          expanded={sweepFooterExpanded}
          onRemove={toggleSweep}
          onBuy={() => void runBulkBuy()}
          onExpand={() => setSweepFooterExpanded(true)}
          onClose={() => setSweepFooterExpanded(false)}
        />
      )}
    </div>
  );
}

const OWNED_BY_VISIBLE_AVATAR_LIMIT = 24;

function ProfilePictureDownloadModal({
  tokenId,
  viewerFid,
  viewerWallet,
  viewerUsername,
  onClose,
}: {
  tokenId: number;
  viewerFid: number | null;
  viewerWallet: string | null;
  viewerUsername: string | null;
  onClose: () => void;
}) {
  const [xUsername, setXUsername] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<"webp" | "gif" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (viewerFid) params.set("fid", String(viewerFid));
    else if (viewerWallet) params.set("wallet", viewerWallet);
    if (!params.toString()) return () => controller.abort();

    fetch(`/api/warplet-social-profile?${params.toString()}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => response.ok ? response.json() as Promise<{ xUsername?: unknown }> : null)
      .then((profile) => {
        const username = typeof profile?.xUsername === "string" ? profile.xUsername.trim().replace(/^@/, "") : "";
        setXUsername(username || null);
      })
      .catch((error) => {
        if ((error as { name?: string }).name !== "AbortError") {
          console.warn("Failed to load the viewer's verified X profile:", error);
        }
      });

    return () => controller.abort();
  }, [viewerFid, viewerWallet]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const downloadAsset = async (extension: "webp" | "gif") => {
    const url = getWarpletAssetUrl(tokenId, extension);
    void hapticPrimaryTap();
    setDownloading(extension);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Image download failed (${response.status})`);
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `10x-warplet-${tokenId}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      void hapticSuccess();
    } catch (error) {
      console.warn("Direct profile image download was unavailable; opening the image instead:", error);
      await openExternalAsset(url);
    } finally {
      setDownloading(null);
    }
  };

  const celebrateProfileChange = () => {
    void hapticSuccess();
    showTradeConfetti();
  };

  const openFarcasterProfile = async () => {
    celebrateProfileChange();
    try {
      const inMiniApp = typeof sdk.isInMiniApp === "function" ? await sdk.isInMiniApp() : false;
      if (inMiniApp && viewerFid) {
        await viewFarcasterProfile(viewerFid);
        return;
      }
    } catch (error) {
      console.warn("Farcaster profile action was unavailable:", error);
    }
    const profileUrl = viewerUsername
      ? `https://farcaster.xyz/${encodeURIComponent(viewerUsername.replace(/^@/, ""))}`
      : viewerFid
        ? `https://farcaster.xyz/~/profiles/${viewerFid}`
        : "https://farcaster.xyz";
    window.open(profileUrl, "_blank", "noopener,noreferrer");
  };

  const openXProfile = () => {
    celebrateProfileChange();
    const profileUrl = xUsername ? `https://x.com/${encodeURIComponent(xUsername)}` : "https://x.com";
    void openExternalAsset(profileUrl);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/80 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-picture-modal-title"
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-auto rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#00FF00]/20 bg-black px-4 py-3">
          <Text id="profile-picture-modal-title" className="min-w-0 text-base font-bold" style={{ color: "rgb(139, 191, 139)" }}>
            <span style={{ color: "#00FF00" }}>One Of Us!</span> Profile Picture Update
          </Text>
          <button
            type="button"
            aria-label="Close profile picture modal"
            title="Close"
            onClick={() => {
              void hapticTap();
              onClose();
            }}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#00FF00]/35 bg-black text-[#00FF00] hover:bg-[#041204]"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-4">
          <Text className="text-sm font-bold" style={{ color: "#8bbf8b" }}>
            Use your 10X Warplet as your profile picture.
          </Text>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {([
              { extension: "webp" as const, title: "10X Green" },
              { extension: "gif" as const, title: "Animated PFP" },
            ]).map((option) => (
              <div key={option.extension} className="min-w-0 rounded-xl border border-[#00FF00]/25 bg-[#041204]/80 p-2.5 text-center">
                <Text className="mb-2 text-xs font-bold uppercase" style={{ color: "#00FF00" }}>{option.title}</Text>
                <div className="aspect-square overflow-hidden rounded-lg bg-black">
                  <img
                    src={getWarpletAssetUrl(tokenId, option.extension)}
                    alt={`${option.title} profile picture for 10X Warplet #${tokenId}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <button
                  type="button"
                  disabled={downloading !== null}
                  onClick={() => void downloadAsset(option.extension)}
                  className="mt-3 w-full cursor-pointer rounded-[16px] border border-[#00FF00]/45 bg-black px-2 py-2 text-xs font-bold text-[#00FF00] transition-colors duration-100 hover:border-[#00FF00] hover:bg-[#071807] disabled:cursor-wait disabled:opacity-60"
                >
                  {downloading === option.extension ? "Downloading..." : "Download"}
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-[#33AAFF]/40 bg-[rgba(51,170,255,0.12)] px-3 py-2.5 text-xs font-bold leading-relaxed text-[#8bcfff]">
            <p>Farcaster and X (Twitter) currently display Animated PFPs as a static coloured Warplet.</p>
            <p className="mt-2">Quorum, and some other Farcaster apps do support Animated PFPs.</p>
            <p className="mt-2">
              ...to stand out, most of us choose{" "}
              <span className="inline-flex rounded-full border border-[#00FF00] bg-[#032503] px-2 py-0.5 font-bold text-[#00FF00]">
                10X Green
              </span>
            </p>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 border-t border-[#00FF00]/20 bg-black px-4 pb-4 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void openFarcasterProfile()}
              className="w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-3 py-3 text-sm font-bold text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000]"
            >
              Farcaster Profile
            </button>
            <button
              type="button"
              onClick={openXProfile}
              className="secondary-trade-cta w-full cursor-pointer rounded-[20px] border bg-black px-3 py-3 text-sm font-bold text-[#00FF00] transition-all duration-100 hover:bg-[#041204] active:translate-x-[1px] active:translate-y-[3px]"
            >
              X (Twitter) Profile
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OwnedByPanel({
  owner,
  currentTokenId,
  ownedTokenIds,
  ownerFavouriteCount,
  onOpenWarplet,
  onSearchOwnerWallet,
  onSearchOwnerFavourites,
  viewerWallet,
  viewerFid,
  viewerUsername,
}: {
  owner?: TokenMarketState["owner"];
  currentTokenId: number;
  ownedTokenIds: number[];
  ownerFavouriteCount: number;
  onOpenWarplet: (tokenId: number) => void;
  onSearchOwnerWallet: (wallet: string) => void;
  onSearchOwnerFavourites: (wallet: string) => void;
  viewerWallet: string | null;
  viewerFid: number | null;
  viewerUsername: string | null;
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
  const viewerOwnsWarplet = Boolean(
    (wallet && viewerWallet && normalizeWalletAddress(wallet) === normalizeWalletAddress(viewerWallet))
    || (fid && viewerFid && fid === viewerFid),
  );
  const [showProfilePictureModal, setShowProfilePictureModal] = useState(false);

  const handleOpenProfile = () => {
    if (!fid) return;
    void hapticTap();
    viewFarcasterProfile(fid).catch((error) => {
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
              <WalletIdenticon wallet={wallet ?? String(fid)} className="h-full w-full" />
            )}
          </button>
          ) : (
          <div className="aspect-square w-full min-w-0 shrink-0 overflow-hidden rounded-full border-2 border-[#00FF00] bg-[rgba(0,255,0,0.12)]">
            <WalletIdenticon wallet={wallet ?? String(fid)} className="h-full w-full" />
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
                onOpenWarplet(tokenId);
              }}
              className="aspect-square w-full min-w-0 cursor-pointer overflow-hidden rounded-full border-2 border-[rgba(0,255,0,0)] bg-transparent hover:border-[#00FF00]"
              title={`Open 10X Warplet #${tokenId}`}
            >
              <ProgressiveWarpletImage tokenId={tokenId} alt="" className="h-full w-full" loading="lazy" />
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
      {viewerOwnsWarplet && (
        <button
          type="button"
          onClick={() => {
            void hapticPrimaryTap();
            setShowProfilePictureModal(true);
          }}
          className="secondary-trade-cta mt-3 w-full cursor-pointer rounded-[20px] border bg-black px-4 py-2.5 text-sm font-bold text-[#00FF00] transition-all duration-100 hover:bg-[#041204] active:translate-x-[1px] active:translate-y-[3px]"
        >
          Set Warplet as Profile Picture
        </button>
      )}
      {showProfilePictureModal && (
        <ProfilePictureDownloadModal
          tokenId={currentTokenId}
          viewerFid={viewerFid}
          viewerWallet={viewerWallet}
          viewerUsername={viewerUsername}
          onClose={() => setShowProfilePictureModal(false)}
        />
      )}
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

function restoreBlackBrowserChrome(): void {
  const current = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const replacement = current ?? document.createElement("meta");
  replacement.name = "theme-color";
  replacement.content = "#000000";
  // Mobile Safari can retain a colour sampled from a fixed element after that
  // element disappears. Re-inserting the tag forces its browser chrome to
  // re-read the app theme instead of keeping the warning-toast red.
  if (current) current.remove();
  document.head.appendChild(replacement);
  document.documentElement.style.backgroundColor = "#000000";
  document.body.style.backgroundColor = "#000000";
}

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
  useEffect(() => () => {
    if (isDanger) restoreBlackBrowserChrome();
  }, [isDanger]);
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
      "10X Warplets is an exclusive 10K NFT collection.",
      "Farcaster focused. Meme powered. Data driven.",
      "10X is where Builders, Traders, & Attention align.",
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
    title: "Perks! Airdrops, Alpha, and More...",
    visual: "access",
    bullets: [
      <>
        Hold higher Levels to get bigger 10X Meme airdrop bonuses (coming soon on Base, BSC, Solana, Robinhood...).
      </>,
      "Holding a 10X Warplet also gives you whitelist access to future 10X NFT launches (coming soon on Ethereum, via OpenSea).",
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
      "Get notifications for activity, stats and friends.",
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
const SEARCH_PLACEHOLDER_DELETE_MS = DATABASE_LOADING_DELETE_MS;
const SEARCH_PLACEHOLDER_TYPE_MS_PER_CHARACTER = ONBOARDING_TYPEWRITER_MS_PER_CHARACTER;
const SEARCH_RESULTS_REVEAL_DELAY_MS = 40;
const ONBOARDING_FEATURED_WARPLET_VIDEO_SRC = getWarpletAssetUrl(760, "mp4");
const ONBOARDING_INITIAL_TITLE_CURSOR_MS = 1500;
const ENABLED_ONBOARDING_VISUALS: ReadonlySet<OnboardingVisualKind> = new Set([
  "featuredWarplet",
  "airdrop",
  "attributes",
  "levels",
  "access",
  "search",
  "trade",
]);

function getOnboardingPreviewAnimationDurationMs(kind: OnboardingVisualKind): number {
  if (!ENABLED_ONBOARDING_VISUALS.has(kind)) return 0;

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
  onFeaturedPreviewReady,
}: {
  kind: OnboardingVisualKind;
  animationStarted?: boolean;
  onFeaturedPreviewReady?: () => void;
}) {
  const [isFeaturedWarpletReady, setIsFeaturedWarpletReady] = useState(false);
  const [readyAccessVideos, setReadyAccessVideos] = useState<Record<string, boolean>>({});
  const [levelAnimationStep, setLevelAnimationStep] = useState(-1);

  useEffect(() => {
    if (kind === "featuredWarplet" && isFeaturedWarpletReady) {
      onFeaturedPreviewReady?.();
    }
  }, [isFeaturedWarpletReady, kind, onFeaturedPreviewReady]);

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

  if (!ENABLED_ONBOARDING_VISUALS.has(kind)) {
    return null;
  }

  if (kind === "featuredWarplet") {
    return (
      <div className="relative mx-auto aspect-[9/8] w-full max-w-[min(100%,360px)] overflow-hidden rounded-lg border border-[#00FF00]/25 bg-black">
        {!isFeaturedWarpletReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-[rgba(0,255,0,0.12)]">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#00FF00]/25 border-t-[#00FF00]" aria-label="Loading 10X Warplet preview" />
          </div>
        )}
        <video
          src={ONBOARDING_FEATURED_WARPLET_VIDEO_SRC}
          autoPlay
          muted
          loop
          playsInline
          onCanPlay={() => setIsFeaturedWarpletReady(true)}
          onLoadedData={() => setIsFeaturedWarpletReady(true)}
          className={`h-full w-full object-cover transition-opacity duration-300 ${isFeaturedWarpletReady ? "opacity-100" : "opacity-0"}`}
        />
      </div>
    );
  }

  if (kind === "airdrop") {
    return (
      <div className="onboarding-pan-zoom-frame relative aspect-[9/7] overflow-hidden rounded-lg border border-[#00FF00]/25 bg-black">
        <img src="/onboarding/step-2-v2-small.avif" alt="The Warplets collection" className="onboarding-pan-zoom" loading="eager" decoding="async" />
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
    const searchPreviewImages = [1, 2, 3, 4, 5].map((index) => `/onboarding/step6-${index}-v2.jpg`);

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
    const tradePreviewImages = [1, 2, 3, 4, 5, 6, 7].map((index) => `/onboarding/step7-${index}-v3.jpg`);

    return (
      <div className="relative aspect-[562/507] overflow-hidden rounded-lg border border-[#00FF00]/25 bg-black">
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

const ONBOARDING_BACKGROUND_PRELOAD_IMAGES = [
  "/onboarding/step-2-v2-small.avif",
  ...[1, 2, 3, 4, 5].map((index) => `/onboarding/step6-${index}-v2.jpg`),
  ...[1, 2, 3, 4, 5, 6, 7].map((index) => `/onboarding/step7-${index}-v3.jpg`),
  getWarpletAssetUrl(FORCED_AIRDROP_FALLBACK_TOKEN_ID, "avif"),
  getWarpletAssetUrl(FORCED_AIRDROP_FALLBACK_TOKEN_ID, "png"),
  getWarpletAssetUrl(FORCED_AIRDROP_FALLBACK_TOKEN_ID, "jpg"),
] as const;

const ONBOARDING_BACKGROUND_PRELOAD_DELAY_MS = 1200;
const ONBOARDING_BACKGROUND_PRELOAD_GAP_MS = 200;

function OnboardingBackgroundMediaPreloader() {
  useEffect(() => {
    let isCancelled = false;
    const timeoutIds: number[] = [];
    const imageRefs: HTMLImageElement[] = [];

    const schedule = (callback: () => void, delay: number) => {
      const timeoutId = window.setTimeout(callback, delay);
      timeoutIds.push(timeoutId);
    };

    const preloadNextImage = (index: number) => {
      if (isCancelled || index >= ONBOARDING_BACKGROUND_PRELOAD_IMAGES.length) return;

      const src = ONBOARDING_BACKGROUND_PRELOAD_IMAGES[index];
      const image = new Image();
      imageRefs.push(image);
      image.decoding = "async";
      image.loading = "eager";
      image.onload = () => schedule(() => preloadNextImage(index + 1), ONBOARDING_BACKGROUND_PRELOAD_GAP_MS);
      image.onerror = () => {
        console.warn("Search onboarding image preload failed:", src);
        schedule(() => preloadNextImage(index + 1), ONBOARDING_BACKGROUND_PRELOAD_GAP_MS);
      };
      image.src = src;
    };

    schedule(() => preloadNextImage(0), ONBOARDING_BACKGROUND_PRELOAD_DELAY_MS);

    return () => {
      isCancelled = true;
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      imageRefs.forEach((image) => {
        image.onload = null;
        image.onerror = null;
      });
    };
  }, []);

  return null;
}

function OnboardingCarousel({ onDone }: { onDone: () => void }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [typedCharacterCount, setTypedCharacterCount] = useState(0);
  const [shouldPreloadUpcomingMedia, setShouldPreloadUpcomingMedia] = useState(false);
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
  const shouldShowInitialTitleCursor = activeIndex === 0 && typedCharacterCount === 0;
  const handleFeaturedPreviewReady = useCallback(() => {
    setShouldPreloadUpcomingMedia(true);
  }, []);
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
    const initialDelayMs = activeIndex === 0 ? ONBOARDING_INITIAL_TITLE_CURSOR_MS : 0;

    setTypedCharacterCount(0);

    const tick = (now: number) => {
      const elapsedMs = Math.max(0, now - startedAt - initialDelayMs);
      const nextCount = Math.min(
        onboardingTotalTextCharacters,
        Math.floor(elapsedMs / ONBOARDING_TYPEWRITER_MS_PER_CHARACTER),
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
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/80 p-4 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl">
        <div className="border-b border-[#00FF00]/20 bg-black px-4 py-3">
          <Text className="relative text-base font-bold" style={{ color: "#00FF00" }}>
            <span className="invisible select-none" aria-hidden="true">{activeSlide.title}</span>
            <span className="absolute inset-0">
              {shouldShowInitialTitleCursor ? (
                <span className="onboarding-terminal-cursor" aria-hidden="true" />
              ) : (
                <TypewriterText visibleCharacters={visibleTitleCharacters}>
                  {activeSlide.title}
                </TypewriterText>
              )}
            </span>
          </Text>
        </div>
        <div ref={onboardingContentRef} className="min-h-0 flex-1 overflow-y-auto p-4">
          <OnboardingVisual
            kind={activeSlide.visual}
            animationStarted={onboardingPreviewAnimationStarted}
            onFeaturedPreviewReady={handleFeaturedPreviewReady}
          />
          {shouldPreloadUpcomingMedia && <OnboardingBackgroundMediaPreloader />}
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

const AIRDROP_CONGRATULATIONS_TITLE = "Free Airdrop Congratulations!";
const AIRDROP_CONGRATULATIONS_TITLE_HIGHLIGHT_LENGTH = "Free Airdrop".length;
const AIRDROP_CONGRATULATIONS_LINES = [
  "Farcaster is for Builders... 10X is for Attention!",
] as const;
const AIRDROP_TITLE_TO_ATTRIBUTES_DELAY_MS = 180;
const AIRDROP_ATTRIBUTE_REVEAL_INTERVAL_MS = 180;
const AIRDROP_ATTRIBUTES_TO_IMAGE_DELAY_MS = 260;
const AIRDROP_IMAGE_FADE_MS = 800;
const AIRDROP_IMAGE_TO_TEXT_DELAY_MS = 1180;

function AirdropCongratulationsModal({
  details,
  onShare,
  onPreviewRevealComplete,
}: {
  details: WarpletDetails;
  onShare: () => void;
  onPreviewRevealComplete: () => void;
}) {
  const [animationElapsedMs, setAnimationElapsedMs] = useState(0);
  const [isWarpletImageReady, setIsWarpletImageReady] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const previewRevealCompleteRef = useRef(false);
  const lineCharacterCounts = useMemo(
    () => AIRDROP_CONGRATULATIONS_LINES.map((line) => countTypewriterCharacters(line)),
    [],
  );
  const titleAnimationMs = AIRDROP_CONGRATULATIONS_TITLE.length * ONBOARDING_TYPEWRITER_MS_PER_CHARACTER;
  const attributesStartMs = titleAnimationMs + AIRDROP_TITLE_TO_ATTRIBUTES_DELAY_MS;
  const attributesAnimationMs = ATTRIBUTE_LEVEL_SUMMARY.length * AIRDROP_ATTRIBUTE_REVEAL_INTERVAL_MS;
  const imageStartMs = attributesStartMs + attributesAnimationMs + AIRDROP_ATTRIBUTES_TO_IMAGE_DELAY_MS;
  const imageRevealCompleteMs = imageStartMs + AIRDROP_IMAGE_FADE_MS;
  const textStartMs = imageRevealCompleteMs + AIRDROP_IMAGE_TO_TEXT_DELAY_MS;
  const textCharacterCount = useMemo(
    () => lineCharacterCounts.reduce((total, count) => total + count, 0),
    [lineCharacterCounts],
  );
  const totalAnimationMs = useMemo(
    () => textStartMs + textCharacterCount * ONBOARDING_TYPEWRITER_MS_PER_CHARACTER,
    [textCharacterCount, textStartMs],
  );
  const [initializeScrollbars] = useOverlayScrollbars({
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
    const target = contentRef.current;
    if (!target) return;
    target.setAttribute("data-overlayscrollbars-initialize", "");
    initializeScrollbars(target);
    return () => {
      target.removeAttribute("data-overlayscrollbars-initialize");
    };
  }, [initializeScrollbars]);

  useEffect(() => {
    let animationFrameId = 0;
    const startedAt = performance.now();

    setAnimationElapsedMs(0);
    setIsWarpletImageReady(false);
    previewRevealCompleteRef.current = false;

    const tick = (now: number) => {
      const nextElapsedMs = Math.min(totalAnimationMs, now - startedAt);
      setAnimationElapsedMs(nextElapsedMs);
      if (nextElapsedMs < totalAnimationMs) {
        animationFrameId = window.requestAnimationFrame(tick);
      }
    };

    animationFrameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [details.id, totalAnimationMs]);

  useEffect(() => {
    if (previewRevealCompleteRef.current) return;
    if (!isWarpletImageReady || animationElapsedMs < imageRevealCompleteMs) return;
    previewRevealCompleteRef.current = true;
    onPreviewRevealComplete();
  }, [animationElapsedMs, imageRevealCompleteMs, isWarpletImageReady, onPreviewRevealComplete]);

  const visibleTitleCharacters = Math.max(
    0,
    Math.min(
      AIRDROP_CONGRATULATIONS_TITLE.length,
      Math.floor(animationElapsedMs / ONBOARDING_TYPEWRITER_MS_PER_CHARACTER),
    ),
  );
  const visibleHighlightedTitle = AIRDROP_CONGRATULATIONS_TITLE.slice(
    0,
    Math.min(visibleTitleCharacters, AIRDROP_CONGRATULATIONS_TITLE_HIGHLIGHT_LENGTH),
  );
  const visibleRestTitle = visibleTitleCharacters > AIRDROP_CONGRATULATIONS_TITLE_HIGHLIGHT_LENGTH
    ? AIRDROP_CONGRATULATIONS_TITLE.slice(AIRDROP_CONGRATULATIONS_TITLE_HIGHLIGHT_LENGTH, visibleTitleCharacters)
    : "";
  const revealedAttributeCount = animationElapsedMs < attributesStartMs
    ? 0
    : Math.min(
        ATTRIBUTE_LEVEL_SUMMARY.length,
        Math.floor((animationElapsedMs - attributesStartMs) / AIRDROP_ATTRIBUTE_REVEAL_INTERVAL_MS) + 1,
      );
  const isImageVisible = animationElapsedMs >= imageStartMs;
  const textAnimationElapsedMs = Math.max(0, animationElapsedMs - textStartMs);

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/80 p-4 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-[#00FF00]/20 bg-black px-4 py-3">
          <Text className="relative min-w-0 flex-1 text-base font-bold" style={{ color: "rgb(139, 191, 139)" }}>
            <span className="invisible select-none" aria-hidden="true">{AIRDROP_CONGRATULATIONS_TITLE}</span>
            <span className="absolute inset-0 min-w-0 truncate">
              <span style={{ color: "#00FF00" }}>{visibleHighlightedTitle}</span>
              {visibleRestTitle}
            </span>
          </Text>
        </div>

        <div ref={contentRef} className="min-h-0 flex-1 overflow-auto">
          <CompactAttributePreview row={details.row} revealedAttributeCount={revealedAttributeCount} />
          <div className="relative aspect-square w-full overflow-hidden bg-[rgba(0,255,0,0.12)]">
            {(!isImageVisible || !isWarpletImageReady) && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#00FF00]/25 border-t-[#00FF00]" aria-label="Loading 10X Warplet image" />
              </div>
            )}
            <img
              src={getWarpletAssetUrl(details.id, "avif")}
              alt=""
              onLoad={() => setIsWarpletImageReady(true)}
              className={`relative z-[1] h-full w-full object-cover transition-opacity duration-[800ms] ${isImageVisible && isWarpletImageReady ? "opacity-100" : "opacity-0"}`}
            />
          </div>
          <div className="space-y-2 p-4">
            {AIRDROP_CONGRATULATIONS_LINES.map((line, index) => {
              const previousCharacters = lineCharacterCounts
                .slice(0, index)
                .reduce((total, count) => total + count, 0);
              const lineCharacterCount = lineCharacterCounts[index] ?? 0;
              const visibleCharacters = Math.max(
                0,
                Math.min(
                  lineCharacterCount,
                  Math.floor(textAnimationElapsedMs / ONBOARDING_TYPEWRITER_MS_PER_CHARACTER) - previousCharacters,
                ),
              );

              return (
                <div key={line} className="relative rounded-lg border border-[#00FF00]/15 bg-[#041204] px-3 py-2 text-sm leading-relaxed text-[#8bbf8b]">
                  <div className="invisible select-none" aria-hidden="true">
                    {line}
                  </div>
                  <div className="absolute inset-0 px-3 py-2">
                    <TypewriterText visibleCharacters={visibleCharacters}>
                      {line}
                    </TypewriterText>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="sticky bottom-0 z-10 border-t border-[#00FF00]/20 bg-black p-4">
          <button
            type="button"
            onClick={() => {
              void hapticPrimaryTap();
              onShare();
            }}
            className="w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-4 py-3 text-sm font-bold text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000]"
          >
            Let&apos;s make some noise!
          </button>
        </div>
      </div>
    </div>
  );
}

const NOTIFICATIONS_PROMPT_TITLE = "FOMO? Don't Miss Out...";
const NOTIFICATIONS_PROMPT_TITLE_HIGHLIGHT_LENGTH = "FOMO?".length;
const NOTIFICATIONS_PREVIEW_TOKEN_ID = 5019;
const NOTIFICATIONS_PREVIEW_IMAGE_SRC = getWarpletAssetUrl(NOTIFICATIONS_PREVIEW_TOKEN_ID, "png");
const NOTIFICATIONS_PREVIEW_FALLBACK_IMAGE_SRC = getWarpletAssetUrl(NOTIFICATIONS_PREVIEW_TOKEN_ID, "jpg");
const NOTIFICATIONS_PREVIEW_REVEAL_MS = 4800;
const NOTIFICATIONS_PREVIEW_TO_TEXT_DELAY_MS = 180;
const NOTIFICATIONS_PREVIEW_REVEAL_STOPS = [0, 40, 20, 65, 35, 85, 25, 100] as const;

function easeInOutProgress(progress: number): number {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  return 0.5 - Math.cos(clampedProgress * Math.PI) / 2;
}

function getNotificationPreviewRevealPercent(elapsedMs: number): number {
  if (elapsedMs <= 0) return NOTIFICATIONS_PREVIEW_REVEAL_STOPS[0];
  if (elapsedMs >= NOTIFICATIONS_PREVIEW_REVEAL_MS) return 100;

  const segmentCount = NOTIFICATIONS_PREVIEW_REVEAL_STOPS.length - 1;
  const segmentMs = NOTIFICATIONS_PREVIEW_REVEAL_MS / segmentCount;
  const segmentIndex = Math.min(segmentCount - 1, Math.floor(elapsedMs / segmentMs));
  const segmentProgress = easeInOutProgress((elapsedMs - segmentIndex * segmentMs) / segmentMs);
  const fromPercent = NOTIFICATIONS_PREVIEW_REVEAL_STOPS[segmentIndex];
  const toPercent = NOTIFICATIONS_PREVIEW_REVEAL_STOPS[segmentIndex + 1];
  return fromPercent + (toPercent - fromPercent) * segmentProgress;
}

function NotificationsPromptModal({
  notificationsOnlyPrompt,
  onConfirm,
}: {
  notificationsOnlyPrompt: boolean;
  onConfirm: () => void;
}) {
  const [animationElapsedMs, setAnimationElapsedMs] = useState(0);
  const [isPreviewImageReady, setIsPreviewImageReady] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const notificationPromptText = notificationsOnlyPrompt
    ? "Please turn on notifications so you don't miss important 10X market updates."
    : "Please add this Mini App & enable notifications so you don't miss important 10X updates 👀";
  const titleAnimationMs = NOTIFICATIONS_PROMPT_TITLE.length * ONBOARDING_TYPEWRITER_MS_PER_CHARACTER;
  const previewStartMs = titleAnimationMs;
  const textStartMs = previewStartMs + NOTIFICATIONS_PREVIEW_REVEAL_MS + NOTIFICATIONS_PREVIEW_TO_TEXT_DELAY_MS;
  const totalAnimationMs = textStartMs + notificationPromptText.length * ONBOARDING_TYPEWRITER_MS_PER_CHARACTER;
  const [initializeScrollbars] = useOverlayScrollbars({
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
    const target = contentRef.current;
    if (!target) return;
    target.setAttribute("data-overlayscrollbars-initialize", "");
    initializeScrollbars(target);
    return () => {
      target.removeAttribute("data-overlayscrollbars-initialize");
    };
  }, [initializeScrollbars]);

  useEffect(() => {
    let animationFrameId = 0;
    const startedAt = performance.now();

    setAnimationElapsedMs(0);
    setIsPreviewImageReady(false);

    const tick = (now: number) => {
      const nextElapsedMs = Math.min(totalAnimationMs, now - startedAt);
      setAnimationElapsedMs(nextElapsedMs);
      if (nextElapsedMs < totalAnimationMs) {
        animationFrameId = window.requestAnimationFrame(tick);
      }
    };

    animationFrameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [notificationPromptText, totalAnimationMs]);

  const visibleTitleCharacters = Math.max(
    0,
    Math.min(
      NOTIFICATIONS_PROMPT_TITLE.length,
      Math.floor(animationElapsedMs / ONBOARDING_TYPEWRITER_MS_PER_CHARACTER),
    ),
  );
  const visibleHighlightedTitle = NOTIFICATIONS_PROMPT_TITLE.slice(
    0,
    Math.min(visibleTitleCharacters, NOTIFICATIONS_PROMPT_TITLE_HIGHLIGHT_LENGTH),
  );
  const visibleRestTitle = visibleTitleCharacters > NOTIFICATIONS_PROMPT_TITLE_HIGHLIGHT_LENGTH
    ? NOTIFICATIONS_PROMPT_TITLE.slice(NOTIFICATIONS_PROMPT_TITLE_HIGHLIGHT_LENGTH, visibleTitleCharacters)
    : "";
  const previewRevealPercent = isPreviewImageReady
    ? getNotificationPreviewRevealPercent(animationElapsedMs - previewStartMs)
    : 0;
  const textAnimationElapsedMs = previewRevealPercent >= 100
    ? Math.max(0, animationElapsedMs - textStartMs)
    : 0;
  const visibleTextCharacters = Math.max(
    0,
    Math.min(
      notificationPromptText.length,
      Math.floor(textAnimationElapsedMs / ONBOARDING_TYPEWRITER_MS_PER_CHARACTER),
    ),
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/80 p-4 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl">
        <div className="border-b border-[#00FF00]/20 bg-black px-4 py-3">
          <Text className="relative min-w-0 text-base font-bold" style={{ color: "rgb(139, 191, 139)" }}>
            <span className="invisible select-none" aria-hidden="true">{NOTIFICATIONS_PROMPT_TITLE}</span>
            <span className="absolute inset-0 min-w-0 truncate">
              <span style={{ color: "#00FF00" }}>{visibleHighlightedTitle}</span>
              {visibleRestTitle}
            </span>
          </Text>
        </div>

        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="relative mx-auto aspect-[9/8] w-full max-w-[min(100%,360px)] overflow-hidden rounded-lg border border-[#00FF00]/25 bg-black">
            <ProgressiveNotificationImage
              highResolutionSrc={NOTIFICATIONS_PREVIEW_IMAGE_SRC}
              fallbackSrc={NOTIFICATIONS_PREVIEW_FALLBACK_IMAGE_SRC}
              revealPercent={previewRevealPercent}
              onReady={() => setIsPreviewImageReady(true)}
            />
          </div>

          <div className="mt-3">
            <div className="relative rounded-lg border border-[#00FF00]/15 bg-[#041204] px-3 py-2 text-sm leading-relaxed text-[#8bbf8b]">
              <div className="invisible select-none" aria-hidden="true">
                {notificationPromptText}
              </div>
              <div className="absolute inset-0 px-3 py-2">
                <TypewriterText visibleCharacters={visibleTextCharacters}>
                  {notificationPromptText}
                </TypewriterText>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-[#00FF00]/20 bg-black p-4">
          <button
            type="button"
            onClick={onConfirm}
            className="w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-4 py-3 text-sm font-bold text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000]"
          >
            Ok, let's go!
          </button>
        </div>
      </div>
    </div>
  );
}

function SharePreviewModal({
  preview,
  onClose,
  onCopySuccess,
  onImageCopySuccess,
  onImageCopyError,
  onImageDownloadSuccess,
  onShareFarcaster,
  onShareTwitter,
  onRetry,
}: {
  preview: SharePreviewState;
  onClose: () => void;
  onCopySuccess: () => void;
  onImageCopySuccess: (sourceMimeType: string) => void;
  onImageCopyError: (message: string) => void;
  onImageDownloadSuccess: () => void;
  onShareFarcaster: () => void;
  onShareTwitter: () => void;
  onRetry?: () => void;
}) {
  const [resolvedImages, setResolvedImages] = useState<SharePreviewImage[]>(() => getInitialSharePreviewImages(preview.images));
  const [copyingImageIndex, setCopyingImageIndex] = useState<number | null>(null);
  const [downloadingImageIndex, setDownloadingImageIndex] = useState<number | null>(null);
  const farcasterPostText = preview.farcasterText ?? preview.text;
  const twitterPostText = preview.twitterPostText ?? preview.text;
  const hasChannelTabs = farcasterPostText !== twitterPostText;
  const [activeShareChannel, setActiveShareChannel] = useState<"farcaster" | "twitter">("farcaster");
  const visiblePostBody = hasChannelTabs && activeShareChannel === "twitter" ? twitterPostText : farcasterPostText;
  const postText = buildSharePostText(visiblePostBody, preview.links);
  const [titleFirstWord, ...titleRestWords] = preview.title.split(" ");
  const titleRest = titleRestWords.join(" ");
  const [isClipboardTooltipOpen, setIsClipboardTooltipOpen] = useState(false);
  const [snapshotCountdown, setSnapshotCountdown] = useState<number | null>(15);
  const shareReady = preview.status == null || preview.status === "ready";
  const snapshotRenderingMessage = preview.statusMessage || "Rendering your Stats snapshot…";
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
    if (preview.status !== "preparing") {
      setSnapshotCountdown(null);
      return;
    }

    setSnapshotCountdown(15);
    let remainingSeconds = 15;
    const countdownTimer = window.setInterval(() => {
      remainingSeconds -= 1;
      if (remainingSeconds <= 0) {
        window.clearInterval(countdownTimer);
        setSnapshotCountdown(null);
        return;
      }
      setSnapshotCountdown(remainingSeconds);
    }, 1_000);

    return () => window.clearInterval(countdownTimer);
  }, [preview.status, preview.statusMessage]);

  useEffect(() => {
    setActiveShareChannel("farcaster");
    setCopyingImageIndex(null);
    setDownloadingImageIndex(null);
  }, [preview]);

  useEffect(() => {
    let cancelled = false;
    setResolvedImages(getInitialSharePreviewImages(preview.images));

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
                currentIndex === index && !currentImage.waitForResolvedSource
                  ? { ...currentImage, isLoading: false }
                  : currentImage,
              ),
            );
            return;
          }
          const imageUrl = "imageUrl" in payload ? payload.imageUrl : null;
          if (typeof imageUrl !== "string" || !imageUrl) {
            setResolvedImages((currentImages) =>
              currentImages.map((currentImage, currentIndex) =>
                currentIndex === index && !currentImage.waitForResolvedSource
                  ? { ...currentImage, isLoading: false }
                  : currentImage,
              ),
            );
            return;
          }

          setResolvedImages((currentImages) =>
            currentImages.map((currentImage, currentIndex) =>
              currentIndex === index
                ? {
                    ...currentImage,
                    fallbackSrc: currentImage.waitForResolvedSource
                      ? undefined
                      : currentImage.fallbackSrc ?? currentImage.src,
                    src: imageUrl,
                    isLoading: true,
                    sourceResolved: true,
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
              currentIndex === index && !currentImage.waitForResolvedSource
                ? { ...currentImage, isLoading: false }
                : currentImage,
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

        <OverlayScrollbarsComponent
          className="max-h-[calc(92vh-156px)] overflow-auto px-4 py-4"
          defer
          options={{ scrollbars: { theme: "os-theme-10x", autoHide: "scroll", clickScroll: true } }}
        >
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
          <div className={`rounded-xl border border-[#00FF00]/25 bg-[#041204]/80 p-3 ${hasChannelTabs ? "rounded-tl-none" : ""}`}>
            <div className="mb-2 flex h-6 items-center justify-between gap-2">
              <Text className="text-xs font-bold uppercase leading-6" style={{ color: "#00FF00" }}>
                Post
              </Text>
              <button
                ref={clipboardTooltipRefs.setReference}
                type="button"
                aria-label="Copy to Clipboard"
                disabled={!shareReady}
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
                    "flex h-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[oklab(0.866435_-0.23384_0.179502_/_0.35)] bg-black px-2.5 text-[11px] font-black text-[#00FF00] shadow-[2px_3px_0_oklab(0.866435_-0.23384_0.179502_/_0.35)] transition-all duration-100 hover:bg-[#041204] active:translate-x-[1px] active:translate-y-[2px] active:shadow-[1px_1px_0_oklab(0.866435_-0.23384_0.179502_/_0.35)] disabled:cursor-not-allowed disabled:opacity-40",
                })}
              >
                Copy
              </button>
            </div>
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
            <pre className="min-h-9 select-text whitespace-pre-wrap break-words font-sans text-sm font-bold leading-snug text-[#8bbf8b]">
              {postText}
            </pre>
          </div>
          </div>

          {!shareReady && (
            <div className={`mt-3 rounded-xl border p-4 text-center ${preview.status === "error" ? "border-red-400/35 bg-red-950/20" : "border-[#00FF00]/25 bg-[#041204]/80"}`}>
              {preview.status === "preparing" ? (
                <>
                  <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-2 border-[#00FF00]/25 border-t-[#00FF00]" aria-label="Preparing Stats share image" />
                  <Text className="mt-3 text-xs font-bold text-[#8bbf8b]">
                    {snapshotRenderingMessage}{snapshotCountdown == null ? "" : ` ${snapshotCountdown}`}
                  </Text>
                </>
              ) : (
                <>
                  <Text className="text-xs font-bold text-red-300">{preview.statusMessage || "The Stats snapshot could not be rendered."}</Text>
                  {onRetry && <button type="button" onClick={onRetry} className="mt-3 cursor-pointer rounded-full border border-[#00FF00]/45 px-5 py-2 text-xs font-black text-[#00FF00] hover:bg-[#00FF00]/10">Retry</button>}
                </>
              )}
            </div>
          )}

          {shareReady && <div className="mt-3 rounded-xl border border-[#00FF00]/25 bg-[#041204]/80 p-3">
            <Text className="mb-2 text-xs font-bold uppercase" style={{ color: "#00FF00" }}>
              {resolvedImages.length === 1 ? "Image" : "Images"}
            </Text>
            <div className="grid grid-cols-2 gap-2">
              {resolvedImages.map((image, index) => (
                <div key={`${image.src}-${index}`} className={image.aspectRatio === "landscape" ? "col-span-2" : ""}>
                  <div className={`relative overflow-hidden rounded-lg border border-[#00FF00]/25 bg-[rgba(0,255,0,0.12)] ${image.aspectRatio === "landscape" ? "aspect-[3/2]" : "aspect-square"}`}>
                    {image.isLoading && (
                      <div className="absolute inset-0 z-[2] flex h-full w-full items-center justify-center">
                        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#00FF00]/25 border-t-[#00FF00]" aria-label="Loading share preview image" />
                      </div>
                    )}
                    {(!image.waitForResolvedSource || image.sourceResolved) && (
                      <img
                        src={image.src}
                        alt={image.alt}
                        className={`relative z-[1] block h-full w-full transition-opacity duration-300 ${image.isLoading ? "opacity-0" : "opacity-100"} ${image.sourceUrl ? "object-contain" : "object-cover"}`}
                        loading="lazy"
                        onLoad={() => {
                          if (!image.isLoading) return;
                          setResolvedImages((currentImages) =>
                            currentImages.map((currentImage, currentIndex) =>
                              currentIndex === index ? { ...currentImage, isLoading: false } : currentImage,
                            ),
                          );
                        }}
                        onError={(event) => {
                          if (!image.fallbackSrc || event.currentTarget.src === image.fallbackSrc) {
                            if (image.waitForResolvedSource) return;
                            setResolvedImages((currentImages) =>
                              currentImages.map((currentImage, currentIndex) =>
                                currentIndex === index ? { ...currentImage, isLoading: false } : currentImage,
                              ),
                            );
                            return;
                          }
                          event.currentTarget.src = image.fallbackSrc;
                          setResolvedImages((currentImages) =>
                            currentImages.map((currentImage, currentIndex) =>
                              currentIndex === index
                                ? { ...currentImage, src: image.fallbackSrc ?? currentImage.src, isLoading: true }
                                : currentImage,
                            ),
                          );
                        }}
                      />
                    )}
                  </div>
                  <div className="mb-1 mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      aria-label={`Copy ${image.alt} to Clipboard`}
                      title="Copy to Clipboard"
                      disabled={image.isLoading || copyingImageIndex !== null || downloadingImageIndex !== null}
                      onClick={() => {
                        void hapticPrimaryTap();
                        setCopyingImageIndex(index);
                        copyImageToClipboard(image.src)
                          .then((sourceMimeType) => {
                            void hapticSuccess();
                            onImageCopySuccess(sourceMimeType);
                          })
                          .catch((error) => {
                            console.error("Failed to copy share image:", error);
                            void hapticError();
                            const message = error instanceof Error ? error.message : "The image could not be copied.";
                            const clipboardDenied = /not allowed|denied permission|notallowederror/i.test(`${message} ${error instanceof DOMException ? error.name : ""}`);
                            if (clipboardDenied && /iPad|iPhone|iPod/i.test(navigator.userAgent)) {
                              void openShareImageExternally(image.src)
                                .then(() => {
                                  void hapticSuccess();
                                  onImageDownloadSuccess();
                                })
                                .catch(() => onImageCopyError("Farcaster on iOS does not permit direct image clipboard access. Use Download to open the PNG, then press and hold it to copy or save it."));
                              return;
                            }
                            onImageCopyError(message);
                          })
                          .finally(() => setCopyingImageIndex(null));
                      }}
                      className="flex h-6 w-full cursor-pointer items-center justify-center rounded-md border border-[oklab(0.866435_-0.23384_0.179502_/_0.35)] bg-black px-2.5 text-[11px] font-black text-[#00FF00] shadow-[2px_3px_0_oklab(0.866435_-0.23384_0.179502_/_0.35)] transition-all duration-100 hover:bg-[#041204] active:translate-x-[1px] active:translate-y-[2px] active:shadow-[1px_1px_0_oklab(0.866435_-0.23384_0.179502_/_0.35)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {copyingImageIndex === index ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#00FF00]/25 border-t-[#00FF00]" aria-hidden="true" /> : "Copy"}
                    </button>
                    <button
                      type="button"
                      aria-label={`Download ${image.alt}`}
                      title="Open image to download"
                      disabled={image.isLoading || copyingImageIndex !== null || downloadingImageIndex !== null}
                      onClick={() => {
                        void hapticPrimaryTap();
                        setDownloadingImageIndex(index);
                        openShareImageExternally(image.src)
                          .then(() => {
                            void hapticSuccess();
                            onImageDownloadSuccess();
                          })
                          .catch((error) => {
                            console.error("Failed to open share image:", error);
                            void hapticError();
                            onImageCopyError(error instanceof Error ? error.message : "The image could not be opened.");
                          })
                          .finally(() => setDownloadingImageIndex(null));
                      }}
                      className="flex h-6 w-full cursor-pointer items-center justify-center rounded-md border border-[oklab(0.866435_-0.23384_0.179502_/_0.35)] bg-black px-2.5 text-[11px] font-black text-[#00FF00] shadow-[2px_3px_0_oklab(0.866435_-0.23384_0.179502_/_0.35)] transition-all duration-100 hover:bg-[#041204] active:translate-x-[1px] active:translate-y-[2px] active:shadow-[1px_1px_0_oklab(0.866435_-0.23384_0.179502_/_0.35)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {downloadingImageIndex === index ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#00FF00]/25 border-t-[#00FF00]" aria-hidden="true" /> : "Download"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>}
        </OverlayScrollbarsComponent>

        <div className="sticky bottom-0 z-10 border-t border-[#00FF00]/20 bg-black px-4 py-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!shareReady}
              onClick={() => {
                void hapticPrimaryTap();
                onShareFarcaster();
              }}
              className="w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-3 py-3 text-center text-sm font-bold text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Share on Farcaster
            </button>
            <button
              type="button"
              disabled={!shareReady}
              onClick={() => {
                void hapticPrimaryTap();
                onShareTwitter();
              }}
              className="secondary-trade-cta w-full cursor-pointer rounded-[20px] border bg-black px-3 py-3 text-center text-sm font-bold text-[#00FF00] transition-all duration-100 hover:bg-[#041204] active:translate-x-[1px] active:translate-y-[3px] disabled:cursor-not-allowed disabled:opacity-40"
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

let ethUsdPriceCache: { value: number; expiresAt: number } | null = null;
let ethUsdPriceRequest: Promise<number> | null = null;

async function fetchEthUsdPrice(): Promise<number> {
  if (ethUsdPriceCache && ethUsdPriceCache.expiresAt > Date.now()) return ethUsdPriceCache.value;
  if (ethUsdPriceRequest) return ethUsdPriceRequest;
  ethUsdPriceRequest = fetch("/api/eth-usd", { headers: { accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`ETH/USD price failed (${response.status})`);
      const payload = await response.json() as { ethUsd?: unknown };
      const amount = typeof payload.ethUsd === "number" ? payload.ethUsd : Number(payload.ethUsd);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("ETH/USD price response was invalid");
      ethUsdPriceCache = { value: amount, expiresAt: Date.now() + 5 * 60 * 1000 };
      return amount;
    })
    .finally(() => {
      ethUsdPriceRequest = null;
    });
  return ethUsdPriceRequest;
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

async function fetchItemSaleProfitText(
  tokenId: number,
  sellerWallet: string | null | undefined,
  saleAmountEth: number | null,
): Promise<string> {
  const seller = normalizeWalletAddress(sellerWallet);
  if (!seller || saleAmountEth == null || !Number.isFinite(saleAmountEth) || saleAmountEth <= 0) return "";
  let cursor: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({ range: "all", tokenId: String(tokenId), events: "sale,send", limit: "20" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/stats/activity?${params.toString()}`, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return "";
    const payload = await response.json() as {
      rows?: Array<{ event?: string; priceEth?: number | null; to?: { wallet?: string | null } | null }>;
      nextCursor?: string | null;
    };
    for (const row of payload.rows ?? []) {
      if (normalizeWalletAddress(row.to?.wallet) !== seller) continue;
      if (row.event !== "sale" || row.priceEth == null || !Number.isFinite(row.priceEth) || row.priceEth <= 0) return "";
      return formatItemSaleProfitText(saleAmountEth, row.priceEth);
    }
    cursor = payload.nextCursor ?? null;
    if (!cursor) break;
  }
  return "";
}

function formatItemSaleProfitText(saleAmountEth: number | null, purchaseAmountEth: number | null): string {
  if (saleAmountEth == null || purchaseAmountEth == null || !Number.isFinite(saleAmountEth) || !Number.isFinite(purchaseAmountEth) || purchaseAmountEth <= 0) return "";
  const profit = saleAmountEth - purchaseAmountEth;
  if (profit <= 0) return "";
  const profitAmount = truncateDecimalDigits(decimalStringFromNumber(profit) ?? "0", 8);
  const profitPercent = Math.round((profit / purchaseAmountEth) * 100);
  return `\n\n${profitAmount} ETH profit +${profitPercent.toLocaleString("en-US")}% 🎉`;
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
  sellerWallet,
  purchaseAmountEth,
}: {
  action: TradeShareAction;
  details: WarpletDetails;
  amountEth: number | null;
  ethUsdPrice: number | null;
  counterparty?: TradeShareCounterparty | null;
  sellerWallet?: string | null;
  purchaseAmountEth?: number | null;
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
    const profitText = purchaseAmountEth == null
      ? await fetchItemSaleProfitText(tokenId, sellerWallet, amountEth)
      : formatItemSaleProfitText(amountEth, purchaseAmountEth);
    farcasterText = `Sold for ${amountText}${withCounterparty("to", farcasterCounterparty)} the 10X Warplet #${tokenId}${farcasterWarpletUsername}.${profitText}`;
    twitterPostText = `Sold for ${amountText}${withCounterparty("to", twitterCounterparty)} the 10X Warplet #${tokenId}${twitterWarpletUsername}.${profitText}`;
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

function buildOfferSharePreview({
  kind,
  amountEth,
  ethUsdPrice,
  quantity,
  tokenId,
  traitText,
}: {
  kind: "collection" | "trait";
  amountEth: number | null;
  ethUsdPrice: number | null;
  quantity: number;
  tokenId: number;
  traitText?: string;
}): SharePreviewState {
  const amountText = formatTradeShareAmount(amountEth, ethUsdPrice);
  const quantityText = quantity > 1 ? ` (${quantity.toLocaleString("en-US")} offers)` : "";
  const isCollection = kind === "collection";
  const postText = isCollection
    ? `Offering ${amountText} for any 10X Warplet in the collection${quantityText}.`
    : `Offering ${amountText} for any 10X Warplet with ${traitText ?? "the selected traits"}${quantityText}.`;
  const miniAppLink = new URL(getSearchPathForRoute({ page: "offers", offersPage: isCollection ? "collection" : "trait" }), window.location.origin).toString();
  const openSeaLink = isCollection ? OPENSEA_COLLECTION_URL : getOpenSeaUrl(tokenId);
  const links = [miniAppLink, openSeaLink];
  return {
    title: isCollection ? "Share Collection Offer" : "Share Trait Offer",
    text: postText,
    farcasterText: postText,
    twitterPostText: postText,
    links,
    images: [
      { src: getWarpletAssetUrl(tokenId, "gif"), alt: isCollection ? "10X Warplets collection offer" : `10X Warplet #${tokenId} trait offer` },
      { src: getWarpletAssetUrl(tokenId, "gif"), alt: "OpenSea offer", sourceUrl: openSeaLink },
    ],
    farcasterEmbeds: [miniAppLink, openSeaLink],
    twitterText: buildTwitterShareText(postText, links),
  };
}

function buildPerksSharePreview(subpage: PerksSubpage): SharePreviewState {
  const content = PERKS_SHARE_CONTENT[subpage];
  const definition = PERKS_DEFINITIONS[subpage];
  const pageUrl = new URL(getSearchPathForRoute({ page: "perks", perksPage: subpage }), window.location.origin).toString();
  const checklist = definition.explanation.map((item) => `✅ ${item.title}`).join("\n");
  const postText = `👀 10X ${content.label}\n\n${content.eyebrow}\n${content.summary}\n\n${checklist}\n\n${content.callout}\n\n${pageUrl}`;
  const images: SharePreviewImage[] = [{ src: getPerksShareImageUrl(content), alt: `${content.label} Perk share image` }];
  if (content.secondImageUrl) {
    images.push({ src: new URL(content.secondImageUrl, window.location.origin).toString(), alt: `${content.label} Perk supporting image` });
  }
  return {
    title: content.modalTitle,
    text: postText,
    farcasterText: postText,
    twitterPostText: postText,
    links: [],
    images,
    farcasterEmbeds: [pageUrl],
    twitterText: postText,
  };
}

const SHARE_MODAL_TEST_CASES = [
  { id: "warplet", label: "Warplet", description: "Details modal → Share." },
  { id: "search", label: "Search results", description: "Search results summary → Share." },
  { id: "airdrop", label: "Airdrop", description: "Successful Warplet airdrop congratulations." },
  { id: "item-offer", label: "Item offer", description: "Details or Offers → Item → successful offer." },
  { id: "item-listing", label: "Item listing", description: "Details or Listed → successful listing." },
  { id: "item-purchase", label: "Item purchase", description: "Details → successful Buy now." },
  { id: "item-sale", label: "Profitable item sale", description: "Details or Offers → Item → accepted offer after buying the item for less." },
  { id: "bulk-buy", label: "Bulk buy", description: "Listed → Sweep → successful purchase." },
  { id: "collection-offer", label: "Collection offer", description: "Offers → Collection → successful offer." },
  { id: "trait-offer", label: "Trait offer", description: "Offers → Trait → successful offer." },
  { id: "perk-memes", label: "Memes Perk", description: "Perks → Memes → bottom Share CTA." },
  { id: "perk-rwas", label: "RWAs Perk", description: "Perks → RWAs → bottom Share CTA." },
  { id: "perk-nfts", label: "NFTs Perk", description: "Perks → NFTs → bottom Share CTA." },
  { id: "perk-ai", label: "AI Perk", description: "Perks → AI → bottom Share CTA." },
  { id: "perk-attention", label: "Attention Perk", description: "Perks → Attention → bottom Share CTA." },
  { id: "perk-alpha", label: "Alpha Perk", description: "Perks → Alpha → bottom Share CTA." },
  { id: "stats-overview-collection", label: "Stats NFT Collection", description: "Stats → Overview → Share NFT Collection." },
  { id: "stats-overview-fair-launch", label: "Stats Fair Launch", description: "Stats → Overview → Share Fair Launch." },
  { id: "stats-market-price", label: "Stats Price", description: "Stats → Market → Price chart Share." },
  { id: "stats-market-floor", label: "Stats Floor Price", description: "Stats → Market → Floor Price chart Share." },
  { id: "stats-market-volume", label: "Stats Volume", description: "Stats → Market → Volume chart Share." },
  { id: "stats-market-listings", label: "Stats Listings", description: "Stats → Market → Listings chart Share." },
  { id: "stats-market-offers", label: "Stats Offers", description: "Stats → Market → Offers chart Share." },
  { id: "stats-market-sales", label: "Stats Sales", description: "Stats → Market → Sales chart Share." },
  { id: "stats-market-all", label: "All Market Stats", description: "Stats → Market → bottom Share All Market Stats CTA." },
  { id: "stats-activity-sale", label: "Stats Sales Activity", description: "Stats → Activity → selected Sales chart Share." },
  { id: "stats-activity-listing", label: "Stats Listings Activity", description: "Stats → Activity → selected Listings chart Share." },
  { id: "stats-activity-offer", label: "Stats Offers Activity", description: "Stats → Activity → selected Offers chart Share." },
  { id: "stats-activity-send", label: "Stats Sends Activity", description: "Stats → Activity → selected Sends chart Share." },
  { id: "stats-item-activity-sale", label: "Item Sales Activity", description: "Details → Item Activity → selected Sales chart Share." },
  { id: "stats-item-activity-listing", label: "Item Listings Activity", description: "Details → Item Activity → selected Listings chart Share." },
  { id: "stats-item-activity-offer", label: "Item Offers Activity", description: "Details → Item Activity → selected Offers chart Share." },
  { id: "stats-item-activity-send", label: "Item Sends Activity", description: "Details → Item Activity → selected Sends chart Share." },
  { id: "stats-holder-rank", label: "Stats Your Rank", description: "Stats → Holders → Share Your Rank." },
  { id: "stats-holders-top10", label: "Stats Top 10", description: "Stats → Holders → Share Top 10." },
  { id: "stats-friends-top10", label: "Stats Top 10 Friends", description: "Stats → Holders → Friends ON → Share Top 10 Friends." },
  { id: "stats-friends-short", label: "Stats Fewer Than 10 Friends", description: "Friend leaderboard fixture with six muted empty cards." },
  { id: "stats-x-handle", label: "Stats Verified X Handles", description: "X leaderboard copy uses verified X usernames." },
  { id: "stats-name-fallback", label: "Stats Display-name Fallback", description: "Leaderboard copy when the channel username is unavailable." },
  { id: "stats-wallet-fallback", label: "Stats Wallet Fallback", description: "Leaderboard copy when all profile identity is unavailable." },
] as const;
type ShareModalTestId = (typeof SHARE_MODAL_TEST_CASES)[number]["id"];

function AppTestingPage({ onTriggerShare }: { onTriggerShare: (id: ShareModalTestId) => void }) {
  const visualFixtures = ["overview-collection", "overview-fair-launch", "market-price", "market-floor", "market-volume", "market-listings", "market-offers", "market-sales", "market-all", "activity-sale", "activity-listing", "activity-offer", "activity-send", "item-activity-sale", "item-activity-listing", "item-activity-offer", "item-activity-send", "rank", "top10", "friends", "friends-short"];
  return (
    <div className="mx-auto w-full max-w-md px-4 pb-10 pt-6">
      <h1 className="text-xl font-black text-[#00FF00]">Share modals</h1>
      <div className="mt-4 space-y-2 rounded-xl border border-[#00FF00]/30 bg-black/60 p-3">
        {SHARE_MODAL_TEST_CASES.map((testCase) => (
          <div key={testCase.id} className="rounded-lg border border-[#00FF00]/20 bg-[#041204] p-3">
            <button type="button" onClick={() => onTriggerShare(testCase.id)} className="w-full cursor-pointer rounded-lg border border-[#00FF00] bg-[#00FF00]/15 px-3 py-2 text-sm font-black text-[#00FF00] hover:bg-[#00FF00]/25">
              Test {testCase.label}
            </button>
            <p className="mt-2 text-xs leading-5 text-[#8bbf8b]">{testCase.description}</p>
          </div>
        ))}
      </div>
      <h2 className="mt-7 text-lg font-black text-[#00FF00]">1000×1000 visual fixtures</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-[#00FF00]/30 bg-black/60 p-3">
        {visualFixtures.map((fixture) => (
          <a key={fixture} href={`/stats/share/fixtures/${fixture}`} target="_blank" rel="noreferrer" className="rounded-lg border border-[#00FF00]/35 bg-[#041204] px-3 py-2 text-center text-xs font-black capitalize text-[#00FF00] hover:border-[#00FF00]">
            {fixture.replaceAll("-", " ")}
          </a>
        ))}
      </div>
    </div>
  );
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
  viewerWallet,
  viewerUsername,
  actionSessionToken,
  onMergeMarketSnapshot,
  onClearMarketSide,
  onUpsertListing,
  onUpsertItemOffer,
  onApplyPurchase,
  onOpenTradeSharePreview,
  stackIndex,
  isInMiniAppContext,
  onShareStats,
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
  viewerWallet: string | null;
  viewerUsername: string | null;
  actionSessionToken: string | null;
  onMergeMarketSnapshot: (tokenId: number, snapshot: MarketSnapshot) => void;
  onClearMarketSide: (tokenId: number, side: "listing" | "offer" | "collectionOffer") => void;
  onUpsertListing: (tokenId: number, listing: MarketSnapshot["listings"][string]) => void;
  onUpsertItemOffer: (tokenId: number, offer: MarketSnapshot["offers"][string]) => void;
  onApplyPurchase: (tokenId: number, update: OptimisticPurchaseUpdate) => void;
  onOpenTradeSharePreview: (preview: SharePreviewState) => void;
  stackIndex: number;
  isInMiniAppContext: boolean;
  onShareStats: (request: StatsShareRequest) => void;
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
  const detailsWalletController = useWalletController();
  const activeWallet = detailsWalletController.session?.address ?? null;
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
  const effectiveTraitOffer = tradeState ? tradeState.traitOffer : market.traitOffer ?? null;
  const effectiveCollectionOffer = tradeState ? tradeState.collectionOffer : market.collectionOffer ?? null;
  const effectiveTopOffer = tradeState ? tradeState.topOffer : chooseTopOffer(effectiveItemOffer ?? undefined, effectiveTraitOffer ?? undefined, effectiveCollectionOffer ?? null);
  const effectiveSale = optimisticSale ?? (tradeState ? tradeState.sale ?? null : market.sale ?? null);
  const effectiveOwner = resolveEffectiveWarpletOwner(tradeState?.owner, market.owner);
  const effectiveFloor = tradeState?.floor ?? null;
  const normalizedActiveWallet = activeWallet?.toLowerCase() ?? "";
  const ownerWallet = effectiveOwner?.wallet?.toLowerCase() ?? "";
  const listingSellerWallet = rawEffectiveListing?.seller?.toLowerCase() ?? "";
  const listingBelongsToOwner = Boolean(!ownerWallet || !listingSellerWallet || listingSellerWallet === ownerWallet);
  const effectiveListing = listingBelongsToOwner ? rawEffectiveListing : null;
  const isOwner = Boolean(normalizedActiveWallet && ownerWallet && normalizedActiveWallet === ownerWallet);
  const hasListing = hasMarketValue(effectiveListing ?? undefined);
  const topOffererWallet = effectiveTopOffer?.offerer?.toLowerCase() ?? "";
  const topOfferIsOwnerCriteriaOffer = Boolean(
    isOwner &&
    (effectiveTopOffer?.source === "collection" || effectiveTopOffer?.source === "trait") &&
    ownerWallet &&
    topOffererWallet === ownerWallet,
  );
  const hasTopOffer = hasMarketValue(effectiveTopOffer ?? undefined);
  const hasSellableTopOffer = hasTopOffer && !topOfferIsOwnerCriteriaOffer;
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
  const floorAmount = marketMoneyToDecimal(effectiveFloor);
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
    decimalEthToWeiString(listingPrice)
  );
  const showTopOfferListingShortcut = Boolean(
    knownTopOfferPrice &&
    topOfferAmount != null &&
    floorAmount != null &&
    topOfferAmount > floorAmount
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
    sellerWallet,
    purchaseAmountEth,
    counterparty,
  }: {
    action: TradeShareAction;
    amountEth: number | null;
    sellerWallet?: string | null;
    purchaseAmountEth?: number | null;
    counterparty?: TradeShareCounterparty | null;
  }) => {
    const usdPrice = await getTradeShareUsdPrice();
    const preview = await buildTradeSharePreview({
      action,
      details,
      amountEth,
      ethUsdPrice: usdPrice,
      counterparty,
      sellerWallet: action === "sale" ? sellerWallet ?? normalizedActiveWallet : null,
      purchaseAmountEth,
    });
    onOpenTradeSharePreview(preview);
  }, [details, getTradeShareUsdPrice, normalizedActiveWallet, onOpenTradeSharePreview]);
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
    return fetch("/api/warplet-trade/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionId: actionIdRef.current,
        fid: viewerFid,
        tokenId: details.id,
        walletFrom: activeWallet,
        ...payload,
      }),
    }).catch(() => null);
  }, [activeWallet, details.id, viewerFid]);

  const getProviderAndAccount = useCallback(async (
    _preferredAccount?: string | null,
    options: { skipChainSwitch?: boolean } = {},
  ): Promise<{ provider: EthereumProvider; account: string }> => {
    if (!detailsWalletController.session) {
      if (isInMiniAppContext) await connectFarcasterWallet();
      else {
        requestWebWalletConnection();
        throw new Error("Connect a wallet to continue");
      }
    }
    const { provider, account } = await getConnectedProviderAndAccount();
    await ensureBaseChain(provider, undefined, { allowSkipSwitch: options.skipChainSwitch });
    return { provider, account };
  }, [detailsWalletController.session, isInMiniAppContext]);

  const refreshTradeState = useCallback(async (
    walletOverride?: string | null,
    options: {
      excludeCollectionOrderHash?: string | null;
      optimisticListing?: FreshTradeState["listing"];
    } = {},
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
      ? chooseTopOffer(optimisticOffer, next.traitOffer ?? undefined, next.collectionOffer) as FreshTradeState["topOffer"]
      : null;
    let merged: FreshTradeState = shouldPreserveOptimisticOffer && optimisticOffer
      ? {
          ...next,
          itemOffer: optimisticOffer,
          ownItemOffer: optimisticOffer,
          topOffer: preservedTopOffer,
        }
      : next;
    const shouldPreserveOptimisticListing = Boolean(
      options.optimisticListing &&
      next.listing?.rawAmount !== options.optimisticListing.rawAmount
    );
    if (shouldPreserveOptimisticListing && options.optimisticListing) {
      merged = { ...merged, listing: options.optimisticListing };
    }
    if (!shouldPreserveOptimisticOffer && next.ownItemOffer?.orderHash === optimisticOffer?.orderHash) {
      optimisticOwnItemOfferRef.current = null;
    }
    setTradeState(merged);
    setOptimisticSale(merged.sale ?? null);
    if (next.snapshot) {
      const snapshot = shouldPreserveOptimisticListing && options.optimisticListing
        ? {
            ...next.snapshot,
            listings: {
              ...next.snapshot.listings,
              [String(details.id)]: options.optimisticListing,
            },
          }
        : next.snapshot;
      onMergeMarketSnapshot(details.id, snapshot);
    }
    if (shouldPreserveOptimisticOffer && optimisticOffer) onUpsertItemOffer(details.id, optimisticOffer);
    setOfferPrice((current) => current || defaultOfferPrice(merged.topOffer));
    setListingPrice((current) => current || defaultListingPrice(merged.floor));
    return merged;
  }, [activeWallet, details.id, onMergeMarketSnapshot, onUpsertItemOffer]);

  useEffect(() => {
    let cancelled = false;
    const loadPassiveWallet = async () => {
      try {
        const account = detailsWalletController.session?.address ?? null;
        if (account && !cancelled) {
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
  }, [details.id, detailsWalletController.session?.address, refreshTradeState]);

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
    viewFarcasterProfile(farcasterFid).catch((error) => {
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
      traitOffer: FreshTradeState["traitOffer"],
      collectionOffer: FreshTradeState["collectionOffer"],
    ): NonNullable<FreshTradeState["topOffer"]> => {
      return chooseTopOffer(offer, traitOffer ?? undefined, collectionOffer) as NonNullable<FreshTradeState["topOffer"]>;
    };
    setTradeState((current) => {
      if (!current) {
        return {
          tokenId: details.id,
          generatedAt: now,
          listing: effectiveListing ?? null,
          itemOffer: offer,
          traitOffer: effectiveTraitOffer ?? null,
          collectionOffer: effectiveCollectionOffer ?? null,
          topOffer: chooseFreshTopOffer(effectiveTraitOffer ?? null, effectiveCollectionOffer ?? null),
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
        topOffer: chooseFreshTopOffer(current.traitOffer ?? null, current.collectionOffer ?? null),
        generatedAt: now,
      };
    });
    onUpsertItemOffer(details.id, offer);
  }, [details.id, effectiveCollectionOffer, effectiveFloor, effectiveItemOffer, effectiveListing, effectiveOwner, effectiveTraitOffer, onUpsertItemOffer]);

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
      const confirmationLog = await postTradeLog({
        actionName: "buy",
        status: "confirmed",
        phase: "confirmed",
        transactionHash: hash,
        walletFrom: account,
      });
      if (!confirmationLog?.ok) {
        console.warn("Purchase confirmed, but its immediate ownership sync did not complete.");
      }
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
        const traitOffer = current?.traitOffer ?? effectiveTraitOffer ?? null;
        const collectionOffer = current?.collectionOffer ?? effectiveCollectionOffer ?? null;
        const topOffer = current?.topOffer ?? (chooseTopOffer(itemOffer ?? undefined, traitOffer ?? undefined, collectionOffer) as FreshTradeState["topOffer"]) ?? null;
        return {
          tokenId: details.id,
          generatedAt: now,
          listing: null,
          itemOffer,
          traitOffer,
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
        const traitOffer = acceptedOffer?.source === "trait"
          ? refreshed?.traitOffer ?? null
          : current?.traitOffer ?? effectiveTraitOffer ?? null;
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
          traitOffer,
          collectionOffer,
          topOffer: chooseTopOffer(itemOffer ? { ...itemOffer, source: "item" as const } : undefined, traitOffer ?? undefined, collectionOffer) as FreshTradeState["topOffer"],
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
              ? { ...current, collectionOffer: null, topOffer: chooseTopOffer(current.itemOffer ?? undefined, current.traitOffer ?? undefined, null) as FreshTradeState["topOffer"] }
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
      if (!getExternalWalletReviewName(provider)) {
        showToast("neutral", "Check your wallet to confirm the listing...", { minMs: 5000 });
      }
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
      const submitted = await submit.json().catch(() => ({})) as {
        message?: string;
        result?: { order_hash?: unknown; orderHash?: unknown; protocol_address?: unknown };
      };
      if (!submit.ok) throw new Error(submitted.message || `Listing submit failed (${submit.status})`);
      const signedPayload = signed.payload && typeof signed.payload === "object"
        ? signed.payload as Record<string, unknown>
        : null;
      const submittedOrderHash = typeof submitted.result?.order_hash === "string"
        ? submitted.result.order_hash
        : typeof submitted.result?.orderHash === "string" ? submitted.result.orderHash : null;
      const submittedProtocolAddress = typeof submitted.result?.protocol_address === "string"
        ? submitted.result.protocol_address
        : typeof signedPayload?.protocol_address === "string" ? signedPayload.protocol_address : null;
      const optimisticListing: NonNullable<FreshTradeState["listing"]> = {
        eth: listingAmount ?? parseTradeAmount(listingPrice),
        at: new Date().toISOString(),
        rawAmount: priceRaw,
        decimals: 18,
        currencySymbol: "ETH",
        tokenAddress: NATIVE_TOKEN_ADDRESS,
        orderHash: submittedOrderHash,
        protocolAddress: submittedProtocolAddress,
        seller: account,
      };
      setTradeState((current) => current ? { ...current, listing: optimisticListing } : current);
      onUpsertListing(details.id, optimisticListing);
      for (const delayMs of [1500, 4000, 8000]) {
        window.setTimeout(() => {
          if (actionIdRef.current !== actionId) return;
          void refreshTradeState(account, { optimisticListing }).catch((error) => {
            console.warn("Failed to reconcile newly submitted listing:", error);
          });
        }, delayMs);
      }
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
  }, [assertConnectedOwnerWallet, details.id, getProviderAndAccount, handleTradeError, listingAmount, listingPrice, onUpsertListing, openTradeSharePreview, postTradeLog, refreshTradeState, showFirefoxWarningIfNeeded, showToast, viewerFid]);

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
          if (!getExternalWalletReviewName(provider)) {
            showToast("neutral", `Wrap ${formatWeiTokenAmount(missingWeth, "ETH")} to WETH to make this offer...`, { minMs: 5000 });
          }
          const wrapHash = await wrapEthToWeth(provider, account, payload.wethApproval.tokenAddress, missingWeth);
          postTradeLog({ actionName: "make_offer", status: "submitted", phase: "transaction_submitted", transactionHash: wrapHash, expectedPriceRaw: priceRaw });
          showToast("neutral", "ETH wrapped to WETH. Continuing offer...", { minMs: 5000 });
        }
        postTradeLog({ actionName: "make_offer", status: "requested", phase: "approval_requested", expectedPriceRaw: priceRaw });
        await ensureErc20Approval(provider, account, payload.wethApproval);
        postTradeLog({ actionName: "make_offer", status: "approved", phase: "approval_success", expectedPriceRaw: priceRaw });
      }
      postTradeLog({ actionName: "make_offer", status: "requested", phase: "signature_requested", expectedPriceRaw: priceRaw });
      if (!getExternalWalletReviewName(provider)) {
        showToast("neutral", "Check your wallet to confirm the offer...", { minMs: 5000 });
      }
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
        orderHash?: string | null;
        result?: {
          order_hash?: string;
          orderHash?: string;
        };
      };
      applyOptimisticItemOffer(account, priceRaw, payload.protocolAddress, submitPayload.orderHash ?? submitPayload.result?.order_hash ?? submitPayload.result?.orderHash ?? null);
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
      if (!getExternalWalletReviewName(provider)) {
        showToast("neutral", "Check your wallet to confirm cancellation...", { minMs: 5000 });
      }
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
        setTradeState((current) => current ? { ...current, itemOffer: null, ownItemOffer: null, topOffer: chooseTopOffer(undefined, current.traitOffer ?? undefined, current.collectionOffer ?? null) as FreshTradeState["topOffer"] } : current);
        onClearMarketSide(details.id, "offer");
      }
      await refreshTradeState(account);
      if (action === "cancel_listing") {
        setTradeState((current) => current ? { ...current, listing: null } : current);
        onClearMarketSide(details.id, "listing");
      } else {
        optimisticOwnItemOfferRef.current = null;
        setTradeState((current) => current ? { ...current, itemOffer: null, ownItemOffer: null, topOffer: chooseTopOffer(undefined, current.traitOffer ?? undefined, current.collectionOffer ?? null) as FreshTradeState["topOffer"] } : current);
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

  const scrollActivityEventsIntoView = useCallback((target: HTMLElement) => {
    const container = getModalScrollbars()?.elements().viewport ?? modalScrollRef.current;
    if (!container) return;
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
        { kind: "offer" as const, label: "Top Offer", money: effectiveTopOffer, emptyValue: "No offers", tooltipPrefix: getOfferSourceLabel(effectiveTopOffer) },
        { kind: "sold" as const, label: "Latest Sale", money: effectiveSale, emptyValue: "No sales" },
      ].map(({ kind, label, money, emptyValue, tooltipPrefix }) => {
        const styles = getMarketKindStyles(kind);
        return (
          <MarketValuePanel
            key={label}
            kind={kind}
            label={label}
            money={money}
            emptyValue={emptyValue}
            tooltipPrefix={tooltipPrefix}
            className="min-w-0 px-2 pb-2.5 pt-2"
            style={{ backgroundColor: styles.backgroundColor }}
          />
        );
      })}
    </div>
  );

  const compactAttributePreview = (
    <CompactAttributePreview row={row} onLevelFilter={onLevelFilter} />
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
            {showTopOfferListingShortcut && knownTopOfferPrice && (
              <>
                {" "}Set price to{" "}
                <button
                  type="button"
                  onClick={() => {
                    void hapticTap();
                    setListingPrice(sanitizeTradePriceInput(knownTopOfferPrice));
                    focusTradeInput("list");
                  }}
                  className="cursor-pointer text-[#FFFF00] underline underline-offset-2 hover:text-[#ffff66]"
                >
                  Top Offer
                </button>
                .
              </>
            )}
          </p>
          {listingPriceIsAtOrBelowTopOffer && effectiveTopOffer && (
            <p className="mt-2 rounded-lg border border-[#FFFF00]/35 bg-[rgba(255,255,0,0.12)] px-3 py-2 text-xs font-bold text-[#e6e68a]">
              Suggestion: Listing price should be above the current Top Offer of {formatMarketEthForTradeCopy(effectiveTopOffer)}.
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
          openAppUrl(getOpenSeaUrl(details.id)).catch((error) => {
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

          <WarpletDetailsMedia tokenId={details.id} />

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
                    {showTopOfferListingShortcut && knownTopOfferPrice && (
                      <>
                        {" "}Set price to{" "}
                        <button
                          type="button"
                          onClick={() => {
                            void hapticTap();
                            setListingPrice(sanitizeTradePriceInput(knownTopOfferPrice));
                            focusTradeInput("list");
                          }}
                          className="cursor-pointer text-[#FFFF00] underline underline-offset-2 hover:text-[#ffff66]"
                        >
                          Top Offer
                        </button>
                        .
                      </>
                    )}
                  </p>
                  {listingPriceIsAtOrBelowTopOffer && effectiveTopOffer && (
                    <p className="mt-2 rounded-lg border border-[#FFFF00]/35 bg-[rgba(255,255,0,0.12)] px-3 py-2 text-xs font-bold text-[#e6e68a]">
                      Suggestion: Listing price should be above the current Top Offer of {formatMarketEthForTradeCopy(effectiveTopOffer)}.
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
                  openAppUrl(getOpenSeaUrl(details.id)).catch((error) => {
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
                viewerWallet={viewerWallet}
                viewerFid={viewerFid}
                viewerUsername={viewerUsername}
              />

              <WarpletItemActivity
                tokenId={details.id}
                viewerFid={viewerFid}
                actionSessionToken={actionSessionToken}
                onSearchWallet={onSearchOwnerWallet}
                onOpenToken={onOpenRelatedWarplet}
                refreshKey={`${effectiveListing?.at ?? ""}|${effectiveItemOffer?.at ?? ""}|${effectiveSale?.at ?? ""}|${effectiveOwner?.wallet ?? ""}`}
                isInMiniAppContext={isInMiniAppContext}
                onScrollToEvents={scrollActivityEventsIntoView}
                onShareStats={onShareStats}
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
                        className="cursor-pointer rounded-full border border-[#00FF00]/25 bg-black/60 px-2 py-1 text-left text-[11px] text-[#00FF00] hover:border-[#00FF00]/60 hover:bg-[#041204]"
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
                  className="w-full cursor-pointer rounded-xl border border-[#00FF00]/25 bg-[#041204]/60 px-3 py-2 text-left hover:border-[#00FF00]/60 hover:bg-[#071807]"
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
                  className="w-full cursor-pointer rounded-xl border border-[#00FF00]/25 bg-[#041204]/60 px-3 py-2 text-left hover:border-[#00FF00]/60 hover:bg-[#071807]"
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
                  className="w-full cursor-pointer rounded-xl border border-[#00FF00]/25 bg-[#041204]/60 px-3 py-2 text-left hover:border-[#00FF00]/60 hover:bg-[#071807]"
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
                <a
                  key={asset.ext}
                  href={getWarpletAssetUrl(details.id, asset.ext)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    void hapticTap();
                  }}
                  className="cursor-pointer rounded-xl border border-[#00FF00]/30 bg-[#041204]/90 px-3 py-2 text-left text-xs text-[#00FF00] hover:border-[#00FF00]/60 hover:bg-[#071807]"
                >
                  <span className="block font-bold">{asset.label}</span>
                  <span className="block text-[10px] text-[#8bbf8b]">{asset.detail}</span>
                </a>
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
  const walletController = useWalletController();
  const webWalletEnabled = import.meta.env.VITE_WEB_WALLET_ENABLED === "true";
  const [webConnectOpen, setWebConnectOpen] = useState(() => hasPendingFarcasterSignIn());
  const [headerAccountMenuAnchor, setHeaderAccountMenuAnchor] = useState<"title" | "avatar" | null>(null);
  const handleHeaderAccountMenuOpenChange = useCallback((open: boolean) => {
    if (!open) setHeaderAccountMenuAnchor(null);
  }, []);
  const handleHeaderTitleMenuToggle = useCallback(() => {
    setHeaderAccountMenuAnchor((current) => current === "title" ? null : "title");
  }, []);
  const handleHeaderAvatarMenuToggle = useCallback(() => {
    setHeaderAccountMenuAnchor((current) => current === "avatar" ? null : "avatar");
  }, []);
  const [webConnectIdentityError, setWebConnectIdentityError] = useState<string | null>(null);
  useEffect(() => {
    const openConnect = () => setWebConnectOpen(true);
    window.addEventListener("warplets:connect-wallet", openConnect);
    return () => window.removeEventListener("warplets:connect-wallet", openConnect);
  }, []);
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState("");
  const [databaseLoadingMessage, setDatabaseLoadingMessage] = useState(DATABASE_LOADING_PREFIX);
  const [onboardingComplete, setOnboardingComplete] = useState(() => readOnboardingComplete());
  const [showOnboarding, setShowOnboarding] = useState(() => isOnboardingForced());
  const [onboardingSessionKey, setOnboardingSessionKey] = useState(0);
  const [notificationPromptPending, setNotificationPromptPending] = useState(false);
  const [viewerFid, setViewerFid] = useState<number | null>(null);
  const [viewerProfile, setViewerProfile] = useState<ViewerProfile | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mockup") === "1") {
      window.localStorage.removeItem(PERKS_MOCKUP_NOTICE_DISMISSED_KEY);
    }
  }, []);
  const [miniAppContextKnown, setMiniAppContextKnown] = useState(false);
  const [isInMiniAppContext, setIsInMiniAppContext] = useState(false);
  const [searchCompletionStatusLoaded, setSearchCompletionStatusLoaded] = useState(false);
  const [onboardingDecisionTimedOut, setOnboardingDecisionTimedOut] = useState(false);
  useEffect(() => {
    if (onboardingComplete || showOnboarding) return;
    const timeoutId = window.setTimeout(() => setOnboardingDecisionTimedOut(true), ONBOARDING_DECISION_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [onboardingComplete, showOnboarding]);
  useEffect(() => {
    if (shouldOpenOnboarding({
      onboardingComplete,
      showOnboarding,
      miniAppContextKnown,
      isInMiniAppContext,
      viewerFid,
      searchCompletionStatusLoaded,
      onboardingDecisionTimedOut,
    })) {
      setShowOnboarding(true);
    }
  }, [
    onboardingComplete,
    showOnboarding,
    miniAppContextKnown,
    isInMiniAppContext,
    viewerFid,
    searchCompletionStatusLoaded,
    onboardingDecisionTimedOut,
  ]);
  const [showAddAppPrompt, setShowAddAppPrompt] = useState(false);
  const [notificationsOnlyPrompt, setNotificationsOnlyPrompt] = useState(false);
  const [notificationPromptMode, setNotificationPromptMode] = useState<"farcaster" | "web">("farcaster");
  const [pendingNotificationId, setPendingNotificationId] = useState<string | null>(null);
  const [actionSessionToken, setActionSessionToken] = useState<string | null>(null);
  const [notificationOpenSent, setNotificationOpenSent] = useState(false);
  const baseNotificationOpenSentRef = useRef(false);
  const appInitializationStartedRef = useRef(false);
  const [matchedWarpletCard, setMatchedWarpletCard] = useState<MatchedWarpletCard | null>(null);
  const [query, setQuery] = useState("");
  const [isAllWarpletsMode, setIsAllWarpletsMode] = useState(false);
  const [activeExampleSearch, setActiveExampleSearch] = useState(() => getRandomExampleSearch());
  const [searchPlaceholderAnimation, setSearchPlaceholderAnimation] = useState<{
    from: string;
    to: string;
    mode: "placeholder" | "value";
  } | null>(null);
  const [animatedSearchPlaceholder, setAnimatedSearchPlaceholder] = useState("");
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
  const [itemOffersRevision, setItemOffersRevision] = useState(0);
  const [marketRefreshTokenId, setMarketRefreshTokenId] = useState<number | null>(null);
  const [marketRefreshError, setMarketRefreshError] = useState("");
  const [listedWarplets, setListedWarplets] = useState<WarpletResult[]>([]);
  const [listedOwnedWarplets, setListedOwnedWarplets] = useState<WarpletResult[]>([]);
  const [listedOwnedTokenIds, setListedOwnedTokenIds] = useState<number[]>([]);
  const [listedWarpletsLoading, setListedWarpletsLoading] = useState(false);
  const [listedWarpletsError, setListedWarpletsError] = useState("");
  const [listedScope, setListedScope] = useState<ListedScopeFilter>(() => readListedScopeFilter());
  const [orderBy, setOrderBy] = useState<OrderByOption>("rarity");
  const [orderDirection, setOrderDirection] = useState<OrderDirection>("asc");
  const [userSelectedOrder, setUserSelectedOrder] = useState(false);
  const [activeWallet, setActiveWallet] = useState<string | null>(null);
  const [walletProfile, setWalletProfile] = useState<{ name: string | null; avatarUrl: string | null } | null>(null);
  const [favouriteIdentityWallet, setFavouriteIdentityWallet] = useState<string | null>(null);
  const [favouriteListsByWallet, setFavouriteListsByWallet] = useState<Record<string, number[]>>({});
  const [favouriteFilterWallet, setFavouriteFilterWallet] = useState<string | null>(null);
  const [sharePreview, setSharePreview] = useState<SharePreviewState | null>(null);
  const statsShareRequestRef = useRef<StatsShareRequest | null>(null);
  const statsShareIdRef = useRef<string | null>(null);
  const [airdropCongratulationsDetails, setAirdropCongratulationsDetails] = useState<WarpletDetails | null>(null);
  const [preparedAirdropCongratulationsDetails, setPreparedAirdropCongratulationsDetails] = useState<WarpletDetails | null>(null);
  const [airdropFlowHandled, setAirdropFlowHandled] = useState(false);
  const [airdropSharePendingNotificationPrompt, setAirdropSharePendingNotificationPrompt] = useState(false);
  const [preparedNotificationPrompt, setPreparedNotificationPrompt] = useState(false);
  const [searchToast, setSearchToast] = useState<TradeToast | null>(null);
  const [searchToastExiting, setSearchToastExiting] = useState(false);
  const dbRef = useRef<SqliteDatabase | null>(null);
  const databaseLoadPromiseRef = useRef<Promise<SqliteDatabase> | null>(null);
  const databaseDisposedRef = useRef(false);
  const searchRunRef = useRef(0);
  const lastSearchSuccessHapticSignatureRef = useRef("");
  const pendingConfirmedPurchasesRef = useRef(new Map<string, PendingConfirmedPurchase>());
  const ownershipRequestsRef = useRef(new Map<string, Promise<number[]>>());
  const ownershipTokenIdsRef = useRef(new Map<string, number[]>());
  const ownershipOwnersRef = useRef(new Map<string, MarketSnapshot["owners"]>());
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputVisualTextRef = useRef("");
  const searchInputAnimationStartedRef = useRef(false);
  const searchAnimationRevealAtRef = useRef(0);
  const urlHydratedRef = useRef(false);
  const applyingUrlStateRef = useRef(false);
  const lastUrlSignatureRef = useRef("");
  const loadedFavouriteWalletsRef = useRef(new Set<string>());
  const favouriteListsByWalletRef = useRef<Record<string, number[]>>({});
  const pendingSearchCompletionsRef = useRef<Set<SearchCompletion>>(new Set());
  const forceAirdropRef = useRef(isAirdropForced());
  const forcedAirdropTokenIdRef = useRef(getForcedAirdropTokenId());
  const listedDeepLinkSignatureRef = useRef("");
  const miniAppReadySentRef = useRef(false);
  const shareCelebrationRef = useRef<{ pending: boolean; leftApp: boolean; fallbackTimer: number | null }>({
    pending: false,
    leftApp: false,
    fallbackTimer: null,
  });
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome(WARPLETS_APP_SLUG);
  const [searchRoute, setSearchRoute] = useState<SearchRoute>(() => parseSearchRouteFromPath(window.location.pathname));
  const perksShareDeepLinkHandledRef = useRef("");
  const [lastOffersSubpage, setLastOffersSubpage] = useState<SearchOffersSubpage>(() => readLastSearchOffersSubpage());
  const [lastPerksSubpage, setLastPerksSubpage] = useState<PerksSubpage>(() => readLastSearchPerksSubpage());
  const [lastStatsSubpage, setLastStatsSubpage] = useState<SearchStatsSubpage>(() => readLastSearchStatsSubpage());
  const [lastListedLevel, setLastListedLevel] = useState<ListedLevelFilter>(() => readLastSearchListedLevel());
  const useEmbeddedHistory = isInMiniAppContext || isEmbeddedWebView() || isLikelyBaseAppBrowser();
  useEffect(() => {
    if (searchRoute.page !== "perks") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("share") !== "1") return;
    const signature = `${url.pathname}${url.search}${url.hash}`;
    if (perksShareDeepLinkHandledRef.current === signature) return;
    perksShareDeepLinkHandledRef.current = signature;
    setSharePreview(buildPerksSharePreview(searchRoute.perksPage));
    url.searchParams.delete("share");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [searchRoute]);
  useEffect(() => {
    if (!miniAppContextKnown) return;
    trackAppEvent("route_viewed", {
      surface: resolveAppSurface(isInMiniAppContext),
      route: window.location.pathname,
    });
  }, [isInMiniAppContext, miniAppContextKnown, searchRoute]);
  const [siwfViewerProfile, setSiwfViewerProfile] = useState<ViewerProfile | null>(null);
  useEffect(() => {
    if (!miniAppContextKnown || isInMiniAppContext || siwfViewerProfile?.fid) return;
    void restorePendingFarcasterSignIn().then((pending) => {
      if (pending) setWebConnectOpen(true);
    });
  }, [isInMiniAppContext, miniAppContextKnown, siwfViewerProfile?.fid]);

  useEffect(() => {
    const wallet = walletController.session?.address ?? null;
    setActiveWallet(wallet);
  }, [walletController.session?.address]);

  useEffect(() => {
    if (!activeWallet) {
      setWalletProfile(null);
      return;
    }
    let cancelled = false;
    const cacheKey = `warplets_ens_profile:${activeWallet.toLowerCase()}`;
    try {
      const cached = JSON.parse(window.sessionStorage.getItem(cacheKey) ?? "null") as {
        name?: unknown;
        avatarUrl?: unknown;
        expiresAt?: unknown;
      } | null;
      if (cached && Number(cached.expiresAt) > Date.now()) {
        setWalletProfile({
          name: typeof cached.name === "string" ? cached.name : null,
          avatarUrl: typeof cached.avatarUrl === "string" ? cached.avatarUrl : null,
        });
        return;
      }
    } catch { /* optional cache */ }
    setWalletProfile(null);
    void fetch(`/api/wallet-profile?address=${encodeURIComponent(activeWallet)}`, {
      headers: { accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) return null;
      return response.json() as Promise<{ name?: unknown; avatarUrl?: unknown }>;
    }).then((profile) => {
      if (!profile || cancelled) return;
      const resolved = {
        name: typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : null,
        avatarUrl: typeof profile.avatarUrl === "string" && profile.avatarUrl.trim() ? profile.avatarUrl.trim() : null,
      };
      setWalletProfile(resolved);
      try {
        window.sessionStorage.setItem(cacheKey, JSON.stringify({ ...resolved, expiresAt: Date.now() + 60 * 60 * 1000 }));
      } catch { /* optional cache */ }
    }).catch((error) => console.warn("ENS wallet profile lookup failed:", error));
    return () => { cancelled = true; };
  }, [activeWallet]);

  const animateSearchInputChange = useCallback((to: string, mode: "placeholder" | "value") => {
    searchInputAnimationStartedRef.current = true;
    const from = searchInputVisualTextRef.current;
    if (from === to) {
      searchAnimationRevealAtRef.current = 0;
      setSearchPlaceholderAnimation(null);
      return;
    }
    searchAnimationRevealAtRef.current = window.performance.now()
      + (from.length > 0 ? SEARCH_PLACEHOLDER_DELETE_MS : 0)
      + to.length * SEARCH_PLACEHOLDER_TYPE_MS_PER_CHARACTER
      + SEARCH_RESULTS_REVEAL_DELAY_MS;
    setAnimatedSearchPlaceholder(from);
    setSearchPlaceholderAnimation({ from, to, mode });
  }, []);

  useEffect(() => {
    if (searchPlaceholderAnimation === null) return;

    const { from, to } = searchPlaceholderAnimation;
    const deleteDurationMs = from.length > 0 ? SEARCH_PLACEHOLDER_DELETE_MS : 0;
    const typeDurationMs = to.length * SEARCH_PLACEHOLDER_TYPE_MS_PER_CHARACTER;
    const startedAt = window.performance.now();
    let animationFrameId: number | null = null;
    let lastText = from;

    searchInputVisualTextRef.current = from;
    setAnimatedSearchPlaceholder(from);

    const renderFrame = (now: number) => {
      const elapsedMs = now - startedAt;
      let nextText: string;

      if (elapsedMs < deleteDurationMs) {
        const deleteProgress = elapsedMs / deleteDurationMs;
        const visibleCharacters = Math.ceil(from.length * (1 - deleteProgress));
        nextText = from.slice(0, visibleCharacters);
      } else {
        const typeElapsedMs = elapsedMs - deleteDurationMs;
        const visibleCharacters = Math.min(
          to.length,
          Math.floor(typeElapsedMs / SEARCH_PLACEHOLDER_TYPE_MS_PER_CHARACTER),
        );
        nextText = to.slice(0, visibleCharacters);
      }

      if (nextText !== lastText) {
        lastText = nextText;
        searchInputVisualTextRef.current = nextText;
        setAnimatedSearchPlaceholder(nextText);
      }

      if (elapsedMs >= deleteDurationMs + typeDurationMs) {
        searchAnimationRevealAtRef.current = 0;
        setSearchPlaceholderAnimation(null);
        return;
      }

      animationFrameId = window.requestAnimationFrame(renderFrame);
    };

    animationFrameId = window.requestAnimationFrame(renderFrame);

    return () => {
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
    };
  }, [searchPlaceholderAnimation]);

  const selectedWarpletDetails = selectedWarpletDetailsStack.at(-1) ?? null;
  const sendMiniAppReady = useCallback(() => {
    if (miniAppReadySentRef.current) return;
    miniAppReadySentRef.current = true;
    signalAppReady().catch((error) => {
      miniAppReadySentRef.current = false;
      console.warn("Search mini app ready failed:", error);
    });
  }, []);

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

  useEffect(() => subscribeToWalletReviewRequests(({ provider, kind, phase }) => {
    const externalWalletName = getExternalWalletReviewName(provider);
    if (!externalWalletName) return;
    if (phase === "settled") {
      closeSearchToast();
      return;
    }
    const requestLabel = kind === "signature"
      ? "signature request"
      : kind === "network"
        ? "network request"
        : "transaction request";
    showSearchToast(
      "success",
      `Review the ${requestLabel} in ${externalWalletName} to continue.`,
      { manualClose: true },
    );
  }), [closeSearchToast, showSearchToast]);

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

  useEffect(() => {
    const syncSearchRoute = () => {
      const nextRoute = parseSearchRouteFromPath(window.location.pathname);
      setSearchRoute(nextRoute);
      if (nextRoute.page === "offers") {
        setLastOffersSubpage(nextRoute.offersPage);
        writeLastSearchOffersSubpage(nextRoute.offersPage);
      } else if (nextRoute.page === "perks") {
        setLastPerksSubpage(nextRoute.perksPage);
        writeLastSearchPerksSubpage(nextRoute.perksPage);
      } else if (nextRoute.page === "stats") {
        setLastStatsSubpage(nextRoute.statsPage);
        writeLastSearchStatsSubpage(nextRoute.statsPage);
      } else if (nextRoute.page === "listed") {
        setLastListedLevel(nextRoute.listedLevel);
        writeLastSearchListedLevel(nextRoute.listedLevel);
      }
    };

    const navigation = (window as Window & {
      navigation?: {
        addEventListener?: (event: string, listener: EventListener) => void;
        removeEventListener?: (event: string, listener: EventListener) => void;
      };
    }).navigation;

    window.addEventListener("popstate", syncSearchRoute);
    window.addEventListener("hashchange", syncSearchRoute);
    navigation?.addEventListener?.("navigatesuccess", syncSearchRoute);
    syncSearchRoute();
    return () => {
      window.removeEventListener("popstate", syncSearchRoute);
      window.removeEventListener("hashchange", syncSearchRoute);
      navigation?.removeEventListener?.("navigatesuccess", syncSearchRoute);
    };
  }, []);

  const navigateSearchRoute = useCallback((route: SearchRoute, mode: "push" | "replace" = "push") => {
    const nextPath = getSearchPathForRoute(route);
    const historyState = {
      ...(window.history.state ?? {}),
      searchRoute: getSearchRouteStableKey(route),
    };
    writeSpaHistory(window.history, historyState, nextPath, {
      mode,
      embedded: useEmbeddedHistory,
    });
    setSearchRoute(route);
    if (route.page === "offers") {
      setLastOffersSubpage(route.offersPage);
      writeLastSearchOffersSubpage(route.offersPage);
    } else if (route.page === "perks") {
      setLastPerksSubpage(route.perksPage);
      writeLastSearchPerksSubpage(route.perksPage);
    } else if (route.page === "stats") {
      setLastStatsSubpage(route.statsPage);
      writeLastSearchStatsSubpage(route.statsPage);
    } else if (route.page === "listed") {
      setLastListedLevel(route.listedLevel);
      writeLastSearchListedLevel(route.listedLevel);
    }
  }, [useEmbeddedHistory]);

  const handleListedScopeChange = useCallback((scope: ListedScopeFilter) => {
    setListedScope(scope);
    writeListedScopeFilter(scope);
  }, []);

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

    writeSpaHistory(window.history, historyState, nextUrl, {
      mode,
      embedded: useEmbeddedHistory,
    });

    lastUrlSignatureRef.current = signature;
  }, [useEmbeddedHistory]);

  const ensureDatabaseReady = useCallback(async (): Promise<SqliteDatabase> => {
    if (dbRef.current) return dbRef.current;
    if (!databaseLoadPromiseRef.current) {
      setDbError("");
      databaseLoadPromiseRef.current = (async () => {
        const { default: sqlite3InitModule } = await import("@sqlite.org/sqlite-wasm");
        const sqlite3 = await sqlite3InitModule();
        const response = await fetch(DB_URL);
        if (!response.ok) throw new Error(`Database download failed (${response.status})`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        sqlite3.capi.sqlite3_js_posix_create_file(DB_FILENAME, bytes);
        const db = new sqlite3.oo1.DB(DB_FILENAME, "r") as SqliteDatabase;
        if (databaseDisposedRef.current) {
          db.close();
          throw new Error("Database load was cancelled");
        }
        dbRef.current = db;
        setDbReady(true);
        if (readOnboardingComplete()) void hapticSuccess();
        return db;
      })().catch((error) => {
        databaseLoadPromiseRef.current = null;
        if (!databaseDisposedRef.current) {
          setDbError(error instanceof Error ? error.message : String(error));
        }
        throw error;
      });
    }
    return databaseLoadPromiseRef.current;
  }, []);

  const searchWarpmojiWarplets = useCallback(async (query: string) => {
    const db = await ensureDatabaseReady();
    return searchWarpletPickerPage(db, query, null, 8).rows.slice(0, 8).map((row) => ({
      id: row.id,
      rank: row.rarityValue,
      description: row.description,
      jpgUrl: `https://warplets.10x.meme/${row.id}.jpg`,
    }));
  }, [ensureDatabaseReady]);

  const loadWarpletDetails = useCallback(async (tokenId: number) => {
    try {
      const db = await ensureDatabaseReady();
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
      await preloadImage(getWarpletImageUrl(details.id));
      return details;
    } catch (err) {
      console.error("Failed to load Warplet details:", err);
      return null;
    }
  }, [ensureDatabaseReady]);

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

  const applySearchCompletionStatus = useCallback((payload: unknown) => {
    const record = payload && typeof payload === "object" ? payload as SearchStatusPayload : null;
    if (!record) return;

    if (isCompletedAt(record.searchOnboardingCompletedAt) && !isOnboardingForced()) {
      writeOnboardingComplete();
      setOnboardingComplete(true);
    }

    if (isCompletedAt(record.searchAirdropModalCompletedAt) && !forceAirdropRef.current) {
      writeAirdropCongratulationsComplete();
      setAirdropFlowHandled(true);
      setAirdropCongratulationsDetails(null);
      setPreparedAirdropCongratulationsDetails(null);
      setAirdropSharePendingNotificationPrompt(false);
    }
  }, []);

  const syncSearchViewerStatus = useCallback((fid: number, warningLabel = "Search user status upsert failed", profile?: ViewerProfile | null) => {
    const resetSearchCompletions = window.sessionStorage.getItem(SERVER_CACHE_RESET_PENDING_KEY) === "1";
    return fetch("/api/warplet-status", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ fid, appSlug: WARPLETS_APP_SLUG, resetSearchCompletions: resetSearchCompletions || undefined, profile: profile ? {
        username: profile.username,
        displayName: profile.displayName,
        pfpUrl: profile.pfpUrl,
      } : undefined }),
    })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: unknown) => {
        const record = payload && typeof payload === "object" ? payload as SearchStatusPayload : null;
        if (record?.searchCompletionsReset === true) {
          window.sessionStorage.removeItem(SERVER_CACHE_RESET_PENDING_KEY);
        }
        if (typeof record?.actionSessionToken === "string") {
          setActionSessionToken(record.actionSessionToken);
        }
        applySearchCompletionStatus(payload);
      })
      .catch((error) => console.warn(warningLabel, error))
      .finally(() => setSearchCompletionStatusLoaded(true));
  }, [applySearchCompletionStatus]);

  const postSearchCompletion = useCallback((completion: SearchCompletion) => {
    if (!viewerFid) {
      pendingSearchCompletionsRef.current.add(completion);
      return;
    }

    fetch("/api/warplet-status", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        fid: viewerFid,
        appSlug: WARPLETS_APP_SLUG,
        searchCompletion: completion,
      }),
    })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: unknown) => applySearchCompletionStatus(payload))
      .catch((error) => console.warn(`Search ${completion} completion sync failed:`, error));
  }, [applySearchCompletionStatus, viewerFid]);

  useEffect(() => {
    if (!viewerFid || pendingSearchCompletionsRef.current.size === 0) return;
    const completions = Array.from(pendingSearchCompletionsRef.current);
    pendingSearchCompletionsRef.current.clear();
    completions.forEach((completion) => postSearchCompletion(completion));
  }, [postSearchCompletion, viewerFid]);

  useEffect(() => {
    if (appInitializationStartedRef.current) return;
    appInitializationStartedRef.current = true;
    let shouldCallReady = false;

    const init = async () => {
      try {
        const inMiniApp = await detectMiniAppContext(
          typeof sdk.isInMiniApp === "function" ? () => sdk.isInMiniApp() : undefined,
        );
        setIsInMiniAppContext(inMiniApp);
        const surface = resolveAppSurface(inMiniApp);
        configureAppSurface(surface);
        trackAppEvent("app_viewed", {
          surface,
          route: window.location.pathname,
          entryPoint: resolveEntryPoint(window.location, {
            standalone: isStandaloneDisplay(),
            referrer: document.referrer,
            userAgent: navigator.userAgent,
          }),
        });
        configureFarcasterWallet(inMiniApp
          ? async () => {
              const provider = await getEmbeddedWalletProvider();
              if (!provider) throw new Error("Farcaster wallet is unavailable");
              return provider;
            }
          : null);

        const inBaseApp = isLikelyBaseAppBrowser();
        if (inBaseApp) {
          void requestBaseAppWalletLogin().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            if (!/reject|denied|cancel/i.test(message)) console.warn("Base wallet login failed:", error);
          });
        }

        if (!inMiniApp) {
          const [, appSession] = await Promise.all([
            (inBaseApp ? Promise.resolve(null) : restoreWebWallet()).catch((error) => {
              console.warn("Web wallet restore failed:", error);
              return null;
            }),
            loadAppSession().catch((error) => {
              console.warn("Application session restore failed:", error);
              return null;
            }),
          ]);
          if (appSession?.farcasterFid) {
            const profile: ViewerProfile = appSession.farcasterProfile ?? {
              fid: appSession.farcasterFid,
              username: null,
              displayName: null,
              pfpUrl: null,
            };
            setSiwfViewerProfile(profile);
            setViewerFid(appSession.farcasterFid);
            setViewerProfile(profile);
            setActionSessionToken(appSession.actionSessionToken);
          }
          setMiniAppContextKnown(true);
          setSearchCompletionStatusLoaded(true);
          return;
        }

        shouldCallReady = true;
        sendMiniAppReady();
        const context = await sdk.context;
        const user = (context as { user?: Record<string, unknown> }).user;
        const fid = Number(user?.fid);
        const normalizedFid = Number.isInteger(fid) && fid > 0 ? fid : null;
        setViewerFid(normalizedFid);
        const liveViewerProfile: ViewerProfile = {
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
        };
        setViewerProfile(liveViewerProfile);
        setMiniAppContextKnown(true);

        if (normalizedFid) {
          void sdk.quickAuth.getToken().then(({ token }) => verifyFarcasterQuickAuth(token)).then(async (session) => {
            const verifiedFid = Number(session.farcasterFid);
            const sessionFid = Number.isInteger(verifiedFid) && verifiedFid > 0 ? verifiedFid : normalizedFid;
            if (!sessionFid) throw new Error("Farcaster identity could not be restored");
            const verifiedProfile: ViewerProfile = {
              fid: sessionFid,
              username: typeof session.username === "string" && session.username.trim() ? session.username.trim() : liveViewerProfile.username,
              displayName: typeof session.displayName === "string" && session.displayName.trim() ? session.displayName.trim() : liveViewerProfile.displayName,
              pfpUrl: typeof session.pfpUrl === "string" && session.pfpUrl.trim() ? session.pfpUrl.trim() : liveViewerProfile.pfpUrl,
            };
            setViewerFid(verifiedProfile.fid);
            setViewerProfile(verifiedProfile);
            if (typeof session.actionSessionToken === "string") setActionSessionToken(session.actionSessionToken);
            await syncSearchViewerStatus(sessionFid, "Search user status upsert failed", verifiedProfile);
            await restoreFarcasterWallet();
          }).catch((error) => console.warn("Farcaster Quick Auth verification failed:", error))
            .finally(() => setSearchCompletionStatusLoaded(true));
        } else {
          setSearchCompletionStatusLoaded(true);
        }

        const location = (context as { location?: Record<string, unknown> }).location;
        const notification = location?.notification;
        const notificationIdFromContext = location?.type === "notification"
          ? typeof notification === "object" && notification !== null && "notificationId" in notification && typeof notification.notificationId === "string"
            ? notification.notificationId
            : typeof location.notificationId === "string"
              ? location.notificationId
              : typeof location.notification_id === "string"
                ? location.notification_id
                : null
          : null;
        const notificationIdFromUrl = new URLSearchParams(window.location.search).get("notificationId")?.trim() || null;
        const notificationId = notificationIdFromContext?.trim() || notificationIdFromUrl;
        if (notificationId) setPendingNotificationId(notificationId);

        const client = (context as { client?: Record<string, unknown> }).client;
        const host = window.location.hostname.toLowerCase();
        const addDebug = new URLSearchParams(window.location.search).get("add") === "1";
        const isPromptHost =
          host === new URL(WARPLETS_APP_ORIGINS.prod).hostname ||
          host === new URL(WARPLETS_APP_ORIGINS.dev).hostname ||
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
        setMiniAppContextKnown(true);
        if (!shouldCallReady) {
          setSearchCompletionStatusLoaded(true);
        }
        if (shouldCallReady) sendMiniAppReady();
      }
    };

    void init();
  }, [sendMiniAppReady, syncSearchViewerStatus]);

  const handleWebFarcasterAuthenticated = useCallback((identity: FarcasterWebIdentity) => {
    setWebConnectIdentityError(null);
    const profile: ViewerProfile = {
      fid: identity.fid,
      username: identity.username,
      displayName: identity.displayName,
      pfpUrl: identity.pfpUrl,
    };
    setSiwfViewerProfile(profile);
    setViewerFid(identity.fid);
    setViewerProfile(profile);
    setActionSessionToken(identity.actionSessionToken);
    setWebConnectOpen(false);
    setSearchCompletionStatusLoaded(false);
    trackAppEvent("farcaster_identity_connected", { surface: "web" });
    void syncSearchViewerStatus(identity.fid, "Search SIWF user status upsert failed:", profile);
    if (activeWallet) {
      void linkCurrentWalletAndIdentity(activeWallet, { automatic: true }).catch((error) => {
        console.warn("Automatic wallet and social linking failed:", error);
      });
    }
  }, [activeWallet, syncSearchViewerStatus]);

  const handleWebFarcasterError = useCallback((message: string) => {
    const normalized = /reject|denied|cancel|closed/i.test(message)
      ? "Farcaster connection was cancelled."
      : message;
    setWebConnectIdentityError(normalized);
  }, []);

  const handleWebFarcasterDisconnect = useCallback(async () => {
    await logoutAppPrincipal("farcaster");
    setSiwfViewerProfile(null);
    setFavouriteIdentityWallet(null);
    setViewerFid(null);
    setViewerProfile(null);
    setActionSessionToken(null);
    setSearchCompletionStatusLoaded(true);
    setWebConnectIdentityError(null);
  }, []);

  useEffect(() => {
    if (!webConnectOpen || isInMiniAppContext || siwfViewerProfile?.fid) return;
    let cancelled = false;
    let checking = false;
    const recoverVerifiedSession = async () => {
      if (checking || cancelled) return;
      checking = true;
      try {
        const session = await loadAppSession();
        if (cancelled || !session.farcasterFid) return;
        handleWebFarcasterAuthenticated({
          fid: session.farcasterFid,
          username: session.farcasterProfile?.username ?? null,
          displayName: session.farcasterProfile?.displayName ?? null,
          pfpUrl: session.farcasterProfile?.pfpUrl ?? null,
          actionSessionToken: session.actionSessionToken,
        });
      } catch {
        // The normal AuthKit callback reports actionable errors. This fallback
        // only recovers a server session if the relay UI restarts after success.
      } finally {
        checking = false;
      }
    };
    void recoverVerifiedSession();
    const interval = window.setInterval(() => void recoverVerifiedSession(), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [handleWebFarcasterAuthenticated, isInMiniAppContext, siwfViewerProfile?.fid, webConnectOpen]);

  useEffect(() => {
    if (!pendingNotificationId || !viewerFid || !actionSessionToken || notificationOpenSent) return;
    setNotificationOpenSent(true);
    fetch("/api/notifications/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        notificationId: pendingNotificationId,
        fid: viewerFid,
        appSlug: WARPLETS_APP_SLUG,
        sessionToken: actionSessionToken,
      }),
    }).catch((error) => console.warn("Failed to record notification open:", error));
  }, [actionSessionToken, notificationOpenSent, pendingNotificationId, viewerFid]);

  useEffect(() => {
    if (isInMiniAppContext || baseNotificationOpenSentRef.current) return;
    const campaignId = new URLSearchParams(window.location.search).get("baseNotificationId")?.trim();
    if (!campaignId) return;
    void fetch("/api/notifications/base/open", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId, action: "click" }),
    }).then((response) => {
      if (response.ok) baseNotificationOpenSentRef.current = true;
    }).catch(() => undefined);
  }, [activeWallet, isInMiniAppContext]);

  const handleConfirmAddAppPrompt = useCallback(async () => {
    try {
      void hapticPrimaryTap();
      if (notificationPromptMode === "web") {
        await subscribeToWebPush(["announcements", "favourites", "offers", "market", "activity"]);
        trackAppEvent("web_push_subscribed", { surface: "web", channel: "web-push" });
        showSearchToast("success", "Web notifications are enabled for 10X Warplets.");
      } else {
        const result = await requestFarcasterNotifications();
        if (!result.notificationDetails) {
          showSearchToast("error", FARCASTER_NOTIFICATIONS_MANUAL_ENABLE_MESSAGE, { manualClose: true });
        }
      }
    } catch (error) {
      console.warn("Search add mini app prompt failed:", error);
      if (notificationPromptMode === "web") {
        showSearchToast("error", error instanceof Error ? error.message : "Web notifications could not be enabled.", { manualClose: true });
      } else if (notificationsOnlyPrompt) {
        showSearchToast("error", FARCASTER_NOTIFICATIONS_MANUAL_ENABLE_MESSAGE, { manualClose: true });
      }
    } finally {
      setShowAddAppPrompt(false);
    }
  }, [notificationPromptMode, notificationsOnlyPrompt, showSearchToast]);

  const handleCompleteOnboarding = useCallback(() => {
    void hapticSuccess();
    writeOnboardingComplete();
    setOnboardingComplete(true);
    if (preparedAirdropCongratulationsDetails) {
      setAirdropCongratulationsDetails(preparedAirdropCongratulationsDetails);
      setPreparedAirdropCongratulationsDetails(null);
    } else if (preparedNotificationPrompt) {
      setPreparedNotificationPrompt(false);
      setShowAddAppPrompt(true);
    }
    setShowOnboarding(false);
    postSearchCompletion("onboarding");
  }, [postSearchCompletion, preparedAirdropCongratulationsDetails, preparedNotificationPrompt]);

  const openPendingNotificationPrompt = useCallback(() => {
    if (!notificationPromptPending) return;
    setNotificationPromptPending(false);
    if (showOnboarding) {
      setPreparedNotificationPrompt(true);
      return;
    }
    setShowAddAppPrompt(true);
  }, [notificationPromptPending, showOnboarding]);

  useEffect(() => {
    const db = dbRef.current;
    const forceAirdrop = forceAirdropRef.current;
    const canPreparePostOnboarding = onboardingComplete || showOnboarding;
    if (!canPreparePostOnboarding || airdropFlowHandled || airdropCongratulationsDetails || preparedAirdropCongratulationsDetails) return;
    if (!miniAppContextKnown) return;

    if (!forceAirdrop && readAirdropCongratulationsComplete()) {
      setAirdropFlowHandled(true);
      openPendingNotificationPrompt();
      return;
    }

    if (isInMiniAppContext && viewerFid != null && !searchCompletionStatusLoaded && !forceAirdrop) {
      return;
    }

    if ((!isInMiniAppContext || viewerFid == null) && !forceAirdrop) {
      setAirdropFlowHandled(true);
      openPendingNotificationPrompt();
      return;
    }

    if (!dbReady || !db) return;

    let cancelled = false;

    const loadAirdropMatch = async () => {
      try {
        let tokenId: number | null = null;

        if (viewerFid != null) {
          const rows = db.exec(
            `SELECT w.id
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
          tokenId = cellToNumber(rows[0]?.[0]);
        }

        if (!tokenId && forceAirdrop) {
          tokenId = forcedAirdropTokenIdRef.current;
        }

        let details = tokenId ? await loadWarpletDetails(tokenId) : null;
        if (!details && forceAirdrop) {
          const fallbackRows = db.exec(
            `SELECT w.id
             FROM warplets w
             ORDER BY w.id ASC
             LIMIT 1`,
            {
              rowMode: "array",
              returnValue: "resultRows",
            },
          );
          const fallbackTokenId = cellToNumber(fallbackRows[0]?.[0]);
          details = fallbackTokenId ? await loadWarpletDetails(fallbackTokenId) : null;
        }
        if (cancelled) return;
        if (details) {
          setAirdropFlowHandled(true);
          if (showOnboarding) {
            setPreparedAirdropCongratulationsDetails(details);
          } else {
            setAirdropCongratulationsDetails(details);
            void hapticSuccess();
          }
        } else if (forceAirdrop) {
          console.warn("Forced airdrop modal could not load Warplet details.");
        } else {
          setAirdropFlowHandled(true);
          openPendingNotificationPrompt();
        }
      } catch (error) {
        console.error("Failed to load viewer airdrop match:", error);
        if (!cancelled) {
          if (forceAirdrop) {
            console.warn("Forced airdrop modal failed before details could load.");
          } else {
            setAirdropFlowHandled(true);
            openPendingNotificationPrompt();
          }
        }
      }
    };

    void loadAirdropMatch();

    return () => {
      cancelled = true;
    };
  }, [
    airdropCongratulationsDetails,
    airdropFlowHandled,
    dbReady,
    isInMiniAppContext,
    loadWarpletDetails,
    miniAppContextKnown,
    onboardingComplete,
    openPendingNotificationPrompt,
    preparedAirdropCongratulationsDetails,
    searchCompletionStatusLoaded,
    showOnboarding,
    viewerFid,
  ]);

  useEffect(() => {
    const canPreparePostOnboarding = onboardingComplete || showOnboarding;
    if (
      !notificationPromptPending ||
      !canPreparePostOnboarding ||
      (forceAirdropRef.current && !airdropSharePendingNotificationPrompt) ||
      !airdropFlowHandled ||
      airdropCongratulationsDetails ||
      preparedAirdropCongratulationsDetails ||
      airdropSharePendingNotificationPrompt ||
      sharePreview
    ) {
      return;
    }
    openPendingNotificationPrompt();
  }, [
    airdropCongratulationsDetails,
    airdropFlowHandled,
    airdropSharePendingNotificationPrompt,
    notificationPromptPending,
    onboardingComplete,
    openPendingNotificationPrompt,
    preparedAirdropCongratulationsDetails,
    sharePreview,
    showOnboarding,
  ]);

  const preservePendingConfirmedPurchases = useCallback((snapshot: MarketSnapshot) => {
    const pending = pendingConfirmedPurchasesRef.current;
    if (pending.size === 0) return snapshot;

    const now = Date.now();
    let next = snapshot;
    for (const [key, purchase] of pending) {
      const snapshotOwner = snapshot.owners?.[key];
      const purchaseConfirmed = walletMatches(snapshotOwner?.wallet, purchase.owner.wallet) && !snapshot.listings?.[key];
      if (purchaseConfirmed || purchase.expiresAt <= now) {
        pending.delete(key);
        continue;
      }
      if (next === snapshot) {
        next = {
          ...snapshot,
          listings: { ...(snapshot.listings ?? {}) },
          sales: { ...(snapshot.sales ?? {}) },
          owners: { ...(snapshot.owners ?? {}) },
        };
      }
      delete next.listings[key];
      next.sales[key] = purchase.sale;
      next.owners[key] = purchase.owner;
    }
    return next;
  }, []);

  const loadTokenMarketState = useCallback(async (tokenId: number) => {
    try {
      const response = await fetch(`/api/warplets-market-state/${tokenId}`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) return;
      const payload = await response.json() as { snapshot?: MarketSnapshot };
      if (!payload.snapshot) return;
      setMarketSnapshot((current) => preservePendingConfirmedPurchases(
        mergeTokenSnapshot(current, payload.snapshot as MarketSnapshot, tokenId),
      ));
    } catch (error) {
      console.warn(`Failed to load market state for Warplet #${tokenId}:`, error);
    }
  }, [preservePendingConfirmedPurchases]);

  useEffect(() => {
    const tokenId = selectedWarpletDetailsStack.at(-1)?.id;
    if (tokenId) void loadTokenMarketState(tokenId);
  }, [loadTokenMarketState, selectedWarpletDetailsStack]);

  const mergeCachedOwnershipOwners = useCallback((owners: MarketSnapshot["owners"] = {}) => {
    const cachedOwners: MarketSnapshot["owners"] = {};
    for (const focusedOwners of ownershipOwnersRef.current.values()) {
      Object.assign(cachedOwners, focusedOwners);
    }
    return { ...cachedOwners, ...owners };
  }, []);

  const refreshMarketSnapshot = useCallback(async (force = false) => {
    const cached = readCachedMarketSnapshot();
    if (force) setMarketRefreshError("");
    if (cached && !force) {
      setMarketSnapshot((current) => preservePendingConfirmedPurchases({
        ...cached,
        owners: mergeCachedOwnershipOwners({ ...(current?.owners ?? {}), ...(cached.owners ?? {}) }),
      }));
      const age = Date.now() - Date.parse(cached.generatedAt || "");
      if (Number.isFinite(age) && age < MARKET_SNAPSHOT_STALE_MS) return;
    }

    try {
      const response = await fetch("/api/warplets-market-state", {
        headers: { accept: "application/json" },
        cache: force ? "no-store" : "default",
      });
      if (!response.ok) throw new Error(`Market data failed (${response.status})`);
      const received = (await response.json()) as MarketSnapshot;
      const snapshot = preservePendingConfirmedPurchases(received);
      setMarketSnapshot((current) => preservePendingConfirmedPurchases({
        ...snapshot,
        owners: mergeCachedOwnershipOwners({ ...(current?.owners ?? {}), ...(snapshot.owners ?? {}) }),
      }));
      setMarketRefreshError("");
      writeCachedMarketSnapshot(snapshot);
    } catch (error) {
      console.error("Failed to refresh market state:", error);
      if (!cached) {
        setMarketRefreshError(error instanceof Error ? error.message : String(error));
      }
    }
  }, [mergeCachedOwnershipOwners, preservePendingConfirmedPurchases]);

  const loadMarketOwnership = useCallback((selector: { wallet?: string | null; fid?: number | null }, force = false) => {
    const wallet = normalizeWalletAddress(selector.wallet);
    const fid = Number.isInteger(selector.fid) && Number(selector.fid) > 0 ? Number(selector.fid) : null;
    const key = wallet ? `wallet:${wallet}` : fid ? `fid:${fid}` : "";
    if (!key) return Promise.resolve<number[]>([]);
    if (!force) {
      const cached = ownershipTokenIdsRef.current.get(key);
      if (cached) return Promise.resolve(cached);
      const pending = ownershipRequestsRef.current.get(key);
      if (pending) return pending;
    }
    const params = new URLSearchParams(wallet ? { wallet } : { fid: String(fid) });
    const request = fetch(`/api/warplet-ownership?${params}`, {
      headers: { accept: "application/json" },
      cache: force ? "no-store" : "default",
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Ownership data failed (${response.status})`);
      const payload = await response.json() as {
        tokenIds?: unknown;
        owners?: MarketSnapshot["owners"];
      };
      const tokenIdSet = new Set(Array.isArray(payload.tokenIds)
        ? payload.tokenIds.map(Number).filter((tokenId) => Number.isInteger(tokenId) && tokenId > 0)
        : []);
      const owners = payload.owners && typeof payload.owners === "object" ? { ...payload.owners } : {};
      const now = Date.now();
      for (const [tokenId, purchase] of pendingConfirmedPurchasesRef.current) {
        if (purchase.expiresAt <= now) {
          pendingConfirmedPurchasesRef.current.delete(tokenId);
          continue;
        }
        const belongsToSelector = wallet
          ? walletMatches(purchase.owner.wallet, wallet)
          : fid != null && purchase.owner.fid === fid;
        if (belongsToSelector) {
          tokenIdSet.add(Number(tokenId));
          owners[tokenId] = purchase.owner;
        } else {
          tokenIdSet.delete(Number(tokenId));
          delete owners[tokenId];
        }
      }
      const tokenIds = Array.from(tokenIdSet)
        .filter((tokenId) => Number.isInteger(tokenId) && tokenId > 0)
        .sort((left, right) => left - right);
      ownershipTokenIdsRef.current.set(key, tokenIds);
      ownershipOwnersRef.current.set(key, owners);
      setMarketSnapshot((current) => current ? { ...current, owners: { ...(current.owners ?? {}), ...owners } } : current);
      return tokenIds;
    }).finally(() => {
      if (ownershipRequestsRef.current.get(key) === request) ownershipRequestsRef.current.delete(key);
    });
    ownershipRequestsRef.current.set(key, request);
    return request;
  }, []);

  useEffect(() => {
    if (searchRoute.page === "search" || searchRoute.page === "listed") {
      void refreshMarketSnapshot();
    }
  }, [refreshMarketSnapshot, searchRoute.page]);

  useEffect(() => {
    if (searchRoute.page !== "listed") return;
    let cancelled = false;
    // Never leave the previous signer’s inventory visible while a newly
    // connected wallet is being resolved.
    setListedOwnedTokenIds([]);
    const loadListedOwnership = async () => {
      try {
        const tokenIds = activeWallet
          ? await loadMarketOwnership({ wallet: activeWallet })
          : [];
        if (!cancelled) setListedOwnedTokenIds(tokenIds);
      } catch (error) {
        console.error("Failed to load Listed user ownership:", error);
        if (!cancelled) setListedOwnedTokenIds([]);
      }
    };
    if (activeWallet) {
      void loadListedOwnership();
    } else {
      setListedOwnedTokenIds([]);
    }
    return () => {
      cancelled = true;
    };
  }, [activeWallet, loadMarketOwnership, searchRoute.page]);

  useEffect(() => {
    if (searchRoute.page !== "search") return;
    const ownershipSelector = activeWallet
      ? { wallet: activeWallet }
      : viewerFid
        ? { fid: viewerFid }
        : null;
    if (!ownershipSelector) return;
    void loadMarketOwnership(ownershipSelector).catch((error) => {
      console.error("Failed to load viewer ownership:", error);
    });
  }, [activeWallet, loadMarketOwnership, searchRoute.page, viewerFid]);

  const refreshListedMarket = useCallback(async () => {
    try {
      const hostname = window.location.hostname.toLowerCase();
      const isLocalSearch = hostname === "localhost" || hostname === "127.0.0.1" || hostname === new URL(WARPLETS_APP_ORIGINS.local).hostname;
      if (isLocalSearch) {
        const scheduled = await fetch("/api/local/opensea-market-refresh", { method: "POST", cache: "no-store" });
        if (!scheduled.ok) throw new Error(`Local OpenSea ingest failed (${scheduled.status})`);
      }
      await refreshMarketSnapshot(true);
    } catch (error) {
      console.error("Failed to refresh Listed market:", error);
      setMarketRefreshError(error instanceof Error ? error.message : String(error));
    }
  }, [refreshMarketSnapshot]);

  useEffect(() => {
    if (!dbReady || !dbRef.current || !marketSnapshot) {
      setListedWarplets([]);
      setListedWarpletsLoading(false);
      return;
    }

    setListedWarpletsLoading(true);
    try {
      const tokenIds = Object.keys(marketSnapshot.listings ?? {})
        .map((tokenId) => Number(tokenId))
        .filter((tokenId) => Number.isInteger(tokenId) && tokenId > 0 && Boolean(getMarketState(marketSnapshot, tokenId).listing));
      setListedWarplets(loadWarpletResultsByIds(dbRef.current, tokenIds));
      setListedWarpletsError("");
    } catch (error) {
      console.error("Failed to load listed Warplets:", error);
      setListedWarpletsError(error instanceof Error ? error.message : String(error));
    } finally {
      setListedWarpletsLoading(false);
    }
  }, [dbReady, marketSnapshot]);

  useEffect(() => {
    const normalizedWallet = normalizeWalletAddress(activeWallet);
    if (!dbReady || !dbRef.current || !marketSnapshot || !normalizedWallet) {
      setListedOwnedWarplets([]);
      return;
    }

    try {
      const ownedIds = new Set(listedOwnedTokenIds);
      for (const [tokenId, owner] of Object.entries(marketSnapshot.owners ?? {})) {
        if (walletMatches(owner.wallet, normalizedWallet)) {
          const parsedTokenId = Number(tokenId);
          if (Number.isInteger(parsedTokenId) && parsedTokenId > 0) ownedIds.add(parsedTokenId);
        }
      }
      const tokenIds = Array.from(ownedIds).sort((a, b) => a - b);
      setListedOwnedWarplets(loadWarpletResultsByIds(dbRef.current, tokenIds));
    } catch (error) {
      console.error("Failed to load owned Warplets for Listed page:", error);
      setListedOwnedWarplets([]);
    }
  }, [activeWallet, dbReady, listedOwnedTokenIds, marketSnapshot]);

  useEffect(() => {
    const routeNeedsDatabase = searchRoute.page === "search"
      || searchRoute.page === "listed"
      || (searchRoute.page === "offers" && searchRoute.offersPage === "item");
    if (routeNeedsDatabase) {
      void ensureDatabaseReady().catch((error) => {
        if (!databaseDisposedRef.current) {
          console.error("Failed to load Warplets search database:", error);
        }
      });
    }
  }, [ensureDatabaseReady, searchRoute]);

  useEffect(() => {
    databaseDisposedRef.current = false;
    return () => {
      databaseDisposedRef.current = true;
      dbRef.current?.close();
      dbRef.current = null;
      databaseLoadPromiseRef.current = null;
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

  const loadVerifiedFavouriteList = useCallback(async () => {
    const response = await fetch("/api/warplet-favourites", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({})) as { wallet?: unknown; tokenIds?: unknown; error?: unknown };
    if (!response.ok || typeof payload.wallet !== "string") {
      throw new Error(typeof payload.error === "string" ? payload.error : `Favourite list unavailable (${response.status})`);
    }
    const wallet = normalizeWalletAddress(payload.wallet);
    if (!wallet) throw new Error("No primary wallet is available for this Farcaster account.");
    const tokenIds = normalizeFavouriteTokenIds(payload.tokenIds);
    setFavouriteIdentityWallet(wallet);
    setFavouriteListForWallet(wallet, tokenIds);
    loadedFavouriteWalletsRef.current.add(wallet);
    return wallet;
  }, [setFavouriteListForWallet]);

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
    if (viewerFid) {
      if (favouriteIdentityWallet) return favouriteIdentityWallet;
      return loadVerifiedFavouriteList();
    }
    if (activeWallet) {
      const normalizedWallet = normalizeWalletAddress(activeWallet);
      if (!normalizedWallet) throw new Error("No wallet account is connected.");
      const authenticatedSession = await loadAppSession().catch(() => null);
      if (authenticatedSession?.walletAddress?.toLowerCase() !== normalizedWallet) {
        const walletSession = walletController.session;
        if (!walletSession || walletSession.address.toLowerCase() !== normalizedWallet) {
          throw new Error("Reconnect and verify your wallet to use favourites.");
        }
        if (!getExternalWalletReviewName(walletSession.provider)) {
          showSearchToast("neutral", "Check your wallet to verify favourites access...", { minMs: 5000 });
        }
        await authenticateWallet(walletSession.provider, walletSession.address, walletSession.chainId);
        const verifiedSession = await loadAppSession();
        if (verifiedSession.walletAddress?.toLowerCase() !== normalizedWallet) {
          throw new Error("Wallet verification did not complete.");
        }
      }
      return normalizedWallet;
    }
    if (!isInMiniAppContext) {
      setWebConnectOpen(true);
      trackAppEvent("connect_opened", { surface: "web", route: window.location.pathname });
      throw new Error("Connect and verify a wallet to use favourites.");
    }
    const session = await connectFarcasterWallet();
    const wallet = normalizeWalletAddress(session.address);
    if (!wallet) throw new Error("No wallet account is connected.");
    void loadFavouriteList(wallet);
    return wallet;
  }, [activeWallet, favouriteIdentityWallet, isInMiniAppContext, loadFavouriteList, loadVerifiedFavouriteList, showSearchToast, viewerFid, walletController.session]);

  useEffect(() => {
    if (!viewerFid || !actionSessionToken) return;
    void loadVerifiedFavouriteList().catch((error) => {
      console.warn("Verified identity favourite list load failed:", error);
    });
  }, [actionSessionToken, loadVerifiedFavouriteList, viewerFid]);

  const getCollectionOfferProviderAndAccount = useCallback(async (): Promise<{ provider: EthereumProvider; account: string }> => {
    if (!walletController.session) {
      if (isInMiniAppContext) await connectFarcasterWallet();
      else {
        setWebConnectOpen(true);
        throw new Error("Connect a wallet to continue.");
      }
    }
    const { provider, account } = await getConnectedProviderAndAccount();
    void loadFavouriteList(account);
    await ensureBaseChain(provider, undefined, { allowSkipSwitch: true });
    return { provider, account };
  }, [isInMiniAppContext, loadFavouriteList, walletController.session]);

  const handleHeaderConnectWallet = useCallback(() => {
    if (!isInMiniAppContext) {
      trackAppEvent("connect_opened", { surface: "web", route: window.location.pathname });
      setWebConnectOpen(true);
      return;
    }
    connectFarcasterWallet().then((session) => loadFavouriteList(session.address)).catch((error) => {
      console.warn("Search header wallet connect failed:", error);
      showSearchToast("error", error instanceof Error ? error.message : "Farcaster wallet connection failed.", { manualClose: true });
    });
  }, [isInMiniAppContext, loadFavouriteList, showSearchToast]);

  const handleHeaderViewOnboarding = useCallback(() => {
    setOnboardingSessionKey((current) => current + 1);
    setShowAddAppPrompt(false);
    setNotificationsOnlyPrompt(false);
    setAirdropCongratulationsDetails(null);
    setPreparedAirdropCongratulationsDetails(null);
    setShowOnboarding(true);
  }, []);

  const handleHeaderEnableNotifications = useCallback(() => {
    if (!isInMiniAppContext) {
      if (isLikelyBaseAppBrowser()) return;
      setNotificationPromptMode("web");
      setNotificationsOnlyPrompt(true);
      setShowAddAppPrompt(true);
      return;
    }
    setNotificationPromptMode("farcaster");
    setNotificationPromptPending(false);
    setPreparedNotificationPrompt(false);
    setNotificationsOnlyPrompt(true);
    setShowAddAppPrompt(true);
  }, [isInMiniAppContext]);

  const handleHeaderOpenSpreadsheet = useCallback(() => {
    openExternalAsset("https://link.10x.meme/csv").catch((error) => {
      console.error("Failed to open Warplets spreadsheet:", error);
    });
  }, []);

  const handleHeaderBack = useCallback(() => {
    if (isMenuRoute || searchRoute.page === "search") {
      actions.goBack();
      return;
    }
    navigateSearchRoute({ page: "search" }, "replace");
  }, [actions, isMenuRoute, navigateSearchRoute, searchRoute.page]);

  const handleHeaderDisconnect = useCallback(() => {
    void disconnectWallet().then(async () => {
      await logoutAppPrincipal("all").catch(() => undefined);
      if (!isInMiniAppContext) {
        setSiwfViewerProfile(null);
        setFavouriteIdentityWallet(null);
        setViewerFid(null);
        setViewerProfile(null);
        setActiveWallet(null);
        setFavouriteFilterWallet(null);
        setActionSessionToken(null);
        setSearchCompletionStatusLoaded(true);
      }
    }).catch((error) => {
      showSearchToast("error", error instanceof Error ? error.message : "Wallet could not be disconnected.", { manualClose: true });
    });
  }, [isInMiniAppContext, showSearchToast]);

  useEffect(() => {
    if (!activeWallet) return;
    const cached = readCachedFavouriteTokenIds(activeWallet);
    if (cached.length > 0) setFavouriteListForWallet(activeWallet, cached);
    void loadFavouriteList(activeWallet);
  }, [activeWallet, loadFavouriteList, setFavouriteListForWallet]);

  useEffect(() => {
    const db = dbRef.current;
    if (!dbReady || !db || (!activeWallet && viewerFid == null) || !marketSnapshot) {
      setMatchedWarpletCard(null);
      return;
    }

    let cancelled = false;

    const loadViewerMatch = async () => {
      try {
        const rows = viewerFid == null
          ? []
          : db.exec(
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

        if (
          match &&
          matchOwnerWallet &&
          matchMetadataWallet &&
          matchOwnerWallet === matchMetadataWallet &&
          (!activeWallet || walletMatches(matchOwnerWallet, activeWallet))
        ) {
          await preloadResultImages([match]);
          if (!cancelled) {
            setMatchedWarpletCard({ warplet: match, label: "We Found You!" });
          }
          return;
        }

        const rarestOwnedTokenId = findRarestOwnedWarpletTokenId(marketSnapshot.owners, {
          wallet: activeWallet,
          fid: viewerFid,
        });
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
        console.error("Failed to match connected user to Warplet:", err);
        if (!cancelled) {
          setMatchedWarpletCard(null);
        }
      }
    };

    loadViewerMatch();

    return () => {
      cancelled = true;
    };
  }, [activeWallet, dbReady, marketSnapshot, viewerFid]);

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
    const exactTokenMatch = searchText.match(/^#([1-9]\d{0,4})$/);
    const exactTokenId = exactTokenMatch && Number(exactTokenMatch[1]) <= 10000 ? Number(exactTokenMatch[1]) : null;
    const isWildcardSearch = searchText.trim() === "*" || (!searchText && nextQuery.trim() === "*");
    const ftsQuery = isWildcardSearch || exactTokenId != null ? "" : normalizeFtsQuery(searchText);
    const levelFilter = buildLevelFilter(activeAttributes, activeLevels);
    const hasAttributeOnlyFilter = activeAttributes.length > 0 && activeLevels.length === 0;
    const attributeOnlyRankColumn =
      !ftsQuery && hasAttributeOnlyFilter ? getRankColumnForLevelAttribute(activeAttributes[0]) : null;
    const runId = searchRunRef.current + 1;
    searchRunRef.current = runId;
    const revealAt = offset === 0 ? searchAnimationRevealAtRef.current : 0;
    const waitForAnimatedReveal = async () => {
      const remainingMs = revealAt - window.performance.now();
      if (remainingMs > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, remainingMs));
      }
    };

    if (!db || (!ftsQuery && exactTokenId == null && !levelFilter && !hasAttributeOnlyFilter && !isWildcardSearch && !ownerWalletFilter && !activeFavouriteWallet)) {
      await waitForAnimatedReveal();
      if (searchRunRef.current !== runId) return;
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
      let allowedTokenIds: number[] | null = null;
      if (ownerWalletFilter) {
        allowedTokenIds = await loadMarketOwnership({ wallet: ownerWalletFilter });
      }
      if (activeFavouriteWallet) {
        const favouriteTokenIds = getFavouriteTokenIds(favouriteListsByWalletRef.current, activeFavouriteWallet);
        const favouriteSet = new Set(favouriteTokenIds);
        allowedTokenIds = allowedTokenIds == null
          ? favouriteTokenIds
          : allowedTokenIds.filter((tokenId) => favouriteSet.has(tokenId));
      }
      if (allowedTokenIds?.length === 0) {
        await waitForAnimatedReveal();
        if (searchRunRef.current !== runId) return;
        setSubmittedQuery(nextQuery.trim());
        setTotalResults(0);
        setVisibleCount(limit);
        setResults([]);
        return;
      }

      const conditions: string[] = [];
      const baseBind: Array<string | number> = [];
      if (exactTokenId != null) {
        conditions.push("w.id = ?");
        baseBind.push(exactTokenId);
      } else if (ftsQuery) {
        conditions.push("warplets_fts MATCH ?");
        baseBind.push(ftsQuery);
      }
      if (levelFilter) {
        conditions.push(levelFilter.sql);
        baseBind.push(...levelFilter.bind);
      }
      if (allowedTokenIds) {
        conditions.push("w.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))");
        baseBind.push(JSON.stringify(allowedTokenIds));
      }

      const fromSql = ftsQuery
        ? "FROM warplets_fts JOIN warplets w ON w.id = warplets_fts.rowid"
        : "FROM warplets w";
      const whereSql = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
      const orderSql = ftsQuery
        ? `ORDER BY score, w."10x_rank" ASC, w.id ASC`
        : `ORDER BY ${attributeOnlyRankColumn ? `w."${attributeOnlyRankColumn}" ASC, ` : ""}w.id ASC`;
      const pageSize = exactTokenId != null ? 1 : SEARCH_RESULT_PAGE_SIZE;
      const resultSql = `SELECT ${RESULT_SELECT_COLUMNS}${ftsQuery ? ", bm25(warplets_fts) AS score" : ""}
        ${fromSql}${whereSql}
        ${orderSql}
        LIMIT ? OFFSET ?`;
      const countRows = db.exec(`SELECT COUNT(*) ${fromSql}${whereSql}`, {
        bind: baseBind,
        rowMode: "array",
        returnValue: "resultRows",
      });
      const fullResultCount = Number(countRows[0]?.[0] ?? 0);
      const rows = db.exec(
        resultSql,
        {
          bind: [...baseBind, pageSize, Math.max(0, offset)],
          rowMode: "array",
          returnValue: "resultRows",
        },
      );
      const nextRows = mapRows(rows, Boolean(ftsQuery));
      await preloadResultImagesWithTimeout(nextRows.slice(0, PAGE_SIZE));
      await waitForAnimatedReveal();

      if (searchRunRef.current !== runId) return;

      setSubmittedQuery(nextQuery.trim());
      setTotalResults(fullResultCount);
      setVisibleCount((current) => offset > 0 ? Math.max(current, offset + limit) : limit);
      setResults((current) => offset > 0
        ? [...current, ...nextRows.filter((row) => !current.some((existing) => existing.id === row.id))]
        : nextRows);
      if (offset === 0) {
        const hapticSignature = JSON.stringify({
          query: nextQuery.trim().toLowerCase(),
          attributes: [...activeAttributes].sort(),
          levels: [...activeLevels].sort((left, right) => left - right),
          favouriteWallet: activeFavouriteWallet,
          ownerWallet: ownerWalletFilter,
          resultCount: fullResultCount,
        });
        if (lastSearchSuccessHapticSignatureRef.current !== hapticSignature) {
          lastSearchSuccessHapticSignatureRef.current = hapticSignature;
          void hapticSuccess();
        }
      }
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
  }, [favouriteFilterWallet, loadMarketOwnership, selectedAttributes, selectedLevels]);

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

    if (!nextAllWarpletsMode && nextState.search.trim()) {
      animateSearchInputChange(nextState.search, "value");
    } else {
      const favouriteIsActiveWallet = Boolean(
        nextFavouriteWallet && activeWallet && nextFavouriteWallet === activeWallet.toLowerCase(),
      );
      const nextPlaceholder = nextAllWarpletsMode
        ? nextFavouriteWallet
          ? favouriteIsActiveWallet
            ? "My Favourite Warplets..."
            : `${nextFavouriteWallet.slice(0, 6)} Favourite Warplets...`
          : "All Warplets..."
        : hasAttributeFilter || hasLevelFilter
          ? "Search for Warplets..."
          : `${getRandomExampleDisplayLabel(nextRandom)} Warplets...`;
      animateSearchInputChange(nextPlaceholder, "placeholder");
    }

    setQuery(nextAllWarpletsMode ? "" : nextState.search);
    setIsAllWarpletsMode(nextAllWarpletsMode);
    setActiveExampleSearch(nextRandom);
    if (isRandomMode) {
      recordSeenRandomExampleSearch(nextRandom);
    }
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
  }, [activeExampleSearch, activeWallet, animateSearchInputChange, dbReady, loadFavouriteList, loadWarpletDetails, matchedWarpletCard, openTradeShareTestPreview, runSearch]);

  useEffect(() => {
    if (searchRoute.page !== "search" || !dbReady || urlHydratedRef.current) return;

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
  }, [activeExampleSearch, applySearchUrlState, dbReady, searchRoute.page, updateSearchUrl]);

  useEffect(() => {
    if (searchRoute.page !== "search" || !dbReady || !urlHydratedRef.current || applyingUrlStateRef.current) return;
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
  }, [activeExampleSearch, dbReady, favouriteFilterWallet, isAllWarpletsMode, matchedWarpletCard, query, runSearch, searchRoute.page, selectedAttributes.length, selectedLevels.length]);

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
      if (parseSearchRouteFromPath(window.location.pathname).page !== "search") return;
      const nextState = parseSearchUrlState(new URLSearchParams(window.location.search));
      lastUrlSignatureRef.current = getSearchUrlSignature(nextState);
      void applySearchUrlState(nextState);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [applySearchUrlState, dbReady]);

  useEffect(() => {
    if (searchRoute.page !== "search" || !dbReady || !urlHydratedRef.current || applyingUrlStateRef.current) return;

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
    searchRoute.page,
    userSelectedOrder,
    updateSearchUrl,
  ]);

  const hasActiveAttributeFilter = selectedAttributes.length > 0;
  const hasActiveLevelFilter = selectedLevels.length > 0;
  const hasActiveFavouriteFilter = Boolean(favouriteFilterWallet);
  const hasTypedQuery = query.trim().length > 0;
  const isAllWarpletsSearchMode = isAllWarpletsMode && !hasTypedQuery;
  const isExampleSearchMode = !isAllWarpletsSearchMode && !hasTypedQuery && !hasActiveFavouriteFilter && !hasActiveAttributeFilter && !hasActiveLevelFilter;
  const favouriteOrderTokenIds = getFavouriteTokenIds(favouriteListsByWallet, favouriteFilterWallet);
  const parsedQuerySearch = parseOwnerWalletSearch(query.trim() || submittedQuery.trim());
  const parsedQuerySearchText = parsedQuerySearch.searchText;
  const isOwnWalletSearch = Boolean(
    parsedQuerySearch.ownerWalletFilter &&
    activeWallet &&
    walletMatches(parsedQuerySearch.ownerWalletFilter, activeWallet)
  );
  const hasFavouriteOnlySearchText = Boolean(parsedQuerySearchText.trim()) && parsedQuerySearchText.trim() !== "*";
  const isFavouriteOnlySearchState = Boolean(
    hasActiveFavouriteFilter &&
    isAllWarpletsSearchMode &&
    !hasFavouriteOnlySearchText &&
    !hasActiveAttributeFilter &&
    !hasActiveLevelFilter,
  );
  const showFavouriteOrderOption = isFavouriteOnlySearchState;
  const activeFavouriteWallet = viewerFid ? favouriteIdentityWallet : activeWallet;
  const activeFavouriteTokenIds = getFavouriteTokenIds(favouriteListsByWallet, activeFavouriteWallet);
  const activeFavouriteTokenIdSet = useMemo(
    () => new Set(activeFavouriteTokenIds),
    [activeFavouriteTokenIds],
  );
  const favouriteFilterIsActiveWallet = Boolean(
    favouriteFilterWallet &&
    activeFavouriteWallet &&
    favouriteFilterWallet.toLowerCase() === activeFavouriteWallet.toLowerCase(),
  );
  const favouriteFilterOwnerLabel = favouriteFilterWallet?.slice(0, 6) ?? "";
  const emptySearchPlaceholder = isAllWarpletsSearchMode
    ? hasActiveFavouriteFilter
      ? favouriteFilterIsActiveWallet || !favouriteFilterOwnerLabel
        ? "My Favourite Warplets..."
        : `${favouriteFilterOwnerLabel} Favourite Warplets...`
      : "All Warplets..."
    : `${getRandomExampleDisplayLabel(activeExampleSearch)} Warplets...`;
  const searchPlaceholder = hasTypedQuery || hasActiveAttributeFilter || hasActiveLevelFilter
    ? "Search for Warplets..."
    : emptySearchPlaceholder;
  const displayedSearchPlaceholder = searchPlaceholderAnimation === null
    ? searchInputAnimationStartedRef.current ? searchPlaceholder : ""
    : animatedSearchPlaceholder;
  const displayedSearchValue = searchPlaceholderAnimation?.mode === "value"
    ? animatedSearchPlaceholder
    : searchInputAnimationStartedRef.current ? query : "";
  if (searchInputAnimationStartedRef.current || searchPlaceholderAnimation !== null) {
    searchInputVisualTextRef.current = displayedSearchValue.trim() || displayedSearchPlaceholder;
  }
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
  const displayedTotalResults = totalResults + (shouldPrependMatchedWarplet ? 1 : 0);
  const canLoadMore = totalResults > visibleCount;
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
    const toggled = toggleValue(selectedAttributes, column);
    const next = LEVEL_ATTRIBUTES
      .map((attribute) => attribute.column)
      .filter((attribute) => toggled.includes(attribute));
    if (!query.trim()) {
      animateSearchInputChange(
        next.length > 0 || selectedLevels.length > 0 ? "Search for Warplets..." : emptySearchPlaceholder,
        "placeholder",
      );
    }
    setSelectedAttributes(next);
  };

  const handleToggleLevel = (level: number) => {
    const next = toggleValue(selectedLevels, level).sort((a, b) => a - b);
    if (!query.trim()) {
      animateSearchInputChange(
        selectedAttributes.length > 0 || next.length > 0 ? "Search for Warplets..." : emptySearchPlaceholder,
        "placeholder",
      );
    }
    setSelectedLevels(next);
  };

  const animateSearchPlaceholderChange = (nextPlaceholder: string) => {
    animateSearchInputChange(nextPlaceholder, "placeholder");
  };

  const handleResetSearch = () => {
    void hapticPrimaryTap();
    const nextExample = getFreshRandomExampleSearch(activeExampleSearch);
    animateSearchPlaceholderChange(`${getRandomExampleDisplayLabel(nextExample)} Warplets...`);
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
    const nextExample = getFreshRandomExampleSearch(activeExampleSearch);
    animateSearchPlaceholderChange(`${getRandomExampleDisplayLabel(nextExample)} Warplets...`);
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

  useEffect(() => {
    if (!dbReady || searchRoute.page !== "listed") {
      listedDeepLinkSignatureRef.current = "";
      return;
    }
    const tokenId = parseWarpletParam(new URLSearchParams(window.location.search).get("warplet") ?? new URLSearchParams(window.location.search).get("tokenId"));
    if (!tokenId) {
      listedDeepLinkSignatureRef.current = "";
      return;
    }
    const signature = `${getSearchRouteStableKey(searchRoute)}:${tokenId}`;
    if (listedDeepLinkSignatureRef.current === signature) return;
    listedDeepLinkSignatureRef.current = signature;

    let cancelled = false;
    loadWarpletDetails(tokenId).then((details) => {
      if (!cancelled && details) setSelectedWarpletDetailsStack([details]);
    });
    return () => {
      cancelled = true;
    };
  }, [dbReady, loadWarpletDetails, searchRoute]);

  const handleOpenRelatedWarpletDetails = useCallback(async (tokenId: number) => {
    const details = await loadWarpletDetails(tokenId);
    if (!details) return;
    setSelectedWarpletDetailsStack((current) => {
      if (current.at(-1)?.id === details.id) return current;
      return [...current, details];
    });
  }, [loadWarpletDetails]);

  const handleCloseTopWarpletDetails = useCallback(() => {
    setSelectedWarpletDetailsStack((current) => {
      const next = current.slice(0, -1);
      if (next.length === 0 && searchRoute.page === "listed") {
        const url = new URL(window.location.href);
        url.searchParams.delete("warplet");
        url.searchParams.delete("tokenId");
        window.history.replaceState(
          { ...(window.history.state ?? {}), searchRoute: getSearchRouteStableKey(searchRoute) },
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
        listedDeepLinkSignatureRef.current = "";
      }
      return next;
    });
  }, [searchRoute]);

  const handleSearchTag = useCallback((tag: string) => {
    setSelectedWarpletDetailsStack([]);
    animateSearchInputChange(tag, "value");
    setIsAllWarpletsMode(false);
    setFavouriteFilterWallet(null);
    setQuery(tag);
    void runSearch(tag, 0, { attributes: selectedAttributes, levels: selectedLevels, favouriteWallet: null });
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [animateSearchInputChange, runSearch, selectedAttributes, selectedLevels]);

  const handleLevelFilter = useCallback((attribute: LevelAttributeColumn, level: number) => {
    const nextAttributes = [attribute];
    const nextLevels = [level];
    setSelectedWarpletDetailsStack([]);
    if (searchRoute.page !== "search") {
      navigateSearchRoute({ page: "search" });
      window.setTimeout(() => {
        window.scrollTo({ top: 0, behavior: "auto" });
        document.documentElement.scrollTo({ top: 0, behavior: "auto" });
        document.body.scrollTo({ top: 0, behavior: "auto" });
      }, 0);
    }
    animateSearchInputChange("Search for Warplets...", "placeholder");
    setQuery("");
    setIsAllWarpletsMode(false);
    setSelectedAttributes(nextAttributes);
    setSelectedLevels(nextLevels);
    setFavouriteFilterWallet(null);
    void runSearch("", 0, { attributes: nextAttributes, levels: nextLevels, favouriteWallet: null });
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [animateSearchInputChange, navigateSearchRoute, runSearch, searchRoute.page]);

  const handleSearchOwnerWallet = useCallback((
    wallet: string,
    options: { focus?: boolean; levels?: number[] } = {},
  ) => {
    const normalizedWallet = wallet.trim();
    if (!normalizedWallet) return;
    const levels = options.levels ?? [];
    setSelectedWarpletDetailsStack([]);
    animateSearchInputChange(normalizedWallet, "value");
    setQuery(normalizedWallet);
    setIsAllWarpletsMode(false);
    setSelectedAttributes([]);
    setSelectedLevels(levels);
    setFavouriteFilterWallet(null);
    setVisibleCount(PAGE_SIZE);
    setOrderBy("rarity");
    setOrderDirection("asc");
    setUserSelectedOrder(false);
    setSearchError("");
    if (dbReady) {
      void runSearch(normalizedWallet, 0, { attributes: [], levels, favouriteWallet: null }, PAGE_SIZE);
    }
    if (options.focus !== false) {
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [animateSearchInputChange, dbReady, runSearch]);

  const handleStatsSearchOwnerWallet = useCallback((wallet: string) => {
    navigateSearchRoute({ page: "search" });
    handleSearchOwnerWallet(wallet, { focus: false });
    window.setTimeout(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
      document.documentElement.scrollTo({ top: 0, behavior: "auto" });
      document.body.scrollTo({ top: 0, behavior: "auto" });
    }, 0);
  }, [handleSearchOwnerWallet, navigateSearchRoute]);

  const handleSearchMyWarplets = useCallback(async () => {
    let wallet = normalizeWalletAddress(activeWallet) ?? normalizeWalletAddress(favouriteIdentityWallet);
    try {
      if (!wallet && isInMiniAppContext && viewerFid) {
        wallet = await loadVerifiedFavouriteList().catch((error) => {
          console.warn("Verified wallet unavailable for My Warplets; using embedded wallet", error);
          return null;
        });
      }
      if (!wallet && isInMiniAppContext) {
        const session = await connectFarcasterWallet();
        wallet = normalizeWalletAddress(session.address);
      }
      if (!wallet) throw new Error("No wallet account is connected.");
      await loadMarketOwnership({ wallet }, true);
      handleStatsSearchOwnerWallet(wallet);
    } catch (error) {
      void hapticError();
      showSearchToast("error", error instanceof Error ? error.message : "Unable to find your wallet.");
    }
  }, [activeWallet, favouriteIdentityWallet, handleStatsSearchOwnerWallet, isInMiniAppContext, loadMarketOwnership, loadVerifiedFavouriteList, showSearchToast, viewerFid]);

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
      if (!query.trim() && isAllWarpletsMode) {
        animateSearchInputChange("All Warplets...", "placeholder");
      }
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
        animateSearchInputChange("My Favourite Warplets...", "placeholder");
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
    animateSearchInputChange,
    ensureActiveFavouriteWallet,
    favouriteFilterWallet,
    isAllWarpletsMode,
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
      const favouriteLabel = activeFavouriteWallet && normalizedWallet === activeFavouriteWallet.toLowerCase()
        ? "My Favourite Warplets..."
        : `${normalizedWallet.slice(0, 6)} Favourite Warplets...`;
      animateSearchInputChange(favouriteLabel, "placeholder");
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
  }, [activeFavouriteWallet, animateSearchInputChange, dbReady, loadFavouriteList, runSearch, showSearchToast]);

  const handleShareWarpletDetails = useCallback((tokenId: number) => {
    let shareUrl: string;
    if (searchRoute.page === "listed") {
      shareUrl = buildListedWarpletHref(searchRoute, tokenId);
      const url = new URL(shareUrl);
      window.history.replaceState(
        { ...(window.history.state ?? {}), searchRoute: getSearchRouteStableKey(searchRoute) },
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
      listedDeepLinkSignatureRef.current = `${getSearchRouteStableKey(searchRoute)}:${tokenId}`;
    } else {
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
      shareUrl = buildSearchHref(shareState);
      updateSearchUrl(shareState, "replace");
    }
    const openSeaUrl = getOpenSeaUrl(tokenId);
    const text = `👀 Check out 10X Warplet #${tokenId}`;
    const links = [shareUrl, openSeaUrl];
    setSharePreview({
      title: `Share 10X Warplet #${tokenId}`,
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
    searchRoute,
    userSelectedOrder,
    updateSearchUrl,
  ]);

  const handleOpenItemTradeShare = useCallback(async ({
    tokenId,
    action,
    amountEth,
    sellerWallet,
    purchaseAmountEth,
    counterparty,
  }: {
    tokenId: number;
    action: TradeShareAction;
    amountEth: number | null;
    sellerWallet?: string | null;
    purchaseAmountEth?: number | null;
    counterparty?: TradeShareCounterparty | null;
  }) => {
    const details = await loadWarpletDetails(tokenId);
    if (!details) return;
    const ethUsdPrice = await fetchEthUsdPrice().catch(() => null);
    setSharePreview(await buildTradeSharePreview({ action, details, amountEth, ethUsdPrice, counterparty, sellerWallet, purchaseAmountEth }));
  }, [loadWarpletDetails]);

  const handleOpenCollectionOfferShare = useCallback((amountEth: number | null, quantity: number) => {
    void fetchEthUsdPrice().catch(() => null).then((ethUsdPrice) => {
      setSharePreview(buildOfferSharePreview({ kind: "collection", amountEth, ethUsdPrice, quantity, tokenId: 760 }));
    });
  }, []);

  const handleOpenTraitOfferShare = useCallback((input: {
    amountEth: number | null;
    quantity: number;
    attributes: LevelAttributeColumn[];
    level: number;
  }) => {
    const selected = LEVEL_ATTRIBUTES.filter((attribute) => input.attributes.includes(attribute.column));
    const traitText = selected.length === LEVEL_ATTRIBUTES.length
      ? `All traits at Level ${input.level}X`
      : `${selected.map((attribute) => `${attribute.emoji} ${attribute.label}`).join(", ")} at Level ${input.level}X`;
    const tokenId = findTraitOfferRepresentativeTokenId(dbRef.current, input.attributes, input.level);
    void fetchEthUsdPrice().catch(() => null).then((ethUsdPrice) => {
      setSharePreview(buildOfferSharePreview({ kind: "trait", amountEth: input.amountEth, ethUsdPrice, quantity: input.quantity, tokenId, traitText }));
    });
  }, []);

  const handleTestShareModal = useCallback(async (id: ShareModalTestId) => {
    const tokenId = 1358;
    const mockSimplePreview = (title: string, text: string, imageTokenId = tokenId): SharePreviewState => {
      const miniAppLink = new URL("/", window.location.origin).toString();
      const openSeaLink = getOpenSeaUrl(imageTokenId);
      const links = [miniAppLink, openSeaLink];
      return {
        title,
        text,
        farcasterText: text,
        twitterPostText: text,
        links,
        images: [
          { src: getWarpletAssetUrl(imageTokenId, "gif"), alt: `${title} test image` },
          { src: getWarpletAssetUrl(imageTokenId, "gif"), alt: "OpenSea test image", sourceUrl: openSeaLink },
        ],
        farcasterEmbeds: [miniAppLink, openSeaLink],
        twitterText: buildTwitterShareText(text, links),
      };
    };
    if (id === "warplet") return setSharePreview(mockSimplePreview("Share 10X Warplet #1358", "👀 Check out 10X Warplet #1358"));
    if (id === "search") return setSharePreview(mockSimplePreview("Share Search Results", "👀 Check out these 42 Green 10X Warplets..."));
    if (id === "airdrop") return setSharePreview(mockSimplePreview("Share your 10X Warplet Airdrop", "🎁 Airdropped: 10X Warplet #1358!"));
    if (id === "bulk-buy") return setSharePreview(mockSimplePreview("Share Your Bulk Buy!", "👀 Purchased 3 more 10X Warplets..."));
    if (id === "collection-offer") return handleOpenCollectionOfferShare(0.001, 3);
    if (id.startsWith("stats-")) {
      const fixture = id === "stats-overview-collection" ? "overview-collection"
        : id === "stats-overview-fair-launch" ? "overview-fair-launch"
        : id === "stats-market-all" ? "market-all"
        : id.startsWith("stats-market-") ? id.slice("stats-".length)
          : id.startsWith("stats-item-activity-") ? id.slice("stats-".length)
          : id.startsWith("stats-activity-") ? id.slice("stats-".length)
            : id === "stats-holder-rank" ? "rank"
              : id === "stats-holders-top10" ? "top10"
                : id === "stats-friends-short" ? "friends-short" : "friends";
      const fixtureUrl = new URL(`/stats/share/fixtures/${fixture}`, window.location.origin).toString();
      const marketMetric = id.startsWith("stats-market-") && id !== "stats-market-all" ? id.slice("stats-market-".length) : null;
      const itemActivity = id.startsWith("stats-item-activity-");
      const activityEvent = itemActivity ? id.slice("stats-item-activity-".length) : id.startsWith("stats-activity-") ? id.slice("stats-activity-".length) : null;
      let farcasterText = id === "stats-overview-collection" ? "10X Warplets — NFT Collection Stats"
        : id === "stats-overview-fair-launch" ? "10X Warplets — Fair Launch Stats"
        : id === "stats-market-all" ? "10X Warplets — Market Stats (30 Days)"
        : marketMetric ? `10X Warplets — ${marketMetric === "floor" ? "Floor Price" : marketMetric.replace(/^./, (character) => character.toUpperCase())} (30 Days)`
          : activityEvent ? `${itemActivity ? "10X Warplet #4512" : "10X Warplets"} — 29 ${activityEvent === "sale" ? "Sales" : activityEvent === "listing" ? "Listings" : activityEvent === "offer" ? "Offers" : "Sends"} (7 Days)`
            : id === "stats-holder-rank" ? "10X Warplets — My holder rank: #1 of 9,992\n\n👀 @x-hunter @luci13.eth"
              : "10X Warplets — Top 10 Holders\n\n🥇 @collector1\n🥈 @collector2\n🥉 @collector3";
      let twitterPostText = farcasterText;
      if (id === "stats-holder-rank") {
        twitterPostText = "10X Warplets — My holder rank: #1 of 9,992\n\n👀 @verified_x_hunter Luci13";
      } else if (id === "stats-friends-top10" || id === "stats-friends-short") {
        farcasterText = "10X Warplets — My Top Ranked Friends\n\n🥇 @collector1\n🥈 @collector2\n🥉 @collector3";
        twitterPostText = "10X Warplets — My Top Ranked Friends\n\n🥇 @verified_x_friend\n🥈 Collector Two\n🥉 0x1234…5678";
      } else if (id === "stats-x-handle") {
        farcasterText = "10X Warplets — Top 10 Holders\n\n🥇 @farcaster_friend";
        twitterPostText = "10X Warplets — Top 10 Holders\n\n🥇 @verified_x_friend";
      } else if (id === "stats-name-fallback") {
        farcasterText = twitterPostText = "10X Warplets — Top 10 Holders\n\n🥇 Display Name Friend";
      } else if (id === "stats-wallet-fallback") {
        farcasterText = twitterPostText = "10X Warplets — Top 10 Holders\n\n🥇 0x1234…5678";
      }
      return setSharePreview({
        title: id === "stats-overview-collection" ? "Share NFT Collection Stats" : id === "stats-overview-fair-launch" ? "Share Fair Launch Stats" : id === "stats-holder-rank" ? "Share Your Rank" : itemActivity ? "Share Item #4512 Activity" : "Share Stats",
        text: farcasterText,
        farcasterText,
        twitterPostText,
        links: [fixtureUrl],
        images: [{ src: getWarpletAssetUrl(760, "gif"), alt: "Stats share fixture", aspectRatio: "square" }],
        farcasterEmbeds: [fixtureUrl],
        twitterText: buildTwitterShareText(twitterPostText, [fixtureUrl]),
        status: "ready",
      });
    }
    if (id.startsWith("perk-")) {
      const subpage = id.slice("perk-".length) as PerksSubpage;
      return setSharePreview(buildPerksSharePreview(subpage));
    }
    if (id === "trait-offer") {
      await ensureDatabaseReady();
      return handleOpenTraitOfferShare({ amountEth: 0.001, quantity: 2, attributes: ["cast_level"], level: 8 });
    }
    const action: TradeShareAction = id === "item-offer" ? "offer" : id === "item-listing" ? "listing" : id === "item-purchase" ? "purchase" : "sale";
    await handleOpenItemTradeShare({
      tokenId,
      action,
      amountEth: 0.001,
      purchaseAmountEth: id === "item-sale" ? 0.0004 : null,
      counterparty: { farcasterUsername: "10xchris.eth", xUsername: "10xchrisx" },
    });
  }, [ensureDatabaseReady, handleOpenCollectionOfferShare, handleOpenItemTradeShare, handleOpenTraitOfferShare]);

  const handleShareAirdropWarplet = useCallback((details: WarpletDetails) => {
    const tokenId = details.id;
    const shareState = { ...EMPTY_SEARCH_URL_STATE, warplet: tokenId };
    const shareUrl = buildSearchHref(shareState);
    const openSeaUrl = getOpenSeaUrl(tokenId);
    const text = `🎁 Airdropped: 10X Warplet #${tokenId}!`;
    const links = [shareUrl, openSeaUrl];
    writeAirdropCongratulationsComplete();
    postSearchCompletion("airdrop_modal");
    updateSearchUrl(shareState, "replace");
    setAirdropCongratulationsDetails(null);
    setAirdropSharePendingNotificationPrompt(true);

    setSharePreview({
      title: "Share your 10X Warplet Airdrop",
      text,
      links,
      images: [
        { src: getWarpletAssetUrl(tokenId, "gif"), alt: `10X Warplet #${tokenId} airdrop share image` },
        {
          src: getWarpletAssetUrl(tokenId, "gif"),
          alt: `OpenSea 10X Warplet #${tokenId} airdrop share image`,
          sourceUrl: openSeaUrl,
        },
      ],
      farcasterEmbeds: [shareUrl, openSeaUrl],
      twitterText: buildTwitterShareText(text, links),
    });
  }, [postSearchCompletion, updateSearchUrl]);

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
    const shareText = isOwnWalletSearch ? "👀 Checkout my 10X Warplets..." : searchResultsShareTitle;
    const openSeaCollectionUrl = isOwnWalletSearch && activeWallet
      ? `https://opensea.io/${activeWallet.toLowerCase()}?collectionSlugs=10xwarplets`
      : marketOrderShareMeta?.openSeaUrl ?? OPENSEA_COLLECTION_URL;
    const links = [shareUrl, openSeaCollectionUrl];

    setSharePreview({
      title: "Share Search Results",
      text: shareText,
      links,
      images: [
        { src: getWarpletAssetUrl(firstWarpletId, "gif"), alt: `10X Warplet #${firstWarpletId} share image` },
        {
          src: "/menu/menu-opensea-10xwarplets.jpg",
          alt: "10X Warplets OpenSea collection share image",
          sourceUrl: openSeaCollectionUrl,
          waitForResolvedSource: true,
        },
      ],
      farcasterEmbeds: [shareUrl, openSeaCollectionUrl],
      twitterText: buildTwitterShareText(shareText, links),
    });
  }, [
    activeExampleSearch,
    activeWallet,
    displayedResults,
    displayedTotalResults,
    favouriteFilterWallet,
    isAllWarpletsMode,
    isOwnWalletSearch,
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
    trackAppEvent("share_started", { surface: resolveAppSurface(isInMiniAppContext), channel: "farcaster", route: window.location.pathname });
    beginShareCelebrationWatch();
    composeFarcasterPost(
      buildSharePostText(sharePreview.farcasterText ?? sharePreview.text, sharePreview.links),
      sharePreview.farcasterEmbeds,
    )
      .then(() => {
        completeShareCelebration();
      })
      .catch((error) => {
        cancelShareCelebration();
        console.error("Failed to compose share cast:", error);
      });
  }, [beginShareCelebrationWatch, cancelShareCelebration, completeShareCelebration, isInMiniAppContext, sharePreview]);

  const handleSharePreviewTwitter = useCallback(() => {
    if (!sharePreview) return;
    trackAppEvent("share_started", { surface: resolveAppSurface(isInMiniAppContext), route: window.location.pathname });
    const twitterText = sharePreview.twitterPostText
      ? buildTwitterShareText(sharePreview.twitterPostText, sharePreview.links)
      : sharePreview.twitterText;
    const intentUrl = `https://x.com/intent/post?${new URLSearchParams({
      text: twitterText,
      url: "",
    }).toString()}`;
    beginShareCelebrationWatch();
    openAppUrl(intentUrl).catch((error) => {
      cancelShareCelebration();
      console.error("Failed to open X share intent:", error);
    });
  }, [beginShareCelebrationWatch, cancelShareCelebration, isInMiniAppContext, sharePreview]);

  const handleCreateStatsShare = useCallback(async (request: StatsShareRequest, retry = false) => {
    statsShareRequestRef.current = request;
    if (!retry) statsShareIdRef.current = null;
    setSharePreview({
      title: "Share Stats",
      text: "Preparing your Stats snapshot…",
      links: [],
      images: [],
      farcasterEmbeds: [],
      twitterText: "",
      status: "preparing",
      statusMessage: retry ? "Rendering the snapshot again…" : "Rendering your Stats snapshot…",
    });
    try {
      const endpoint = retry && statsShareIdRef.current
        ? `/api/stats/shares/${encodeURIComponent(statsShareIdRef.current)}/render`
        : "/api/stats/shares";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        credentials: "same-origin",
        body: retry && statsShareIdRef.current ? undefined : JSON.stringify(request),
      });
      const responseBody = await response.text();
      let result: StatsShareCreateResponse & { error?: string; message?: string };
      try {
        result = responseBody ? JSON.parse(responseBody) as StatsShareCreateResponse & { error?: string; message?: string } : {} as StatsShareCreateResponse;
      } catch {
        throw new Error(`Stats snapshot service returned an invalid response (${response.status}).`);
      }
      if (!responseBody) throw new Error(`Stats snapshot service returned an empty response (${response.status}).`);
      if (result.snapshot?.id) statsShareIdRef.current = result.snapshot.id;
      if (!response.ok || !result.snapshot?.imageReady) {
        throw new Error(result.renderError || result.message || result.error || `Snapshot rendering failed (${response.status})`);
      }
      const launchUrl = new URL(result.snapshot.launchPath, window.location.origin).href;
      const imageUrl = resolveShareUrl(result.imageUrl).href;
      const farcasterPostText = `${result.snapshot.farcasterText}\n\n${launchUrl}`;
      setSharePreview({
        title: result.snapshot.title,
        text: farcasterPostText,
        farcasterText: farcasterPostText,
        twitterPostText: result.snapshot.twitterText,
        links: [launchUrl],
        images: [{ src: imageUrl, alt: result.snapshot.title, aspectRatio: "square" }],
        farcasterEmbeds: [launchUrl, imageUrl],
        twitterText: buildTwitterShareText(result.snapshot.twitterText, [launchUrl]),
        status: "ready",
      });
    } catch (error) {
      setSharePreview({
        title: "Share Stats",
        text: "Your Stats snapshot is not ready yet.",
        links: [],
        images: [],
        farcasterEmbeds: [],
        twitterText: "",
        status: "error",
        statusMessage: error instanceof Error ? error.message : "The Stats snapshot could not be rendered.",
      });
    }
  }, []);

  const handleRetryStatsShare = useCallback(() => {
    if (statsShareRequestRef.current) void handleCreateStatsShare(statsShareRequestRef.current, true);
  }, [handleCreateStatsShare]);

  const handleCloseSharePreview = useCallback(() => {
    setSharePreview(null);
    if (airdropSharePendingNotificationPrompt) {
      setAirdropSharePendingNotificationPrompt(false);
      openPendingNotificationPrompt();
    }
  }, [airdropSharePendingNotificationPrompt, openPendingNotificationPrompt]);

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
      const merged = preservePendingConfirmedPurchases(mergeTokenSnapshot(current, snapshot, tokenId));
      writeCachedMarketSnapshot(merged);
      return merged;
    });
  }, [preservePendingConfirmedPurchases]);

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
        traitOffers: { ...(current?.traitOffers ?? {}) },
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
        traitOffers: { ...(current?.traitOffers ?? {}) },
        sales: { ...(current?.sales ?? {}) },
        owners: { ...(current?.owners ?? {}) },
      };
      writeCachedMarketSnapshot(next);
      return next;
    });
    setItemOffersRevision((current) => current + 1);
  }, []);

  const handleUpsertListing = useCallback((tokenId: number, listing: MarketSnapshot["listings"][string]) => {
    pendingConfirmedPurchasesRef.current.delete(String(tokenId));
    setMarketSnapshot((current) => {
      const key = String(tokenId);
      const next: MarketSnapshot = {
        version: "opensea-market-v1",
        generatedAt: new Date().toISOString(),
        maxAgeSeconds: current?.maxAgeSeconds ?? 600,
        collection: current?.collection ?? { floor: null, topOffer: null },
        listings: { ...(current?.listings ?? {}), [key]: listing },
        offers: { ...(current?.offers ?? {}) },
        traitOffers: { ...(current?.traitOffers ?? {}) },
        sales: { ...(current?.sales ?? {}) },
        owners: { ...(current?.owners ?? {}) },
      };
      writeCachedMarketSnapshot(next);
      return next;
    });
  }, []);

  const handleListedCreateListing = useCallback(async (tokenId: number, price: string): Promise<boolean> => {
    const priceRaw = decimalEthToWeiString(price);
    if (!priceRaw || BigInt(priceRaw) < 10000n) {
      void hapticError();
      showSearchToast("error", "Enter a listing price of at least 0.00000000000001 ETH.", { manualClose: true });
      return false;
    }
    const actionId = crypto.randomUUID();
    try {
      void hapticPrimaryTap();
      const { provider, account } = await getCollectionOfferProviderAndAccount();
      const expectedOwner = marketSnapshot?.owners?.[String(tokenId)]?.wallet ?? null;
      if (expectedOwner && !walletMatches(expectedOwner, account)) {
        throw new Error("Connect the wallet that owns this Warplet to list it.");
      }
      const prepare = await fetch("/api/warplet-trade/listing/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionId,
          fid: viewerFid,
          tokenId,
          wallet: account,
          priceRaw,
          durationSeconds: DEFAULT_TRADE_DURATION_SECONDS,
        }),
      });
      const prepared = await prepare.json().catch(() => ({})) as { actions?: unknown; message?: string };
      if (!prepare.ok) throw new Error(prepared.message || `Listing prepare failed (${prepare.status})`);
      if (!getExternalWalletReviewName(provider)) {
        showSearchToast("neutral", "Check your wallet to confirm the listing...", { minMs: 5000 });
      }
      const signed = await executeOpenSeaActions(provider, account, prepared.actions);
      const submit = await fetch("/api/warplet-trade/listing/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId, fid: viewerFid, tokenId, wallet: account, priceRaw, payload: signed.payload }),
      });
      const submitted = await submit.json().catch(() => ({})) as {
        message?: string;
        result?: { order_hash?: unknown; orderHash?: unknown; protocol_address?: unknown };
      };
      if (!submit.ok) throw new Error(submitted.message || `Listing submit failed (${submit.status})`);
      const signedPayload = signed.payload && typeof signed.payload === "object"
        ? signed.payload as Record<string, unknown>
        : null;
      const orderHash = typeof submitted.result?.order_hash === "string"
        ? submitted.result.order_hash
        : typeof submitted.result?.orderHash === "string" ? submitted.result.orderHash : null;
      const protocolAddress = typeof submitted.result?.protocol_address === "string"
        ? submitted.result.protocol_address
        : typeof signedPayload?.protocol_address === "string" ? signedPayload.protocol_address : null;
      const listing: MarketSnapshot["listings"][string] = {
        eth: parseTradeAmount(price),
        at: new Date().toISOString(),
        rawAmount: priceRaw,
        decimals: 18,
        currencySymbol: "ETH",
        tokenAddress: NATIVE_TOKEN_ADDRESS,
        orderHash,
        protocolAddress,
        seller: account,
      };
      handleUpsertListing(tokenId, listing);
      void hapticSuccess();
      showTradeConfetti();
      showSearchToast("success", `Warplet #${tokenId} successfully listed`, { minMs: 5000 });
      void handleOpenItemTradeShare({ tokenId, action: "listing", amountEth: listing.eth });
      return true;
    } catch (error) {
      void hapticError();
      showSearchToast("error", error instanceof Error ? error.message : "Item listing failed.", { manualClose: true });
      return false;
    }
  }, [getCollectionOfferProviderAndAccount, handleOpenItemTradeShare, handleUpsertListing, marketSnapshot?.owners, showSearchToast, viewerFid]);

  const handleApplyPurchase = useCallback((tokenId: number, update: OptimisticPurchaseUpdate) => {
    const buyerWallet = normalizeWalletAddress(update.buyerWallet);
    const buyerFid = Number.isInteger(update.buyerFid) && Number(update.buyerFid) > 0
      ? Number(update.buyerFid)
      : null;
    const buyerOwnershipKeys = new Set([
      buyerWallet ? `wallet:${buyerWallet}` : "",
      buyerFid ? `fid:${buyerFid}` : "",
    ].filter(Boolean));

    // A completed sale must invalidate the seller's focused ownership caches as
    // well as adding the token to the buyer. Otherwise navigating to Search can
    // merge a cached seller owner over the optimistic transfer and resurrect the
    // sold Warplet in the "We Found You" card.
    for (const [key, cachedTokenIds] of ownershipTokenIdsRef.current) {
      const withoutTransferredToken = cachedTokenIds.filter((cachedTokenId) => cachedTokenId !== tokenId);
      ownershipTokenIdsRef.current.set(
        key,
        buyerOwnershipKeys.has(key)
          ? Array.from(new Set([...withoutTransferredToken, tokenId])).sort((left, right) => left - right)
          : withoutTransferredToken,
      );
    }
    for (const key of buyerOwnershipKeys) {
      const cachedTokenIds = ownershipTokenIdsRef.current.get(key) ?? [];
      ownershipTokenIdsRef.current.set(key, Array.from(new Set([...cachedTokenIds, tokenId])).sort((left, right) => left - right));
    }
    for (const [key, cachedOwners] of ownershipOwnersRef.current) {
      const nextOwners = { ...cachedOwners };
      delete nextOwners[String(tokenId)];
      ownershipOwnersRef.current.set(key, nextOwners);
    }
    const buyerIsViewer = Boolean(buyerWallet && walletMatches(buyerWallet, activeWallet));
    setListedOwnedTokenIds((current) => buyerIsViewer
      ? Array.from(new Set([...current, tokenId])).sort((left, right) => left - right)
      : current.filter((ownedTokenId) => ownedTokenId !== tokenId));
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
      for (const buyerKey of buyerOwnershipKeys) {
        ownershipOwnersRef.current.set(buyerKey, {
          ...(ownershipOwnersRef.current.get(buyerKey) ?? {}),
          [key]: nextOwner,
        });
      }
      pendingConfirmedPurchasesRef.current.set(key, {
        owner: nextOwner,
        sale: update.sale,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      const next: MarketSnapshot = {
        version: "opensea-market-v1",
        generatedAt: now,
        maxAgeSeconds: current?.maxAgeSeconds ?? 600,
        collection: current?.collection ?? { floor: null, topOffer: null },
        listings: { ...(current?.listings ?? {}) },
        offers: { ...(current?.offers ?? {}) },
        traitOffers: { ...(current?.traitOffers ?? {}) },
        sales: { ...(current?.sales ?? {}), [key]: update.sale },
        owners: { ...(current?.owners ?? {}), [key]: nextOwner },
      };
      delete next.listings[key];
      writeCachedMarketSnapshot(next);
      return next;
    });
  }, [activeWallet, viewerProfile]);

  const handleListedBulkBuy = useCallback(async (rows: ListedWarpletRow[]) => {
    if (rows.length === 0) return [];
    if (rows.length > MAX_SWEEP_ITEMS) {
      showSearchToast("error", `Bulk buys are limited to ${MAX_SWEEP_ITEMS} NFTs`, { manualClose: true });
      return [];
    }
    try {
      void hapticPrimaryTap();
      const { provider, account } = await getCollectionOfferProviderAndAccount();
      const prepared = await Promise.all(rows.map(async (row) => {
        const listing = row.market.listing;
        if (!listing) throw new Error(`Warplet #${row.warplet.id} is no longer listed`);
        const actionId = crypto.randomUUID();
        const response = await fetch("/api/warplet-trade/buy/prepare", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actionId,
            fid: viewerFid,
            tokenId: row.warplet.id,
            wallet: account,
            expectedOrderHash: listing.orderHash,
            expectedRawAmount: listing.rawAmount,
          }),
        });
        const payload = await response.json() as {
          status?: string;
          chainIdHex?: string;
          fulfillment?: unknown;
          state?: FreshTradeState;
          message?: string;
        };
        if (response.status === 409 || payload.status === "mismatch") {
          throw new Error(`Warplet #${row.warplet.id} changed price or is no longer available`);
        }
        if (!response.ok) throw new Error(payload.message || `Bulk buy preparation failed (${response.status})`);
        const transaction = extractFulfillmentTransaction(payload.fulfillment);
        if (!transaction) throw new Error(`OpenSea did not return a transaction for #${row.warplet.id}`);
        return { actionId, row, listing: payload.state?.listing ?? listing, transaction, chainIdHex: payload.chainIdHex };
      }));

      await ensureBaseChain(provider, prepared[0]?.chainIdHex);
      const transactions = prepared.map((item) => item.transaction);
      const chainIdHex = prepared[0]?.chainIdHex ?? undefined;
      const useAtomicBatch = transactions.length > 1 && await supportsAtomicBatchTransactions(provider, account, chainIdHex);
      const hash = transactions.length === 1
        ? await sendPreparedTransaction(provider, account, transactions[0])
        : useAtomicBatch
          ? (await sendPreparedTransactionsAtomic(provider, account, transactions, chainIdHex)).transactionHash
          : await sendPreparedTransaction(provider, account, combinePreparedOpenSeaTransactions(transactions));
      const receipt = await waitForTransactionReceipt(hash);
      const transferredTokenIds = getPurchasedWarpletTransferIds(receipt, account);
      const purchased = prepared.filter((item) => transferredTokenIds.has(item.row.warplet.id));
      if (purchased.length === 0) throw new Error("Bulk transaction confirmed without transferring any selected Warplets");
      if (useAtomicBatch && purchased.length !== prepared.length) {
        throw new Error("Atomic purchase receipt did not contain every selected Warplet transfer");
      }
      const now = new Date().toISOString();
      for (const item of purchased) {
        const listing = item.listing;
        const sale: MarketSnapshot["sales"][string] = {
          eth: listing?.eth ?? null,
          at: now,
          rawAmount: listing?.rawAmount ?? null,
          decimals: listing?.decimals ?? null,
          currencySymbol: listing?.currencySymbol ?? null,
          tokenAddress: listing?.tokenAddress ?? null,
          txHash: hash,
          seller: listing?.seller ?? null,
        };
        handleApplyPurchase(item.row.warplet.id, { buyerWallet: account, buyerFid: viewerFid, sale });
      }
      void (async () => {
        for (let index = 0; index < purchased.length; index += 5) {
          const batch = purchased.slice(index, index + 5);
          await Promise.allSettled(batch.map((item) =>
            fetch("/api/warplet-trade/log", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                actionId: item.actionId,
                actionName: "buy",
                status: "confirmed",
                phase: "confirmed",
                fid: viewerFid,
                tokenId: item.row.warplet.id,
                walletFrom: account,
                walletTo: item.listing?.seller ?? null,
                orderHash: item.listing?.orderHash ?? null,
                transactionHash: hash,
                expectedPriceRaw: item.listing?.rawAmount ?? null,
                actualPriceRaw: item.listing?.rawAmount ?? null,
              }),
            }),
          ));
        }
      })();
      void hapticSuccess();
      showTradeConfetti();
      window.setTimeout(() => {
        void hapticSuccess();
        showTradeConfetti();
      }, 400);
      window.setTimeout(() => {
        void hapticSuccess();
        showTradeConfetti();
      }, 800);
      if (purchased.length === prepared.length) {
        showSearchToast("success", `Successfully purchased ${purchased.length.toLocaleString("en-US")} NFTs`, { minMs: 6000 });
      } else {
        void hapticWarning();
        showSearchToast(
          "warning",
          `Purchased ${purchased.length.toLocaleString("en-US")} of ${prepared.length.toLocaleString("en-US")} selected NFTs; unavailable items remain in your sweep list`,
          { minMs: 8000 },
        );
      }
      const purchasedCount = purchased.length;
      const bulkBuyShareState: SearchUrlState = {
        ...EMPTY_SEARCH_URL_STATE,
        search: account.toLowerCase(),
        order: "recently-sold",
        dir: "desc",
      };
      const firstPurchasedTokenId = purchased[0].row.warplet.id;
      const walletResultTokenIds = new Set(
        Object.entries(marketSnapshot?.owners ?? {})
          .filter(([, owner]) => walletMatches(owner.wallet, account))
          .map(([tokenId]) => Number(tokenId))
          .filter((tokenId) => Number.isInteger(tokenId) && tokenId > 0),
      );
      purchased.forEach((item) => walletResultTokenIds.add(item.row.warplet.id));
      const bulkBuySearchUrl = appendSearchShareParams(
        buildSearchHref(bulkBuyShareState),
        firstPurchasedTokenId,
        walletResultTokenIds.size,
      );
      const openSeaWalletUrl = `https://opensea.io/${account.toLowerCase()}?collectionSlugs=10xwarplets`;
      const bulkBuyShareText = `👀 Purchased ${purchasedCount.toLocaleString("en-US")} more 10X ${purchasedCount === 1 ? "Warplet" : "Warplets"}...`;
      const links = [bulkBuySearchUrl, openSeaWalletUrl];
      setSharePreview({
        title: "Share Your Bulk Buy!",
        text: bulkBuyShareText,
        links,
        images: [
          {
            src: getWarpletAssetUrl(firstPurchasedTokenId, "gif"),
            alt: `10X Warplet #${firstPurchasedTokenId} bulk buy share image`,
          },
          {
            src: "/menu/menu-opensea-10xwarplets.jpg",
            alt: "OpenSea 10X Warplets wallet collection share image",
            sourceUrl: openSeaWalletUrl,
            waitForResolvedSource: true,
          },
        ],
        farcasterEmbeds: [bulkBuySearchUrl, openSeaWalletUrl],
        twitterText: buildTwitterShareText(bulkBuyShareText, links),
      });
      return purchased.map((item) => item.row.warplet.id);
    } catch (error) {
      void hapticError();
      showSearchToast("error", error instanceof Error ? error.message : "Bulk buy failed", { manualClose: true });
      throw error;
    }
  }, [getCollectionOfferProviderAndAccount, handleApplyPurchase, marketSnapshot, showSearchToast, viewerFid]);

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
      if (ownerWallet) {
        void loadMarketOwnership({ wallet: ownerWallet }).catch((error) => {
          console.warn(`Failed to load owner holdings for Warplet #${details.id}:`, error);
        });
      }
    }
  }, [ensureFavouriteListLoaded, loadMarketOwnership, marketSnapshot, selectedWarpletDetailsStack]);

  useEffect(() => {
    if (!canLoadMore || isSearching || !hasActiveSearchOrFilter) return;
    const target = loadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          setVisibleCount((current) => Math.min(current + PAGE_SIZE, totalResults));
        }
      },
      { rootMargin: "600px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [canLoadMore, hasActiveSearchOrFilter, isSearching, totalResults, visibleCount]);

  useEffect(() => {
    if (
      searchRoute.page !== "search" ||
      isSearching ||
      results.length >= totalResults ||
      visibleCount <= results.length ||
      !submittedQuery
    ) return;
    void runSearch(submittedQuery, results.length, undefined, PAGE_SIZE);
  }, [isSearching, results.length, runSearch, searchRoute.page, submittedQuery, totalResults, visibleCount]);

  const handleReturnToTop = useCallback(() => {
    void hapticPrimaryTap();
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.documentElement.scrollTo({ top: 0, behavior: "smooth" });
    document.body.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const siwfConnected = Boolean(!isInMiniAppContext && siwfViewerProfile?.fid);
  const miniAppIdentityConnected = Boolean(isInMiniAppContext && viewerProfile?.fid);
  const miniAppWalletConnected = Boolean(isInMiniAppContext && activeWallet);
  const webWalletConnected = Boolean(!isInMiniAppContext && activeWallet);
  const identityConnected = miniAppIdentityConnected || siwfConnected;
  const headerAccountConnected = identityConnected || miniAppWalletConnected || webWalletConnected;
  const headerAccountProfile = isInMiniAppContext ? viewerProfile : siwfViewerProfile;
  const headerAccountUsername = headerAccountProfile?.username?.trim() || null;
  const headerAccountLabel = headerAccountUsername
    ? `Connected as @${headerAccountUsername}`
    : activeWallet
      ? `Connected wallet ${formatShortWallet(activeWallet)}`
      : "Connected Farcaster account";
  const walletAvatarUrl = activeWallet ? (walletProfile?.avatarUrl ?? getWalletIdenticonDataUrl(activeWallet)) : null;
  const identityAvatarUrl = identityConnected ? (headerAccountProfile?.pfpUrl?.trim() || null) : null;
  const identityMenuLabel = identityConnected
    ? (headerAccountUsername ? `@${headerAccountUsername}` : "Farcaster identity")
    : null;
  const routeTitle = getSearchRouteTitle(searchRoute);
  const headerTitle = isMenuRoute
    ? getHeaderTitle(WARPLETS_APP_SLUG, true)
    : getHeaderTitle(WARPLETS_APP_SLUG, false);
  const isPrimaryNavigationRoute = !isMenuRoute &&
    (searchRoute.page === "listed" || searchRoute.page === "offers" || searchRoute.page === "perks" || searchRoute.page === "stats");
  const headerCanGoBack = !isPrimaryNavigationRoute && (canGoBack || (!isMenuRoute && searchRoute.page !== "search"));
  const headerCloseKey = isMenuRoute ? "menu" : getSearchRouteStableKey(searchRoute);
  const coverAppWhileResolvingOnboarding = shouldCoverAppWhileResolvingOnboarding({
    onboardingComplete,
    showOnboarding,
    miniAppContextKnown,
    isInMiniAppContext,
    viewerFid,
    searchCompletionStatusLoaded,
    onboardingDecisionTimedOut,
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (selectedWarpletDetails) {
      const username = selectedWarpletDetails.username.trim().replace(/^@/, "");
      document.title = `10X Warplet #${selectedWarpletDetails.id} @${username}`;
      return;
    }
    document.title = routeTitle;
  }, [routeTitle, selectedWarpletDetails]);

  return (
    <MiniAppShell>
      {coverAppWhileResolvingOnboarding && (
        <div className="fixed inset-0 z-[105] flex flex-col items-center justify-center gap-4 bg-black px-6 text-center" aria-busy="true" aria-live="polite">
          <img src="/icon_search.png" alt="10X Warplets" className="h-24 w-24 animate-pulse rounded-2xl" />
          <Text className="text-sm" style={{ color: "#00FF00" }}>Loading 10X Warplets…</Text>
        </div>
      )}
      {!isInMiniAppContext && (
        <PwaControls
          onMessage={(kind, message) => showSearchToast(kind, message, { manualClose: kind !== "success" })}
        />
      )}
      {!isInMiniAppContext && (
        <WebConnectModal
          open={webConnectOpen}
          onClose={() => { setWebConnectOpen(false); setWebConnectIdentityError(null); }}
          identityError={webConnectIdentityError}
          onClearIdentityError={() => setWebConnectIdentityError(null)}
          identityConnected={siwfConnected}
          onWalletConnected={(address) => {
            void hapticSuccess();
            showTradeConfetti();
            showSearchToast("success", `Wallet ${formatShortWallet(address)} connected successfully.`);
          }}
          farcasterControl={<FarcasterSignInControl connected={siwfConnected} onAuthenticated={handleWebFarcasterAuthenticated} onDisconnect={handleWebFarcasterDisconnect} onError={handleWebFarcasterError} />}
        />
      )}
      {searchToast && (
        <TradeToastView toast={searchToast} exiting={searchToastExiting} onClose={closeSearchToast} />
      )}
      {showOnboarding && (
        <OnboardingCarousel key={onboardingSessionKey} onDone={handleCompleteOnboarding} />
      )}
      {airdropCongratulationsDetails && canPresentAirdrop(showOnboarding) && (
        <AirdropCongratulationsModal
          details={airdropCongratulationsDetails}
          onShare={() => handleShareAirdropWarplet(airdropCongratulationsDetails)}
          onPreviewRevealComplete={() => showTradeConfetti()}
        />
      )}
      {showAddAppPrompt && (
        <NotificationsPromptModal
          notificationsOnlyPrompt={notificationsOnlyPrompt}
          onConfirm={handleConfirmAddAppPrompt}
        />
      )}
      <div className="relative z-30 w-full">
        <MiniAppHeader
          appSlug={WARPLETS_APP_SLUG}
          title={headerTitle}
          canGoBack={headerCanGoBack}
          onBack={handleHeaderBack}
          onLogo={actions.openHubRoot}
          onMenu={actions.openMenu}
          onTitleMenu={handleHeaderTitleMenuToggle}
          rightAccessory={
            <SearchHeaderAccountControl
              connected={headerAccountConnected}
              walletConnected={Boolean(activeWallet)}
              walletAddress={activeWallet}
              walletAvatarUrl={walletAvatarUrl}
              identityConnected={identityConnected}
              identityLabel={identityMenuLabel}
              identityAvatarUrl={identityAvatarUrl}
              simplifiedFarcaster={isInMiniAppContext}
              accountLabel={headerAccountLabel}
              showDisconnect={!isInMiniAppContext && Boolean(identityConnected || activeWallet)}
              open={headerAccountMenuAnchor !== null}
              centered={headerAccountMenuAnchor === "title"}
              onOpenChange={handleHeaderAccountMenuOpenChange}
              onAvatarToggle={handleHeaderAvatarMenuToggle}
              closeKey={headerCloseKey}
              onConnectWallet={handleHeaderConnectWallet}
              onOpenSpreadsheet={handleHeaderOpenSpreadsheet}
              onOpenAppTesting={() => navigateSearchRoute({ page: "app-testing" })}
              onOpenWarpmoji={() => navigateSearchRoute({ page: "warpmoji" })}
              onViewMyWarplets={activeWallet || isInMiniAppContext ? () => { void handleSearchMyWarplets(); } : undefined}
              onViewOnboarding={handleHeaderViewOnboarding}
              onEnableNotifications={isLikelyBaseAppBrowser() ? undefined : handleHeaderEnableNotifications}
              onInstallWebApp={!isInMiniAppContext && !isStandaloneDisplay() && !isEmbeddedWebView() && !isLikelyBaseAppBrowser()
                ? () => window.dispatchEvent(new CustomEvent("10x:open-pwa-install"))
                : undefined}
              onDisconnect={handleHeaderDisconnect}
            />
          }
        />
        {!isMenuRoute && (
          <SearchPageNavigation
            route={searchRoute}
            lastOffersSubpage={lastOffersSubpage}
            lastPerksSubpage={lastPerksSubpage}
            lastStatsSubpage={lastStatsSubpage}
            lastListedLevel={lastListedLevel}
            onNavigate={navigateSearchRoute}
          />
        )}

        {isMenuRoute ? (
          <MiniAppMenuPage appSlug={WARPLETS_APP_SLUG} />
        ) : searchRoute.page === "app-testing" ? (
          <AppTestingPage onTriggerShare={(id) => { void handleTestShareModal(id); }} />
        ) : searchRoute.page === "warpmoji" ? (
          <Suspense fallback={<p className="p-6 text-center text-sm text-[#00FF00]">Loading Warpmoji…</p>}><LazyWarpmojiPage sessionToken={actionSessionToken} searchWarplets={searchWarpmojiWarplets} /></Suspense>
        ) : searchRoute.page === "listed" ? (
          <ListedPage
            db={dbRef.current}
            level={searchRoute.listedLevel}
            scope={listedScope}
            listedWarplets={listedWarplets}
            ownedWarplets={listedOwnedWarplets}
            marketSnapshot={marketSnapshot}
            connectedWallet={activeWallet}
            favouriteTokenIds={activeFavouriteTokenIdSet}
            loading={listedWarpletsLoading}
            loadError={listedWarpletsError}
            marketRefreshError={marketRefreshError}
            onScopeChange={handleListedScopeChange}
            onLevelChange={(level) => navigateSearchRoute({ page: "listed", listedLevel: level })}
            onOpenWarpletDetails={handleOpenWarpletDetails}
            onToggleFavourite={handleToggleFavourite}
            onRefreshMarket={refreshListedMarket}
            onListWarplet={handleListedCreateListing}
            onBulkBuy={handleListedBulkBuy}
          />
        ) : searchRoute.page === "stats" ? (
          <StatsPage
            subpage={searchRoute.statsPage}
            range={searchRoute.statsRange ?? "all"}
            detail={searchRoute.statsDetail}
            onRangeChange={(range) => navigateSearchRoute({
              page: "stats",
              statsPage: searchRoute.statsPage,
              statsRange: range,
              statsDetail: searchRoute.statsDetail,
            })}
            connectedWallet={searchRoute.statsPage === "holders" ? readStatsDeepLinkWallet() ?? activeWallet : activeWallet}
            friendFilterWallet={searchRoute.statsPage === "holders" ? readStatsDeepLinkWallet() : null}
            favouriteWallet={activeFavouriteWallet}
            favouriteTokenIds={activeFavouriteTokenIds}
            viewerFid={viewerFid}
            actionSessionToken={actionSessionToken}
            onSearchWallet={handleStatsSearchOwnerWallet}
            onOpenWarpletDetails={handleOpenWarpletDetails}
            isInMiniAppContext={isInMiniAppContext}
            onShareStats={(request) => void handleCreateStatsShare(request)}
            onResetFriendFilter={() => navigateSearchRoute({ page: "stats", statsPage: "holders" })}
          />
        ) : searchRoute.page === "perks" ? (
          <Suspense fallback={<div className="mx-auto w-full max-w-md px-4 py-12 text-center text-xs font-black text-[#00FF00]">Loading Perks...</div>}>
            <LazyPerksPage
              subpage={searchRoute.perksPage}
              connectedWallet={activeWallet}
              viewerFid={viewerFid}
              actionSessionToken={actionSessionToken}
              viewerProfile={headerAccountProfile}
              onSearchWallet={handleStatsSearchOwnerWallet}
              onOpenWarpletDetails={handleOpenWarpletDetails}
              onShare={(subpage) => setSharePreview(buildPerksSharePreview(subpage))}
            />
          </Suspense>
        ) : searchRoute.page === "offers" && searchRoute.offersPage === "collection" ? (
          <CollectionOffersPage
            connectedWallet={activeWallet}
            viewerFid={viewerFid}
            isInMiniAppContext={isInMiniAppContext}
            getProviderAndAccount={getCollectionOfferProviderAndAccount}
            showToast={showSearchToast}
            onShareOffer={handleOpenCollectionOfferShare}
          />
        ) : searchRoute.page === "offers" && searchRoute.offersPage === "trait" ? (
          <TraitOffersPage
            connectedWallet={activeWallet}
            showBaseWalletWarning={walletController.session?.connectorId === "base-account" && isBaseAppContext()}
            viewerFid={viewerFid}
            isInMiniAppContext={isInMiniAppContext}
            getProviderAndAccount={getCollectionOfferProviderAndAccount}
            showToast={showSearchToast}
            onMarketChanged={() => refreshMarketSnapshot(true)}
            onShareOffer={handleOpenTraitOfferShare}
            onOpenConnect={() => {
              trackAppEvent("connect_opened", { surface: "web", route: window.location.pathname, trigger: "trait_offer_base_warning" });
              setWebConnectOpen(true);
            }}
          />
        ) : searchRoute.page === "offers" && searchRoute.offersPage === "item" ? (
          <ItemOffersPage
            db={dbRef.current}
            favouriteTokenIds={activeFavouriteTokenIds}
            connectedWallet={activeWallet}
            viewerFid={viewerFid}
            isInMiniAppContext={isInMiniAppContext}
            getProviderAndAccount={getCollectionOfferProviderAndAccount}
            showToast={showSearchToast}
            onOpenWarpletDetails={handleOpenWarpletDetails}
            onApplyPurchase={handleApplyPurchase}
            refreshRevision={itemOffersRevision}
            onShareTrade={handleOpenItemTradeShare}
          />
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
                value={displayedSearchValue}
                onChange={(event) => {
                  searchAnimationRevealAtRef.current = 0;
                  setSearchPlaceholderAnimation(null);
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
                placeholder={searchPlaceholderAnimation?.mode === "value" ? "" : displayedSearchPlaceholder}
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
                      className="cursor-pointer font-bold text-[#00FF00] underline decoration-[#00FF00] underline-offset-2 hover:text-[#8bbf8b] hover:decoration-[#00FF00]"
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
      <SiteFooter />
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
            viewerWallet={activeWallet}
            viewerUsername={headerAccountProfile?.username ?? null}
            actionSessionToken={actionSessionToken}
            onMergeMarketSnapshot={handleMergeMarketSnapshot}
            onClearMarketSide={handleClearMarketSide}
            onUpsertListing={handleUpsertListing}
            onUpsertItemOffer={handleUpsertItemOffer}
            onApplyPurchase={handleApplyPurchase}
            onOpenTradeSharePreview={setSharePreview}
            stackIndex={index}
            isInMiniAppContext={isInMiniAppContext}
            onShareStats={(request) => void handleCreateStatsShare(request)}
          />
        );
      })}
      {sharePreview && (
        <SharePreviewModal
          preview={sharePreview}
          onClose={handleCloseSharePreview}
          onCopySuccess={() => showSearchToast("neutral", "Post has been copied to your clipboard.")}
          onImageCopySuccess={(sourceMimeType) => showSearchToast(
            "neutral",
            sourceMimeType === "image/gif"
              ? "Image has been copied to your clipboard as a static PNG image."
              : "Image has been copied to your clipboard.",
          )}
          onImageCopyError={(message) => showSearchToast("error", message, { manualClose: true })}
          onImageDownloadSuccess={() => showSearchToast("neutral", "Image opened in your browser. Use the browser controls to save it.")}
          onShareFarcaster={handleSharePreviewFarcaster}
          onShareTwitter={handleSharePreviewTwitter}
          onRetry={sharePreview.status === "error" && statsShareRequestRef.current ? handleRetryStatsShare : undefined}
        />
      )}
    </MiniAppShell>
  );
}
