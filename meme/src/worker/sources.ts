import {
  one,
  rows,
  run,
  sha,
  requireThat,
  integer,
  text,
  json,
  payload,
  type Database,
} from "./db";
import { canonical } from "../shared/canonical";
import { decode58 } from "../shared/base58";
import {
  type HistoryAdapter,
  heliusAdapter,
  historicalPrice,
} from "./sourceAdapters";
import { type Receipt, receiptDelta, verifyReceipt } from "./receipts";
import { operator } from "./rounds";
import type { LedgerEvent } from "../shared/holding";
interface SourceRun {
  id: string;
  campaign_id: string;
  wallet: string;
  from_at: number;
  through_at: number;
  cursor: string | null;
  state: string;
  pages: number;
  root_hash: string;
  last_slot: number;
}
export async function beginSource(
  db: Database,
  campaignId: string,
  wallet: string,
  throughAt: number,
) {
  decode58(wallet, 32);
  integer(throughAt, "history cutoff");
  requireThat(
    throughAt <= Date.now() - 120000,
    409,
    "Allow finalized history to stabilize before collection",
  );
  const campaign = await one<{ launched_at: number }>(
    db,
    "SELECT launched_at FROM meme_campaigns WHERE id=?",
    campaignId,
  );
  requireThat(
    campaign && throughAt > campaign.launched_at,
    409,
    "History must cover the campaign from launch",
  );
  requireThat(
    campaign.launched_at >= Date.UTC(2023, 0, 1),
    409,
    "Pre-owner-metadata campaign history needs a separate archival adapter",
  );
  const id = await sha(
    canonical({ campaignId, wallet, throughAt, provider: "helius-history-v1" }),
  );
  await run(
    db,
    "INSERT INTO meme_source_runs(id,campaign_id,wallet,provider,from_at,through_at,cursor,state,root_hash,created_at) VALUES(?,?,?,'helius',?,?,NULL,'collecting',?,?) ON CONFLICT(id) DO NOTHING",
    id,
    campaignId,
    wallet,
    campaign.launched_at,
    throughAt,
    await sha("helius-history-v1"),
    Date.now(),
  );
  return { id };
}
export async function collectSource(
  db: Database,
  id: string,
  adapter: HistoryAdapter,
) {
  const r = await one<SourceRun>(
    db,
    "SELECT * FROM meme_source_runs WHERE id=?",
    id,
  );
  requireThat(r, 404, "Source run not found");
  if (r.state === "ready") return { id, state: "ready", rootHash: r.root_hash };
  requireThat(r.state === "collecting", 409, "Source run is blocked");
  const page = await adapter.page({
    wallet: r.wallet,
    fromAt: r.from_at,
    throughAt: r.through_at,
    cursor: r.cursor,
  });
  requireThat(
    page.data.length <= 20 &&
      (page.paginationToken === null || page.data.length > 0),
    409,
    "Invalid or empty nonterminal history page",
  );
  requireThat(
    page.paginationToken === null ||
      (typeof page.paginationToken === "string" &&
        page.paginationToken.length <= 256 &&
        page.paginationToken !== r.cursor),
    409,
    "Source cursor did not advance",
  );
  let last = r.last_slot;
  const statements: D1PreparedStatement[] = [];
  const seen = new Map<string, string>();
  for (const receipt of page.data) {
    // Owner metadata is absent on ancient transactions; never claim that history is complete.
    requireThat(
      Number.isSafeInteger(receipt.slot) &&
        receipt.slot >= 111491819 &&
        receipt.slot >= last &&
        receipt.blockTime != null &&
        receipt.blockTime * 1000 >= Math.floor(r.from_at / 1000) * 1000 &&
        receipt.blockTime * 1000 <= r.through_at &&
        receipt.meta &&
        receipt.meta.err === null &&
        (receipt.version == null ||
          receipt.version === "legacy" ||
          receipt.version === 0),
      409,
      "History has unsupported, out-of-order or incomplete receipts",
    );
    last = receipt.slot;
    const signature = receipt.transaction.signatures?.[0];
    decode58(signature, 64);
    const bytes = JSON.stringify(receipt),
      hash = await sha(bytes);
    requireThat(
      !seen.has(signature) || seen.get(signature) === hash,
      409,
      "Conflicting duplicate receipt",
    );
    seen.set(signature, hash);
    const old = await one<{ payload_hash: string }>(
      db,
      "SELECT payload_hash FROM meme_source_receipts WHERE run_id=? AND signature=?",
      id,
      signature,
    );
    requireThat(
      !old || old.payload_hash === hash,
      409,
      "Conflicting historical receipt",
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO meme_source_receipts VALUES(?,?,?,?,?,?) ON CONFLICT(run_id,signature) DO NOTHING",
        )
        .bind(
          id,
          signature,
          receipt.slot,
          receipt.blockTime * 1000,
          bytes,
          hash,
        ),
    );
  }
  if (page.paginationToken)
    requireThat(
      !(await one(
        db,
        "SELECT 1 FROM meme_source_pages WHERE run_id=? AND request_cursor=?",
        id,
        page.paginationToken,
      )),
      409,
      "Source cursor loop",
    );
  const bytes = JSON.stringify(page),
    hash = await sha(bytes),
    root = await sha(r.root_hash + ":" + hash);
  // CAS transaction protects pagination from overlapping workers and lost responses.
  statements.unshift(
    db
      .prepare("INSERT INTO meme_source_pages VALUES(?,?,?,?,?,?)")
      .bind(id, r.pages, r.cursor ?? "", page.paginationToken, hash, bytes),
  );
  statements.push(
    db
      .prepare(
        "UPDATE meme_source_runs SET pages=pages+1,cursor=?,root_hash=?,last_slot=?,state=? WHERE id=? AND pages=? AND state='collecting'",
      )
      .bind(
        page.paginationToken,
        root,
        last,
        page.paginationToken ? "collecting" : "ready",
        id,
        r.pages,
      ),
  );
  await db.batch(statements);
  return {
    id,
    state: page.paginationToken ? "collecting" : "ready",
    rootHash: root,
  };
}

/** Every relevant receipt in complete history must reconcile to accepted ledger evidence.
 * Manual classifications still require independent finalized receipts and oracle prices. */
export async function requireDependableSources(
  db: Database,
  campaignId: string,
  mint: string,
  launchedAt: number,
  cutoff: number,
  wallets: Set<string>,
  requireVersion = false,
) {
  requireThat(
    !(await one(
      db,
      "SELECT id FROM meme_source_corrections WHERE campaign_id=? AND state='proposed' AND effective_from<=?",
      campaignId,
      cutoff,
    )),
    409,
    "A source correction requires review",
  );
  const { chosenVersion } = await import("./evidenceVersions");
  const version = await chosenVersion(db, campaignId, cutoff);
  if (version) {
    const scope = new Set<string>(JSON.parse(version.scope_wallets));
    requireThat(
      version.mode === "observed" &&
        version.through_at >= cutoff &&
        [...wallets].every((w) => scope.has(w)),
      409,
      "Accepted source version does not cover settlement",
    );
    return;
  }
  requireThat(
    !requireVersion,
    409,
    "A verified evidence version is required for observed settlement",
  );
  for (const wallet of wallets) {
    const r = await one<SourceRun>(
      db,
      "SELECT * FROM meme_source_runs WHERE campaign_id=? AND wallet=? AND from_at<=? AND through_at>=? AND state='ready' ORDER BY through_at,id LIMIT 1",
      campaignId,
      wallet,
      launchedAt,
      cutoff,
    );
    requireThat(
      r,
      409,
      "Complete token-account history is required at round close",
    );
    let signature = "";
    for (;;) {
      const page = await rows<{ signature: string; payload: string }>(
        db,
        "SELECT signature,payload FROM meme_source_receipts WHERE run_id=? AND at<=? AND signature>? ORDER BY signature LIMIT 40",
        r.id,
        cutoff,
        signature,
      );
      for (const record of page) {
        const receipt = JSON.parse(record.payload) as Receipt;
        const delta = receiptDelta(receipt, wallet, mint);
        if (delta !== 0n) {
          const e = await one<{ payload: string }>(
            db,
            "SELECT e.payload FROM meme_receipt_claims c JOIN meme_ledger_events e ON e.id=c.event_id WHERE c.campaign_id=? AND c.signature=? AND c.wallet=?",
            campaignId,
            record.signature,
            wallet,
          );
          requireThat(e, 409, "History contains unclassified token movements");
          const event = JSON.parse(e.payload) as LedgerEvent;
          verifyReceipt(event, { mint }, receipt);
          if (event.quote) await requireIndependentQuote(db, event);
        }
        signature = record.signature;
      }
      if (page.length < 40) break;
    }
    // Also reject ledger events missing from the independent complete history.
    const missing = await one(
      db,
      "SELECT e.id FROM meme_ledger_events e JOIN meme_ledger_wallet_index w ON w.event_id=e.id WHERE e.campaign_id=? AND w.wallet=? AND e.event_at<=? AND NOT EXISTS(SELECT 1 FROM meme_source_receipts s WHERE s.run_id=? AND s.signature=e.signature) LIMIT 1",
      campaignId,
      wallet,
      cutoff,
      r.id,
    );
    requireThat(
      !missing,
      409,
      "Ledger evidence is absent from complete source history",
    );
  }
}
export async function requireIndependentQuote(
  db: Database,
  event: LedgerEvent,
) {
  if (event.kind !== "purchase") return;
  const q = event.quote;
  requireThat(q, 409, "Purchase price required");
  const price = await one<{
    payment_mint: string;
    at: number;
    usd_micros: string;
    decimals: number;
  }>(
    db,
    "SELECT p.*,f.decimals FROM meme_verified_prices p JOIN meme_price_feeds f ON f.payment_mint=p.payment_mint WHERE p.evidence_hash=?",
    q.evidenceHash,
  );
  requireThat(
    price &&
      price.payment_mint === q.paymentMint &&
      price.at === event.at &&
      q.at === event.at &&
      price.usd_micros === q.usdPriceMicros &&
      price.decimals === q.paymentDecimals &&
      q.source === "pyth-hermes-https",
    409,
    "Independent historical acquisition price required",
  );
}
export async function sourceRequest(
  db: Database,
  request: Request,
  keys: { helius: string; pyth: string },
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/meme/operator/sources/")) return null;
  const actor = await operator(db, request);
  if (path.endsWith("/status") && request.method === "GET")
    return json(
      await rows(
        db,
        "SELECT id,campaign_id,wallet,from_at,through_at,state,pages,root_hash FROM meme_source_runs ORDER BY created_at DESC LIMIT 100",
      ),
    );
  requireThat(request.method === "POST", 405, "Method not allowed");
  if (path.endsWith("/start")) {
    const p = await payload(request, ["campaignId", "wallet", "throughAt"]);
    return json(
      await beginSource(
        db,
        text(p.campaignId, "campaign"),
        text(p.wallet, "wallet"),
        integer(p.throughAt, "cutoff"),
      ),
    );
  }
  if (path.endsWith("/step")) {
    const p = await payload(request, ["id"]);
    return json(
      await collectSource(
        db,
        text(p.id, "run ID"),
        heliusAdapter(db, keys.helius),
      ),
    );
  }
  if (path.endsWith("/price")) {
    const p = await payload(request, ["paymentMint", "at"]);
    return json(
      await historicalPrice(
        db,
        text(p.paymentMint, "payment mint"),
        integer(p.at, "acquisition time"),
        keys.pyth,
      ),
    );
  }
  if (path.endsWith("/correction-review")) {
    const p = await payload(request, [
        "id",
        "manifestHash",
        "reason",
        "reject",
      ]),
      id = text(p.id, "correction ID"),
      reason = text(p.reason, "review reason", 2000),
      hash = text(p.manifestHash, "manifest hash", 64);
    requireThat(/^[a-f0-9]{64}$/.test(hash), 400, "SHA-256 manifest required");
    await run(
      db,
      "UPDATE meme_source_corrections SET manifest_hash=?,resolution=?,state=? WHERE id=? AND state='proposed'",
      hash,
      canonical({ actor, reason, at: Date.now() }),
      p.reject === true ? "rejected" : "proposed",
      id,
    );
    return json({
      id,
      state: p.reject === true ? "rejected" : "proposed",
      manifestHash: hash,
    });
  }
  if (path.endsWith("/correction")) {
    const p = await payload(request, [
      "id",
      "parentId",
      "campaignId",
      "reason",
      "manifestHash",
      "effectiveFrom",
    ]);
    const effective = integer(p.effectiveFrom, "effective cutoff"),
      campaign = text(p.campaignId, "campaign"),
      hash = text(p.manifestHash, "manifest hash", 64);
    requireThat(/^[a-f0-9]{64}$/.test(hash), 400, "SHA-256 manifest required");
    requireThat(
      !(await one(
        db,
        "SELECT round_id FROM meme_settlements WHERE cutoff>=?",
        effective,
      )),
      409,
      "Correction must not rewrite a frozen settlement",
    );
    await run(
      db,
      "INSERT INTO meme_source_corrections VALUES(?,?,?,?,?,?,'proposed',?,?,NULL)",
      text(p.id, "correction ID"),
      p.parentId ?? null,
      campaign,
      text(p.reason, "reason", 2000),
      hash,
      effective,
      actor,
      Date.now(),
    );
    return json({ state: "proposed", blocksFinalization: true });
  }
  return null;
}
