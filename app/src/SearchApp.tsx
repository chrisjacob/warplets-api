import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
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

const DB_URL = "/db/warplets.v1.fts.sqlite.br";
const PAGE_SIZE = 20;
const DB_FILENAME = "/warplets-search.sqlite3";
const SEARCH_DEBOUNCE_MS = 300;
const STATUS_LINE_CLASS = "text-center text-xs uppercase leading-4";
const EXAMPLE_SEARCHES = [
  "Wizard Hat",
  "Pink Bunny",
  "Sharp Teeth",
  "Wide Eyes",
  "Open Mouth",
  "Pink Tongue",
  "Wide Mouth",
  "Purple+Background",
  "Black+Background",
  "Grey+Background",
  "Light+Blue+Background",
  "Blue+Background",
  "Teal+Background",
  "Orange+Background",
  "Pink+Background",
  "Red+Background",
  "White+Background",
  "Dark+Blue+Background",
  "Dark+Grey+Background",
  "Green+Background",
  "Yellow+Background",
  "Brown+Background",
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
  "Almost",
  "Chill Vibe",
  "Playful Monster",
  "Cartoon Monster",
  "Cartoon Creature",
  "Playful Creature",
  "Quirky Warplet",
  "Furry Warplet",
  "Spotted Warplet",
  "Striped Warplet",
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
  "Gray",
  "Brown",
  "Gold",
  "Silver",
  "Teal",
  "Tan",
  "Beige",
  "Cream",
  "Magenta",
  "Lavender",
  "Maroon",
  "Cyan",
  "Indigo",
  "Furry",
  "Peach",
  "Olive",
  "Mint",
  "Lime",
  "Navy",
  "Sage",
  "Pale",
  "Neon",
  "Hot",
  "Mustard",
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
  "Quirky",
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
  "Rectangular",
  "Lit",
  "Coffee",
  "Crown",
  "Hood",
  "Collar",
  "Teeth",
  "Monster",
  "Tongue",
  "Mouth",
  "Eyes",
  "Pupils",
  "Ears",
  "Nose",
  "Brows",
  "Feet",
  "Hands",
  "Claws",
  "Smile",
  "Grin",
  "Fur",
  "Bumpy",
  "Textured",
  "Spotted",
  "Striped",
  "Hair",
  "Smoke",
  "Expression",
  "Wide",
  "Vibrant",
  "Sharp",
  "Striking",
  "Open",
  "Pointed",
  "Sports",
  "Standout",
  "Prominent",
  "Expressive",
  "Adorned",
  "Dressed",
  "Bold",
  "Stylish",
  "Charm",
  "Subtle",
  "Revealing",
  "Sleek",
  "Iconic",
  "Massive",
  "Presence",
  "Captivating",
  "Slightly",
  "Clean",
  "Texture",
  "Perfectly",
  "Clawed",
  "Eye-catching",
  "Touch",
  "Pop",
  "Pattern",
  "Embodying",
  "Simple",
  "Crisp",
  "Gaze",
  "Glowing",
  "Formidable",
  "Bright",
  "Cartoon",
  "Wild",
  "Demeanor",
  "Memorable",
  "Tone",
  "Showcasing",
  "Numerous",
  "Energy",
  "Round",
  "Hand",
  "Gaping",
  "Energetic",
  "Setting",
  "Impressive",
  "Collection",
  "Spots",
  "Matching",
  "Standing",
  "Covered",
  "Classic",
  "Attire",
  "Excitement",
  "Downturned",
  "Aesthetic",
  "Closed",
  "Uniquely",
  "Aura",
  "Tiny",
  "Statement",
  "Rare",
  "Eye",
  "Complete",
  "Casual",
  "Huge",
  "Color",
  "Style",
  "Spirit",
  "Blend",
  "Plain",
  "Stand",
  "Powerful",
  "Front",
  "Sporting",
  "Collared",
  "Stripes",
  "Deep",
  "Left",
  "Feature",
  "Personality",
  "Surprise",
  "Pure",
  "Charming",
  "Right",
  "Mysterious",
  "Lumpy",
  "Hue",
  "Bumps",
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
    description: "Farcaster posts since The Warplets launched",
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

function getRandomExampleSearch(current?: string): string {
  let next = current;
  while (!next || next === current) {
    next = EXAMPLE_SEARCHES[Math.floor(Math.random() * EXAMPLE_SEARCHES.length)];
  }
  return next;
}

function normalizeFtsQuery(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/["']/g, "").replace(/\+/g, " "))
    .filter(Boolean)
    .map((term) => `"${term}"*`)
    .join(" ");
}

function mapRows(values: unknown[][]): WarpletResult[] {
  return values.map((row) => ({
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
  }));
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

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
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
        onClick={() => setIsOpen((current) => !current)}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between rounded-xl border border-[#00FF00]/25 bg-black/70 px-3 py-2 text-left text-sm text-[#00FF00]"
      >
        <span>{label}</span>
        <span className="ml-2 truncate text-xs text-[#8bbf8b]">
          {valueLabel}
        </span>
      </button>
      {isOpen && (
        <div className="absolute left-0 right-0 z-30 mt-2 overflow-visible rounded-xl border border-[#00FF00]/30 bg-black p-2 shadow-2xl">
          {children}
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

function openExternalAsset(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function WarpletCard({
  warplet,
  onOpen,
  labelOverride,
}: {
  warplet: WarpletResult;
  onOpen: (tokenId: number) => void;
  labelOverride?: string;
}) {
  const label = labelOverride ?? `#${warplet.id} ${warplet.farcasterUsername ? `@${warplet.farcasterUsername}` : warplet.wallet}`;

  return (
    <button
      type="button"
      onClick={() => onOpen(warplet.id)}
      className="flex w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-[18px] border border-[#00FF00]/25 bg-[#041204]/90 p-0 text-left transition hover:-translate-y-px hover:border-[#00FF00]/50 hover:bg-[#071807]/95"
    >
      <img
        src={getWarpletImageUrl(warplet.id)}
        alt={`Warplet ${warplet.id}`}
        loading="eager"
        className="aspect-square w-full bg-[#041204] object-cover"
      />
      <span className="flex min-h-[38px] w-full items-center justify-center truncate rounded-b-[18px] bg-[#00FF00] px-2 py-1.5 text-center text-[0.76rem] font-bold text-[rgb(0,80,0)]">
        {label}
      </span>
    </button>
  );
}

function WarpletDetailsModal({
  details,
  onClose,
  onSearchTag,
  onLevelFilter,
}: {
  details: WarpletDetails;
  onClose: () => void;
  onSearchTag: (tag: string) => void;
  onLevelFilter: (attribute: LevelAttributeColumn, level: number) => void;
}) {
  const row = details.row;
  const farcasterUsername = cellToString(row.warplet_username_farcaster);
  const farcasterFid = cellToNumber(row.fid_value);
  const xUsername = cellToString(row.warplet_username_x).replace(/^@/, "");
  const wallet = cellToString(row.warplet_wallet);
  const userIsPro = formatDetailValue("warplet_user_is_pro", row.warplet_user_is_pro);
  const chipGroups = [
    { label: "Colours", values: splitChips(row.warplet_colours) },
    { label: "Keywords", values: splitChips(row.warplet_keywords) },
    { label: "Traits", values: splitChips(row.warplet_traits) },
  ];

  const handleOpenFarcasterProfile = () => {
    if (!farcasterFid) return;
    sdk.actions.viewProfile({ fid: farcasterFid }).catch((error) => {
      console.error("Failed to open Farcaster profile:", error);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-md overflow-auto rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#00FF00]/20 bg-black px-4 py-3">
          <Text className="min-w-0 truncate text-base font-bold" style={{ color: "#00FF00" }}>
            <span>{details.title}</span>
            {details.username && (
              <span style={{ color: "rgb(139, 191, 139)" }}> @{details.username}</span>
            )}
          </Text>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 rounded-lg border border-[#00FF00]/35 px-3 py-1 text-sm font-bold text-[#00FF00] hover:bg-[#041204]"
          >
            Close
          </button>
        </div>

        <div className="p-4">
          <img
            src={getWarpletAssetUrl(details.id, "avif")}
            alt={`Warplet ${details.id}`}
            className="aspect-square w-full rounded-xl bg-[#041204] object-cover"
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
                        onClick={() => onLevelFilter(target.attribute, target.level)}
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
              onClick={() => openExternalAsset(getOpenSeaUrl(details.id))}
              className="mt-4 w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-5 py-3 text-center text-base font-bold text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000]"
            >
              View on OpenSea
            </button>

            <div className="mt-4 space-y-3">
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
                            onClick={() => onLevelFilter(target.attribute, target.level)}
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
                          if (value !== "-") onSearchTag(value);
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
                  onClick={() => openExternalAsset(`https://x.com/${encodeURIComponent(xUsername)}`)}
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
                  onClick={() => openExternalAsset(`https://basescan.org/address/${wallet}`)}
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
                  onClick={() => openExternalAsset(getWarpletAssetUrl(details.id, asset.ext))}
                  className="rounded-xl border border-[#00FF00]/30 bg-[#041204]/90 px-3 py-2 text-left text-xs text-[#00FF00] hover:border-[#00FF00]/60 hover:bg-[#071807]"
                >
                  <span className="block font-bold">{asset.label}</span>
                  <span className="block text-[10px] text-[#8bbf8b]">{asset.detail}</span>
                </button>
              ))}
            </div>
          </div>
      </div>
    </div>
  );
}

export default function SearchApp() {
  const [showOpenInFarcaster, setShowOpenInFarcaster] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState("");
  const [viewerFid, setViewerFid] = useState<number | null>(null);
  const [matchedWarplet, setMatchedWarplet] = useState<WarpletResult | null>(null);
  const [query, setQuery] = useState("");
  const [activeExampleSearch, setActiveExampleSearch] = useState(() => getRandomExampleSearch());
  const [selectedAttributes, setSelectedAttributes] = useState<LevelAttributeColumn[]>([]);
  const [selectedLevels, setSelectedLevels] = useState<number[]>([]);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<WarpletResult[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selectedWarpletDetails, setSelectedWarpletDetails] = useState<WarpletDetails | null>(null);
  const dbRef = useRef<SqliteDatabase | null>(null);
  const searchRunRef = useRef(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome("search");

  useEffect(() => {
    let shouldCallReady = false;

    const init = async () => {
      try {
        const inMiniApp =
          typeof sdk.isInMiniApp === "function" ? await sdk.isInMiniApp() : true;

        if (!inMiniApp) {
          setShowOpenInFarcaster(true);
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

        if (looksLikeBrowserLaunch) {
          setShowOpenInFarcaster(true);
        }
      } finally {
        if (shouldCallReady) {
          sdk.actions.ready();
        }
      }
    };

    init();
  }, []);

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
             w.id,
             w."10x_rarity",
             w.fid_value,
             w.description,
             w.warplet_colours,
             w.warplet_keywords,
             w.warplet_traits,
             w.warplet_username_farcaster,
             w.warplet_username_x,
             w.warplet_wallet
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
    const ftsQuery = normalizeFtsQuery(nextQuery);
    const activeAttributes = filterOverride?.attributes ?? selectedAttributes;
    const activeLevels = filterOverride?.levels ?? selectedLevels;
    const levelFilter = buildLevelFilter(activeAttributes, activeLevels);
    const runId = searchRunRef.current + 1;
    searchRunRef.current = runId;

    if (!db || (!ftsQuery && !levelFilter)) {
      setResults([]);
      setTotalResults(0);
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
           FROM warplets w
           WHERE ${levelFilter?.sql}`;
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
             w.id,
             w."10x_rarity",
             w.fid_value,
             w.description,
             w.warplet_colours,
             w.warplet_keywords,
             w.warplet_traits,
             w.warplet_username_farcaster,
             w.warplet_username_x,
             w.warplet_wallet,
             bm25(warplets_fts) AS score
           FROM warplets_fts
           JOIN warplets w ON w.id = warplets_fts.rowid
           WHERE warplets_fts MATCH ?${levelFilter ? ` AND ${levelFilter.sql}` : ""}
           ORDER BY score, w."10x_rank" ASC, w.id ASC
           LIMIT ? OFFSET ?`
        : `SELECT
             w.id,
             w."10x_rarity",
             w.fid_value,
             w.description,
             w.warplet_colours,
             w.warplet_keywords,
             w.warplet_traits,
             w.warplet_username_farcaster,
             w.warplet_username_x,
             w.warplet_wallet
           FROM warplets w
           WHERE ${levelFilter?.sql}
           ORDER BY w.id ASC
           LIMIT ? OFFSET ?`;
      const resultBind = ftsQuery
        ? [ftsQuery, ...(levelFilter?.bind ?? []), limit, offset]
        : [...(levelFilter?.bind ?? []), limit, offset];
      const rows = db.exec(
        resultSql,
        {
          bind: resultBind,
          rowMode: "array",
          returnValue: "resultRows",
        },
      );
      const nextRows = mapRows(rows);
      await preloadResultImages(nextRows);

      if (searchRunRef.current !== runId) return;

      setSubmittedQuery(nextQuery.trim());
      setTotalResults(nextTotal);
      setResults((current) => (offset === 0 ? nextRows : [...current, ...nextRows]));
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

  useEffect(() => {
    if (!dbReady) return;
    const timeoutId = window.setTimeout(() => {
      const hasQuery = query.trim().length > 0;
      const hasLevelFilter = selectedLevels.length > 0;
      const isExampleSearch = !hasQuery && !hasLevelFilter && selectedAttributes.length === 0;
      const nextQuery = hasQuery
        ? query
        : hasLevelFilter
          ? ""
          : selectedAttributes.length > 0
            ? ""
            : activeExampleSearch;
      const limit = isExampleSearch && matchedWarplet ? PAGE_SIZE - 1 : PAGE_SIZE;
      runSearch(nextQuery, 0, undefined, limit);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [activeExampleSearch, dbReady, matchedWarplet, query, runSearch, selectedAttributes.length, selectedLevels.length]);

  useEffect(() => {
    if (!dbReady || isMenuRoute) return;
    searchInputRef.current?.focus();
  }, [dbReady, isMenuRoute]);

  const canLoadMore = results.length > 0 && results.length < totalResults;
  const hasActiveAttributeFilter = selectedAttributes.length > 0;
  const hasActiveLevelFilter = selectedLevels.length > 0;
  const hasTypedQuery = query.trim().length > 0;
  const isExampleSearchMode = !hasTypedQuery && !hasActiveAttributeFilter && !hasActiveLevelFilter;
  const searchPlaceholder = hasTypedQuery || hasActiveAttributeFilter || hasActiveLevelFilter
    ? "Search for Warplets..."
    : `${activeExampleSearch} Warplets...`;
  const shouldPrependMatchedWarplet = Boolean(isExampleSearchMode && matchedWarplet);
  const displayedResults = shouldPrependMatchedWarplet && matchedWarplet
    ? [matchedWarplet, ...results]
    : results;
  const displayedTotalResults = totalResults + (shouldPrependMatchedWarplet ? 1 : 0);
  const hasActiveSearchOrFilter = Boolean(submittedQuery || hasTypedQuery || hasActiveAttributeFilter || hasActiveLevelFilter);
  const selectedAttributeLabel = selectedAttributes.length === 0
    ? "All"
    : LEVEL_ATTRIBUTES
      .filter((attribute) => selectedAttributes.includes(attribute.column))
      .map((attribute) => attribute.label)
      .join(", ");
  const selectedLevelLabel = selectedLevels.length === 0
    ? "Any"
    : selectedLevels.map((level) => `${level}X`).join(", ");

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
    setQuery("");
    setSelectedAttributes([]);
    setSelectedLevels([]);
    setResults([]);
    setTotalResults(0);
    setSubmittedQuery("");
    setSearchError("");
    setIsSearching(false);
    searchRunRef.current += 1;
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const handleRandomExampleSearch = () => {
    const nextExample = getRandomExampleSearch(activeExampleSearch);
    setActiveExampleSearch(nextExample);
    setQuery("");
    setSelectedAttributes([]);
    setSelectedLevels([]);
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
    const db = dbRef.current;
    if (!db) return;

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
      if (!details) return;
      await preloadImage(getWarpletAssetUrl(details.id, "avif"));
      setSelectedWarpletDetails(details);
    } catch (err) {
      console.error("Failed to load Warplet details:", err);
    }
  }, []);

  const handleSearchTag = useCallback((tag: string) => {
    setSelectedWarpletDetails(null);
    setQuery(tag);
    void runSearch(tag, 0);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [runSearch]);

  const handleLevelFilter = useCallback((attribute: LevelAttributeColumn, level: number) => {
    const nextAttributes = [attribute];
    const nextLevels = [level];
    setSelectedWarpletDetails(null);
    setQuery("");
    setSelectedAttributes(nextAttributes);
    setSelectedLevels(nextLevels);
    void runSearch("", 0, { attributes: nextAttributes, levels: nextLevels });
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [runSearch]);

  useEffect(() => {
    if (!canLoadMore || isSearching || !hasActiveSearchOrFilter) return;
    const target = loadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          runSearch(submittedQuery, results.length);
        }
      },
      { rootMargin: "600px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [canLoadMore, hasActiveSearchOrFilter, isSearching, results.length, runSearch, submittedQuery]);

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
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                disabled={!dbReady}
                className="min-w-0 flex-1 rounded-xl border border-[#00FF00] bg-black/70 py-3 pl-10 pr-16 text-base text-[#00FF00] outline-none transition-[border-color,box-shadow] placeholder:text-[#8bbf8b] focus:border-[#00FF00] focus:shadow-[0_0_10px_rgba(0,255,0,0.22)] disabled:cursor-wait disabled:opacity-60"
              />
              {(query.trim() || selectedAttributes.length > 0 || selectedLevels.length > 0) ? (
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
                      className="h-4 w-4 accent-[#00FF00]"
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
                      className="h-4 w-4 accent-[#00FF00]"
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

            {showOpenInFarcaster && (
              <Text className="mt-3 text-xs" style={{ color: "#7ddf7d" }}>
                Open this mini app inside Farcaster to preview the full experience.
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
              <div className="mt-5">
                <Text className={STATUS_LINE_CLASS} style={{ color: "#00FF00" }}>
                  {displayedResults.length} of {displayedTotalResults} results
                </Text>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  {displayedResults.map((warplet, index) => (
                    <WarpletCard
                      key={`${warplet.id}-${index}`}
                      warplet={warplet}
                      onOpen={handleOpenWarpletDetails}
                      labelOverride={shouldPrependMatchedWarplet && index === 0 ? "👀 We Found You!" : undefined}
                    />
                  ))}
                </div>

                <div ref={loadMoreRef} className="h-8" />
              </div>
            )}

            {isSearching && (query.trim() || hasActiveLevelFilter || isExampleSearchMode) && (
              <Text className={`mt-5 ${STATUS_LINE_CLASS}`} style={{ color: "#00FF00" }}>
                Loading results...
              </Text>
            )}
          </div>
        )}
      </div>
      {selectedWarpletDetails && (
        <WarpletDetailsModal
          details={selectedWarpletDetails}
          onClose={() => setSelectedWarpletDetails(null)}
          onSearchTag={handleSearchTag}
          onLevelFilter={handleLevelFilter}
        />
      )}
    </MiniAppShell>
  );
}
