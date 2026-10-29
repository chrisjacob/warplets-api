import { requireThat, one, type Database, sha } from "./db";
import { decode58 } from "../shared/base58";
import type { Receipt } from "./receipts";
export interface HistoryPage {
  data: (Receipt & {
    transaction: Receipt["transaction"] & { signatures: string[] };
    version?: number | "legacy";
  })[];
  paginationToken: string | null;
}
export interface HistoryQuery {
  wallet: string;
  fromAt: number;
  throughAt: number;
  cursor: string | null;
}
export interface HistoryAdapter {
  readonly provider: "helius";
  page(query: HistoryQuery): Promise<HistoryPage>;
}

export async function reserveSource(
  db: Database,
  provider: "helius" | "pyth",
  cost: number,
) {
  requireThat(
    Number.isSafeInteger(cost) && cost > 0,
    400,
    "Invalid source cost",
  );
  const allowance = await one(
    db,
    "UPDATE meme_source_budgets SET used=used+? WHERE provider=? AND used+?<=ceiling RETURNING used",
    cost,
    provider,
    cost,
  );
  requireThat(
    allowance,
    429,
    "Source allowance unavailable; no automatic quota reset",
  );
}
export async function boundedJSON(
  response: Response,
  maxBytes = 2000000,
): Promise<unknown> {
  requireThat(response.ok && response.body, 502, "Source unavailable");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let bytes = 0,
    body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw Error("Source payload too large");
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(body);
}
export function heliusAdapter(db: Database, key: string): HistoryAdapter {
  return {
    provider: "helius",
    async page(q) {
      requireThat(key.length > 0, 409, "Helius credentials are not configured");
      decode58(q.wallet, 32);
      // Reserve worst-case request credits before attempting network I/O. Retries consume allowance too.
      // Current published metering: 10 credits per 100 full transactions, rounded up.
      // This adapter requests at most 20; retain the full reservation even on failure.
      await reserveSource(db, "helius", 10);
      let result: unknown;
      try {
        result = await boundedJSON(
          await fetch(
            "https://mainnet.helius-rpc.com/?api-key=" +
              encodeURIComponent(key),
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "getTransactionsForAddress",
                params: [
                  q.wallet,
                  {
                    transactionDetails: "full",
                    encoding: "jsonParsed",
                    maxSupportedTransactionVersion: 0,
                    commitment: "finalized",
                    sortOrder: "asc",
                    limit: 20,
                    ...(q.cursor ? { paginationToken: q.cursor } : {}),
                    filters: {
                      status: "succeeded",
                      tokenAccounts: "all",
                      blockTime: {
                        gte: Math.floor(q.fromAt / 1000),
                        lte: Math.floor(q.throughAt / 1000),
                      },
                    },
                  },
                ],
              }),
              redirect: "manual",
              signal: AbortSignal.timeout(15000),
            },
          ),
        );
      } catch {
        throw Error("History request failed; persisted cursor retained");
      }
      const envelope = result as { error?: unknown; result?: HistoryPage };
      requireThat(
        !envelope.error &&
          envelope.result &&
          Array.isArray(envelope.result.data) &&
          envelope.result.data.length <= 20 &&
          (envelope.result.paginationToken === null ||
            typeof envelope.result.paginationToken === "string"),
        502,
        "Unsupported history response",
      );
      return envelope.result;
    },
  };
}

export interface PriceFeed {
  payment_mint: string;
  feed_id: string;
  decimals: number;
  max_age_seconds: number;
  max_confidence_bps: number;
}
/** Parse an independent oracle observation, using integer arithmetic. HTTPS oracle trust;
 * this does not claim to verify a Wormhole VAA signature. No implicit stablecoin peg. */
export function parseOracle(body: unknown, feed: PriceFeed, at: number) {
  const parsed = (
    body as {
      parsed?: {
        id: string;
        price: {
          price: string;
          conf: string;
          expo: number;
          publish_time: number;
        };
      }[];
    }
  ).parsed;
  requireThat(
    parsed?.length === 1 &&
      parsed[0].id.replace(/^0x/, "") === feed.feed_id.replace(/^0x/, ""),
    409,
    "Oracle feed mismatch",
  );
  const p = parsed[0].price;
  requireThat(
    p &&
      /^[0-9]{1,38}$/.test(p.price) &&
      /^[0-9]{1,38}$/.test(p.conf) &&
      Number.isSafeInteger(p.expo) &&
      Math.abs(p.expo) <= 30 &&
      Number.isSafeInteger(p.publish_time),
    409,
    "Invalid oracle observation",
  );
  const value = BigInt(p.price),
    confidence = BigInt(p.conf),
    age = Math.abs(at - p.publish_time * 1000);
  requireThat(
    value > 0n &&
      age <= feed.max_age_seconds * 1000 &&
      confidence * 10000n <= value * BigInt(feed.max_confidence_bps),
    409,
    "Oracle price is stale or uncertain",
  );
  const power = p.expo + 6,
    usdMicros =
      power >= 0 ? value * 10n ** BigInt(power) : value / 10n ** BigInt(-power);
  requireThat(usdMicros > 0n, 409, "Price below supported precision");
  return { usdMicros: usdMicros.toString(), publishAt: p.publish_time * 1000 };
}
export async function historicalPrice(
  db: Database,
  mint: string,
  at: number,
  key: string,
) {
  const feed = await one<PriceFeed>(
    db,
    "SELECT * FROM meme_price_feeds WHERE payment_mint=?",
    mint,
  );
  requireThat(feed, 409, "No approved independent price feed for payment mint");
  requireThat(key.length > 0, 409, "Oracle credentials are not configured");
  await reserveSource(db, "pyth", 1);
  const url = new URL(
    "https://hermes.pyth.network/v2/updates/price/" + Math.floor(at / 1000),
  );
  url.searchParams.set("ids[]", feed.feed_id);
  url.searchParams.set("parsed", "true");
  let body: unknown;
  try {
    body = await boundedJSON(
      await fetch(url, {
        headers: { authorization: "Bearer " + key },
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      }),
    );
  } catch {
    throw Error("Historical oracle unavailable");
  }
  const observation = parseOracle(body, feed, at),
    bytes = JSON.stringify(body),
    evidenceHash = await sha(JSON.stringify({ mint, at, feed, body }));
  await db.batch([
    db
      .prepare(
        "INSERT INTO meme_verified_prices VALUES(?,?,?,?,?,?,?,'oracle-https') ON CONFLICT(evidence_hash) DO NOTHING",
      )
      .bind(
        evidenceHash,
        mint,
        at,
        observation.publishAt,
        observation.usdMicros,
        feed.feed_id,
        bytes,
      ),
  ]);
  return {
    ...observation,
    evidenceHash,
    source: "pyth-hermes-https",
    paymentDecimals: feed.decimals,
  };
}
