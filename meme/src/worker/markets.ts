import { decode58 } from "../shared/base58";
import { canonical } from "../shared/canonical";
import { Exact } from "../shared/exact";
import {
  comparison,
  type MarketDefinition,
  type MarketObservation,
  type MarketWindow,
  type MarketView,
} from "../shared/markets";
import {
  one,
  rows,
  sha,
  requireThat,
  json,
  payload,
  type Database,
} from "./db";
import { operator } from "./rounds";
import { requireUnpaused } from "./controls";

const id = (value: unknown) =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/.test(value);
export async function registerMarket(db: Database, market: MarketDefinition) {
  requireThat(
    market && id(market.id) && ["simulated", "observed"].includes(market.mode),
    400,
    "Invalid market",
  );
  for (const symbol of [market.symbol, market.ogSymbol])
    requireThat(
      typeof symbol === "string" && /^[A-Za-z0-9._-]{1,20}$/.test(symbol),
      400,
      "Invalid symbol",
    );
  decode58(market.ogMint, 32);
  for (const address of [market.attnMint, market.pool]) {
    requireThat(
      address === null || typeof address === "string",
      400,
      "Explicit mint/pool required",
    );
    if (address !== null) decode58(address, 32);
  }
  requireThat(
    market.attnMint === null || market.attnMint !== market.ogMint,
    400,
    "Distinct paired mints required",
  );
  requireThat(
    market.launchedAt === null
      ? market.attnMint === null
      : Number.isSafeInteger(market.launchedAt) &&
          market.launchedAt >= 0 &&
          market.attnMint !== null,
    400,
    "Actual launch time required for ATTN",
  );
  requireThat(
    Object.keys(market).sort().join(",") ===
      [
        "id",
        "symbol",
        "ogSymbol",
        "ogMint",
        "attnMint",
        "pool",
        "launchedAt",
        "mode",
      ]
        .sort()
        .join(","),
    400,
    "Unexpected market definition",
  );
  const bytes = canonical(market),
    hash = await sha(bytes);
  await db
    .prepare("INSERT OR IGNORE INTO meme_markets VALUES(?,?,?,?)")
    .bind(market.id, bytes, hash, Date.now())
    .run();
  requireThat(
    (
      await one<{ definition_hash: string }>(
        db,
        "SELECT definition_hash FROM meme_markets WHERE id=?",
        market.id,
      )
    )?.definition_hash === hash,
    409,
    "Market identity already has different terms",
  );
  return market;
}
export async function marketDefinition(db: Database, marketId: string) {
  const row = await one<{ definition: string }>(
    db,
    "SELECT definition FROM meme_markets WHERE id=?",
    marketId,
  );
  requireThat(row, 404, "Market not found");
  return JSON.parse(row.definition) as MarketDefinition;
}
export async function appendMarketEvidence(
  db: Database,
  marketId: string,
  key: string,
  points: MarketObservation[],
  now = Date.now(),
) {
  await requireUnpaused(db, "collection");
  const market = await marketDefinition(db, marketId);
  requireThat(
    id(key) &&
      Array.isArray(points) &&
      points.length > 0 &&
      points.length <= 20,
    400,
    "Import requires 1–20 observations and a stable key",
  );
  for (const p of points) {
    requireThat(
      p &&
        Number.isSafeInteger(p.at) &&
        p.at >= 0 &&
        Number.isSafeInteger(p.observedAt) &&
        p.observedAt >= p.at &&
        p.observedAt <= now + 60000,
      400,
      "Invalid observation time",
    );
    requireThat(
      Number.isSafeInteger(p.intervalMs) &&
        p.intervalMs >= 1000 &&
        p.intervalMs <= 86400000,
      400,
      "Invalid observation interval",
    );
    requireThat(
      id(p.source) && /^[a-f0-9]{64}$/.test(p.evidenceHash),
      400,
      "Source provenance required",
    );
    requireThat(
      Exact.decimal(p.ogUsd).n > 0n,
      400,
      "Positive OG price required",
    );
    if (p.attnOg !== null)
      requireThat(
        market.attnMint &&
          market.launchedAt !== null &&
          p.at >= market.launchedAt &&
          Exact.decimal(p.attnOg).n > 0n,
        400,
        "ATTN observation precedes launch or has invalid price",
      );
    requireThat(
      Object.keys(p).sort().join(",") ===
        [
          "at",
          "observedAt",
          "ogUsd",
          "attnOg",
          "intervalMs",
          "source",
          "evidenceHash",
        ]
          .sort()
          .join(","),
      400,
      "Unexpected observation fields",
    );
  }
  const bodyHash = await sha(canonical({ marketId, points })),
    old = await one<{ payload_hash: string }>(
      db,
      "SELECT payload_hash FROM meme_market_imports WHERE key=?",
      key,
    );
  if (old) {
    requireThat(
      old.payload_hash === bodyHash,
      409,
      "Import key already has different evidence",
    );
    return { key, count: points.length, replayed: true };
  }
  const statements = [
    db
      .prepare("INSERT INTO meme_market_imports VALUES(?,?,?,?)")
      .bind(key, marketId, bodyHash, now),
  ];
  for (const p of points) {
    const bytes = canonical(p),
      pointId = await sha(marketId + ":" + bytes);
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO meme_market_observations VALUES(?,?,?,?,?,?)",
        )
        .bind(pointId, marketId, key, p.at, p.observedAt, bytes),
    );
  }
  await db.batch(statements);
  return { key, count: points.length, replayed: false };
}
export async function correctMarketEvidence(
  db: Database,
  key: string,
  oldId: string,
  newId: string,
  reason: string,
) {
  await requireUnpaused(db, "operations");
  requireThat(
    id(key) &&
      /^[a-f0-9]{64}$/.test(oldId) &&
      /^[a-f0-9]{64}$/.test(newId) &&
      typeof reason === "string" &&
      reason.trim().length > 0 &&
      reason.length <= 256,
    400,
    "Reviewed correction identity and reason required",
  );
  const requestHash = await sha(canonical({ oldId, newId, reason })),
    old = await one<{ request_hash: string }>(
      db,
      "SELECT request_hash FROM meme_market_corrections WHERE key=?",
      key,
    );
  if (old) {
    requireThat(
      old.request_hash === requestHash,
      409,
      "Correction key has different evidence",
    );
    return { key, replayed: true };
  }
  await db.batch([
    db
      .prepare("INSERT INTO meme_market_corrections VALUES(?,?,?,?,?,?)")
      .bind(key, oldId, newId, reason, requestHash, Date.now()),
  ]);
  return { key, replayed: false };
}
export async function publishMarket(
  db: Database,
  marketId: string,
  window: MarketWindow,
  now = Date.now(),
) {
  await requireUnpaused(db, "operations");
  requireThat(["24h", "30d", "all"].includes(window), 400, "Invalid window");
  const market = await marketDefinition(db, marketId),
    from =
      window === "all"
        ? 0
        : now - (window === "24h" ? 86400000 : 30 * 86400000);
  const source = await rows<{ payload: string }>(
    db,
    "SELECT o.payload FROM meme_market_observations o WHERE o.market_id=? AND o.at>=? AND o.at<=? AND NOT EXISTS(SELECT 1 FROM meme_market_corrections c WHERE c.old_id=o.id) ORDER BY o.at DESC,o.id DESC LIMIT 2001",
    marketId,
    from,
    now,
  );
  const facts = new Map<number, string>();
  for (const row of source) {
    const p = JSON.parse(row.payload) as MarketObservation;
    const fact = canonical({
      og: Exact.decimal(p.ogUsd).toJSON(),
      attn: p.attnOg === null ? null : Exact.decimal(p.attnOg).toJSON(),
      interval: p.intervalMs,
    });
    requireThat(
      !facts.has(p.at) || facts.get(p.at) === fact,
      409,
      "Conflicting market evidence requires an explicit correction",
    );
    facts.set(p.at, fact);
  }
  const limited = source.length > 2000,
    points = source
      .slice(0, 2000)
      .map((r) => JSON.parse(r.payload) as MarketObservation);
  const corrections = await rows<{ key: string; request_hash: string }>(
    db,
    "SELECT c.key,c.request_hash FROM meme_market_corrections c JOIN meme_market_observations o ON o.id=c.old_id WHERE o.market_id=? ORDER BY c.key LIMIT 2001",
    marketId,
  );
  requireThat(
    corrections.length <= 2000,
    409,
    "Market correction lineage exceeds publication bound",
  );
  const hash = await sha(
      canonical({ market, points, corrections, window, now, limited }),
    ),
    view = comparison(market, points, window, now, hash, limited),
    bytes = canonical(view),
    viewId = "market:" + hash;
  requireThat(
    bytes.length <= 512000,
    409,
    "Market view exceeds publication bound",
  );
  await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO meme_market_views VALUES(?,?,?,?,?,?)")
      .bind(viewId, marketId, window, now, hash, bytes),
    db
      .prepare(
        "INSERT INTO meme_market_heads VALUES(?,?,?,?) ON CONFLICT(market_id,window) DO UPDATE SET view_id=excluded.view_id,as_of=excluded.as_of WHERE excluded.as_of>=meme_market_heads.as_of",
      )
      .bind(marketId, window, viewId, now),
  ]);
  return view;
}
export async function readMarket(
  db: Database,
  marketId: string,
  window: MarketWindow,
) {
  const row = await one<{ payload: string }>(
    db,
    "SELECT v.payload FROM meme_market_heads h JOIN meme_market_views v ON v.id=h.view_id WHERE h.market_id=? AND h.window=?",
    marketId,
    window,
  );
  if (row) {
    const view = JSON.parse(row.payload) as MarketView;
    if (view.asOf === null || Date.now() - view.asOf > view.freshnessMs) {
      view.coverage.stale = true;
      view.coverage.state = "partial";
    }
    return view;
  }
  return comparison(
    await marketDefinition(db, marketId),
    [],
    window,
    Date.now(),
    "unpublished",
  );
}
export async function marketRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url),
    path = url.pathname;
  if (path === "/api/meme/operator/markets") {
    await operator(db, request);
    requireThat(request.method === "POST", 405, "Method not allowed");
    const input = await payload(request, [
      "action",
      "market",
      "marketId",
      "key",
      "observations",
      "window",
      "oldId",
      "newId",
      "reason",
    ]);
    if (input.action === "register")
      return json({
        market: await registerMarket(db, input.market as MarketDefinition),
      });
    if (input.action === "correct")
      return json(
        await correctMarketEvidence(
          db,
          input.key as string,
          input.oldId as string,
          input.newId as string,
          input.reason as string,
        ),
      );
    requireThat(
      typeof input.marketId === "string" && id(input.marketId),
      400,
      "Market id required",
    );
    if (input.action === "append")
      return json(
        await appendMarketEvidence(
          db,
          input.marketId,
          input.key as string,
          input.observations as MarketObservation[],
        ),
      );
    requireThat(input.action === "publish", 400, "Unsupported market action");
    return json(
      await publishMarket(db, input.marketId, input.window as MarketWindow),
    );
  }
  if (path === "/api/meme/markets") {
    requireThat(
      request.method === "GET" || request.method === "HEAD",
      405,
      "Method not allowed",
    );
    requireThat(
      [...url.searchParams.keys()].every(
        (k) => k === "after" && url.searchParams.getAll(k).length === 1,
      ),
      400,
      "Invalid market cursor",
    );
    const after = url.searchParams.get("after") ?? "";
    requireThat(after === "" || id(after), 400, "Invalid market cursor");
    const items = await rows<{ id: string; definition: string }>(
      db,
      "SELECT id,definition FROM meme_markets WHERE id>? ORDER BY id LIMIT 21",
      after,
    );
    return json({
      items: items.slice(0, 20).map((r) => JSON.parse(r.definition)),
      nextCursor: items.length > 20 ? items[19].id : null,
    });
  }
  const match = path.match(/^\/api\/meme\/markets\/([^/]{1,360})$/);
  if (!match) return null;
  const marketId = decodeURIComponent(match[1]);
  requireThat(id(marketId), 400, "Invalid market id");
  requireThat(
    request.method === "GET" || request.method === "HEAD",
    405,
    "Method not allowed",
  );
  requireThat(
    [...url.searchParams.keys()].every(
      (k) => k === "window" && url.searchParams.getAll(k).length === 1,
    ),
    400,
    "Invalid market parameters",
  );
  const window = url.searchParams.get("window") ?? "24h";
  requireThat(["24h", "30d", "all"].includes(window), 400, "Invalid window");
  return json(await readMarket(db, marketId, window as MarketWindow));
}
