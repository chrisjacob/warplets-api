/**
 * OpenSea event sync — designed to run as a Cloudflare Worker Cron Trigger.
 *
 * How resumption works:
 *   • After each successful run, the ISO timestamp of the most recent event
 *     processed is written to KV under `opensea_last_sync_at`.
 *   • On the next run, that value is read back and passed as `occurred_after`
 *     to the OpenSea API, ensuring no events are missed across cron gaps.
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

export type SyncResult = {
  processed: number;
  matched: number;
  skipped: number;
};

export type OpenseaSyncOptions = {
  // When provided, bypass KV resume and force a lookback window.
  occurredAfterSec?: number;
};

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
  const occurredAfterSec =
    typeof options.occurredAfterSec === "number"
      ? options.occurredAfterSec
      : lastSyncAt
        ? Math.floor(new Date(lastSyncAt).getTime() / 1000)
        // First run: look back 24 hours so we don't miss recent activity
        : Math.floor(Date.now() / 1000) - 86400;

  console.log(
    `[opensea-sync] resuming from ${lastSyncAt ?? "(first run, -24h)"} (unix=${occurredAfterSec})${typeof options.occurredAfterSec === "number" ? " [manual window override]" : ""}`,
  );

  // -------------------------------------------------------------------------
  // 2. Page through all events since last sync
  // -------------------------------------------------------------------------
  let cursor: string | null = null;
  let processed = 0;
  let matched = 0;
  let skipped = 0;
  let latestTimestamp: string | null = lastSyncAt;
  let buyMatchFound = false;

  do {
    const params = new URLSearchParams({
      event_type: "sale",
      occurred_after: String(occurredAfterSec),
      limit: "50",
    });
    if (cursor) params.set("next", cursor);

    const url = `${OPENSEA_API_BASE}/events/collection/${COLLECTION_SLUG}?${params}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "x-api-key": apiKey,
          accept: "application/json",
        },
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
    for (const ev of events) {
      const txHash = ev.transaction ?? null;
      const tokenId = ev.nft?.identifier ?? null;
      const walletFrom = ev.seller ?? null;
      const walletTo = ev.buyer ?? null;
      const salePriceWei = ev.payment?.quantity ?? null;
      const paymentToken = ev.payment?.token?.symbol ?? null;
      const eventTs = ev.event_timestamp;

      // Insert into opensea table; ON CONFLICT DO NOTHING handles dedup
      let isDuplicate = false;
      try {
        const result = await env.WARPLETS.prepare(
          `INSERT OR IGNORE INTO opensea
            (event_type, token_id, wallet_from, wallet_to, transaction_hash,
             sale_price_wei, payment_token, event_timestamp, raw_payload, created_on)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        )
          .bind(
            ev.event_type,
            tokenId,
            walletFrom,
            walletTo,
            txHash,
            salePriceWei,
            paymentToken,
            eventTs,
            JSON.stringify(ev),
          )
          .run();

        // `changes === 0` means the UNIQUE constraint fired — already stored
        if (result.meta.changes === 0) {
          isDuplicate = true;
          skipped++;
        }
      } catch (err) {
        console.error("[opensea-sync] insert error for event:", eventTs, err);
        continue;
      }

      if (!isDuplicate) {
        processed++;
      }

      // Track latest timestamp for KV resume
      if (!latestTimestamp || eventTs > latestTimestamp) {
        latestTimestamp = eventTs;
      }

      // -------------------------------------------------------------------
      // 4. If sale from distribution wallet: match buyer → warplets_users.buy_on
      //    Only sales where 10xchris.eth is the seller count (direct listings
      //    and accepted offers both have wallet_from = distribution wallet).
      // -------------------------------------------------------------------
      if (
        ev.event_type === "sale" &&
        walletFrom?.toLowerCase() === DISTRIBUTION_WALLET.toLowerCase() &&
        walletTo
      ) {
        try {
          const userRow = await env.WARPLETS.prepare(
            `SELECT id, buy_on FROM warplets_users
             WHERE LOWER(primary_eth_address) = LOWER(?) LIMIT 1`,
          )
            .bind(walletTo)
            .first<{ id: number; buy_on: string | null }>();

          if (userRow && !userRow.buy_on) {
            const now = new Date().toISOString();
            await env.WARPLETS.prepare(
              "UPDATE warplets_users SET buy_on = ?, updated_on = ? WHERE id = ?",
            )
              .bind(now, now, userRow.id)
              .run();
            matched++;
            buyMatchFound = true;
            console.log(
              `[opensea-sync] matched buyer wallet ${walletTo} → user id ${userRow.id} (token ${tokenId})`,
            );
          }
        } catch (err) {
          console.error("[opensea-sync] error matching buyer:", err);
        }
      }
    }

    cursor = data.next ?? null;
  } while (cursor);

  // -------------------------------------------------------------------------
  // 5. Persist resume point (only advance if we saw newer events)
  // -------------------------------------------------------------------------
  if (latestTimestamp && latestTimestamp !== lastSyncAt) {
    await env.WARPLETS_KV.put(KV_LAST_SYNC_KEY, latestTimestamp);
    console.log(`[opensea-sync] updated last_sync_at → ${latestTimestamp}`);
  }

  // -------------------------------------------------------------------------
  // 6. Refresh buys KV counter if any new matches were found
  // -------------------------------------------------------------------------
  if (buyMatchFound) {
    try {
      const buysRow = await env.WARPLETS.prepare(
        "SELECT COUNT(*) AS count FROM warplets_users WHERE buy_on IS NOT NULL",
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
