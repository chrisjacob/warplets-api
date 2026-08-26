/**
 * OpenSea event sync — designed to run as a Cloudflare Worker Cron Trigger.
 *
 * How resumption works:
 *   • After each successful run, the ISO timestamp of the most recent event
 *     processed is written to KV under `opensea_last_sync_at`.
 *   • On the next run, that value is read back and passed
 *     to the OpenSea API as the supported `after` filter, ensuring no events
 *     are missed across cron gaps.
 *   • On the very first run (or if KV is empty) we fall back to the last 24 h.
 *   • The `next` cursor returned by OpenSea is followed until exhausted so
 *     large bursts of activity are fully captured in a single cron invocation.
 *   • `INSERT OR IGNORE` (backed by a UNIQUE index on `transaction_hash`) makes
 *     re-processing overlapping windows fully idempotent for on-chain events.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENSEA_API_BASE = "https://api.opensea.io/api/v2";
const COLLECTION_SLUG = "10xwarplets";
// Only sales originating from this wallet count as legitimate distribution buys.
// 10xchris.eth pre-minted all tokens and distributes via private listings and accepted offers.
const DISTRIBUTION_WALLET = "0x4709a4b12daf0eedae0ef48a28a056640dee0846";
const KV_LAST_SYNC_KEY = "opensea_last_sync_at";
const KV_STATS_BUYS_KEY = "stats_buys";
const OPENSEA_REQUEST_TIMEOUT_MS = 12_000;
const OPENSEA_EVENTS_PAGE_SIZE = 200;
const OPENSEA_D1_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenseaSyncEnv {
  WARPLETS: D1Database;
  WARPLETS_KV: KVNamespace;
  OPENSEA_API_KEY?: string;
}

type OpenSeaPaymentToken = {
  symbol?: string;
};

type OpenSeaNft = {
  identifier?: string; // token_id
};

type OpenSeaEvent = {
  event_type: string;
  event_timestamp: string; // ISO 8601
  transaction: string | null;
  nft?: OpenSeaNft | null;
  seller?: string | null;
  buyer?: string | null;
  payment?: {
    quantity?: string; // raw amount in smallest unit (e.g. wei)
    token?: OpenSeaPaymentToken | null;
  } | null;
};

type OpenSeaEventsResponse = {
  asset_events?: OpenSeaEvent[];
  next?: string | null;
};

type PreparedOpenSeaEvent = {
  event: OpenSeaEvent;
  statement: D1PreparedStatement;
};

export type SyncResult = {
  processed: number;
  matched: number;
  skipped: number;
};

export type OpenseaSyncOptions = {
  // When provided, bypass KV resume and force a lookback window.
  occurredAfterSec?: number;
};

export type OpenSeaResumePoint = {
  occurredAfterSec: number;
  persistedCursorSec: number | null;
  source: "manual" | "persisted" | "lookback";
};

async function insertOpenSeaEventBatch(
  db: D1Database,
  preparedEvents: PreparedOpenSeaEvent[],
): Promise<Array<{ event: OpenSeaEvent; stored: boolean; inserted: boolean }>> {
  try {
    const results = await db.batch(preparedEvents.map(({ statement }) => statement));
    return preparedEvents.map(({ event }, index) => ({
      event,
      stored: true,
      inserted: (results[index]?.meta.changes ?? 0) > 0,
    }));
  } catch (batchError) {
    console.warn("[opensea-sync] batched event insert failed; retrying rows individually", batchError);
    const outcomes: Array<{ event: OpenSeaEvent; stored: boolean; inserted: boolean }> = [];
    for (const { event, statement } of preparedEvents) {
      try {
        const result = await statement.run();
        outcomes.push({ event, stored: true, inserted: (result.meta.changes ?? 0) > 0 });
      } catch (error) {
        console.error("[opensea-sync] insert error for event:", event.event_timestamp, error);
        outcomes.push({ event, stored: false, inserted: false });
      }
    }
    return outcomes;
  }
}

/** Normalize OpenSea ISO, Unix-second, and Unix-millisecond timestamps. */
export function parseOpenSeaTimestampSeconds(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "") return null;

  const numeric = typeof raw === "number"
    ? raw
    : /^\d+(?:\.\d+)?$/.test(raw)
      ? Number(raw)
      : Number.NaN;
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.floor(numeric >= 100_000_000_000 ? numeric / 1000 : numeric);
  }

  if (typeof raw !== "string") return null;
  const parsedMs = Date.parse(raw);
  return Number.isFinite(parsedMs) && parsedMs >= 0
    ? Math.floor(parsedMs / 1000)
    : null;
}

export function resolveOpenSeaResumePoint(
  lastSyncAt: string | null,
  occurredAfterOverride: number | undefined,
  nowMs = Date.now(),
): OpenSeaResumePoint {
  const persistedCursorSec = parseOpenSeaTimestampSeconds(lastSyncAt);
  const manualCursorSec = parseOpenSeaTimestampSeconds(occurredAfterOverride);
  if (manualCursorSec !== null) {
    return { occurredAfterSec: manualCursorSec, persistedCursorSec, source: "manual" };
  }
  if (persistedCursorSec !== null) {
    return { occurredAfterSec: persistedCursorSec, persistedCursorSec, source: "persisted" };
  }
  return {
    occurredAfterSec: Math.floor(nowMs / 1000) - 86400,
    persistedCursorSec,
    source: "lookback",
  };
}

export function buildOpenSeaSalesEventsUrl(
  occurredAfterSec: number,
  cursor: string | null = null,
): string {
  const params = new URLSearchParams({
    event_type: "sale",
    after: String(occurredAfterSec),
    limit: String(OPENSEA_EVENTS_PAGE_SIZE),
  });
  if (cursor) params.set("next", cursor);
  return `${OPENSEA_API_BASE}/events/collection/${COLLECTION_SLUG}?${params}`;
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

export async function runOpenseaSync(
  env: OpenseaSyncEnv,
  options: OpenseaSyncOptions = {},
): Promise<SyncResult> {
  const apiKey = env.OPENSEA_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[opensea-sync] OPENSEA_API_KEY not configured — skipping");
    return { processed: 0, matched: 0, skipped: 0 };
  }

  // -------------------------------------------------------------------------
  // 1. Determine resume point
  // -------------------------------------------------------------------------
  const lastSyncAt = await env.WARPLETS_KV.get(KV_LAST_SYNC_KEY);
  const resume = resolveOpenSeaResumePoint(lastSyncAt, options.occurredAfterSec);
  const occurredAfterSec = resume.occurredAfterSec;

  if (lastSyncAt && resume.persistedCursorSec === null) {
    console.warn(
      `[opensea-sync] invalid persisted cursor ${JSON.stringify(lastSyncAt)}; using a 24-hour lookback`,
    );
  }

  console.log(
    `[opensea-sync] resume cursor=${lastSyncAt ?? "none"} after=${occurredAfterSec} source=${resume.source}`,
  );

  // -------------------------------------------------------------------------
  // 2. Page through all events since last sync
  // -------------------------------------------------------------------------
  let cursor: string | null = null;
  let processed = 0;
  let matched = 0;
  let skipped = 0;
  let latestTimestampSec: number | null = resume.persistedCursorSec;
  let buyMatchFound = false;
  const distributionBuyerWallets = new Set<string>();

  do {
    const url = buildOpenSeaSalesEventsUrl(occurredAfterSec, cursor);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "x-api-key": apiKey,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(OPENSEA_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      console.error("[opensea-sync] network error fetching events:", err);
      break;
    }

    if (res.status === 429) {
      // Rate-limited — stop this run; next cron will resume from the same
      // last_sync_at timestamp so nothing is lost.
      console.warn("[opensea-sync] rate-limited (429), stopping early");
      break;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      console.error(`[opensea-sync] API error ${res.status}: ${body}`);
      break;
    }

    const data = (await res.json()) as OpenSeaEventsResponse;
    const events = data.asset_events ?? [];

    // -----------------------------------------------------------------------
    // 3. Process each event
    // -----------------------------------------------------------------------
    const preparedEvents = events.map((ev): PreparedOpenSeaEvent => ({
      event: ev,
      statement: env.WARPLETS.prepare(
        `INSERT OR IGNORE INTO opensea
          (event_type, token_id, wallet_from, wallet_to, transaction_hash,
           sale_price_wei, payment_token, event_timestamp, raw_payload, created_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      ).bind(
        ev.event_type,
        ev.nft?.identifier ?? null,
        ev.seller ?? null,
        ev.buyer ?? null,
        ev.transaction ?? null,
        ev.payment?.quantity ?? null,
        ev.payment?.token?.symbol ?? null,
        ev.event_timestamp,
        JSON.stringify(ev),
      ),
    }));

    for (let index = 0; index < preparedEvents.length; index += OPENSEA_D1_BATCH_SIZE) {
      const outcomes = await insertOpenSeaEventBatch(
        env.WARPLETS,
        preparedEvents.slice(index, index + OPENSEA_D1_BATCH_SIZE),
      );
      for (const insertOutcome of outcomes) {
        const ev = insertOutcome.event;
        const walletFrom = ev.seller ?? null;
        const walletTo = ev.buyer ?? null;
        const eventTs = ev.event_timestamp;

        // Insert into opensea table; ON CONFLICT DO NOTHING handles dedup.
        if (!insertOutcome.stored) continue;

        if (insertOutcome.inserted) processed += 1;
        else skipped += 1;

        // Track the resume cursor in one representation regardless of which
        // event timestamp format OpenSea returned.
        const eventTimestampSec = parseOpenSeaTimestampSeconds(eventTs);
        if (
          eventTimestampSec !== null &&
          (latestTimestampSec === null || eventTimestampSec > latestTimestampSec)
        ) {
          latestTimestampSec = eventTimestampSec;
        }

        // Distribution-sale buyer updates are applied in bounded chunks after
        // pagination instead of issuing a SELECT and UPDATE for every event.
        if (
          ev.event_type === "sale" &&
          walletFrom?.toLowerCase() === DISTRIBUTION_WALLET.toLowerCase() &&
          walletTo
        ) {
          distributionBuyerWallets.add(walletTo.toLowerCase());
        }
      }
    }

    cursor = data.next ?? null;
  } while (cursor);

  // Preserve repair behavior for duplicate sale events while avoiding one
  // SELECT and one UPDATE for every buyer in the OpenSea response.
  const buyerWallets = [...distributionBuyerWallets];
  for (let index = 0; index < buyerWallets.length; index += OPENSEA_D1_BATCH_SIZE) {
    const chunk = buyerWallets.slice(index, index + OPENSEA_D1_BATCH_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const now = new Date().toISOString();
    try {
      const result = await env.WARPLETS.prepare(
        `UPDATE warplets_users
         SET buy_in_opensea_on = ?, updated_on = ?
         WHERE buy_in_opensea_on IS NULL
           AND LOWER(primary_eth_address) IN (${placeholders})`,
      ).bind(now, now, ...chunk).run();
      const changes = result.meta.changes ?? 0;
      matched += changes;
      buyMatchFound ||= changes > 0;
    } catch (error) {
      console.error("[opensea-sync] error matching distribution buyers:", error);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Persist resume point (only advance if we saw newer events)
  // -------------------------------------------------------------------------
  if (
    latestTimestampSec !== null &&
    latestTimestampSec !== resume.persistedCursorSec
  ) {
    await env.WARPLETS_KV.put(KV_LAST_SYNC_KEY, String(latestTimestampSec));
    console.log(`[opensea-sync] updated last_sync_at to ${latestTimestampSec}`);
  }

  // -------------------------------------------------------------------------
  // 6. Refresh buys KV counter if any new matches were found
  // -------------------------------------------------------------------------
  if (buyMatchFound) {
    try {
      const buysRow = await env.WARPLETS.prepare(
        "SELECT COUNT(*) AS count FROM warplets_users WHERE buy_in_opensea_on IS NOT NULL OR buy_in_farcaster_wallet_on IS NOT NULL",
      ).first<{ count: number }>();
      await env.WARPLETS_KV.put(KV_STATS_BUYS_KEY, String(buysRow?.count ?? 0));
    } catch (err) {
      console.error("[opensea-sync] error refreshing stats_buys KV:", err);
    }
  }

  console.log(
    `[opensea-sync] done — processed=${processed} matched=${matched} skipped=${skipped}`,
  );
  return { processed, matched, skipped };
}
