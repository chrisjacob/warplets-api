import { canonical } from "../shared/canonical";
import { HoldingReplay, type ReplayCheckpoint } from "../shared/holdingReplay";
import type { LedgerEvent, Campaign } from "../shared/holding";
import type { EvidenceVersion } from "./evidenceVersions";
import { one, rows, requireThat, sha, type Database } from "./db";
import { receiptDelta, verifyReceipt, type Receipt } from "./receipts";
import { requireIndependentQuote } from "./sources";

interface Progress {
  phase: "hash" | "replay" | "sources" | "review";
  cursor_slot: number;
  cursor_signature: string;
  cursor_index: number;
  event_count: number;
  event_root: string;
  wallet_index: number;
  replay: string | null;
  source_id: string | null;
  source_signature: string;
  source_root: string;
  revision: number;
}
/** New large manifests use explicit v2 folding. Existing accepted manifests are never rewritten. */
export async function sealPagedVersion(
  db: Database,
  v: EvidenceVersion,
  campaign: Campaign,
  preview: boolean,
) {
  const id = v.id,
    wallets = JSON.parse(v.scope_wallets) as string[];
  await db.batch([
    db
      .prepare(
        "UPDATE meme_evidence_versions SET state='checking' WHERE id=? AND state='building'",
      )
      .bind(id),
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_version_page_progress(version_id,phase,event_root,source_root) VALUES(?,'hash',?,?)",
      )
      .bind(id, await sha("version-events-v2"), await sha("source-history-v1")),
  ]);
  const old = (await one<Progress>(
    db,
    "SELECT * FROM meme_version_page_progress WHERE version_id=?",
    id,
  ))!;
  const next = { ...old };
  if (old.phase === "hash") {
    const page = await rows<{
      slot: number;
      signature: string;
      event_index: number;
      payload_hash: string;
    }>(
      db,
      "SELECT slot,signature,event_index,payload_hash FROM meme_version_events WHERE version_id=? AND (slot,signature,event_index)>(?,?,?) ORDER BY slot,signature,event_index LIMIT 200",
      id,
      old.cursor_slot,
      old.cursor_signature,
      old.cursor_index,
    );
    for (const e of page) {
      next.event_root = await sha(next.event_root + ":" + e.payload_hash);
      next.event_count++;
      next.cursor_slot = e.slot;
      next.cursor_signature = e.signature;
      next.cursor_index = e.event_index;
    }
    if (page.length < 200) next.phase = "replay";
  } else if (old.phase === "replay") {
    if (old.wallet_index === wallets.length) {
      next.phase = v.mode === "observed" ? "sources" : "review";
      next.wallet_index = 0;
    } else {
      const wallet = wallets[old.wallet_index],
        state = old.replay
          ? (JSON.parse(old.replay) as ReplayCheckpoint)
          : undefined;
      const replay = new HoldingReplay(
          campaign,
          new Set([wallet]),
          v.through_at,
          state,
        ),
        cursor = state?.last;
      const page = await rows<{ payload: string }>(
        db,
        "SELECT e.payload FROM meme_version_events e WHERE e.version_id=? AND (e.slot,e.signature,e.event_index)>(?,?,?) AND e.event_key IN(SELECT event_key FROM meme_version_wallets WHERE version_id=? AND wallet=?) ORDER BY e.slot,e.signature,e.event_index LIMIT 200",
        id,
        cursor?.slot ?? -1,
        cursor?.signature ?? "",
        cursor?.index ?? -1,
        id,
        wallet,
      );
      for (const e of page) replay.push(JSON.parse(e.payload) as LedgerEvent);
      next.replay = canonical(replay.checkpoint());
      requireThat(
        next.replay.length <= 1024 * 1024,
        409,
        "Replay checkpoint exceeds reviewed memory allowance; do not truncate history",
      );
      if (page.length < 200) {
        replay.value();
        next.wallet_index++;
        next.replay = null;
      }
    }
  } else if (old.phase === "sources") {
    if (old.wallet_index === wallets.length) next.phase = "review";
    else {
      const wallet = wallets[old.wallet_index];
      const source = await one<{ id: string; root_hash: string }>(
        db,
        "SELECT id,root_hash FROM meme_source_runs WHERE campaign_id=? AND wallet=? AND from_at<=? AND through_at>=? AND state='ready' AND (? IS NULL OR id=?) ORDER BY through_at,id LIMIT 1",
        campaign.id,
        wallet,
        campaign.launchedAt,
        v.through_at,
        old.source_id,
        old.source_id,
      );
      requireThat(
        source,
        409,
        "Complete source history required to seal version",
      );
      next.source_id = source.id;
      const page = await rows<{ signature: string; payload: string }>(
        db,
        "SELECT signature,payload FROM meme_source_receipts WHERE run_id=? AND at<=? AND signature>? ORDER BY signature LIMIT 20",
        source.id,
        v.through_at,
        old.source_signature,
      );
      for (const r of page) {
        const receipt = JSON.parse(r.payload) as Receipt;
        if (receiptDelta(receipt, wallet, campaign.mint) !== 0n) {
          const event = await one<{ payload: string }>(
            db,
            "SELECT e.payload FROM meme_version_events e JOIN meme_version_wallets w ON w.version_id=e.version_id AND w.event_key=e.event_key WHERE e.version_id=? AND e.signature=? AND w.wallet=?",
            id,
            r.signature,
            wallet,
          );
          requireThat(event, 409, "Version omits a source movement");
          const e = JSON.parse(event.payload) as LedgerEvent;
          verifyReceipt(e, campaign, receipt);
          await requireIndependentQuote(db, e);
        }
        next.source_signature = r.signature;
      }
      if (page.length < 20) {
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
        next.source_root = await sha(
          old.source_root + ":" + wallet + ":" + source.root_hash,
        );
        next.wallet_index++;
        next.source_id = null;
        next.source_signature = "";
      }
    }
  }
  const result = await db.batch([
    db
      .prepare(
        "UPDATE meme_version_page_progress SET phase=?,cursor_slot=?,cursor_signature=?,cursor_index=?,event_count=?,event_root=?,wallet_index=?,replay=?,source_id=?,source_signature=?,source_root=?,revision=revision+1 WHERE version_id=? AND revision=?",
      )
      .bind(
        next.phase,
        next.cursor_slot,
        next.cursor_signature,
        next.cursor_index,
        next.event_count,
        next.event_root,
        next.wallet_index,
        next.replay,
        next.source_id,
        next.source_signature,
        next.source_root,
        id,
        old.revision,
      ),
  ]);
  requireThat(
    result[0].meta.changes === 1,
    409,
    "Concurrent evidence page; resume the committed checkpoint",
  );
  if (next.phase !== "review")
    return {
      id,
      state: "checking",
      phase: next.phase,
      eventsChecked: next.event_count,
      walletsChecked: next.wallet_index,
    };
  const manifestHash = await sha(
    canonical({
      version: 2,
      id,
      campaign: v.campaign_id,
      parent: v.parent_id,
      correction: v.correction_id,
      effectiveFrom: v.effective_from,
      throughAt: v.through_at,
      scope: wallets,
      mode: v.mode,
      eventCount: next.event_count,
      eventRoot: next.event_root,
      sourceRoot: next.source_root,
    }),
  );
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

/** One immutable participant/campaign page per background step, never called by public reads. */
export async function replayVersionPage(
  db: Database,
  snapshot: string,
  fid: number,
  campaign: Campaign,
  version: string,
  wallets: ReadonlySet<string>,
  cutoff: number,
) {
  const empty = new HoldingReplay(campaign, wallets, cutoff).checkpoint();
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_score_replay_progress(snapshot_id,fid,campaign_id,checkpoint) VALUES(?,?,?,?)",
      )
      .bind(snapshot, fid, campaign.id, canonical(empty)),
  ]);
  const progress = (await one<{
    checkpoint: string;
    complete: number;
    revision: number;
  }>(
    db,
    "SELECT * FROM meme_score_replay_progress WHERE snapshot_id=? AND fid=? AND campaign_id=?",
    snapshot,
    fid,
    campaign.id,
  ))!;
  const state = JSON.parse(progress.checkpoint) as ReplayCheckpoint;
  const replay = new HoldingReplay(campaign, wallets, cutoff, state);
  if (progress.complete) return { complete: true, ...replay.value() };
  const cursor = state.last;
  const page = await rows<{ payload: string }>(
    db,
    "SELECT e.payload FROM meme_version_events e WHERE e.version_id=? AND e.event_at<=? AND (e.slot,e.signature,e.event_index)>(?,?,?) AND e.event_key IN(SELECT event_key FROM meme_version_wallets WHERE version_id=? AND wallet IN(SELECT value FROM json_each(?))) ORDER BY e.slot,e.signature,e.event_index LIMIT 200",
    version,
    cutoff,
    cursor?.slot ?? -1,
    cursor?.signature ?? "",
    cursor?.index ?? -1,
    version,
    canonical([...wallets].sort()),
  );
  for (const e of page) replay.push(JSON.parse(e.payload) as LedgerEvent);
  const encoded = canonical(replay.checkpoint()),
    complete = page.length < 200;
  requireThat(
    encoded.length <= 1024 * 1024,
    409,
    "Replay checkpoint exceeds reviewed memory allowance; do not truncate history",
  );
  const result = await db.batch([
    db
      .prepare(
        "UPDATE meme_score_replay_progress SET checkpoint=?,complete=?,revision=revision+1 WHERE snapshot_id=? AND fid=? AND campaign_id=? AND revision=?",
      )
      .bind(
        encoded,
        Number(complete),
        snapshot,
        fid,
        campaign.id,
        progress.revision,
      ),
  ]);
  requireThat(
    result[0].meta.changes === 1,
    409,
    "Concurrent score page; resume the committed checkpoint",
  );
  return { complete, ...replay.value() };
}
