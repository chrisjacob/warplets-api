import { one, rows, requireThat, sha, type Database } from "./db";
import { canonical } from "../shared/canonical";
import { normalizedHolding, type LedgerEvent } from "../shared/holding";
import { campaigns } from "./holding";
import { receiptDelta, verifyReceipt, type Receipt } from "./receipts";
import { requireIndependentQuote } from "./sources";
import type { EvidenceVersion } from "./evidenceVersions";
interface Check {
  wallet_index: number;
  signature: string;
  source_id: string | null;
  source_root: string;
  base_hash: string;
  state: string;
}
/** Complete history validation in bounded, restartable pages; no source calls from reads. */
export async function sealVersion(db: Database, id: string, preview = false) {
  const v = await one<EvidenceVersion>(
    db,
    "SELECT * FROM meme_evidence_versions WHERE id=?",
    id,
  );
  requireThat(v, 404, "Version not found");
  if (v.state === "ready")
    return { id, state: "ready", manifestHash: v.manifest_hash };
  const campaign = (await campaigns(db)).find((c) => c.id === v.campaign_id)!,
    wallets = JSON.parse(v.scope_wallets) as string[];
  const all = await rows<{ payload: string; payload_hash: string }>(
    db,
    "SELECT payload,payload_hash FROM meme_version_events WHERE version_id=? ORDER BY slot,signature,event_index LIMIT 5001",
    id,
  );
  requireThat(
    all.length <= 5000,
    409,
    "Version requires a larger-history replay implementation",
  );
  const events = all.map((e) => JSON.parse(e.payload) as LedgerEvent);
  let check = await one<Check>(
    db,
    "SELECT * FROM meme_version_checks WHERE version_id=?",
    id,
  );
  if (!check) {
    normalizedHolding(
      [campaign],
      new Map([[campaign.id, events]]),
      new Set(wallets),
      v.through_at,
    );
    const base = await sha(
      canonical({
        id,
        campaign: v.campaign_id,
        parent: v.parent_id,
        correction: v.correction_id,
        effectiveFrom: v.effective_from,
        throughAt: v.through_at,
        scope: wallets,
        mode: v.mode,
        events: all.map((e) => e.payload_hash),
      }),
    );
    const sourceRoot = await sha("source-history-v1");
    await db.batch([
      db
        .prepare(
          "UPDATE meme_evidence_versions SET state='checking' WHERE id=? AND state='building'",
        )
        .bind(id),
      db
        .prepare(
          "INSERT INTO meme_version_checks VALUES(?,0,'',NULL,?,?,'checking')",
        )
        .bind(id, sourceRoot, base),
    ]);
    check = {
      wallet_index: 0,
      signature: "",
      source_id: null,
      source_root: sourceRoot,
      base_hash: base,
      state: "checking",
    };
  }
  if (v.mode === "observed" && check.wallet_index < wallets.length) {
    const wallet = wallets[check.wallet_index];
    const source = check.source_id
      ? await one<{ id: string; root_hash: string }>(
          db,
          "SELECT id,root_hash FROM meme_source_runs WHERE id=? AND state='ready'",
          check.source_id,
        )
      : await one<{ id: string; root_hash: string }>(
          db,
          "SELECT id,root_hash FROM meme_source_runs WHERE campaign_id=? AND wallet=? AND from_at<=? AND through_at>=? AND state='ready' ORDER BY through_at,id LIMIT 1",
          campaign.id,
          wallet,
          campaign.launchedAt,
          v.through_at,
        );
    requireThat(
      source,
      409,
      "Complete source history required to seal version",
    );
    const page = await rows<{ signature: string; payload: string }>(
      db,
      "SELECT signature,payload FROM meme_source_receipts WHERE run_id=? AND at<=? AND signature>? ORDER BY signature LIMIT 20",
      source.id,
      v.through_at,
      check.signature,
    );
    let signature = check.signature;
    for (const r of page) {
      const receipt = JSON.parse(r.payload) as Receipt;
      if (receiptDelta(receipt, wallet, campaign.mint) !== 0n) {
        const event = events.find(
          (e) =>
            e.signature === r.signature &&
            [e.wallet, e.from, e.to].includes(wallet),
        );
        requireThat(event, 409, "Version omits a source movement");
        verifyReceipt(event, campaign, receipt);
        await requireIndependentQuote(db, event);
      }
      signature = r.signature;
    }
    const done = page.length < 20;
    if (done)
      requireThat(
        !(await one(
          db,
          "SELECT e.event_key FROM meme_version_events e JOIN meme_version_wallets w ON w.version_id=e.version_id AND w.event_key=e.event_key WHERE e.version_id=? AND w.wallet=? AND NOT EXISTS(SELECT 1 FROM meme_source_receipts s WHERE s.run_id=? AND s.signature=e.signature) LIMIT 1",
          id,
          wallet,
          source.id,
        )),
        409,
        "Version event missing from complete history",
      );
    await db.batch([
      db
        .prepare(
          "UPDATE meme_version_checks SET wallet_index=?,signature=?,source_id=?,source_root=? WHERE version_id=? AND wallet_index=? AND signature=?",
        )
        .bind(
          done ? check.wallet_index + 1 : check.wallet_index,
          done ? "" : signature,
          done ? null : source.id,
          done
            ? await sha(
                check.source_root + ":" + wallet + ":" + source.root_hash,
              )
            : check.source_root,
          id,
          check.wallet_index,
          check.signature,
        ),
    ]);
    return {
      id,
      state: "checking",
      walletsChecked: check.wallet_index + (done ? 1 : 0),
    };
  }
  const manifestHash = await sha(check.base_hash + ":" + check.source_root);
  if (check.state !== "review_ready")
    await db.batch([
      db
        .prepare(
          "UPDATE meme_version_checks SET state='review_ready' WHERE version_id=?",
        )
        .bind(id),
    ]);
  if (preview) return { id, state: "review_ready", manifestHash };
  if (v.correction_id) {
    const correction = await one<{ manifest_hash: string }>(
      db,
      "SELECT manifest_hash FROM meme_source_corrections WHERE id=? AND state='proposed'",
      v.correction_id,
    );
    requireThat(
      correction?.manifest_hash === manifestHash,
      409,
      "Correction review manifest does not match sealed evidence",
    );
  }
  await db.batch([
    db
      .prepare(
        "UPDATE meme_evidence_versions SET state='ready',manifest_hash=? WHERE id=? AND state='checking'",
      )
      .bind(manifestHash, id),
    ...(v.correction_id
      ? [
          db
            .prepare(
              "UPDATE meme_source_corrections SET state='superseded',resolution=json_object('version',?,'review',json(resolution)) WHERE id=? AND state='proposed'",
            )
            .bind(id, v.correction_id),
        ]
      : []),
  ]);
  return { id, state: "ready", manifestHash };
}
