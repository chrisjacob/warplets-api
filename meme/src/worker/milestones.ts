import { Exact } from "../shared/exact";
import { canonical } from "../shared/canonical";
import { one, run, sha, requireThat, type Database } from "./db";
/** Only a trusted supply/price adapter may construct this evidence. No public/admin endpoint accepts it. */
export interface VerifiedFdv {
  editionId: string;
  mint: string;
  supplyRaw: string;
  decimals: number;
  mintAuthority: null;
  priceUsd: string;
  at: number;
  verifiedAt: number;
  supplyHash: string;
  priceHash: string;
  mode: "observed" | "simulated";
}
export async function observeMilestone(
  db: Database,
  ruleId: string,
  proof: VerifiedFdv,
  now = Date.now(),
) {
  const rule = await one<{
    edition_id: string;
    threshold_usd: string;
    enabled: number;
  }>(db, "SELECT * FROM meme_milestone_rules WHERE id=?", ruleId);
  requireThat(
    rule?.enabled && rule.edition_id === proof.editionId,
    409,
    "An enabled matching milestone rule is required",
  );
  const campaign = await one<{
    mint: string;
    total_supply: string;
    decimals: number;
    mode: string;
  }>(
    db,
    "SELECT mint,total_supply,decimals,mode FROM meme_campaigns WHERE id=?",
    proof.editionId,
  );
  requireThat(
    campaign &&
      campaign.mint === proof.mint &&
      campaign.total_supply === proof.supplyRaw &&
      campaign.decimals === proof.decimals &&
      campaign.mode === proof.mode &&
      proof.mintAuthority === null &&
      /^\d{1,40}$/.test(proof.supplyRaw) &&
      Number.isInteger(proof.decimals) &&
      proof.decimals >= 0 &&
      proof.decimals <= 18,
    409,
    "Verified fixed supply and revoked mint authority are required",
  );
  requireThat(
    Number.isSafeInteger(proof.at) &&
      Number.isSafeInteger(proof.verifiedAt) &&
      proof.at <= proof.verifiedAt &&
      proof.verifiedAt <= now &&
      now - proof.at <= 300000 &&
      /^[a-f0-9]{64}$/.test(proof.supplyHash) &&
      /^[a-f0-9]{64}$/.test(proof.priceHash),
    409,
    "Fresh verified price and supply provenance are required",
  );
  const price = Exact.decimal(proof.priceUsd);
  requireThat(price.n > 0n, 409, "Positive verified price required");
  const fdv = price.mul(
      new Exact(BigInt(proof.supplyRaw), 10n ** BigInt(proof.decimals)),
    ),
    above = fdv.compare(Exact.decimal(rule.threshold_usd)) >= 0;
  const old = await one<{
    last_at: number;
    state: string;
    first_above: number | null;
    payload: string;
  }>(db, "SELECT * FROM meme_milestone_progress WHERE rule_id=?", ruleId);
  if (old && proof.at <= old.last_at)
    return { state: old.state, replayed: true };
  if (old)
    requireThat(
      JSON.parse(old.payload).proof.priceHash !== proof.priceHash,
      409,
      "A distinct accepted price observation is required",
    );
  const continuous = !!old && proof.at - old.last_at <= 300000;
  // Starting above, or resuming above after a gap, establishes a baseline only.
  const fire =
    continuous &&
    old!.state === "confirming" &&
    above &&
    old!.first_above !== null &&
    proof.at - old!.first_above >= 60000;
  const state =
    old?.state === "fired"
      ? "fired"
      : fire
        ? "fired"
        : !above
          ? "below"
          : continuous &&
              (old!.state === "below" || old!.state === "confirming")
            ? "confirming"
            : "baseline";
  const first =
    state === "confirming"
      ? old?.state === "confirming"
        ? old.first_above
        : proof.at
      : null;
  const payload = canonical({
      proof,
      fdv: fdv.toJSON(),
      ...(fire ? { first: JSON.parse(old!.payload) } : {}),
    }),
    eventId =
      "fdv:" +
      (await sha(
        canonical({ edition: proof.editionId, threshold: rule.threshold_usd }),
      ));
  const statements = [];
  if (fire)
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO meme_milestone_crossings SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM meme_milestone_progress WHERE rule_id=? AND last_at=? AND state='confirming')",
        )
        .bind(
          eventId,
          ruleId,
          proof.editionId,
          rule.threshold_usd,
          proof.at,
          await sha(payload),
          payload,
          ruleId,
          old!.last_at,
        ),
    );
  statements.push(
    db
      .prepare(
        "INSERT INTO meme_milestone_progress VALUES(?,?,?,?,?) ON CONFLICT(rule_id) DO UPDATE SET last_at=excluded.last_at,state=excluded.state,first_above=excluded.first_above,payload=excluded.payload WHERE last_at=?",
      )
      .bind(ruleId, proof.at, state, first, payload, old?.last_at ?? -1),
  );
  if (fire)
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO meme_admin_notice_candidates SELECT ?,'milestones',?,10,?,?,'pending',NULL WHERE EXISTS(SELECT 1 FROM meme_milestone_crossings WHERE id=?)",
        )
        .bind("notice:" + eventId, eventId, now, now + 3600000, eventId),
    );
  if (fire)
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO meme_social_drafts(id,version,title,body,target_path,state,source_event,created_at,updated_at) SELECT ?,1,'FDV milestone',?,?,'draft',?,?,? WHERE EXISTS(SELECT 1 FROM meme_milestone_crossings WHERE id=?)",
        )
        .bind(
          "event-social:" + eventId,
          "A verified $" +
            rule.threshold_usd +
            " FDV milestone was reached. Review the edition.",
          "/?market=" + encodeURIComponent(proof.editionId),
          eventId,
          now,
          now,
          eventId,
        ),
    );
  await db.batch(statements);
  const stored = await one<{ last_at: number; state: string }>(
    db,
    "SELECT last_at,state FROM meme_milestone_progress WHERE rule_id=?",
    ruleId,
  );
  return {
    state: stored!.state,
    eventId:
      fire &&
      (await one(
        db,
        "SELECT id FROM meme_milestone_crossings WHERE id=?",
        eventId,
      ))
        ? eventId
        : null,
  };
}
