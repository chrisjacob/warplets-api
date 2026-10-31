import { one, Problem, requireThat, sha, type Database } from "./db";
import { decode58 } from "../shared/base58";
import { canonical } from "../shared/canonical";

export interface TrendingItem {
  rank: number;
  name: string;
  symbol: string;
  ogMint: string;
  changePercent: number | null;
  volumeUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
}
function number(value: unknown) {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? n : null;
}
/** Preserve provider order. Discovery facts never become price/FDV or safety evidence. */
export function parseTrending(raw: unknown): TrendingItem[] {
  const value = raw as { code?: unknown; data?: { rank?: unknown } };
  requireThat(
    value && value.code === 0 && Array.isArray(value.data?.rank),
    502,
    "GMGN returned an unsupported response",
  );
  const seen = new Set<string>();
  return value
    .data!.rank.slice(0, 50)
    .map((row: Record<string, unknown>, index: number) => {
      requireThat(
        row && typeof row === "object" && typeof row.address === "string",
        502,
        "Invalid GMGN token",
      );
      decode58(row.address, 32);
      requireThat(
        !seen.has(row.address) &&
          typeof row.symbol === "string" &&
          row.symbol.length > 0 &&
          row.symbol.length <= 20 &&
          typeof row.name === "string" &&
          row.name.length > 0 &&
          row.name.length <= 80,
        502,
        "Invalid GMGN token fields",
      );
      seen.add(row.address);
      return {
        rank: index + 1,
        name: row.name,
        symbol: row.symbol,
        ogMint: row.address,
        changePercent: number(row.price_change_percent),
        volumeUsd: number(row.volume),
        liquidityUsd: number(row.liquidity),
        marketCapUsd: number(row.market_cap),
      };
    });
}
export async function refreshTrending(
  db: Database,
  window: unknown,
  key: string | undefined,
  commandId: string,
  request: typeof fetch = fetch,
  now = Date.now(),
) {
  requireThat(
    window === "1h" || window === "24h",
    400,
    "Choose a 1h or 24h window",
  );
  const id = "gmgn:" + (await sha(commandId)),
    prior = await one<{ payload: string; as_of: number }>(
      db,
      "SELECT payload,as_of FROM meme_gmgn_snapshots WHERE id=?",
      id,
    );
  if (prior)
    return {
      id,
      asOf: prior.as_of,
      ...JSON.parse(prior.payload),
      replayed: true,
    };
  requireThat(
    !!key && key.length <= 4096,
    503,
    "Read-only GMGN key is not configured",
  );
  const cached = await one<{ as_of: number }>(
    db,
    "SELECT s.as_of FROM meme_gmgn_heads h JOIN meme_gmgn_snapshots s ON s.id=h.snapshot_id WHERE h.window=?",
    window,
  );
  requireThat(
    !cached || now - cached.as_of >= 900000,
    409,
    "GMGN cache is fresh; refresh after 15 minutes",
  );
  const reserved = await one(
    db,
    "UPDATE meme_gmgn_allowance SET used=used+1,next_at=? WHERE id=1 AND used<ceiling AND next_at<=? RETURNING used",
    now + 60000,
    now,
  );
  requireThat(reserved, 429, "GMGN allowance unavailable; use manual entry");
  const data=await fetchTrending(window,key!,request,now);
  await db.batch([
    db
      .prepare("INSERT INTO meme_gmgn_snapshots VALUES(?,?,?,?)")
      .bind(id, window, now, canonical(data)),
    db
      .prepare(
        "INSERT INTO meme_gmgn_heads VALUES(?,?) ON CONFLICT(window) DO UPDATE SET snapshot_id=excluded.snapshot_id",
      )
      .bind(window, id),
  ]);
  return { id, asOf: now, ...data };
}

async function fetchTrending(window:string,key:string,request:typeof fetch,now:number){try{
  // One bounded GET, no redirects/retries. Failed attempts remain consumed.
  const url = new URL("https://openapi.gmgn.ai/v1/market/rank");
  for (const [k, v] of Object.entries({
    chain: "sol",
    interval: window,
    limit: "50",
    order_by: "default",
    direction: "desc",
    timestamp: String(Math.floor(now / 1000)),
    client_id: crypto.randomUUID(),
  }))
    url.searchParams.set(k, v);
  url.searchParams.append("filters", "renounced");
  url.searchParams.append("filters", "frozen");
  const response = await request(url, {
    headers: { "X-APIKEY": key!, accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  requireThat(
    response.ok,
    502,
    "GMGN is unavailable; the previous cache is retained",
  );
  requireThat(
    !Number(response.headers.get("content-length")) ||
      Number(response.headers.get("content-length")) <= 1048576,
    502,
    "GMGN response too large",
  );
  const reader = response.body?.getReader();
  requireThat(reader, 502, "Empty GMGN response");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      requireThat(bytes <= 1048576, 502, "GMGN response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(all),
    );
  } catch {
    throw new Error("Invalid GMGN response");
  }
  const data = {
    mode: "observed",
    source: "gmgn-openapi-v1-market-rank",
    items: parseTrending(raw),
  };
return data;
}catch(error){if(error instanceof Problem)throw error;throw new Problem(502,"GMGN response unavailable or invalid; the previous cache is retained");}}
