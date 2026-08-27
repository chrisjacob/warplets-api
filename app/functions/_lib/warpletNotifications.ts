import { dispatchNotification } from "./dispatch.js";
import {
  getBaseNotificationAudience,
  isPermanentBaseNotificationFailure,
  sendBaseNotificationCampaign,
  type BaseNotificationsEnv,
} from "./baseNotifications.js";
import { buildClickTrackingUrl } from "./notificationTracking.js";
import {
  sendWebPushNotification,
  type WebPushEnv,
  type WebPushSubscriptionRow,
} from "./webPush.js";
import { WARPLETS_APP_ORIGINS, WARPLETS_APP_SLUG } from "../../shared/warpletsApp.js";

export type WarpletActivityType =
  | "purchased"
  | "offered"
  | "listed"
  | "sold"
  | "favourited"
  | "collection_top_offer"
  | "trait_top_offer";

type NotificationCategory =
  | "owned"
  | "offered"
  | "favourited"
  | "best_friend"
  | "global_stats";

export interface WarpletNotificationEnv extends Partial<BaseNotificationsEnv>, Partial<WebPushEnv> {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  BASE_NOTIFICATIONS_API_KEY?: string;
  BASE_NOTIFICATIONS_ENABLED?: string;
  BASE_APP_URL?: string;
}

interface ActivityInput {
  eventKey?: string;
  eventType: WarpletActivityType;
  tokenId?: number | string | null;
  actorWallet?: string | null;
  actorFid?: number | null;
  actorUsername?: string | null;
  ownerWallet?: string | null;
  ownerFid?: number | null;
  counterpartyWallet?: string | null;
  counterpartyFid?: number | null;
  amountEth?: number | null;
  amountRaw?: string | null;
  currencySymbol?: string | null;
  orderHash?: string | null;
  transactionHash?: string | null;
  source?: string | null;
  occurredAt?: string | null;
  rawPayload?: unknown;
  queue?: boolean;
}

interface ActivityRow {
  id: number;
  event_key: string;
  event_type: WarpletActivityType;
  token_id: number | null;
  actor_wallet: string | null;
  actor_fid: number | null;
  actor_username: string | null;
  owner_wallet: string | null;
  owner_fid: number | null;
  counterparty_wallet: string | null;
  counterparty_fid: number | null;
  amount_eth: number | null;
  amount_raw: string | null;
  currency_symbol: string | null;
  order_hash: string | null;
  transaction_hash: string | null;
  source: string;
  occurred_at: string;
  raw_payload: string | null;
  queued_at?: string | null;
}

const APP_SLUG = WARPLETS_APP_SLUG;
const WARPLETS_BASE_URL = WARPLETS_APP_ORIGINS.prod;
const TOKEN_CONTRACT = "0x780446dd12e080ae0db762fcd4daf313f3e359de";
const OPEN_SEA_COLLECTION_URL = "https://opensea.io/collection/10xwarplets";
const GLOBAL_STATS_ACTIVE_JOB_KEY = "warplets:global-stats:active";
const GLOBAL_STATS_LAST_JOB_KEY = "warplets:global-stats:last";
const COLLECTION_OFFER_AUDIENCE_CURSOR_KEY = "warplets:collection-offer-audience:cursor";
const MAX_TRANSACTIONAL_RETRY_ATTEMPTS = 6;
const MAX_COLLECTION_OFFER_RECIPIENTS = 250;
export const GLOBAL_STATS_TARGET_URL = `${WARPLETS_BASE_URL}/stats/market/30d`;

const ACTION_PRIORITY: Record<WarpletActivityType, number> = {
  purchased: 0,
  offered: 1,
  listed: 2,
  sold: 3,
  favourited: 4,
  collection_top_offer: 5,
  trait_top_offer: 6,
};

const TABLE_COLUMN_CACHE = new Map<string, Set<string>>();

export function isWebPushSubscriptionEligible(
  subscription: Pick<WebPushSubscriptionRow, "farcaster_fid" | "wallet_address">,
  notificationKind: "daily-stats" | "transactional",
): boolean {
  if (notificationKind === "daily-stats") return true;
  return Boolean(subscription.farcaster_fid || normalizeWallet(subscription.wallet_address));
}

export function buildGlobalStatsAudience(input: {
  farcasterFids: number[];
  baseWallets: string[];
  webPushSubscriptions: WebPushSubscriptionRow[];
}): {
  farcasterFids: number[];
  baseWallets: string[];
  webPushSubscriptions: WebPushSubscriptionRow[];
} {
  return {
    farcasterFids: [...new Set(input.farcasterFids.filter((fid) => Number.isInteger(fid) && fid > 0))],
    baseWallets: [...new Set(input.baseWallets.map(normalizeWallet).filter((wallet): wallet is string => Boolean(wallet)))],
    webPushSubscriptions: [...new Map(
      input.webPushSubscriptions
        .filter((subscription) => isWebPushSubscriptionEligible(subscription, "daily-stats"))
        .map((subscription) => [subscription.endpoint_hash, subscription]),
    ).values()],
  };
}

async function getTableColumns(env: WarpletNotificationEnv, tableName: "wallet_farcaster_links" | "warplets_users"): Promise<Set<string>> {
  const cached = TABLE_COLUMN_CACHE.get(tableName);
  if (cached) return cached;
  const result = await env.WARPLETS.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();
  const columns = new Set((result.results ?? []).map((row) => row.name));
  TABLE_COLUMN_CACHE.set(tableName, columns);
  return columns;
}

function normalizeWallet(wallet?: string | null): string | null {
  if (!wallet) return null;
  const trimmed = wallet.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(trimmed) ? trimmed : null;
}

function normalizeTokenId(tokenId?: number | string | null): number | null {
  if (tokenId == null) return null;
  const value = Number(tokenId);
  if (!Number.isInteger(value) || value < 1 || value > 10000) return null;
  return value;
}

function normalizeTimestamp(timestamp?: string | null): string {
  if (!timestamp) return new Date().toISOString();
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function safeJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value).slice(0, 8000);
  } catch {
    return null;
  }
}

function formatEth(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const fixed = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `${fixed || "0"} ETH`;
}

function formatUsd(value?: number | null, ethUsd?: number | null): string {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    typeof ethUsd !== "number" ||
    !Number.isFinite(ethUsd)
  ) {
    return "";
  }
  const usd = Math.round(value * ethUsd);
  return `(~$${usd.toLocaleString("en-US")})`;
}

function compactAmount(value?: number | null, ethUsd?: number | null): string {
  const eth = formatEth(value);
  if (!eth) return "";
  const usd = formatUsd(value, ethUsd);
  return usd ? `${eth} ${usd}` : eth;
}

function actorLabel(row: Pick<ActivityRow, "actor_username" | "actor_fid" | "actor_wallet">): string {
  if (row.actor_username) return `@${row.actor_username.replace(/^@/, "")}`;
  if (row.actor_fid) return `FID ${row.actor_fid}`;
  if (row.actor_wallet) return `${row.actor_wallet.slice(0, 6)}…${row.actor_wallet.slice(-4)}`;
  return "Someone";
}

function traitLabelFromPayload(rawPayload?: string | null): string {
  if (!rawPayload) return "matching traits";
  try {
    const parsed = JSON.parse(rawPayload) as { traits?: Array<{ traitType?: unknown; traitValue?: unknown }> };
    const traits = Array.isArray(parsed.traits) ? parsed.traits : [];
    const label = traits
      .map((trait) => {
        const traitType = typeof trait.traitType === "string" ? trait.traitType.trim() : "";
        const traitValue = typeof trait.traitValue === "string" ? trait.traitValue.trim() : "";
        return traitType && traitValue ? `${traitType}: ${traitValue}` : "";
      })
      .filter(Boolean)
      .join(", ");
    return label || "matching traits";
  } catch {
    return "matching traits";
  }
}

function itemTarget(tokenId?: number | null): string {
  return tokenId ? `${WARPLETS_BASE_URL}/?warplet=${tokenId}` : WARPLETS_BASE_URL;
}

function wrapTargetUrl(notificationId: string, fid: number, targetUrl: string): string {
  const params = new URLSearchParams({
    app: APP_SLUG,
    fid: String(fid),
    t: targetUrl,
  });
  return `${WARPLETS_BASE_URL}/n/${encodeURIComponent(notificationId)}?${params.toString()}`;
}

function makeEventKey(input: ActivityInput): string {
  const tokenId = normalizeTokenId(input.tokenId) ?? "collection";
  let unique =
    input.transactionHash ||
    input.orderHash ||
    input.occurredAt ||
    `${normalizeWallet(input.actorWallet) || "unknown"}:${normalizeTimestamp(input.occurredAt)}`;
  if (!input.transactionHash && !input.orderHash && input.rawPayload && typeof input.rawPayload === "object" && "id" in input.rawPayload) {
    unique = String((input.rawPayload as { id?: unknown }).id);
  }
  return `${APP_SLUG}:${input.eventType}:${tokenId}:${unique}`.slice(0, 240);
}

async function getEthUsd(env: WarpletNotificationEnv): Promise<number | null> {
  const cacheKey = "warplets:notifications:eth-usd:v1";
  if (env.WARPLETS_KV) {
    const cached = await env.WARPLETS_KV.get(cacheKey);
    const value = cached ? Number(cached) : NaN;
    if (Number.isFinite(value) && value > 0) return value;
  }

  const fetchJson = async (url: string): Promise<Record<string, unknown>> => {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`ETH/USD fetch failed: ${response.status}`);
    return response.json();
  };

  let value: number | null = null;
  try {
    const data = await fetchJson("https://api.coinbase.com/v2/exchange-rates?currency=ETH");
    const rates = (data.data as { rates?: Record<string, unknown> } | undefined)?.rates;
    value = Number(rates?.USD);
  } catch {
    try {
      const data = await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
      value = Number((data.ethereum as { usd?: unknown } | undefined)?.usd);
    } catch {
      value = null;
    }
  }

  if (value && Number.isFinite(value) && env.WARPLETS_KV) {
    await env.WARPLETS_KV.put(cacheKey, String(value), { expirationTtl: 60 * 30 });
  }
  return value && Number.isFinite(value) ? value : null;
}

export async function resolveFidForWallet(
  env: WarpletNotificationEnv,
  wallet?: string | null,
): Promise<number | null> {
  const normalized = normalizeWallet(wallet);
  if (!normalized) return null;

  try {
    const linkColumns = await getTableColumns(env, "wallet_farcaster_links");
    if (linkColumns.has("wallet") && linkColumns.has("fid")) {
      const scoreColumn = linkColumns.has("neynar_score") ? "neynar_score" : linkColumns.has("score") ? "score" : null;
      const linked = await env.WARPLETS.prepare(
        `SELECT fid
         FROM wallet_farcaster_links
         WHERE lower(wallet) = ?
         ORDER BY ${scoreColumn ? `COALESCE(${scoreColumn}, 0) DESC, ` : ""}fid ASC
         LIMIT 1`,
      )
        .bind(normalized)
        .first<{ fid: number }>();
      if (linked?.fid) return Number(linked.fid);
    }
  } catch (error) {
    console.warn("resolveFidForWallet wallet_farcaster_links lookup failed", error);
  }

  try {
    const userColumns = await getTableColumns(env, "warplets_users");
    if (!userColumns.has("primary_eth_address") || !userColumns.has("fid")) return null;
    const updatedColumn = userColumns.has("updated_at")
      ? "updated_at"
      : userColumns.has("updated_on")
        ? "updated_on"
        : userColumns.has("created_on")
          ? "created_on"
          : "fid";
    const user = await env.WARPLETS.prepare(
      `SELECT fid
       FROM warplets_users
       WHERE lower(primary_eth_address) = ?
       ORDER BY ${updatedColumn} DESC
       LIMIT 1`,
    )
      .bind(normalized)
      .first<{ fid: number }>();
    return user?.fid ? Number(user.fid) : null;
  } catch (error) {
    console.warn("resolveFidForWallet warplets_users lookup failed", error);
    return null;
  }
}

async function resolveUsernameForFid(env: WarpletNotificationEnv, fid?: number | null): Promise<string | null> {
  if (!fid) return null;
  const user = await env.WARPLETS.prepare(
    `SELECT username FROM warplets_users WHERE fid = ? LIMIT 1`,
  )
    .bind(fid)
    .first<{ username: string | null }>();
  return user?.username || null;
}

async function getCurrentOwner(
  env: WarpletNotificationEnv,
  tokenId?: number | null,
): Promise<{ wallet: string | null; fid: number | null }> {
  if (!tokenId) return { wallet: null, fid: null };
  const row = await env.WARPLETS.prepare(
    `SELECT owner_wallet, owner_fid FROM warplet_market_state WHERE token_id = ? LIMIT 1`,
  )
    .bind(tokenId)
    .first<{ owner_wallet: string | null; owner_fid: number | null }>();
  return {
    wallet: normalizeWallet(row?.owner_wallet),
    fid: row?.owner_fid ? Number(row.owner_fid) : null,
  };
}

async function queueNotification(
  env: WarpletNotificationEnv,
  params: {
    category: NotificationCategory;
    priority: number;
    fid: number;
    eventId?: number | null;
    eventKey: string;
    title: string;
    body: string;
    targetUrl: string;
  },
): Promise<void> {
  if (!params.fid || !Number.isFinite(params.fid)) return;
  const notificationId = `warplets:${params.category}:${params.eventKey}:${params.fid}`.slice(0, 120);
  const queueKey = `${params.category}:${params.fid}:${params.eventKey}`.slice(0, 220);
  const wrappedTargetUrl = wrapTargetUrl(notificationId, params.fid, params.targetUrl);

  await env.WARPLETS.prepare(
    `INSERT OR IGNORE INTO notification_queue
       (queue_key, notification_id, app_slug, category, priority, fid, event_id, title, body, target_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      queueKey,
      notificationId,
      APP_SLUG,
      params.category,
      params.priority,
      params.fid,
      params.eventId ?? null,
      truncate(params.title, 32),
      truncate(params.body, 128),
      wrappedTargetUrl,
    )
    .run();
}

async function buildBody(
  env: WarpletNotificationEnv,
  row: ActivityRow,
  tokenOverride?: number | null,
): Promise<string> {
  const tokenId = tokenOverride ?? row.token_id;
  const ethUsd = await getEthUsd(env);
  const amount = compactAmount(row.amount_eth, ethUsd);
  const actor = actorLabel(row);

  switch (row.event_type) {
    case "purchased":
      return amount
        ? `${actor} purchased 10X Warplet #${tokenId} for ${amount}`
        : `${actor} purchased 10X Warplet #${tokenId}`;
    case "offered":
      return amount
        ? `${actor} offered to buy 10X Warplet #${tokenId} for ${amount}`
        : `${actor} offered to buy 10X Warplet #${tokenId}`;
    case "listed":
      return amount
        ? `${actor} listed 10X Warplet #${tokenId} for ${amount}`
        : `${actor} listed 10X Warplet #${tokenId}`;
    case "sold": {
      const buyerUsername = await resolveUsernameForFid(env, row.counterparty_fid);
      const buyer = buyerUsername ? ` to @${buyerUsername}` : "";
      return amount
        ? `${actor} sold 10X Warplet #${tokenId} for ${amount}${buyer}`
        : `${actor} sold 10X Warplet #${tokenId}${buyer}`;
    }
    case "favourited":
      return `${actor} favourited 10X Warplet #${tokenId}`;
    case "collection_top_offer":
      return amount
        ? `${actor} made a new top collection offer for ${amount}`
        : `${actor} made a new top collection offer`;
    case "trait_top_offer": {
      const traitLabel = traitLabelFromPayload(row.raw_payload);
      return amount
        ? `${actor} made a new top trait offer for ${traitLabel} at ${amount}`
        : `${actor} made a new top trait offer for ${traitLabel}`;
    }
    default:
      return `${actor} updated 10X Warplet #${tokenId}`;
  }
}

async function favouriteRecipientFids(env: WarpletNotificationEnv, tokenId: number): Promise<number[]> {
  const rows = await env.WARPLETS.prepare(
    `SELECT wallet, token_ids
     FROM warplet_favourites
     WHERE token_ids LIKE ?
     LIMIT 1000`,
  )
    .bind(`%${tokenId}%`)
    .all<{ wallet: string; token_ids: string }>();

  const fids: number[] = [];
  for (const row of rows.results || []) {
    try {
      const ids = JSON.parse(row.token_ids);
      if (!Array.isArray(ids) || !ids.includes(tokenId)) continue;
      const fid = await resolveFidForWallet(env, row.wallet);
      if (fid) fids.push(fid);
    } catch {
      // Ignore malformed preference rows; writes validate this data.
    }
  }
  return Array.from(new Set(fids));
}

async function queueInstantNotificationsForEvent(env: WarpletNotificationEnv, row: ActivityRow): Promise<void> {
  const tokenId = row.token_id;
  const queuedFids = new Set<number>();

  if (row.event_type === "collection_top_offer") {
    await env.WARPLETS.prepare(
      `UPDATE notification_queue
       SET status = 'superseded', last_error = 'Superseded by a newer top collection offer',
           updated_at = CURRENT_TIMESTAMP
       WHERE app_slug = ? AND status IN ('pending', 'retry') AND event_id IN (
         SELECT id FROM warplet_activity_events
         WHERE event_type = 'collection_top_offer' AND id <> ?
       )`,
    ).bind(APP_SLUG, row.id).run();

    const cursorState = await env.WARPLETS.prepare(
      `SELECT value FROM notification_job_state WHERE job_key = ? LIMIT 1`,
    )
      .bind(COLLECTION_OFFER_AUDIENCE_CURSOR_KEY)
      .first<{ value: string | null }>();
    const parsedCursor = Number(cursorState?.value);
    const audienceCursor = Number.isSafeInteger(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0;
    const actorFid = Number(row.actor_fid) || 0;

    const owners = await env.WARPLETS.prepare(
      `SELECT owner_fid AS fid, MIN(token_id) AS token_id
       FROM warplet_market_state
       WHERE owner_fid IS NOT NULL
         AND owner_fid <> ?
         AND (
         EXISTS (
           SELECT 1 FROM miniapp_notification_tokens token
           WHERE token.fid = warplet_market_state.owner_fid
             AND token.app_slug = ? AND token.enabled = 1
         )
         OR EXISTS (
           SELECT 1 FROM app_identity_links identity
           WHERE identity.farcaster_fid = warplet_market_state.owner_fid
         )
       )
       GROUP BY owner_fid
       ORDER BY CASE WHEN owner_fid > ? THEN 0 ELSE 1 END, owner_fid ASC
       LIMIT ?`,
    )
      .bind(actorFid, APP_SLUG, audienceCursor, MAX_COLLECTION_OFFER_RECIPIENTS)
      .all<{ fid: number; token_id: number }>();

    for (const owner of owners.results || []) {
      const fid = Number(owner.fid);
      if (!fid || queuedFids.has(fid)) continue;
      queuedFids.add(fid);
      await queueNotification(env, {
        category: "owned",
        priority: 15,
        fid,
        eventId: row.id,
        eventKey: `${row.event_key}:${owner.token_id}`,
        title: "10X Warplets",
        body: await buildBody(env, row, Number(owner.token_id)),
        targetUrl: itemTarget(Number(owner.token_id)),
      });
    }
    const lastSelectedFid = Number(owners.results?.at(-1)?.fid);
    if (Number.isSafeInteger(lastSelectedFid) && lastSelectedFid > 0) {
      await env.WARPLETS.prepare(
        `INSERT INTO notification_job_state (job_key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(job_key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      )
        .bind(COLLECTION_OFFER_AUDIENCE_CURSOR_KEY, String(lastSelectedFid))
        .run();
    }
    await env.WARPLETS.prepare(
      `UPDATE warplet_activity_events SET queued_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
      .bind(row.id)
      .run();
    return;
  }

  if (row.event_type === "trait_top_offer") {
    const owners = await env.WARPLETS.prepare(
      `SELECT ms.owner_fid AS fid, MIN(ms.token_id) AS token_id
       FROM opensea_criteria_offer_matches match
       JOIN warplet_market_state ms ON ms.token_id = match.token_id
       WHERE match.order_hash = ?
         AND ms.owner_fid IS NOT NULL
       GROUP BY ms.owner_fid
       LIMIT 10000`,
    ).bind(row.order_hash).all<{ fid: number; token_id: number }>().catch(() => ({ results: [] }));

    for (const owner of owners.results || []) {
      const fid = Number(owner.fid);
      if (!fid || fid === row.actor_fid || queuedFids.has(fid)) continue;
      queuedFids.add(fid);
      await queueNotification(env, {
        category: "owned",
        priority: 15,
        fid,
        eventId: row.id,
        eventKey: `${row.event_key}:${owner.token_id}`,
        title: "10X Warplets",
        body: await buildBody(env, row, Number(owner.token_id)),
        targetUrl: itemTarget(Number(owner.token_id)),
      });
    }
    await env.WARPLETS.prepare(
      `UPDATE warplet_activity_events SET queued_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
      .bind(row.id)
      .run();
    return;
  }

  if (!tokenId) return;

  let ownerFid = row.owner_fid;
  if (!ownerFid && row.owner_wallet) {
    ownerFid = await resolveFidForWallet(env, row.owner_wallet);
  }
  if (!ownerFid && ["offered", "favourited", "listed"].includes(row.event_type)) {
    ownerFid = (await getCurrentOwner(env, tokenId)).fid;
  }

  if (ownerFid && ownerFid !== row.actor_fid && ["offered", "favourited", "purchased"].includes(row.event_type)) {
    queuedFids.add(ownerFid);
    await queueNotification(env, {
      category: "owned",
      priority: 10,
      fid: ownerFid,
      eventId: row.id,
      eventKey: row.event_key,
      title: "10X Warplets",
      body: await buildBody(env, row),
      targetUrl: itemTarget(tokenId),
    });
  }

  if (["offered", "listed", "sold", "purchased"].includes(row.event_type)) {
    const offeredRows = await env.WARPLETS.prepare(
      `SELECT offerer_fid, amount_eth
       FROM warplet_active_item_offers
       WHERE token_id = ? AND active = 1 AND offerer_fid IS NOT NULL
       LIMIT 1000`,
    )
      .bind(tokenId)
      .all<{ offerer_fid: number; amount_eth: number | null }>();

    for (const offer of offeredRows.results || []) {
      const fid = Number(offer.offerer_fid);
      if (!fid || fid === row.actor_fid || queuedFids.has(fid)) continue;
      if (row.event_type === "offered" && row.amount_eth != null && offer.amount_eth != null) {
        if (Number(offer.amount_eth) >= Number(row.amount_eth)) continue;
      }
      queuedFids.add(fid);
      await queueNotification(env, {
        category: "offered",
        priority: 20,
        fid,
        eventId: row.id,
        eventKey: row.event_key,
        title: "10X Warplets",
        body: await buildBody(env, row),
        targetUrl: itemTarget(tokenId),
      });
    }
  }

  if (["listed", "sold", "purchased"].includes(row.event_type)) {
    const traitOfferRows = await env.WARPLETS.prepare(
      `SELECT offer.offerer_wallet, offer.offer_eth AS amount_eth
       FROM opensea_criteria_offer_matches match
       JOIN opensea_criteria_offers offer ON offer.order_hash = match.order_hash
       WHERE match.token_id = ?
         AND offer.active = 1
         AND offer.criteria_kind = 'trait'
       LIMIT 1000`,
    ).bind(tokenId).all<{ offerer_wallet: string | null; amount_eth: number | null }>().catch(() => ({ results: [] }));

    for (const offer of traitOfferRows.results || []) {
      const fid = await resolveFidForWallet(env, offer.offerer_wallet);
      if (!fid || fid === row.actor_fid || queuedFids.has(fid)) continue;
      queuedFids.add(fid);
      await queueNotification(env, {
        category: "offered",
        priority: 20,
        fid,
        eventId: row.id,
        eventKey: `${row.event_key}:trait:${fid}`,
        title: "10X Warplets",
        body: await buildBody(env, row),
        targetUrl: itemTarget(tokenId),
      });
    }
  }

  if (["offered", "listed", "sold", "purchased"].includes(row.event_type)) {
    for (const fid of await favouriteRecipientFids(env, tokenId)) {
      if (!fid || fid === row.actor_fid || queuedFids.has(fid)) continue;
      queuedFids.add(fid);
      await queueNotification(env, {
        category: "favourited",
        priority: 30,
        fid,
        eventId: row.id,
        eventKey: row.event_key,
        title: "10X Warplets",
        body: await buildBody(env, row),
        targetUrl: itemTarget(tokenId),
      });
    }
  }

  await env.WARPLETS.prepare(
    `UPDATE warplet_activity_events SET queued_at = CURRENT_TIMESTAMP WHERE id = ?`,
  )
    .bind(row.id)
    .run();
}

export async function recordWarpletActivity(
  env: WarpletNotificationEnv,
  input: ActivityInput,
): Promise<ActivityRow | null> {
  const tokenId = normalizeTokenId(input.tokenId);
  const eventKey = input.eventKey || makeEventKey(input);
  const actorWallet = normalizeWallet(input.actorWallet);
  const ownerWallet = normalizeWallet(input.ownerWallet);
  const counterpartyWallet = normalizeWallet(input.counterpartyWallet);
  const actorFid = input.actorFid ?? (actorWallet ? await resolveFidForWallet(env, actorWallet) : null);
  const ownerFid = input.ownerFid ?? (ownerWallet ? await resolveFidForWallet(env, ownerWallet) : null);
  const counterpartyFid =
    input.counterpartyFid ?? (counterpartyWallet ? await resolveFidForWallet(env, counterpartyWallet) : null);
  const actorUsername = input.actorUsername || (actorFid ? await resolveUsernameForFid(env, actorFid) : null);

  await env.WARPLETS.prepare(
    `INSERT OR IGNORE INTO warplet_activity_events
       (event_key, event_type, token_id, actor_wallet, actor_fid, actor_username,
        owner_wallet, owner_fid, counterparty_wallet, counterparty_fid,
        amount_eth, amount_raw, currency_symbol, order_hash, transaction_hash,
        source, occurred_at, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      eventKey,
      input.eventType,
      tokenId,
      actorWallet,
      actorFid,
      actorUsername,
      ownerWallet,
      ownerFid,
      counterpartyWallet,
      counterpartyFid,
      input.amountEth ?? null,
      input.amountRaw ?? null,
      input.currencySymbol ?? null,
      input.orderHash ?? null,
      input.transactionHash ?? null,
      input.source || WARPLETS_APP_SLUG,
      normalizeTimestamp(input.occurredAt),
      safeJson(input.rawPayload),
    )
    .run();

  const row = await env.WARPLETS.prepare(
    `SELECT * FROM warplet_activity_events WHERE event_key = ? LIMIT 1`,
  )
    .bind(eventKey)
    .first<ActivityRow>();

  const disposition = row
    ? activityNotificationDisposition(input.queue, row.queued_at)
    : "already_handled";
  if (row && disposition !== "already_handled") {
    if (disposition === "suppress") {
      await env.WARPLETS.prepare(
        `UPDATE warplet_activity_events
         SET queued_at = CURRENT_TIMESTAMP
         WHERE id = ? AND queued_at IS NULL`,
      )
        .bind(row.id)
        .run();
      row.queued_at = new Date().toISOString();
    } else {
      await queueInstantNotificationsForEvent(env, row);
    }
  }
  return row || null;
}

export function activityNotificationDisposition(
  queue: boolean | undefined,
  queuedAt: string | null | undefined,
): "already_handled" | "suppress" | "queue" {
  if (queuedAt) return "already_handled";
  return queue === false ? "suppress" : "queue";
}

export async function upsertActiveItemOffer(
  env: WarpletNotificationEnv,
  input: {
    orderHash?: string | null;
    tokenId?: number | string | null;
    offererWallet?: string | null;
    amountEth?: number | null;
    amountRaw?: string | null;
    currencySymbol?: string | null;
    protocolAddress?: string | null;
    createdAt?: string | null;
    expiresAt?: string | null;
  },
): Promise<boolean> {
  const orderHash = input.orderHash?.trim();
  const tokenId = normalizeTokenId(input.tokenId);
  if (!orderHash || !tokenId) return false;
  const offererWallet = normalizeWallet(input.offererWallet);
  const createdAt = input.createdAt ? normalizeTimestamp(input.createdAt) : null;
  const expiresAt = input.expiresAt ? normalizeTimestamp(input.expiresAt) : null;
  const existing = await env.WARPLETS.prepare(
    `SELECT token_id, offerer_wallet, amount_eth, amount_raw, currency_symbol,
            protocol_address, active, created_at, expires_at
     FROM warplet_active_item_offers
     WHERE order_hash = ?
     LIMIT 1`,
  )
    .bind(orderHash)
    .first<Record<string, unknown>>()
    .catch(() => null);
  const unchanged = existing &&
    Number(existing.token_id) === tokenId &&
    String(existing.offerer_wallet ?? "") === String(offererWallet ?? "") &&
    String(existing.amount_eth ?? "") === String(input.amountEth ?? "") &&
    String(existing.amount_raw ?? "") === String(input.amountRaw ?? "") &&
    String(existing.currency_symbol ?? "") === String(input.currencySymbol ?? "") &&
    String(existing.protocol_address ?? "") === String(input.protocolAddress ?? "") &&
    Number(existing.active) === 1 &&
    String(existing.created_at ?? "") === String(createdAt ?? "") &&
    String(existing.expires_at ?? "") === String(expiresAt ?? "");
  if (unchanged) return false;

  const offererFid = await resolveFidForWallet(env, offererWallet);

  await env.WARPLETS.prepare(
    `INSERT INTO warplet_active_item_offers
       (order_hash, token_id, offerer_wallet, offerer_fid, amount_eth, amount_raw,
        currency_symbol, protocol_address, active, created_at, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(order_hash) DO UPDATE SET
       token_id = excluded.token_id,
       offerer_wallet = excluded.offerer_wallet,
       offerer_fid = excluded.offerer_fid,
       amount_eth = excluded.amount_eth,
       amount_raw = excluded.amount_raw,
       currency_symbol = excluded.currency_symbol,
       protocol_address = excluded.protocol_address,
       active = 1,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      orderHash,
      tokenId,
      offererWallet,
      offererFid,
      input.amountEth ?? null,
      input.amountRaw ?? null,
      input.currencySymbol ?? null,
      input.protocolAddress ?? null,
      createdAt,
      expiresAt,
    )
    .run();
  return true;
}

export async function deactivateActiveItemOffer(
  env: WarpletNotificationEnv,
  orderHash?: string | null,
): Promise<void> {
  const hash = orderHash?.trim();
  if (!hash) return;
  await env.WARPLETS.prepare(
    `UPDATE warplet_active_item_offers SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE order_hash = ?`,
  )
    .bind(hash)
    .run();
}

async function shouldThrottle(env: WarpletNotificationEnv, fid: number): Promise<{ throttle: boolean; reason?: string }> {
  const recent = await env.WARPLETS.prepare(
    `SELECT COUNT(*) AS count
     FROM notification_dispatches
     WHERE fid = ? AND app_slug = ? AND status IN ('sent', 'delivered')
       AND updated_at >= datetime('now', '-30 seconds')`,
  )
    .bind(fid, APP_SLUG)
    .first<{ count: number }>();
  if (Number(recent?.count || 0) > 0) return { throttle: true, reason: "30s throttle" };

  const daily = await env.WARPLETS.prepare(
    `SELECT COUNT(*) AS count
     FROM notification_dispatches
     WHERE fid = ? AND app_slug = ? AND status IN ('sent', 'delivered')
       AND created_at >= datetime('now', '-1 day')`,
  )
    .bind(fid, APP_SLUG)
    .first<{ count: number }>();
  if (Number(daily?.count || 0) >= 90) return { throttle: true, reason: "daily soft cap" };

  return { throttle: false };
}

export async function processNotificationQueue(
  env: WarpletNotificationEnv,
  limit = 100,
): Promise<{ processed: number; sent: number; retried: number; skipped: number }> {
  const rows = await env.WARPLETS.prepare(
    `SELECT *
     FROM notification_queue
     WHERE app_slug = ? AND status IN ('pending', 'retry')
       AND datetime(next_attempt_at) <= datetime('now')
     ORDER BY priority ASC, created_at ASC
     LIMIT ?`,
  )
    .bind(APP_SLUG, env.BASE_NOTIFICATIONS_ENABLED === "true" ? Math.min(limit, 20) : limit)
    .all<{
      id: number;
      notification_id: string;
      fid: number;
      title: string;
      body: string;
      target_url: string;
      attempt_count: number;
    }>();

  let sent = 0;
  let retried = 0;
  let skipped = 0;

  for (const row of rows.results || []) {
    const throttle = await shouldThrottle(env, Number(row.fid));
    if (throttle.throttle) {
      skipped += 1;
      await env.WARPLETS.prepare(
        `UPDATE notification_queue
         SET status = 'retry', next_attempt_at = datetime('now', '+5 minutes'),
             last_error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
        .bind(throttle.reason || "throttled", row.id)
        .run();
      continue;
    }

    const linkedWallets = env.BASE_NOTIFICATIONS_ENABLED === "true"
      ? await env.WARPLETS.prepare(
          `SELECT lower(wallet_address) AS wallet FROM app_identity_links WHERE farcaster_fid = ?
           UNION
           SELECT lower(wallet) AS wallet FROM wallet_farcaster_links WHERE fid = ?
           LIMIT 10`,
        ).bind(Number(row.fid), Number(row.fid)).all<{ wallet: string }>()
      : { results: [] as Array<{ wallet: string }> };
    const wallets = [...new Set((linkedWallets.results ?? []).map((item) => item.wallet))];
    let baseDelivered = false;
    let baseFailure: string | null = null;
    let basePermanentlyUnavailable = false;
    if (wallets.length > 0) {
      try {
        const wrappedTarget = new URL(row.target_url);
        const rawTarget = wrappedTarget.searchParams.get("t") || WARPLETS_BASE_URL;
        const parsedTarget = new URL(rawTarget);
        const baseResults = await sendBaseNotificationCampaign(env as WarpletNotificationEnv & BaseNotificationsEnv, {
          campaignId: row.notification_id,
          appSlug: APP_SLUG,
          wallets,
          title: row.title,
          message: row.body,
          targetPath: `${parsedTarget.pathname}${parsedTarget.search}`,
        });
        baseDelivered = baseResults.some((result) => result.state === "delivered");
        const failures = baseResults
          .filter((result) => result.state !== "delivered")
          .map((result) => result.error)
          .filter((error): error is string => Boolean(error));
        baseFailure = failures.length > 0 ? [...new Set(failures)].join("; ").slice(0, 500) : null;
        basePermanentlyUnavailable = failures.length === baseResults.length &&
          failures.every(isPermanentBaseNotificationFailure);
      } catch (error) {
        baseFailure = error instanceof Error ? error.message : String(error);
        basePermanentlyUnavailable = isPermanentBaseNotificationFailure(baseFailure);
        console.warn("Base notification delivery failed:", error);
      }
    }

    const token = await env.WARPLETS.prepare(
      `SELECT notification_url, notification_token
       FROM miniapp_notification_tokens
       WHERE fid = ? AND app_slug = ? AND enabled = 1
       LIMIT 1`,
    )
      .bind(Number(row.fid), APP_SLUG)
      .first<{ notification_url: string; notification_token: string }>();

    if (!token?.notification_url || !token?.notification_token) {
      if (baseDelivered) sent += 1;
      const attempts = Number(row.attempt_count || 0) + 1;
      const retryable = wallets.length > 0 &&
        !basePermanentlyUnavailable &&
        attempts < MAX_TRANSACTIONAL_RETRY_ATTEMPTS;
      if (!baseDelivered && retryable) retried += 1;
      else if (!baseDelivered) skipped += 1;
      const nextStatus = baseDelivered ? "sent" : retryable ? "retry" : "no_token";
      await env.WARPLETS.prepare(
        `UPDATE notification_queue
         SET status = ?, sent_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE sent_at END,
             attempt_count = attempt_count + CASE WHEN ? THEN 1 ELSE 0 END,
             next_attempt_at = CASE WHEN ? THEN datetime('now', '+5 minutes') ELSE next_attempt_at END,
             last_error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
        .bind(
          nextStatus,
          baseDelivered ? 1 : 0,
          wallets.length > 0 && !baseDelivered ? 1 : 0,
          retryable ? 1 : 0,
          baseDelivered ? null : baseFailure || (wallets.length > 0
            ? attempts >= MAX_TRANSACTIONAL_RETRY_ATTEMPTS
              ? "Retry limit reached; no Farcaster token"
              : "Base delivery failed; no Farcaster token"
            : "No enabled Warplets notification token"),
          row.id,
        )
        .run();
      continue;
    }

    const result = await dispatchNotification(env.WARPLETS, {
      appSlug: APP_SLUG,
      fid: Number(row.fid),
      notificationUrl: token.notification_url,
      notificationToken: token.notification_token,
      notificationId: row.notification_id,
      title: row.title,
      body: row.body,
      targetUrl: row.target_url,
    });

    if (result.state === "success") {
      sent += 1;
      await env.WARPLETS.prepare(
        `UPDATE notification_queue
         SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, last_error = NULL
         WHERE id = ?`,
      )
        .bind(row.id)
        .run();
    } else if (result.state === "invalid_token" || result.state === "no_token") {
      skipped += 1;
      await env.WARPLETS.prepare(
        `UPDATE notification_queue
         SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
        .bind(result.state, result.state, row.id)
        .run();
    } else {
      const attempts = Number(row.attempt_count || 0) + 1;
      const retryable = result.state !== "validation_error" && attempts < MAX_TRANSACTIONAL_RETRY_ATTEMPTS;
      if (retryable) retried += 1;
      else skipped += 1;
      const delayMinutes = Math.min(60, Math.pow(2, Math.min(6, Number(row.attempt_count || 0))));
      await env.WARPLETS.prepare(
        `UPDATE notification_queue
         SET status = ?,
             attempt_count = attempt_count + 1,
             next_attempt_at = datetime('now', ?),
             last_error = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
        .bind(
          retryable ? "retry" : "failed",
          `+${delayMinutes} minutes`,
          result.state === "validation_error"
            ? result.message
            : result.state === "failed"
            ? String(result.error)
            : result.state,
          row.id,
        )
        .run();
    }
  }

  return { processed: rows.results?.length || 0, sent, retried, skipped };
}

export async function runBestFriendNotifications(env: WarpletNotificationEnv): Promise<number> {
  const hourKey = new Date().toISOString().slice(0, 13);
  const stateKey = `warplets:best-friends:${hourKey}`;
  const existing = await env.WARPLETS.prepare(
    `SELECT value FROM notification_job_state WHERE job_key = ? LIMIT 1`,
  )
    .bind(stateKey)
    .first<{ value: string | null }>();
  if (existing) return 0;

  const rows = await env.WARPLETS.prepare(
    `SELECT bf.user_fid AS fid, e.*
     FROM warplet_activity_events e
     JOIN warplets_user_best_friends bf ON bf.best_friend_fid = e.actor_fid
     JOIN miniapp_notification_tokens t ON t.fid = bf.user_fid AND t.app_slug = ? AND t.enabled = 1
     WHERE datetime(e.occurred_at) >= datetime('now', '-1 hour')
       AND e.actor_fid IS NOT NULL
     ORDER BY bf.user_fid ASC, bf.mutual_affinity_score DESC, e.occurred_at DESC
     LIMIT 5000`,
  )
    .bind(APP_SLUG)
    .all<ActivityRow & { fid: number }>();

  const selected = new Map<number, ActivityRow & { fid: number }>();
  for (const row of rows.results || []) {
    const current = selected.get(Number(row.fid));
    if (!current) {
      selected.set(Number(row.fid), row);
      continue;
    }
    const currentPriority = ACTION_PRIORITY[current.event_type] ?? 99;
    const nextPriority = ACTION_PRIORITY[row.event_type] ?? 99;
    if (nextPriority < currentPriority) selected.set(Number(row.fid), row);
  }

  for (const row of selected.values()) {
    await queueNotification(env, {
      category: "best_friend",
      priority: 40,
      fid: Number(row.fid),
      eventId: row.id,
      eventKey: `${hourKey}:${row.event_key}`,
      title: "10X Warplets",
      body: await buildBody(env, row),
      targetUrl: itemTarget(row.token_id),
    });
  }

  await env.WARPLETS.prepare(
    `INSERT INTO notification_job_state (job_key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(job_key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(stateKey, String(selected.size))
    .run();
  return selected.size;
}

interface GlobalStatsCampaign {
  campaignId: string;
  body: string;
  totalCount: number;
}

function parseGlobalStatsCampaign(value?: string | null): GlobalStatsCampaign | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<GlobalStatsCampaign>;
    if (
      typeof parsed.campaignId !== "string" ||
      typeof parsed.body !== "string" ||
      typeof parsed.totalCount !== "number"
    ) return null;
    return { campaignId: parsed.campaignId, body: parsed.body, totalCount: parsed.totalCount };
  } catch {
    return null;
  }
}

async function recordFarcasterChannelDelivery(
  env: WarpletNotificationEnv,
  campaignId: string,
  fid: number,
  state: "success" | "no_token" | "rate_limited" | "invalid_token" | "failed" | "validation_error",
): Promise<void> {
  const now = new Date().toISOString();
  const status = state === "success"
    ? "delivered"
    : state === "invalid_token" || state === "no_token" || state === "validation_error"
    ? "invalid"
    : state === "rate_limited"
    ? "rate_limited"
    : "failed";
  await env.WARPLETS.prepare(
    `INSERT INTO notification_channel_deliveries
       (campaign_id, app_slug, channel, recipient_key, farcaster_fid, status, attempts, last_error, created_at, updated_at)
     VALUES (?, ?, 'farcaster', ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(campaign_id, app_slug, channel, recipient_key) DO UPDATE SET
       status = excluded.status,
       attempts = notification_channel_deliveries.attempts + 1,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`,
  ).bind(
    campaignId,
    APP_SLUG,
    String(fid),
    fid,
    status,
    status === "delivered" ? null : state,
    now,
    now,
  ).run();
}

export async function runGlobalStatsNotifications(env: WarpletNotificationEnv): Promise<number> {
  const [lastState, activeState] = await Promise.all([
    env.WARPLETS.prepare(
      `SELECT value, updated_at FROM notification_job_state WHERE job_key = ? LIMIT 1`,
    ).bind(GLOBAL_STATS_LAST_JOB_KEY).first<{ value: string | null; updated_at: string }>(),
    env.WARPLETS.prepare(
      `SELECT value FROM notification_job_state WHERE job_key = ? LIMIT 1`,
    ).bind(GLOBAL_STATS_ACTIVE_JOB_KEY).first<{ value: string | null }>(),
  ]);
  const activeCampaign = parseGlobalStatsCampaign(activeState?.value);
  if (
    !activeCampaign &&
    lastState?.updated_at &&
    Date.now() - new Date(lastState.updated_at).getTime() < 23 * 60 * 60 * 1000
  ) return 0;

  let campaign = activeCampaign;
  if (!campaign) {
    const rows = await env.WARPLETS.prepare(
      `SELECT event_type, COUNT(*) AS count, COALESCE(SUM(amount_eth), 0) AS eth_total
       FROM warplet_activity_events
       WHERE datetime(occurred_at) >= datetime('now', '-24 hours')
         AND event_type IN ('listed', 'offered', 'trait_top_offer', 'sold')
       GROUP BY event_type`,
    ).all<{ event_type: WarpletActivityType; count: number; eth_total: number }>();
    const stats = new Map(rows.results?.map((row) => [row.event_type, row]) || []);
    const listings = stats.get("listed");
    const offers = {
      count: Number(stats.get("offered")?.count || 0) + Number(stats.get("trait_top_offer")?.count || 0),
      eth_total: Number(stats.get("offered")?.eth_total || 0) + Number(stats.get("trait_top_offer")?.eth_total || 0),
    };
    const sales = stats.get("sold");
    const totalCount = Number(listings?.count || 0) + offers.count + Number(sales?.count || 0);
    if (totalCount === 0) return 0;
    const ethUsd = await getEthUsd(env);
    const totalUsd = (eth: number) =>
      ethUsd && Number.isFinite(ethUsd) ? ` (~$${Math.round(eth * ethUsd).toLocaleString("en-US")})` : "";
    campaign = {
      campaignId: `${APP_SLUG}:global-stats:${new Date().toISOString().slice(0, 10)}`,
      totalCount,
      body: `24hr Stats: ${Number(listings?.count || 0).toLocaleString("en-US")} New Listings${totalUsd(
        Number(listings?.eth_total || 0),
      )}, ${offers.count.toLocaleString("en-US")} New Offers${totalUsd(
        offers.eth_total,
      )}, ${Number(sales?.count || 0).toLocaleString("en-US")} New Sales${totalUsd(Number(sales?.eth_total || 0))}.`.slice(0, 128),
    };
    await env.WARPLETS.prepare(
      `INSERT INTO notification_job_state (job_key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(job_key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).bind(GLOBAL_STATS_ACTIVE_JOB_KEY, JSON.stringify(campaign)).run();
  }

  const tokens = await env.WARPLETS.prepare(
    `SELECT fid, notification_url, notification_token
       FROM miniapp_notification_tokens
      WHERE app_slug = ? AND enabled = 1
      ORDER BY fid
      LIMIT 10000`,
  ).bind(APP_SLUG).all<{ fid: number; notification_url: string; notification_token: string }>();
  const webPush = await env.WARPLETS.prepare(
    `SELECT endpoint_hash, endpoint, p256dh, auth, app_slug, farcaster_fid, wallet_address
       FROM web_push_subscriptions
      WHERE app_slug = ? AND enabled = 1
        AND EXISTS (SELECT 1 FROM json_each(web_push_subscriptions.topics_json) WHERE value = 'announcements')
      ORDER BY updated_at DESC`,
  ).bind(APP_SLUG).all<WebPushSubscriptionRow>();

  let retryableFailure = false;
  let baseAudience: string[] = [];
  let baseAudienceResolved = false;
  try {
    baseAudience = await getBaseNotificationAudience(env as WarpletNotificationEnv & BaseNotificationsEnv, APP_SLUG);
    baseAudienceResolved = true;
  } catch (error) {
    retryableFailure = true;
    console.error("Daily Base notification audience lookup failed", error);
  }
  const audience = buildGlobalStatsAudience({
    farcasterFids: (tokens.results || []).map((token) => Number(token.fid)),
    baseWallets: baseAudience,
    webPushSubscriptions: webPush.results || [],
  });
  const tokenByFid = new Map((tokens.results || []).map((token) => [Number(token.fid), token]));
  for (const fid of audience.farcasterFids) {
    const token = tokenByFid.get(fid);
    if (!token) continue;
    const completed = await env.WARPLETS.prepare(
      `SELECT 1 AS delivered
         FROM notification_channel_deliveries
        WHERE campaign_id = ? AND app_slug = ? AND channel = 'farcaster'
          AND recipient_key = ? AND status = 'delivered'
        LIMIT 1`,
    ).bind(campaign.campaignId, APP_SLUG, String(fid)).first<{ delivered: number }>();
    if (completed?.delivered === 1) continue;
    const targetUrl = buildClickTrackingUrl({
      notificationId: campaign.campaignId,
      targetUrl: GLOBAL_STATS_TARGET_URL,
      trackingBaseUrl: WARPLETS_BASE_URL,
      appSlug: APP_SLUG,
      fid,
    });
    const result = await dispatchNotification(env.WARPLETS, {
      fid,
      appSlug: APP_SLUG,
      notificationUrl: token.notification_url,
      notificationToken: token.notification_token,
      notificationId: campaign.campaignId,
      title: "10X Warplets",
      body: campaign.body,
      targetUrl,
    });
    await recordFarcasterChannelDelivery(env, campaign.campaignId, fid, result.state);
    if (result.state === "failed" || result.state === "rate_limited") retryableFailure = true;
  }

  if (baseAudienceResolved) {
    try {
    const baseResults = await sendBaseNotificationCampaign(env as WarpletNotificationEnv & BaseNotificationsEnv, {
      campaignId: campaign.campaignId,
      appSlug: APP_SLUG,
      wallets: audience.baseWallets,
      title: "10X Warplets",
      message: campaign.body,
      targetPath: "/stats/market/30d",
    });
    if (baseResults.some((result) => result.state === "failed")) retryableFailure = true;
    } catch (error) {
      retryableFailure = true;
      console.error("Daily Base notification delivery failed", error);
    }
  }

  for (const subscription of audience.webPushSubscriptions) {
    const result = await sendWebPushNotification(env as WarpletNotificationEnv & WebPushEnv, subscription, {
      campaignId: campaign.campaignId,
      appSlug: APP_SLUG,
      title: "10X Warplets",
      body: campaign.body,
      targetUrl: GLOBAL_STATS_TARGET_URL,
    });
    if (result.state === "failed" || result.state === "rate_limited") retryableFailure = true;
  }

  const audienceSize = audience.farcasterFids.length + audience.baseWallets.length + audience.webPushSubscriptions.length;
  if (!retryableFailure) {
    await env.WARPLETS.batch([
      env.WARPLETS.prepare(
        `INSERT INTO notification_job_state (job_key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(job_key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      ).bind(GLOBAL_STATS_LAST_JOB_KEY, JSON.stringify({ ...campaign, audienceSize })),
      env.WARPLETS.prepare(`DELETE FROM notification_job_state WHERE job_key = ?`).bind(GLOBAL_STATS_ACTIVE_JOB_KEY),
    ]);
  }
  return audienceSize;
}

export async function runWarpletsNotificationJobs(env: WarpletNotificationEnv): Promise<{
  bestFriendsQueued: number;
  globalStatsQueued: number;
  queue: { processed: number; sent: number; retried: number; skipped: number };
}> {
  const bestFriendsQueued = await runBestFriendNotifications(env);
  const globalStatsQueued = await runGlobalStatsNotifications(env);
  const queue = await processNotificationQueue(env, 100);
  return { bestFriendsQueued, globalStatsQueued, queue };
}

export { APP_SLUG as WARPLETS_NOTIFICATION_APP_SLUG, OPEN_SEA_COLLECTION_URL };
