import { one, rows, requireThat, sha, type Database } from "./db";
import { canonical } from "../shared/canonical";
import {
  normalizedHolding,
  type Campaign,
  type LedgerEvent,
} from "../shared/holding";
import { boost, decimal, streakLength } from "../shared/scoring";
import { RULES_VERSION } from "../shared/rules";

interface Context {
  rules: string;
  ownership: string;
  campaigns: Campaign[];
  events: number;
  seals: number;
  versionIds: string[];
}
interface Snapshot {
  id: string;
  round_id: string;
  as_of: number;
  context: string;
  state: string;
  input_count: number;
  result_hash: string | null;
}
interface Input {
  fid: number;
  candidate: string | null;
  first: number;
  level: number;
  wallets: string[];
  previous: number[];
}
interface Result {
  boost: {
    base: string;
    total: string;
    warplet: string;
    holding: string;
    streak: string;
    points: string;
    finality: string;
    holdingStatus: string;
  };
  coverage: string[];
  inputHash: string;
}

/** Freeze roster, wallet scopes, streaks and append-only source watermarks in one D1 transaction.
 * Concurrent votes never mutate a running snapshot or starve its publication. */
export async function startSnapshot(
  db: Database,
  id: string,
  roundId: string,
  at = Date.now(),
) {
  const existing = await one<Snapshot>(
    db,
    "SELECT * FROM meme_score_snapshots WHERE id=?",
    id,
  );
  if (existing) {
    requireThat(
      existing.round_id === roundId,
      409,
      "Snapshot ID belongs to another round",
    );
    return existing;
  }
  const r = await one<{
    snapshot_id: string;
    rules_version: string;
    opens_at: number;
    closes_at: number;
  }>(
    db,
    "SELECT r.* FROM meme_rounds r JOIN meme_ownership_snapshots o ON o.id=r.snapshot_id AND o.state='ready' WHERE r.id=?",
    roundId,
  );
  requireThat(
    r && at >= r.opens_at && at <= Date.now(),
    409,
    "Ready, revealed ownership required",
  );
  requireThat(
    r.rules_version === RULES_VERSION,
    409,
    "Unsupported snapshot rules",
  );
  const cutoff = Math.min(at, r.closes_at);
  await db.batch([
    db
      .prepare(
        `INSERT INTO meme_score_snapshots SELECT ?,?, ?,json_object('rules',?,'ownership',?,'events',COALESCE((SELECT MAX(rowid) FROM meme_ledger_events),0),'seals',COALESCE((SELECT MAX(rowid) FROM meme_ledger_seals),0),'versionIds',json(COALESCE((SELECT json_group_array(id) FROM meme_evidence_versions WHERE state='ready'),'[]')),'campaigns',json(COALESCE((SELECT json_group_array(json_object('id',id,'mint',mint,'symbol',symbol,'launchedAt',launched_at,'endsAt',ends_at,'totalSupply',total_supply,'decimals',decimals,'mode',mode)) FROM (SELECT * FROM meme_campaigns WHERE launched_at<? AND ends_at>=? ORDER BY launched_at,id)),'[]'))),'building',0,NULL,?`,
      )
      .bind(
        id,
        roundId,
        cutoff,
        r.rules_version,
        r.snapshot_id,
        cutoff,
        cutoff,
        Date.now(),
      ),
    db
      .prepare(
        `INSERT INTO meme_score_inputs SELECT ?,f.fid,json_object('fid',f.fid,'candidate',v.candidate_id,'first',COALESCE(v.first_valid_at,0),'level',COALESCE(e.level,0),'wallets',json(CASE WHEN v.fid IS NOT NULL THEN COALESCE((SELECT json_group_array(address) FROM (SELECT address FROM meme_vote_wallets WHERE round_id=? AND fid=f.fid ORDER BY address)),'[]') ELSE COALESCE((SELECT json_group_array(address) FROM (SELECT DISTINCT address FROM meme_wallet_links WHERE fid=f.fid AND chain='solana' AND revoked_at IS NULL ORDER BY address)),'[]') END),'previous',json(COALESCE((SELECT json_group_array(voted) FROM (SELECT EXISTS(SELECT 1 FROM meme_votes pv WHERE pv.round_id=pr.id AND pv.fid=f.fid) voted FROM meme_rounds pr WHERE pr.closes_at<? AND pr.snapshot_id IN(SELECT id FROM meme_ownership_snapshots WHERE state='ready') ORDER BY pr.closes_at DESC LIMIT 9)),'[]'))) FROM (SELECT fid FROM meme_votes WHERE round_id=? UNION SELECT fid FROM meme_round_eligibility WHERE round_id=? UNION SELECT fid FROM meme_wallet_links WHERE chain='solana' AND revoked_at IS NULL) f LEFT JOIN meme_votes v ON v.round_id=? AND v.fid=f.fid LEFT JOIN meme_round_eligibility e ON e.round_id=? AND e.fid=f.fid`,
      )
      .bind(id, roundId, r.closes_at, roundId, roundId, roundId, roundId),
    db
      .prepare(
        "UPDATE meme_score_snapshots SET input_count=(SELECT COUNT(*) FROM meme_score_inputs WHERE snapshot_id=?) WHERE id=?",
      )
      .bind(id, id),
  ]);
  return (await one<Snapshot>(
    db,
    "SELECT * FROM meme_score_snapshots WHERE id=?",
    id,
  ))!;
}

/** One participant per step, bounded D1 query count even with ten active campaigns.
 * Event count is capped; unsupported oversized histories stay pending rather than inventing credit. */
export async function stepSnapshot(db: Database, id: string) {
  const s = await one<Snapshot>(
    db,
    "SELECT * FROM meme_score_snapshots WHERE id=?",
    id,
  );
  requireThat(s, 404, "Snapshot not found");
  if (s.state === "ready")
    return { state: "ready", id, resultHash: s.result_hash };
  const context = JSON.parse(s.context) as Context;
  const next = await one<{ fid: number; payload: string }>(
    db,
    "SELECT i.* FROM meme_score_inputs i WHERE snapshot_id=? AND NOT EXISTS(SELECT 1 FROM meme_score_results r WHERE r.snapshot_id=i.snapshot_id AND r.fid=i.fid) ORDER BY fid LIMIT 1",
    id,
  );
  if (next) {
    const input = JSON.parse(next.payload) as Input;
    const scope = new Set(input.wallets),
      events = new Map<string, LedgerEvent[]>(),
      coverage: string[] = [];
    let complete = true;
    for (const c of context.campaigns) {
      if (!scope.size) {
        events.set(c.id, []);
        continue;
      }
      const { chosenVersion } = await import("./evidenceVersions");
      const version = await chosenVersion(
        db,
        c.id,
        s.as_of,
        context.versionIds,
      );
      if (version) {
        const covered = new Set<string>(JSON.parse(version.scope_wallets));
        if (
          version.through_at < s.as_of ||
          ![...scope].every((w) => covered.has(w))
        ) {
          complete = false;
          continue;
        }
        coverage.push(version.manifest_hash!);
        const found = await rows<{ payload: string }>(
          db,
          "SELECT e.payload FROM meme_version_events e WHERE version_id=? AND event_at<=? AND event_key IN(SELECT event_key FROM meme_version_wallets WHERE version_id=? AND wallet IN(SELECT value FROM json_each(?))) ORDER BY slot,signature,event_index LIMIT 5001",
          version.id,
          s.as_of,
          version.id,
          canonical(input.wallets),
        );
        if (found.length > 5000) {
          complete = false;
          continue;
        }
        events.set(
          c.id,
          found.map((e) => JSON.parse(e.payload) as LedgerEvent),
        );
        continue;
      }
      const cp = await one<{ evidence_hash: string }>(
        db,
        `SELECT evidence_hash FROM meme_ledger_seals s WHERE campaign_id=? AND rowid<=? AND through_at>=? AND NOT EXISTS(SELECT 1 FROM json_each(?) w WHERE NOT EXISTS(SELECT 1 FROM json_each(s.scope_wallets) sw WHERE sw.value=w.value)) ORDER BY through_at,rowid LIMIT 1`,
        c.id,
        context.seals,
        s.as_of,
        canonical(input.wallets),
      );
      if (!cp) {
        complete = false;
        continue;
      }
      coverage.push(cp.evidence_hash);
      const found = await rows<{ payload: string }>(
        db,
        `SELECT e.payload FROM meme_ledger_events e WHERE e.rowid<=? AND e.id IN(SELECT event_id FROM meme_ledger_wallet_index WHERE campaign_id=? AND wallet IN(SELECT value FROM json_each(?)) AND event_at<=?) ORDER BY e.slot,e.signature,e.event_index LIMIT 5001`,
        context.events,
        c.id,
        canonical(input.wallets),
        s.as_of,
      );
      if (found.length > 5000) {
        complete = false;
        continue;
      }
      events.set(
        c.id,
        found.map((e) => JSON.parse(e.payload) as LedgerEvent),
      );
    }
    let units = 0n;
    if (complete) {
      try {
        units = normalizedHolding(
          context.campaigns,
          events,
          scope,
          s.as_of,
        ).units;
      } catch {
        complete = false;
      }
    }
    const value = boost({
      level: input.level,
      holdingUnits: units,
      streak: streakLength(
        input.previous.map(Boolean),
        input.candidate !== null,
      ),
      voted: input.candidate !== null,
    });
    const result: Result = {
      boost: {
        base: value.base,
        total: value.total,
        warplet: value.warplet,
        holding: complete ? value.holding : "pending",
        streak: value.streak,
        points: value.points,
        finality: "provisional",
        holdingStatus: complete ? "ready" : "pending",
      },
      coverage,
      inputHash: await sha(canonical({ context, asOf: s.as_of, input })),
    };
    const bytes = canonical(result),
      hash = await sha(bytes);
    await db.batch([
      db
        .prepare(
          "INSERT INTO meme_score_results VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(snapshot_id,fid) DO NOTHING",
        )
        .bind(
          id,
          input.fid,
          bytes,
          hash,
          Number(value.pointUnits),
          input.candidate,
          input.first,
          complete ? 1 : 0,
        ),
    ]);
    const saved = await one<{ payload_hash: string }>(
      db,
      "SELECT payload_hash FROM meme_score_results WHERE snapshot_id=? AND fid=?",
      id,
      input.fid,
    );
    requireThat(saved?.payload_hash === hash, 409, "Snapshot replay diverged");
    return { state: "building", id, fid: input.fid };
  }
  // Hash one bounded page per invocation, so large rosters do not exceed D1 query/CPU limits.
  const progress = await one<{
    cursor: number;
    count: number;
    root_hash: string;
  }>(db, "SELECT * FROM meme_score_hash_progress WHERE snapshot_id=?", id);
  let cursor = progress?.cursor ?? 0,
    root = progress?.root_hash ?? (await sha(s.context + ":" + s.as_of)),
    count = progress?.count ?? 0;
  const page = await rows<{ fid: number; payload_hash: string }>(
    db,
    "SELECT fid,payload_hash FROM meme_score_results WHERE snapshot_id=? AND fid>? ORDER BY fid LIMIT 250",
    id,
    cursor,
  );
  for (const r of page) {
    root = await sha(root + ":" + r.fid + ":" + r.payload_hash);
    cursor = r.fid;
    count++;
  }
  await db.batch([
    db
      .prepare(
        "INSERT INTO meme_score_hash_progress VALUES(?,?,?,?) ON CONFLICT(snapshot_id) DO UPDATE SET cursor=excluded.cursor,count=excluded.count,root_hash=excluded.root_hash WHERE cursor=?",
      )
      .bind(id, cursor, count, root, progress?.cursor ?? 0),
  ]);
  if (page.length === 250) return { state: "building", id };
  requireThat(count === s.input_count, 409, "Incomplete score roster");
  await db.batch([
    db
      .prepare(
        "UPDATE meme_score_snapshots SET state='ready',result_hash=? WHERE id=? AND state='building' AND (SELECT count FROM meme_score_hash_progress WHERE snapshot_id=?)=input_count",
      )
      .bind(root, id, id),
    db
      .prepare(
        `INSERT INTO meme_score_heads VALUES(?,?) ON CONFLICT(round_id) DO UPDATE SET snapshot_id=excluded.snapshot_id WHERE (SELECT as_of FROM meme_score_snapshots WHERE id=excluded.snapshot_id)>(SELECT as_of FROM meme_score_snapshots WHERE id=meme_score_heads.snapshot_id)`,
      )
      .bind(s.round_id, id),
  ]);
  return { state: "ready", id, resultHash: root };
}

/** Public projection: fixed query count; never reads ledger, collects data, or starts jobs. */
export async function snapshotView(
  db: Database,
  roundId: string,
  viewer: number | null,
) {
  const s = await one<Snapshot>(
    db,
    "SELECT s.* FROM meme_score_heads h JOIN meme_score_snapshots s ON s.id=h.snapshot_id AND s.state='ready' WHERE h.round_id=?",
    roundId,
  );
  if (!s)
    return {
      boost: null,
      leaderboard: [],
      weightedVotes: {} as Record<string, string>,
      voterCounts: {} as Record<string, number>,
      holdingComplete: false,
      scoreSnapshot: { state: "pending", asOf: null },
    };
  const mine = viewer
    ? await one<{ payload: string }>(
        db,
        "SELECT payload FROM meme_score_results WHERE snapshot_id=? AND fid=?",
        s.id,
        viewer,
      )
    : null;
  const top = await rows<{
    fid: number;
    point_units: number;
    first_valid_at: number;
  }>(
    db,
    "SELECT fid,point_units,first_valid_at FROM meme_score_results WHERE snapshot_id=? AND candidate_id IS NOT NULL ORDER BY point_units DESC,first_valid_at,fid LIMIT 100",
    s.id,
  );
  const weights = await rows<{
    candidate_id: string;
    units: number;
    pending: number;
    voters: number;
  }>(
    db,
    "SELECT candidate_id,SUM(point_units)/10 units,SUM(1-holding_ready) pending,COUNT(*) voters FROM meme_score_results WHERE snapshot_id=? AND candidate_id IS NOT NULL GROUP BY candidate_id",
    s.id,
  );
  return {
    boost: mine ? (JSON.parse(mine.payload) as Result).boost : null,
    leaderboard: top.map((r, i) => ({
      fid: r.fid,
      rank: i + 1,
      points: decimal(BigInt(r.point_units)),
      firstValidAt: r.first_valid_at,
    })),
    weightedVotes: Object.fromEntries(
      weights.map((r) => [r.candidate_id, decimal(BigInt(r.units))]),
    ),
    voterCounts: Object.fromEntries(
      weights.map((r) => [r.candidate_id, r.voters]),
    ),
    holdingComplete: weights.every((r) => r.pending === 0),
    scoreSnapshot: {
      state: "ready",
      id: s.id,
      asOf: s.as_of,
      resultHash: s.result_hash,
    },
  };
}
