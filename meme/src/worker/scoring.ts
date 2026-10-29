import { one, rows, type Database } from "./db";
import type { StoredRound } from "./rounds";
import {
  boost,
  streakLength,
  rankScores,
  decimal,
  type RankedScore,
} from "../shared/scoring";
export async function scoreRound(
  db: Database,
  round: StoredRound,
  viewer: number | null,
  holding = new Map<number, bigint>(),
) {
  const current = await rows<{
    fid: number;
    candidate_id: string;
    first_valid_at: number;
    reward_wallet: string;
    level: number | null;
  }>(
    db,
    "SELECT v.*,e.level FROM meme_votes v LEFT JOIN meme_round_eligibility e ON e.round_id=v.round_id AND e.fid=v.fid WHERE v.round_id=? ORDER BY v.fid",
    round.id,
  );
  const previous = await rows<{ id: string }>(
    db,
    "SELECT id FROM meme_rounds WHERE closes_at<? AND snapshot_id IS NOT NULL ORDER BY closes_at DESC LIMIT 9",
    round.closes_at,
  );
  const past = await rows<{ round_id: string; fid: number }>(
    db,
    "SELECT v.round_id,v.fid FROM meme_votes v WHERE v.round_id IN(SELECT id FROM meme_rounds WHERE closes_at<? AND snapshot_id IS NOT NULL ORDER BY closes_at DESC LIMIT 9) AND (v.fid IN(SELECT fid FROM meme_votes WHERE round_id=?) OR v.fid=?)",
    round.closes_at,
    round.id,
    viewer ?? -1,
  );
  const seen = new Set(past.map((v) => v.round_id + ":" + v.fid));
  const input = (fid: number, level: number, voted: boolean) => ({
    level,
    holdingUnits: holding.get(fid) ?? 0n,
    streak: streakLength(
      previous.map((r) => seen.has(r.id + ":" + fid)),
      voted,
    ),
    voted,
  });
  const scores: RankedScore[] = current.map((v) => ({
    fid: v.fid,
    candidateId: v.candidate_id,
    firstValidAt: v.first_valid_at,
    rewardWallet: v.reward_wallet,
    score: boost(input(v.fid, v.level ?? 0, true)),
  }));
  const ranked = rankScores(scores),
    mine = scores.find((s) => s.fid === viewer);
  let own = mine?.score;
  if (viewer && !own) {
    const eligibility = await one<{ level: number }>(
      db,
      "SELECT level FROM meme_round_eligibility WHERE round_id=? AND fid=?",
      round.id,
      viewer,
    );
    own = boost(input(viewer, eligibility?.level ?? 0, false));
  }
  const weights = new Map<string, bigint>();
  for (const score of scores)
    weights.set(
      score.candidateId,
      (weights.get(score.candidateId) ?? 0n) + score.score.units,
    );
  return {
    scores,
    ranked,
    own,
    weights,
    view: {
      boost: own
        ? {
            base: own.base,
            total: own.total,
            warplet: own.warplet,
            holding: own.holding,
            streak: own.streak,
            points: own.points,
            finality: "provisional",
            holdingStatus: "pending-ledger",
          }
        : null,
      leaderboard: ranked
        .slice(0, 100)
        .map((r, i) => ({
          fid: r.fid,
          rank: i + 1,
          points: r.score.points,
          firstValidAt: r.firstValidAt,
        })),
      weightedVotes: Object.fromEntries(
        [...weights].map(([id, units]) => [id, decimal(units)]),
      ),
    },
  };
}
