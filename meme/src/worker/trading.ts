import { canonical } from "../shared/canonical";
import {
  rankTraders,
  tradingMetrics,
  replayTrading,
  type TraderEvidence,
  type TradingMetrics,
  type TradingWindow,
} from "../shared/trading";
import {
  one,
  rows,
  sha,
  json,
  payload,
  requireThat,
  type Database,
} from "./db";
import { operator } from "./rounds";
import { requireUnpaused } from "./controls";
import { marketDefinition } from "./markets";
export interface TradingBoard {
  version: 1;
  id: string;
  window: TradingWindow;
  asOf: number;
  generatedAt: number;
  sourceHash: string;
  mode: "simulated" | "observed";
  cohort: number;
  items: (TradingMetrics & { rank: number })[];
  coverage: "complete";
  rules: "moving-average-v1";
  financialEvidence: false;
  stale?: boolean;
}
function traderProjections(input: TraderEvidence) {
  const projected = (["24h", "30d", "all"] as const).map((window) => ({
    window,
    payload: canonical(tradingMetrics(input, window, input.throughAt)),
  }));
  requireThat(
    projected.every((p) => p.payload.length <= 32768),
    413,
    "Trader projection exceeds its bounded publication budget",
  );
  return projected;
}
async function projectTrader(
  db: Database,
  id: string,
  input: TraderEvidence,
  projected: ReturnType<typeof traderProjections>,
) {
  await db.batch([
    ...projected.map((p) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO meme_trading_projections VALUES(?,?,?,?)",
        )
        .bind(id, input.throughAt, p.window, p.payload),
    ),
    ...input.wallets.map((wallet) =>
      db
        .prepare("INSERT OR IGNORE INTO meme_trading_wallet_scope VALUES(?,?)")
        .bind(id, wallet),
    ),
  ]);
}
export async function importTrading(
  db: Database,
  input: TraderEvidence,
  parentId: string | null,
  reason: string,
  now = Date.now(),
) {
  await requireUnpaused(db, "collection");
  requireThat(
    typeof reason === "string" &&
      reason.trim().length >= 8 &&
      reason.length <= 500,
    400,
    "Source/correction reason required",
  );
  requireThat(
    input.throughAt <= now && input.verifiedAt <= now,
    400,
    "Future coverage is invalid",
  );
  replayTrading(input);
  for (const m of input.markets) {
    const actual = await marketDefinition(db, m.id);
    requireThat(
      actual.attnMint === m.attnMint &&
        actual.ogMint === m.ogMint &&
        actual.launchedAt !== null &&
        actual.mode === input.mode,
      409,
      "Trading evidence differs from the edition registry",
    );
  }
  if (input.mode === "observed")
    for (const address of input.wallets) {
      const links = await rows<{ fid: number; verified_at: number }>(
        db,
        "SELECT fid,verified_at FROM meme_wallet_links WHERE chain='solana' AND address=? AND revoked_at IS NULL",
        address,
      );
      requireThat(
        links.length === 1 &&
          links[0].fid === input.fid &&
          links[0].verified_at <= input.verifiedAt,
        409,
        "Observed trading needs exclusive verified wallet identity",
      );
    }
  const encoded = canonical(input);
  requireThat(
    encoded.length <= 262144,
    413,
    "Trading source too large; use a complete bounded cohort export",
  );
  const projected = traderProjections(input);
  const id = "trading:" + (await sha(canonical({ input, parentId, reason })));
  const head = await one<{ source_id: string }>(
    db,
    "SELECT source_id FROM meme_trading_source_heads WHERE fid=?",
    input.fid,
  );
  if (head?.source_id === id) {
    await projectTrader(db, id, input, projected);
    return { id, replayed: true };
  }
  requireThat(
    (head?.source_id ?? null) === parentId,
    409,
    "Correction parent is no longer current",
  );
  if (parentId) {
    const parent = await one<{ through_at: number }>(
      db,
      "SELECT through_at FROM meme_trading_sources WHERE id=?",
      parentId,
    );
    requireThat(
      parent && input.throughAt >= parent.through_at,
      409,
      "Corrections cannot silently shorten coverage",
    );
  }
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_trading_sources VALUES(?,?,?,?,?,?,?)",
      )
      .bind(id, input.fid, parentId, reason, encoded, input.throughAt, now),
    db
      .prepare(
        "INSERT INTO meme_trading_source_heads VALUES(?,?) ON CONFLICT(fid) DO UPDATE SET source_id=excluded.source_id WHERE meme_trading_source_heads.source_id=?",
      )
      .bind(input.fid, id, parentId),
  ]);
  requireThat(
    (
      await one<{ source_id: string }>(
        db,
        "SELECT source_id FROM meme_trading_source_heads WHERE fid=?",
        input.fid,
      )
    )?.source_id === id,
    409,
    "Trading source publication conflicted",
  );
  await projectTrader(db, id, input, projected);
  return { id, replayed: false };
}
export async function publishTrading(
  db: Database,
  asOf: number,
  now = Date.now(),
) {
  requireThat(
    Number.isSafeInteger(asOf) && asOf >= 0 && asOf <= now,
    400,
    "Invalid common cohort time",
  );
  const sources = await rows<{
    id: string;
    mode: "observed" | "simulated";
    through_at: number;
  }>(
    db,
    "SELECT s.id,s.through_at,json_extract(s.payload,'$.mode') mode FROM meme_trading_source_heads h JOIN meme_trading_sources s ON s.id=h.source_id ORDER BY h.fid LIMIT 1001",
  );
  requireThat(
    sources.length > 0 && sources.length <= 1000,
    409,
    "Cohort must contain 1–1000 complete sources",
  );
  const mode = sources[0].mode;
  requireThat(
    sources.every((i) => i.mode === mode && i.through_at === asOf),
    409,
    "Every cohort member needs matching complete coverage",
  );
  const scope = await one<{ total: number; uniqueWallets: number }>(
    db,
    "SELECT COUNT(*) total,COUNT(DISTINCT wallet) uniqueWallets FROM meme_trading_wallet_scope WHERE source_id IN(SELECT value FROM json_each(?))",
    JSON.stringify(sources.map((s) => s.id)),
  );
  requireThat(
    scope &&
      scope.total >= sources.length &&
      scope.total === scope.uniqueWallets,
    409,
    "One wallet cannot rank under multiple identities; complete projected scope required",
  );
  const sourceHash = await sha(canonical(sources.map((s) => s.id))),
    boards: TradingBoard[] = [];
  for (const window of ["24h", "30d", "all"] as const) {
    let leaders: (TradingMetrics & { rank: number })[] = [];
    for (let offset = 0; offset < sources.length; offset += 64) {
      const ids = sources.slice(offset, offset + 64).map((s) => s.id),
        page = await rows<{ payload: string }>(
          db,
          "SELECT payload FROM meme_trading_projections WHERE source_id IN(SELECT value FROM json_each(?)) AND window=? AND as_of=?",
          JSON.stringify(ids),
          window,
          asOf,
        );
      requireThat(
        page.length === ids.length,
        409,
        "Resume source import to complete bounded projections",
      );
      leaders = rankTraders([
        ...leaders,
        ...page.map((p) => JSON.parse(p.payload) as TradingMetrics),
      ]);
    }
    const body = {
      version: 1 as const,
      window,
      asOf,
      generatedAt: now,
      sourceHash,
      mode,
      cohort: sources.length,
      items: leaders,
      coverage: "complete" as const,
      rules: "moving-average-v1" as const,
      financialEvidence: false as const,
    };
    requireThat(
      canonical(body).length <= 786432,
      413,
      "Published leaderboard exceeds the response budget",
    );
    boards.push({ id: "board:" + (await sha(canonical(body))), ...body });
  }
  await db.batch(
    boards.flatMap((b) => [
      db
        .prepare("INSERT OR IGNORE INTO meme_trading_boards VALUES(?,?,?,?)")
        .bind(b.id, b.window, b.asOf, canonical(b)),
      db
        .prepare(
          "INSERT INTO meme_trading_board_heads VALUES(?,?,?) ON CONFLICT(window) DO UPDATE SET board_id=excluded.board_id,as_of=excluded.as_of WHERE excluded.as_of>=meme_trading_board_heads.as_of",
        )
        .bind(b.window, b.id, b.asOf),
    ]),
  );
  return boards;
}
export async function readTrading(
  db: Database,
  window: TradingWindow,
): Promise<TradingBoard | null> {
  const row = await one<{ payload: string }>(
    db,
    "SELECT b.payload FROM meme_trading_board_heads h JOIN meme_trading_boards b ON b.id=h.board_id WHERE h.window=?",
    window,
  );
  if (!row) return null;
  const board = JSON.parse(row.payload) as TradingBoard;
  board.stale = Date.now() - board.asOf > 3600000;
  return board;
}
export async function tradingRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/meme/operator/trading") {
    await operator(db, request);
    requireThat(request.method === "POST", 405, "Method not allowed");
    const p = await payload(
      request,
      ["action", "source", "parentId", "reason", "asOf"],
      300000,
    );
    if (p.action === "import")
      return json(
        await importTrading(
          db,
          p.source as TraderEvidence,
          p.parentId as string | null,
          p.reason as string,
        ),
      );
    requireThat(p.action === "publish", 400, "Unsupported trading action");
    return json(await publishTrading(db, p.asOf as number));
  }
  if (url.pathname !== "/api/meme/trading") return null;
  requireThat(
    ["GET", "HEAD"].includes(request.method),
    405,
    "Method not allowed",
  );
  requireThat(
    [...url.searchParams.keys()].every(
      (k) => k === "window" && url.searchParams.getAll(k).length === 1,
    ),
    400,
    "Invalid board parameters",
  );
  const window = url.searchParams.get("window") ?? "24h";
  requireThat(
    ["24h", "30d", "all"].includes(window),
    400,
    "Invalid trading window",
  );
  return json({ board: await readTrading(db, window as TradingWindow) });
}
