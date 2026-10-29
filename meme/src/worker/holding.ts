import {
  one,
  rows,
  run,
  json,
  payload,
  requireThat,
  text,
  integer,
  sha,
  type Database,
} from "./db";
import { canonical } from "../shared/canonical";
import { decode58 } from "../shared/base58";
import {
  natural,
  purchaseCredit,
  normalizedHolding,
  type LedgerEvent,
  type Campaign,
} from "../shared/holding";
import { DAY_MS } from "../shared/rules";
import { fetchFinalizedReceipt, verifyReceipt } from "./receipts";
interface StoredCampaign {
  id: string;
  mint: string;
  symbol: string;
  launched_at: number;
  ends_at: number;
  total_supply: string;
  decimals: number;
  mode: "observed" | "simulated";
  launch_evidence: string;
}
export const campaignView = (c: StoredCampaign): Campaign => ({
  id: c.id,
  mint: c.mint,
  symbol: c.symbol,
  launchedAt: c.launched_at,
  endsAt: c.ends_at,
  totalSupply: c.total_supply,
  decimals: c.decimals,
  mode: c.mode,
});
export async function campaigns(db: Database) {
  return (
    await rows<StoredCampaign>(
      db,
      "SELECT * FROM meme_campaigns ORDER BY launched_at,id",
    )
  ).map(campaignView);
}
export async function recordCampaign(db: Database, p: Record<string, unknown>) {
  const id = text(p.id, "edition ID", 80),
    mint = text(p.mint, "mint", 64);
  decode58(mint, 32);
  const launchedAt = integer(p.launchedAt, "actual launch time");
  requireThat(
    launchedAt <= Date.now(),
    400,
    "An actual past launch time is required",
  );
  const totalSupply = text(p.totalSupply, "raw supply", 78);
  requireThat(
    natural(totalSupply, true) % 100n === 0n,
    400,
    "Supply must divide into exact daily 1% allocations",
  );
  const decimals = integer(p.decimals, "decimals", 0, 18);
  requireThat(
    p.mode === "observed" || p.mode === "simulated",
    400,
    "Source mode required",
  );
  const evidence = text(p.launchEvidence, "launch evidence", 4000);
  await run(
    db,
    "INSERT INTO meme_campaigns VALUES(?,?,?,?,?,?,?,?,?)",
    id,
    mint,
    text(p.symbol, "symbol", 20),
    launchedAt,
    launchedAt + 10 * DAY_MS,
    totalSupply,
    decimals,
    p.mode,
    evidence,
  );
  return { id };
}
function validateEvent(raw: unknown): LedgerEvent {
  requireThat(raw && typeof raw === "object", 400, "Ledger event required");
  const e = raw as LedgerEvent;
  decode58(text(e.signature, "signature"), 64);
  integer(e.index, "event index", 0, 10000);
  integer(e.slot, "slot");
  integer(e.at, "event time");
  requireThat(e.at <= Date.now(), 400, "Future event");
  requireThat(
    ["purchase", "airdrop", "sell", "transfer"].includes(e.kind),
    400,
    "Unknown event kind",
  );
  natural(text(e.quantity, "quantity", 78), true);
  if (e.kind === "transfer") {
    decode58(text(e.from, "sender"), 32);
    decode58(text(e.to, "recipient"), 32);
    requireThat(e.from !== e.to, 400, "Self-transfer is not an event");
  } else decode58(text(e.wallet, "wallet"), 32);
  if (e.kind === "purchase") {
    const q = e.quote;
    requireThat(q && typeof q === "object", 409, "Acquisition quote required");
    integer(q.paymentDecimals, "payment decimals", 0, 18);
    integer(q.at, "quote time");
    requireThat(q.at <= Date.now(), 400, "Future quote");
    requireThat(
      Math.abs(q.at - e.at) <= 300000,
      409,
      "Historical acquisition quote is stale",
    );
    text(q.source, "quote source", 120);
    requireThat(
      /^[a-f0-9]{64}$/.test(q.evidenceHash),
      400,
      "Quote evidence hash required",
    );
    if (q.paymentMint !== "native:SOL")
      decode58(text(q.paymentMint, "payment mint"), 32);
    purchaseCredit(q);
  }
  return e;
}
export async function importLedger(db: Database, p: Record<string, unknown>) {
  const campaignId = text(p.campaignId, "campaign"),
    stored = await one<StoredCampaign>(
      db,
      "SELECT * FROM meme_campaigns WHERE id=?",
      campaignId,
    );
  requireThat(stored, 404, "Campaign not found");
  const campaign = campaignView(stored);
  requireThat(
    p.mode === campaign.mode,
    409,
    "Campaign and ledger source modes differ",
  );
  requireThat(
    Array.isArray(p.events) &&
      p.events.length <= (p.mode === "observed" ? 20 : 1000),
    400,
    "Use bounded ledger chunks",
  );
  requireThat(
    Array.isArray(p.scopeWallets) && p.scopeWallets.length <= 10000,
    400,
    "Wallet scope required",
  );
  const scope = [
    ...new Set(
      p.scopeWallets.map((w) => {
        const s = text(w, "scope wallet");
        decode58(s, 32);
        return s;
      }),
    ),
  ].sort();
  const scopeHash = await sha(canonical(scope));
  const throughAt = integer(p.throughAt, "source time"),
    throughSlot = integer(p.throughSlot, "source slot");
  requireThat(
    throughAt <= Date.now() && p.fromMint === true,
    409,
    "Complete history from mint is required",
  );
  const cursor = text(p.cursor, "source cursor", 1000),
    source = text(p.source, "source", 200);
  requireThat(typeof p.complete === "boolean", 400, "Completion flag required");
  const previous = await one<{
    through_at: number;
    through_slot: number;
    state: string;
  }>(
    db,
    "SELECT * FROM meme_ledger_checkpoints WHERE campaign_id=? AND scope_hash=?",
    campaignId,
    scopeHash,
  );
  requireThat(
    !previous ||
      (throughAt >= previous.through_at &&
        throughSlot >= previous.through_slot),
    409,
    "Source checkpoint cannot move backwards",
  );
  const events = p.events.map(validateEvent),
    statements: D1PreparedStatement[] = [];
  let importedEvents = 0;
  const seen = new Map<string, string>();
  const sealed = await rows<{ through_at: number; scope_wallets: string }>(
    db,
    "SELECT through_at,scope_wallets FROM meme_ledger_seals WHERE campaign_id=?",
    campaignId,
  );
  for (const e of events) {
    requireThat(
      e.at <= throughAt && e.slot <= throughSlot,
      409,
      "Event beyond checkpoint",
    );
    const addresses = e.kind === "transfer" ? [e.from!, e.to!] : [e.wallet!];
    requireThat(
      addresses.some((w) => scope.includes(w)),
      400,
      "Event outside declared wallet scope",
    );
    const id = campaignId + ":" + e.signature + ":" + e.index,
      bytes = canonical(e),
      hash = await sha(bytes);
    if (seen.has(id)) {
      requireThat(seen.get(id) === hash, 409, "Conflicting duplicate event");
      continue;
    }
    seen.set(id, hash);
    const existing = await one<{ payload_hash: string }>(
      db,
      "SELECT payload_hash FROM meme_ledger_events WHERE id=?",
      id,
    );
    if (existing) {
      requireThat(
        existing.payload_hash === hash,
        409,
        "Event changed; import a reviewed correction version instead",
      );
      continue;
    }
    requireThat(
      !sealed.some(
        (cp) =>
          e.at <= cp.through_at &&
          addresses.some((w) =>
            (JSON.parse(cp.scope_wallets) as string[]).includes(w),
          ),
      ),
      409,
      "Late event contradicts a completed source checkpoint",
    );
    importedEvents++;
    if (p.mode === "observed")
      verifyReceipt(e, campaign, await fetchFinalizedReceipt(db, e.signature));
    statements.push(
      db
        .prepare("INSERT INTO meme_ledger_events VALUES(?,?,?,?,?,?,?,?)")
        .bind(id, campaignId, e.signature, e.index, e.slot, e.at, bytes, hash),
    );
    for (const wallet of addresses)
      statements.push(
        db
          .prepare("INSERT INTO meme_receipt_claims VALUES(?,?,?,?)")
          .bind(campaignId, e.signature, wallet, id),
      );
  }
  const evidenceHash = await sha(
    canonical({ source, cursor, throughAt, throughSlot, scope, events }),
  );
  statements.push(
    db
      .prepare(
        "INSERT INTO meme_ledger_checkpoints VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(campaign_id,scope_hash) DO UPDATE SET through_at=excluded.through_at,through_slot=excluded.through_slot,cursor=excluded.cursor,evidence_hash=excluded.evidence_hash,mode=excluded.mode,state=excluded.state,scope_wallets=excluded.scope_wallets",
      )
      .bind(
        campaignId,
        scopeHash,
        throughAt,
        throughSlot,
        cursor,
        evidenceHash,
        p.mode,
        p.complete ? "ready" : "importing",
        canonical(scope),
      ),
  );
  if (p.complete)
    statements.push(
      db
        .prepare(
          "INSERT INTO meme_ledger_seals VALUES(?,?,?,?,?,?,?) ON CONFLICT(campaign_id,scope_hash,through_at) DO NOTHING",
        )
        .bind(
          campaignId,
          scopeHash,
          throughAt,
          throughSlot,
          evidenceHash,
          p.mode,
          canonical(scope),
        ),
    );
  await db.batch(statements);
  return {
    campaignId,
    scopeHash,
    evidenceHash,
    imported: importedEvents,
    state: p.complete ? "ready" : "importing",
  };
}
export async function holdingForRound(
  db: Database,
  roundId: string,
  cutoff: number,
  viewer: number | null = null,
) {
  const all = await campaigns(db),
    active = all.filter((c) => c.launchedAt < cutoff && c.endsAt >= cutoff),
    votes = await rows<{ fid: number }>(
      db,
      "SELECT fid FROM meme_votes WHERE round_id=?",
      roundId,
    ),
    fids = [
      ...new Set([...votes.map((v) => v.fid), ...(viewer ? [viewer] : [])]),
    ],
    scopes = await rows<{ fid: number; address: string }>(
      db,
      "SELECT fid,address FROM meme_vote_wallets WHERE round_id=?",
      roundId,
    );
  if (viewer && !votes.some((v) => v.fid === viewer))
    scopes.push(
      ...(await rows<{ fid: number; address: string }>(
        db,
        "SELECT fid,address FROM meme_wallet_links WHERE fid=? AND chain='solana' AND revoked_at IS NULL",
        viewer,
      )),
    );
  const eventMap = new Map<string, LedgerEvent[]>(),
    checkpointMap = new Map<
      string,
      { scope: string[]; throughAt: number; hash: string; mode: string }[]
    >();
  for (const c of active) {
    eventMap.set(
      c.id,
      (
        await rows<{ payload: string }>(
          db,
          "SELECT payload FROM meme_ledger_events WHERE campaign_id=? AND event_at<=? ORDER BY slot,signature,event_index",
          c.id,
          cutoff,
        )
      ).map((r) => JSON.parse(r.payload) as LedgerEvent),
    );
    checkpointMap.set(
      c.id,
      (
        await rows<{
          scope_wallets: string;
          through_at: number;
          evidence_hash: string;
          mode: string;
        }>(
          db,
          "SELECT scope_wallets,through_at,evidence_hash,mode FROM meme_ledger_seals WHERE campaign_id=? AND through_at>=?",
          c.id,
          cutoff,
        )
      ).map((p) => ({
        scope: JSON.parse(p.scope_wallets),
        throughAt: p.through_at,
        hash: p.evidence_hash,
        mode: p.mode,
      })),
    );
  }
  const units = new Map<number, bigint>(),
    details = new Map<number, ReturnType<typeof normalizedHolding>>(),
    pending: number[] = [];
  for (const fid of fids) {
    const wallets = new Set(
      scopes.filter((s) => s.fid === fid).map((s) => s.address),
    );
    const complete = active.every(
      (c) =>
        wallets.size === 0 ||
        (checkpointMap.get(c.id) ?? []).some((cp) =>
          [...wallets].every((w) => cp.scope.includes(w)),
        ),
    );
    if (!complete) {
      pending.push(fid);
      continue;
    }
    try {
      const value = normalizedHolding(active, eventMap, wallets, cutoff);
      units.set(fid, value.units);
      details.set(fid, value);
    } catch {
      pending.push(fid);
    }
  }
  return {
    units,
    details,
    pending,
    complete: pending.length === 0,
    campaigns: active,
    events: eventMap,
    checkpoints: checkpointMap,
  };
}
export async function holdingRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (
    !["/api/meme/operator/campaigns", "/api/meme/operator/ledger"].includes(
      path,
    )
  )
    return null;
  const { operator, audit } = await import("./rounds");
  requireThat(request.method === "POST", 405, "Method not allowed");
  const actor = await operator(db, request);
  if (path.endsWith("/campaigns")) {
    const p = await payload(request, [
      "id",
      "mint",
      "symbol",
      "launchedAt",
      "totalSupply",
      "decimals",
      "mode",
      "launchEvidence",
    ]);
    const result = await recordCampaign(db, p);
    await audit(db, actor, "record-campaign", result.id, { mode: p.mode });
    return json(result);
  }
  const p = await payload(
    request,
    [
      "campaignId",
      "events",
      "scopeWallets",
      "throughAt",
      "throughSlot",
      "cursor",
      "source",
      "mode",
      "complete",
      "fromMint",
    ],
    2000000,
  );
  const result = await importLedger(db, p);
  await audit(db, actor, "import-ledger", result.campaignId, {
    hash: result.evidenceHash,
  });
  return json(result);
}
