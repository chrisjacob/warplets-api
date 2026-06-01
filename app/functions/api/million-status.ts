interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  ACTION_SESSION_SECRET?: string;
  ALLOW_INSECURE_ACTION_FID_FALLBACK?: string;
}
import { createActionSessionToken, jsonSecure, verifyActionSessionToken } from "../_lib/security.js";

type ActionRow = {
  id: number;
  slug: string;
  name: string;
  description: string;
  app_action: string | null;
  url: string | null;
  verification_method: string;
  entry_value: number;
};

type ActionCompletionRow = {
  action_slug: string;
  verification: string | null;
};

type AttentionCompletionRow = {
  action_key: string;
  auction_day: number;
  points_awarded: number;
  payload_json: string | null;
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

const DAY_MS = 24 * 60 * 60 * 1000;
const FARCASTER_JOIN_URL = "https://farcaster.xyz/~/code/RUZLHN";
const ONE_M_WARPLET_OPENSEA_URL = "https://opensea.io/collection/1m-warplet-1-the-one/overview";
const TEN_X_WARPLETS_OPENSEA_URL = "https://opensea.io/collection/10xwarplets/overview";
const DROP_APP_URL = "https://drop.10x.meme/";
const TELEGRAM_URL = "https://t.me/X10XMeme";
const DISCORD_URL = "https://discord.com/invite/hunt-town";
const FARCASTER_CHANNEL_URL = "https://farcaster.xyz/~/channel/10xmeme";
const TEN_X_MEME_X_FOLLOW_URL = "https://twitter.com/intent/follow?user_id=3275559396";

const DAILY_COLLECTIONS = [
  { day: 1, sale: "$1M", budget: "$100,000", collection: "The Warplets", opensea: "https://opensea.io/collection/the-warplets-farcaster", twitter: "WarpletsAI", slug: "the-warplets-farcaster", extension: "avif" },
  { day: 2, sale: "$1M", budget: "$100,000", collection: "VeeFriends", opensea: "https://opensea.io/collection/veefriends", twitter: "veefriends", slug: "veefriends", extension: "avif" },
  { day: 3, sale: "$900K", budget: "$90,000", collection: "Mutant Ape Yacht Club", opensea: "https://opensea.io/collection/mutant-ape-yacht-club", twitter: "BoredApeYC", slug: "mutant-ape-yacht-club", extension: "avif" },
  { day: 4, sale: "$800K", budget: "$80,000", collection: "Azuki", opensea: "https://opensea.io/collection/azuki", twitter: "Azuki", slug: "azuki", extension: "avif" },
  { day: 5, sale: "$700K", budget: "$70,000", collection: "MAX PAIN AND FRENS", opensea: "https://opensea.io/collection/max-pain-and-frens-by-xcopy", twitter: "XCOPYART", slug: "max-pain-and-frens-by-xcopy", extension: "webp" },
  { day: 6, sale: "$600K", budget: "$60,000", collection: "Doodles", opensea: "https://opensea.io/collection/doodles-official", twitter: "doodles", slug: "doodles-official", extension: "avif" },
  { day: 7, sale: "$500K", budget: "$50,000", collection: "Good Vibes Club", opensea: "https://opensea.io/collection/good-vibes-club", twitter: "goodvibesclub", slug: "good-vibes-club", extension: "avif" },
  { day: 8, sale: "$400K", budget: "$40,000", collection: "Lil Pudgys", opensea: "https://opensea.io/collection/lilpudgys", twitter: "pudgypenguins", slug: "lilpudgys", extension: "avif" },
  { day: 9, sale: "$300K", budget: "$30,000", collection: "Bankr Club", opensea: "https://opensea.io/collection/bankr-club", twitter: "bankrbot", slug: "bankr-club", extension: "jpg" },
  { day: 10, sale: "$200K", budget: "$20,000", collection: "CLONE X", opensea: "https://opensea.io/collection/clonex", twitter: "RTFKT", slug: "clonex", extension: "avif" },
  { day: 11, sale: "$100K", budget: "$10,000", collection: "mfers", opensea: "https://opensea.io/collection/mfers", twitter: "unofficialmfers", slug: "mfers", extension: "avif" },
  { day: 12, sale: "$90K", budget: "$9,000", collection: "Redacted Remilio Babies", opensea: "https://opensea.io/collection/remilio-babies", twitter: "RemilioBaby", slug: "remilio-babies", extension: "avif" },
  { day: 13, sale: "$80K", budget: "$8,000", collection: "Checks - VV Originals", opensea: "https://opensea.io/collection/vv-checks-originals", twitter: "jackbutcher", slug: "vv-checks-originals", extension: "png" },
  { day: 14, sale: "$70K", budget: "$7,000", collection: "Cool Cats", opensea: "https://opensea.io/collection/cool-cats-nft", twitter: "coolcats", slug: "cool-cats-nft", extension: "avif" },
  { day: 15, sale: "$60K", budget: "$6,000", collection: "Mocaverse", opensea: "https://opensea.io/collection/mocaverse", twitter: "Moca_Network", slug: "mocaverse", extension: "avif" },
  { day: 16, sale: "$50K", budget: "$5,000", collection: "Memeland Potatoz", opensea: "https://opensea.io/collection/memelandpotatoz", twitter: "memeland", slug: "memelandpotatoz", extension: "webp" },
  { day: 17, sale: "$40K", budget: "$4,000", collection: "World of Women", opensea: "https://opensea.io/collection/world-of-women-nft", twitter: "worldofwomenxyz", slug: "world-of-women-nft", extension: "avif" },
  { day: 18, sale: "$30K", budget: "$3,000", collection: "Yapybaras - Kaito Genesis", opensea: "https://opensea.io/collection/kaito-genesis", twitter: "KaitoAI", slug: "kaito-genesis", extension: "avif" },
  { day: 19, sale: "$20K", budget: "$2,000", collection: "Otherdeed for Otherside", opensea: "https://opensea.io/collection/otherdeed", twitter: "othersidemeta", slug: "otherdeed", extension: "avif" },
  { day: 20, sale: "$10K", budget: "$1,000", collection: "BEANZ Official", opensea: "https://opensea.io/collection/beanzofficial", twitter: "Azuki", slug: "beanzofficial", extension: "avif" },
  { day: 21, sale: "$10K - $9K", budget: "$1,000 - $900", collection: "Degens", opensea: "https://opensea.io/collection/degens-base", twitter: "degentokenbase", slug: "degens-base", extension: "png" },
  { day: 22, sale: "$9K - $8K", budget: "$900 - $800", collection: "based punks", opensea: "https://opensea.io/collection/basedpunks", twitter: "based", slug: "basedpunks", extension: "avif" },
  { day: 23, sale: "$8K- $7K", budget: "$800 - $700", collection: "OK COMPUTERS", opensea: "https://opensea.io/collection/okcomputers", twitter: "dailofrog", slug: "okcomputers", extension: "png" },
  { day: 24, sale: "$7K - $6K", budget: "$700 - $600", collection: "Farcaster Pro OG", opensea: "https://opensea.io/collection/farcaster-pro-og", twitter: "farcaster_xyz", slug: "farcaster-pro-og", extension: "png" },
  { day: 25, sale: "$6K - $5K", budget: "$600 - $500", collection: "VRNouns", opensea: "https://opensea.io/collection/vrnouns", twitter: "vrnouns", slug: "vrnouns", extension: "png" },
  { day: 26, sale: "$5K - $4K", budget: "$500 - $400", collection: "AXIOM Tool Pass", opensea: "https://opensea.io/collection/axiom-tool-pass", twitter: "AxiomBot", slug: "axiom-tool-pass", extension: "png" },
  { day: 27, sale: "$4K - $3K", budget: "$400 - $300", collection: "BasePaint", opensea: "https://opensea.io/collection/basepaint", twitter: "basepaint_xyz", slug: "basepaint", extension: "avif" },
  { day: 28, sale: "$3K - $2K", budget: "$300 - $200", collection: "Base Colors", opensea: "https://opensea.io/collection/base-colors-nft", twitter: "0fjake", slug: "base-colors-nft", extension: "png" },
  { day: 29, sale: "$2K - $1K", budget: "$200 - $100", collection: "BETRMINT Rounds Art", opensea: "https://opensea.io/collection/0x145b4ea581924882e854f34630a2544b4c2fe4bd", twitter: "betrmint", slug: "betrmint", extension: "avif" },
  { day: 30, sale: "$1K - $100", budget: "$100 - $10", collection: "The Warplets", opensea: "https://opensea.io/collection/the-warplets-farcaster", twitter: "WarpletsAI", slug: "the-warplets-farcaster", extension: "avif" },
];

function currentGiveawayMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentAuctionDay(now = new Date()): number {
  const cycleStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
  const rawDay = Math.floor((now.getTime() - cycleStart) / DAY_MS) + 1;
  return Math.min(30, Math.max(1, rawDay));
}

function safeJsonParse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildAttentionSections(completions: AttentionCompletionRow[], now = new Date()) {
  const day = currentAuctionDay(now);
  const daily = DAILY_COLLECTIONS.find((row) => row.day === day) ?? DAILY_COLLECTIONS[0];
  const completed = new Map(completions.map((row) => [`${row.action_key}:${row.auction_day}`, row]));
  const withState = (action: AttentionAction): AttentionAction => {
    const row = completed.get(`${action.key}:${action.auctionDay ?? 0}`);
    return {
      ...action,
      completed: Boolean(row),
      payload: safeJsonParse(row?.payload_json ?? null),
    };
  };

  return [
    {
      id: "once",
      title: "Once-Off Actions (20pts)",
      actions: ([
        { key: "once-opensea-1m", label: "Visit $1M Warplet on OpenSea", points: 1, kind: "external", url: ONE_M_WARPLET_OPENSEA_URL },
        { key: "once-opensea-10x", label: "Visit 10X Warplets on OpenSea", points: 1, kind: "external", url: TEN_X_WARPLETS_OPENSEA_URL },
        { key: "once-follow-x", label: "Follow on X", points: 2, kind: "external", url: TEN_X_MEME_X_FOLLOW_URL },
        { key: "once-post-x", label: "Post on X", points: 3, kind: "x" },
        { key: "once-telegram", label: "Join Telegram", points: 2, kind: "external", url: TELEGRAM_URL },
        { key: "once-discord", label: "Join Discord", points: 2, kind: "external", url: DISCORD_URL },
        { key: "once-join-farcaster", label: "Join Farcaster", points: 2, kind: "external", url: FARCASTER_JOIN_URL },
        { key: "once-follow-farcaster", label: "Follow on Farcaster", points: 1, kind: "profile", fid: 1313340 },
        { key: "once-post-farcaster", label: "Post on Farcaster", points: 1, kind: "farcaster", channelKey: "10xmeme" },
        { key: "once-follow-channel", label: "Follow channel on Farcaster", points: 1, kind: "external", url: FARCASTER_CHANNEL_URL },
        { key: "once-add-million-app", label: "Add $1M Warplet app", points: 2, kind: "add-app" },
        { key: "once-add-drop-app", label: "Add 10X Warplets Drop app", points: 2, kind: "external", url: DROP_APP_URL },
      ] satisfies AttentionAction[]).map(withState),
    },
    {
      id: "daily",
      title: "Daily Actions (5pts/day)",
      dailyCollection: daily,
      actions: ([
        { key: "daily-opensea", label: "Visit on OpenSea", points: 1, kind: "external", url: daily.opensea, auctionDay: day, collection: daily.collection },
        { key: "daily-follow-x", label: "Follow on X", points: 1, kind: "external", url: `https://x.com/${daily.twitter}`, auctionDay: day, collection: daily.collection },
        { key: "daily-post-x", label: "Post on X", points: 3, kind: "x", auctionDay: day, collection: daily.collection },
      ] satisfies AttentionAction[]).map(withState),
    },
    {
      id: "tenx",
      title: "10X Action (15pts)",
      actions: ([
        { key: "tenx-list-warplet", label: "List your 10X Warplet on OpenSea for $1,000,000 for 6 months", points: 10, kind: "modal" },
        { key: "tenx-post-x", label: "Post on X", points: 5, kind: "modal" },
      ] satisfies AttentionAction[]).map(withState),
    },
  ];
}

function daysLeftInUtcMonth(now = new Date()): number {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const ms = Math.max(0, end - now.getTime());
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function asPositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function resolveFid(context: EventContext<Env, string, unknown>): Promise<number | null> {
  const url = new URL(context.request.url);
  const token = url.searchParams.get("sessionToken")?.trim() || null;
  const session = await verifyActionSessionToken(context.env.ACTION_SESSION_SECRET, token);
  if (session.valid) return session.fid;

  const isLocalDevHost =
    url.hostname.includes("-local.") ||
    url.hostname.includes("-dev.") ||
    url.hostname.endsWith(".pages.dev") ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "::1";
  if (!isLocalDevHost && context.env.ALLOW_INSECURE_ACTION_FID_FALLBACK !== "1") return null;
  return asPositiveInt(url.searchParams.get("fid"));
}

async function loadActions(db: D1Database): Promise<ActionRow[]> {
  const result = await db.prepare(
    `SELECT id, slug, name, description, app_action, url, verification_method, entry_value
     FROM actions
     WHERE app_slug = 'million'
     ORDER BY CASE slug
       WHEN 'million-enter-email' THEN 1
       WHEN 'million-cast' THEN 2
       WHEN 'million-tweet' THEN 3
       WHEN 'million-follow-fc-10xmeme' THEN 4
       WHEN 'million-follow-fc-10xchris' THEN 5
       WHEN 'million-follow-x-10xmeme' THEN 6
       WHEN 'million-follow-x-10xchris' THEN 7
       WHEN 'million-join-fc-channel' THEN 8
       WHEN 'million-join-telegram' THEN 9
       ELSE 999
     END, id ASC`
  ).all<ActionRow>();
  return result.results ?? [];
}

async function loadEntryAvatars(db: D1Database, giveawayMonth: string, fid: number | null, useQa: boolean) {
  if (useQa) {
    const result = await db.prepare(
      `SELECT token_id, name, image_url
       FROM warplets_metadata
       WHERE image_url IS NOT NULL
       ORDER BY token_id ASC
       LIMIT 10`
    ).all<{ token_id: number; name: string; image_url: string }>();
    return (result.results ?? []).map((row) => ({
      fid: row.token_id,
      username: row.name,
      pfpUrl: row.image_url,
    }));
  }

  if (fid) {
    const best = await db.prepare(
      `SELECT wu.fid, wu.username, wu.pfp_url
       FROM million_giveaway_entries e
       JOIN warplets_users wu ON wu.id = e.user_id
       JOIN warplets_user_best_friends bf ON bf.best_friend_fid = wu.fid
       WHERE e.giveaway_month = ?
         AND bf.user_fid = ?
         AND wu.pfp_url IS NOT NULL
       ORDER BY bf.mutual_affinity_score DESC, e.created_on DESC
       LIMIT 10`
    )
      .bind(giveawayMonth, fid)
      .all<{ fid: number; username: string | null; pfp_url: string | null }>();
    const rows = (best.results ?? []).filter((row) => row.pfp_url);
    if (rows.length > 0) {
      return rows.map((row) => ({ fid: row.fid, username: row.username ?? String(row.fid), pfpUrl: row.pfp_url ?? "" }));
    }
  }

  const latest = await db.prepare(
    `SELECT wu.fid, wu.username, wu.pfp_url
     FROM million_giveaway_entries e
     JOIN warplets_users wu ON wu.id = e.user_id
     WHERE e.giveaway_month = ?
       AND wu.pfp_url IS NOT NULL
     ORDER BY e.created_on DESC
     LIMIT 10`
  )
    .bind(giveawayMonth)
    .all<{ fid: number; username: string | null; pfp_url: string | null }>();
  return (latest.results ?? []).map((row) => ({ fid: row.fid, username: row.username ?? String(row.fid), pfpUrl: row.pfp_url ?? "" }));
}

async function loadTopReferrers(db: D1Database) {
  const result = await db.prepare(
    `SELECT fid, username, pfp_url, referrals_count
     FROM warplets_users
     WHERE referrals_count > 0
     ORDER BY referrals_count DESC, score DESC, fid ASC
     LIMIT 25`
  ).all<{ fid: number; username: string | null; pfp_url: string | null; referrals_count: number }>();
  return (result.results ?? []).map((row) => ({
    fid: row.fid,
    username: row.username ?? String(row.fid),
    pfpUrl: row.pfp_url ?? "",
    referrals: row.referrals_count,
  }));
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const fid = await resolveFid(context);
  const giveawayMonth = currentGiveawayMonth();
  const actions = await loadActions(context.env.WARPLETS);

  let userId: number | null = null;
  let referralCount = 0;
  let email: string | null = null;
  let hasEntry = false;
  let userEntries = 0;
  let completions = new Map<string, string | null>();
  let attentionCompletions: AttentionCompletionRow[] = [];
  let previousCompletions = new Set<string>();

  if (fid) {
    const user = await context.env.WARPLETS.prepare(
      "SELECT id, referrals_count FROM warplets_users WHERE fid = ? LIMIT 1"
    )
      .bind(fid)
      .first<{ id: number; referrals_count: number | null }>();
    if (user) {
      userId = user.id;
      referralCount = Math.max(0, Number(user.referrals_count ?? 0));
      const emailRow = await context.env.WARPLETS.prepare(
        `SELECT email
         FROM email_waitlist
         WHERE fid = ?
           AND unsubscribed_at IS NULL
         ORDER BY verified DESC, subscribed_at DESC
         LIMIT 1`
      )
        .bind(fid)
        .first<{ email: string }>();
      email = emailRow?.email ?? null;

      const entry = await context.env.WARPLETS.prepare(
        `SELECT id FROM million_giveaway_entries WHERE user_id = ? AND giveaway_month = ? LIMIT 1`
      )
        .bind(user.id, giveawayMonth)
        .first<{ id: number }>();
      hasEntry = Boolean(entry);

      const completed = await context.env.WARPLETS.prepare(
        `SELECT action_slug, verification
         FROM million_giveaway_action_entries
         WHERE user_id = ? AND giveaway_month = ?`
      )
        .bind(user.id, giveawayMonth)
        .all<ActionCompletionRow>();
      completions = new Map((completed.results ?? []).map((row) => [row.action_slug, row.verification] as const));

      const previous = await context.env.WARPLETS.prepare(
        `SELECT action_slug
         FROM actions_completed
         WHERE user_id = ?
           AND action_slug IN (
             'drop-cast',
             'drop-tweet',
             'drop-follow-fc-10xmeme',
             'drop-follow-fc-10xchris',
             'drop-follow-x-10xmeme',
             'drop-follow-x-10xchris',
             'drop-join-fc-channel',
             'drop-join-telegram'
           )
         UNION
         SELECT action_slug
         FROM million_giveaway_action_entries
         WHERE user_id = ?
           AND giveaway_month <> ?`
      )
        .bind(user.id, user.id, giveawayMonth)
        .all<{ action_slug: string }>();
      const equivalent = new Map([
        ["drop-cast", "million-cast"],
        ["drop-tweet", "million-tweet"],
        ["drop-follow-fc-10xmeme", "million-follow-fc-10xmeme"],
        ["drop-follow-fc-10xchris", "million-follow-fc-10xchris"],
        ["drop-follow-x-10xmeme", "million-follow-x-10xmeme"],
        ["drop-follow-x-10xchris", "million-follow-x-10xchris"],
        ["drop-join-fc-channel", "million-join-fc-channel"],
        ["drop-join-telegram", "million-join-telegram"],
      ]);
      previousCompletions = new Set((previous.results ?? []).map((row) => equivalent.get(row.action_slug) ?? row.action_slug));

      const entryTotal = await context.env.WARPLETS.prepare(
        `SELECT COALESCE(SUM(points_awarded), 0) AS total
         FROM million_attention_completions
         WHERE user_id = ? AND grant_month = ?`
      )
        .bind(user.id, giveawayMonth)
        .first<{ total: number }>();
      userEntries = Number(entryTotal?.total ?? 0) + Math.min(10, referralCount);

      const attentionRows = await context.env.WARPLETS.prepare(
        `SELECT action_key, auction_day, points_awarded, payload_json
         FROM million_attention_completions
         WHERE user_id = ? AND grant_month = ?`
      )
        .bind(user.id, giveawayMonth)
        .all<AttentionCompletionRow>();
      attentionCompletions = attentionRows.results ?? [];
    }
  }

  const totalRow = await context.env.WARPLETS.prepare(
    `SELECT COALESCE(SUM(points_awarded), 0) AS total
     FROM million_attention_completions
     WHERE grant_month = ?`
  )
    .bind(giveawayMonth)
    .first<{ total: number }>();
  const referralRows = await context.env.WARPLETS.prepare(
    `SELECT COALESCE(SUM(CASE WHEN referrals_count > 10 THEN 10 ELSE referrals_count END), 0) AS total
     FROM warplets_users
     WHERE referrals_count > 0`
  ).first<{ total: number }>();

  const actionSessionToken = fid ? await createActionSessionToken(context.env.ACTION_SESSION_SECRET, fid, 3600) : null;
  const actionItems = actions.map((action) => ({
    id: action.id,
    slug: action.slug,
    name: action.name,
    description: action.description,
    appAction: action.app_action,
    url: action.url,
    verificationMethod: action.verification_method,
    entryValue: Number(action.entry_value ?? 0),
    completed: completions.has(action.slug),
    verification: completions.get(action.slug) ?? null,
    previouslyCompleted: previousCompletions.has(action.slug),
  }));

  return jsonSecure({
    giveawayMonth,
    hasEntry,
    email,
    userEntries,
    totalEntries: Number(totalRow?.total ?? 0) + Number(referralRows?.total ?? 0),
    daysLeft: daysLeftInUtcMonth(),
    referralCount,
    referralBonusEntries: Math.min(10, referralCount),
    entryAvatars: await loadEntryAvatars(context.env.WARPLETS, giveawayMonth, fid, url.searchParams.get("entries") === "1"),
    topReferrers: await loadTopReferrers(context.env.WARPLETS),
    actionSessionToken,
    actions: actionItems,
    attentionSections: buildAttentionSections(attentionCompletions),
    userId,
  });
};

export const onRequestPost = onRequestGet;
