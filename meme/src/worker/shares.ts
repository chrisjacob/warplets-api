import { canonical } from "../shared/canonical";
import { cardPage, type ShareCard, type CardKind } from "../shared/shareCards";
import { readMarket } from "./markets";
import { readTrading, readTradingProfile } from "./trading";
import type { MarketWindow } from "../shared/markets";
import { one, sha, json, payload, requireThat, type Database } from "./db";
import { operator } from "./rounds";
import { securityHeaders } from "../shared/securityHeaders";
export async function createCard(
  db: Database,
  kind: CardKind,
  subject: string,
  window: MarketWindow,
  fid: number | null,
  now = Date.now(),
): Promise<ShareCard> {
  requireThat(
    ["candidate", "launch", "performance", "rank", "pnl"].includes(kind) &&
      typeof subject === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/.test(subject) &&
      ["24h", "30d", "all"].includes(window),
    400,
    "Invalid card source",
  );
  let body: Omit<ShareCard, "id" | "version">;
  if (kind === "pnl" || kind === "rank") {
    requireThat(
      Number.isSafeInteger(fid) && (fid ?? 0) > 0 && subject === "trading",
      400,
      "Trading identity required",
    );
    const board = await readTrading(db, window);
    requireThat(
      board && !board.stale,
      409,
      "Fresh published trading snapshot required",
    );
    const profile = await readTradingProfile(db, fid!, window, board.id);
    requireThat(
      profile && (kind === "pnl" || profile.rank !== null),
      404,
      "No matching published trading rank/profile",
    );
    const trader = { ...profile.metrics, rank: profile.rank };
    body = {
      kind,
      subject,
      window,
      fid,
      title:
        kind === "rank"
          ? `#${trader.rank} · ATTN trading`
          : `$${Number(trader.pnlUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })} realized P&L`,
      lines: [
        `FID ${fid} · ${window} · ${trader.rank === null ? "verified trader" : "rank #" + trader.rank}`,
        `Net USD P&L · fees included · ${trader.sells} ${trader.sells === 1 ? "sale" : "sales"}`,
        `ROI ${trader.roiPercent === null ? "unknown" : Number(trader.roiPercent).toFixed(2) + "%"} · moving average cost`,
      ],
      asOf: board.asOf,
      mode: board.mode,
      sourceHash: board.sourceHash,
      targetPath:
        "/?" +
        new URLSearchParams({
          view: "Leaders",
          trader: String(fid),
          window,
          board: board.id,
        }),
    };
  } else {
    requireThat(
      fid === null,
      400,
      "Market card cannot contain a wallet identity",
    );
    const view = await readMarket(db, subject, window);
    requireThat(
      view.asOf !== null && !view.coverage.stale,
      409,
      "Fresh published market snapshot required",
    );
    requireThat(
      kind === "candidate" ? !view.market.attnMint : !!view.market.attnMint,
      409,
      "Card does not match the edition state",
    );
    const pct = (s: string | null) =>
      s === null
        ? "unknown"
        : (Number(s) > 0 ? "+" : "") + Number(s).toFixed(2) + "%";
    body = {
      kind,
      subject,
      window,
      fid: null,
      title:
        kind === "candidate"
          ? `${view.market.ogSymbol} · candidate`
          : kind === "launch"
            ? `${view.market.symbol} / ${view.market.ogSymbol} · launched`
            : `${view.market.symbol} vs ${view.market.ogSymbol}`,
      lines: [
        `${window} · OG ${pct(view.returns.og)} · ATTN ${pct(view.returns.attn)}`,
        `ATTN / OG ${pct(view.returns.pair)} · price change before fees`,
        `${view.coverage.state === "partial" ? "Partial" : "Available"} coverage · ${view.coverage.gaps} gaps${view.coverage.limited ? " · limited history" : ""}`,
      ],
      asOf: view.asOf,
      mode: view.market.mode,
      sourceHash: view.inputHash,
      targetPath:
        "/?" + new URLSearchParams({ market: subject, marketWindow: window }),
    };
  }
  const card: ShareCard = {
    version: 1,
    id: await sha(canonical(body)),
    ...body,
  };
  await db
    .prepare("INSERT OR IGNORE INTO meme_share_cards VALUES(?,?,?,?,?,?,?)")
    .bind(card.id, kind, subject, window, fid ?? 0, canonical(card), now)
    .run();
  return card;
}
export async function attachCardImage(
  db: Database,
  id: string,
  format: "mini" | "og",
  base64: string,
) {
  requireThat(
    /^[a-f0-9]{64}$/.test(id) &&
      ["mini", "og"].includes(format) &&
      typeof base64 === "string" &&
      base64.length <= 350000 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(base64),
    400,
    "Invalid image upload",
  );
  requireThat(
    btoa(atob(base64)) === base64,
    400,
    "Canonical PNG encoding required",
  );
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const data = new DataView(bytes.buffer);
  requireThat(
    bytes.length >= 33 &&
      bytes.slice(0, 8).join() === "137,80,78,71,13,10,26,10" &&
      data.getUint32(16) === 1200 &&
      data.getUint32(20) === (format === "mini" ? 800 : 630),
    400,
    "Expected a 1200px PNG with the exact aspect ratio",
  );
  requireThat(
    await one(db, "SELECT id FROM meme_share_cards WHERE id=?", id),
    404,
    "Unknown card",
  );
  const hash = await sha(base64);
  await db
    .prepare("INSERT OR IGNORE INTO meme_share_images VALUES(?,?,?,?)")
    .bind(id, format, hash, bytes)
    .run();
  requireThat(
    (
      await one<{ image_hash: string }>(
        db,
        "SELECT image_hash FROM meme_share_images WHERE card_id=? AND format=?",
        id,
        format,
      )
    )?.image_hash === hash,
    409,
    "Published image cannot be replaced",
  );
  return { id, format, hash };
}
export async function sharesRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url),
    path = url.pathname;
  if (path === "/api/meme/operator/shares") {
    await operator(db, request);
    requireThat(request.method === "POST", 405, "Method not allowed");
    const p = await payload(
      request,
      ["action", "kind", "subject", "window", "fid", "id", "format", "png"],
      360000,
    );
    if (p.action === "create")
      return json(
        await createCard(
          db,
          p.kind as CardKind,
          p.subject as string,
          p.window as MarketWindow,
          (p.fid ?? null) as number | null,
        ),
      );
    requireThat(p.action === "image", 400, "Unsupported share action");
    return json(
      await attachCardImage(
        db,
        p.id as string,
        p.format as "mini" | "og",
        p.png as string,
      ),
    );
  }
  if (path === "/api/meme/shares") {
    requireThat(
      ["GET", "HEAD"].includes(request.method),
      405,
      "Method not allowed",
    );
    requireThat(
      [...url.searchParams.keys()].every(
        (k) =>
          ["kind", "subject", "window", "fid", "sourceHash"].includes(k) &&
          url.searchParams.getAll(k).length === 1,
      ),
      400,
      "Invalid share lookup",
    );
    const kind = url.searchParams.get("kind"),
      subject = url.searchParams.get("subject"),
      window = url.searchParams.get("window") ?? "24h",
      fid = Number(url.searchParams.get("fid") ?? 0),
      sourceHash = url.searchParams.get("sourceHash");
    requireThat(
      ["candidate", "launch", "performance", "rank", "pnl"].includes(
        kind ?? "",
      ) &&
        subject &&
        subject.length <= 120 &&
        ["24h", "30d", "all"].includes(window) &&
        Number.isSafeInteger(fid) &&
        fid >= 0 &&
        (sourceHash === null || /^[a-f0-9]{64}$/.test(sourceHash)),
      400,
      "Invalid share lookup",
    );
    const row = await one<{ payload: string }>(
      db,
      `SELECT c.payload FROM meme_share_cards c WHERE kind=? AND subject=? AND window=? AND fid=? ${sourceHash === null ? "" : "AND json_extract(c.payload,'$.sourceHash')=?"} AND (SELECT count(*) FROM meme_share_images i WHERE i.card_id=c.id)=2 ORDER BY created_at DESC,id DESC LIMIT 1`,
      kind,
      subject,
      window,
      fid,
      ...(sourceHash === null ? [] : [sourceHash]),
    );
    return json({ card: row ? JSON.parse(row.payload) : null });
  }
  const match = path.match(
    /^\/api\/meme\/share\/([a-f0-9]{64})(?:\/(mini|og)\.png)?$/,
  );
  if (!match) return null;
  requireThat(
    ["GET", "HEAD"].includes(request.method) && url.search === "",
    400,
    "Invalid share request",
  );
  const card = await one<{ payload: string }>(
    db,
    "SELECT payload FROM meme_share_cards WHERE id=?",
    match[1],
  );
  requireThat(card, 404, "Card not found");
  const headers = {
    ...securityHeaders,
    "cache-control": "public, max-age=31536000, immutable",
    "x-robots-tag": "noindex",
  };
  if (match[2]) {
    const row = await one<{ png: ArrayBuffer; image_hash: string }>(
      db,
      "SELECT png,image_hash FROM meme_share_images WHERE card_id=? AND format=?",
      match[1],
      match[2],
    );
    requireThat(row, 404, "Image is not published");
    return new Response(request.method === "HEAD" ? null : row.png, {
      headers: {
        ...headers,
        "content-type": "image/png",
        etag: '"' + row.image_hash + '"',
      },
    });
  }
  const images = await one<{ n: number }>(
    db,
    "SELECT count(*) n FROM meme_share_images WHERE card_id=?",
    match[1],
  );
  requireThat(images?.n === 2, 409, "Card images are not published");
  return new Response(
    request.method === "HEAD"
      ? null
      : cardPage(JSON.parse(card.payload), url.origin),
    {
      headers: {
        ...headers,
        "content-type": "text/html; charset=utf-8",
        "content-security-policy":
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      },
    },
  );
}
