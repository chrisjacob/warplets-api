import { z } from "zod";
import { AssessedCandidateSchema, MarketSchema, type Market } from "./model";
import { OutcomeSchema, ReviewSchema, type Outcome, type Review } from "./research-model";
import { hashJson } from "./solana";
import { researchDay } from "./store";

const CohortSchema = z.object({ candidate: AssessedCandidateSchema, selected_at: z.string().datetime(), policy: z.unknown(), cohort_kind: z.literal("first_wallet_sample").optional() });
type Cohort = z.infer<typeof CohortSchema>;
const change = (start: number | null | undefined, end: number | null | undefined) => {
  const value = start != null && start > 0 && end != null ? (end / start - 1) * 100 : null;
  return value !== null && Number.isFinite(value) ? value : null;
};
export function measureOutcome(cohort: Cohort, history: Market[], inputHash: string, now: Date): Outcome {
  const c = cohort.candidate, selected = Date.parse(cohort.selected_at), target = selected + 86400000;
  const baseline = c.market && selected - Date.parse(c.market.fetched_at) >= 0 && selected - Date.parse(c.market.fetched_at) <= 1800000 ? c.market : null;
  const points = history.filter(p => Date.parse(p.fetched_at) >= selected && Date.parse(p.fetched_at) <= Math.min(target + 7200000, now.getTime())).sort((a, b) => a.fetched_at.localeCompare(b.fetched_at));
  const endpoint = points.filter(p => Math.abs(Date.parse(p.fetched_at) - target) <= (Date.parse(p.fetched_at) < target ? 1800000 : 7200000)).sort((a, b) => Math.abs(Date.parse(a.fetched_at) - target) - Math.abs(Date.parse(b.fetched_at) - target))[0];
  const mature = now.getTime() >= target;
  const returns = mature && baseline && endpoint ? change(baseline.price_usd, endpoint.price_usd) : null;
  const liquidity = mature && baseline && endpoint ? change(baseline.liquidity_usd, endpoint.liquidity_usd) : null;
  const measured = returns !== null;
  let high = baseline?.price_usd ?? null, drawdown: number | null = null;
  for (const point of points.filter(p => Date.parse(p.fetched_at) <= target)) {
    if (point.price_usd === null) continue;
    high = Math.max(high ?? point.price_usd, point.price_usd);
    if (high > 0) drawdown = Math.min(drawdown ?? 0, (point.price_usd / high - 1) * 100);
  }
  const gaps = ["sampled_drawdown_not_continuous", "fees_produced_unavailable", "bundle_risk_unknown", "buyer_wallet_history_unknown"];
  if (!baseline) gaps.push("selection_baseline_missing_or_stale");
  if (!endpoint) gaps.push("24h_endpoint_missing");
  if (points.length < 12) gaps.push("sparse_price_history");
  const h = c.holders;
  const snapshot = c.wallet_analysis;
  const w = snapshot && selected >= Date.parse(snapshot.observed_at) && selected - Date.parse(snapshot.observed_at) <= 3600000 && snapshot.status !== "unavailable" ? snapshot : null;
  const wallets: Outcome["wallets"] = [];
  if (h?.creator && h.payload_hash) wallets.push({ wallet: h.creator, role: "creation_user", evidence_hash: h.payload_hash });
  for (const owner of h?.owners ?? []) if (owner.role === "holder" && owner.supply_pct >= 5 && h?.payload_hash) wallets.push({ wallet: owner.owner, role: "large_owner", evidence_hash: h.payload_hash });
  for (const profile of w?.wallets ?? []) for (const role of profile.roles) {
    if (role === "declared_creator" || role === "creation_user" && !profile.signed_creation) continue;
    if (!wallets.some(row => row.wallet === profile.wallet && row.role === role)) wallets.push({ wallet: profile.wallet, role, evidence_hash: w!.evidence_hash });
  }
  return OutcomeSchema.parse({
    address: c.address, symbol: c.symbol, recommended: c.eligibility === "eligible", cohort_kind: c.eligibility === "eligible" ? "first_recommendation" : cohort.cohort_kind ?? "first_observation", selected_at: cohort.selected_at, input_hash: inputHash,
    status: !mature ? "pending" : measured ? "measured" : "insufficient_data",
    outcome: !mature || !measured ? "unmeasured" : returns <= -80 || (liquidity !== null && liquidity <= -80) ? "severe_loss_signal" : returns > 10 ? "positive" : returns < -10 ? "negative" : "flat",
    return_24h_pct: returns, observed_max_drawdown_pct: drawdown, liquidity_change_pct: liquidity, endpoint_at: mature && endpoint ? endpoint.fetched_at : null,
    gaps, features: {
      holders: h?.status === "verified" ? h.holder_count : null, top1_pct: h?.status === "verified" ? h.top1_pct : null, top10_pct: h?.status === "verified" ? h.top10_pct : null, creator_pct: h?.status === "verified" ? h.creator_pct : null,
      liquidity_usd: baseline?.liquidity_usd ?? null, volume_24h_usd: baseline?.volume_24h_usd ?? null,
      fees_produced_usd: null, bundle_risk: "unknown", buyer_wallet_risk: "unknown",
      same_slot_buyers: w?.metrics.max_same_slot_buyers ?? null, shared_funder_buyers: w?.metrics.shared_funder_buyers ?? null,
      dev_funded_supply_pct: w?.metrics.dev_funded_supply_pct ?? null, dev_sold_supply_pct: w?.metrics.dev_sold_supply_pct ?? null, sampled_buyers: w?.metrics.distinct_buyers ?? null,
      funding_windows_examined: w?.funding_coverage?.filter(c => c.status === "window_examined").length ?? null, funding_wallets_tracked: w?.funding_coverage?.length ?? null,
    }, wallets,
  });
}

export function proposeRules(outcomes: Outcome[]): Review["proposals"] {
  // Chronological holdout; selection features are frozen before any outcome.
  const measured = outcomes.filter(o => o.status === "measured").sort((a, b) => a.selected_at.localeCompare(b.selected_at) || a.address.localeCompare(b.address));
  if (measured.length < 40) return [];
  const train = measured.slice(0, Math.floor(measured.length * .7)), validation = measured.slice(train.length);
  const proposals: Review["proposals"] = [];
  for (const [feature, thresholds, direction] of [
    ["top1_pct", [5, 10, 15], "maximum"], ["top10_pct", [20, 35, 50], "maximum"],
    ["holders", [50, 100, 200], "minimum"], ["liquidity_usd", [15000, 25000, 50000], "minimum"],
    ["dev_funded_supply_pct", [5, 10, 20], "maximum"], ["dev_sold_supply_pct", [1, 5, 10], "maximum"],
    ["shared_funder_buyers", [1, 2, 3], "maximum"], ["same_slot_buyers", [2, 3, 5], "maximum"],
  ] as const) {
    const samples = train.filter(o => o.features[feature] !== null);
    const holdout = validation.filter(o => o.features[feature] !== null);
    if (samples.length < 25 || holdout.length < 12) continue;
    for (const threshold of thresholds) {
      const flags = (o: Outcome) => direction === "maximum" ? o.features[feature]! > threshold : o.features[feature]! < threshold;
      const flaggedTrain = samples.filter(flags), flagged = holdout.filter(flags);
      if (flaggedTrain.length < 5 || flaggedTrain.filter(o => o.outcome === "severe_loss_signal").length / flaggedTrain.length < .6 || flagged.length < 4) continue;
      const precision = flagged.filter(o => o.outcome === "severe_loss_signal").length / flagged.length;
      const baseline = holdout.filter(o => o.outcome === "severe_loss_signal").length / holdout.length;
      if (precision < .6 || precision - baseline < .1) continue;
      proposals.push({ feature, threshold, direction, train_count: samples.length, validation_count: holdout.length, validation_flagged: flagged.length, validation_loss_precision: precision, validation_baseline_loss_rate: baseline, validation_nonloss_excluded: flagged.filter(o => o.outcome !== "severe_loss_signal").length, activated: false, status: "research_proposal" });
    }
  }
  return proposals.slice(0, 12);
}

export function walletWatch(outcomes: Outcome[]): Review["wallet_watch"] {
  const associations = new Map<string, { roles: Set<string>; tokens: Set<string>; bad: Set<string>; hashes: Set<string> }>();
  for (const outcome of outcomes.filter(o => o.status === "measured")) for (const w of outcome.wallets) {
    const a = associations.get(w.wallet) ?? { roles: new Set(), tokens: new Set(), bad: new Set(), hashes: new Set() };
    a.roles.add(w.role); a.tokens.add(outcome.address); a.hashes.add(w.evidence_hash);
    if (outcome.outcome === "severe_loss_signal") a.bad.add(outcome.address);
    associations.set(w.wallet, a);
  }
  return [...associations].filter(([, a]) => a.bad.size >= 2).map(([wallet, a]) => ({ wallet, role: [...a.roles].sort().join(", "), distinct_tokens: a.tokens.size, severe_loss_associations: a.bad.size, evidence_hashes: [...a.hashes].sort(), label: "review_association_not_fraud_finding" as const })).sort((a, b) => b.severe_loss_associations - a.severe_loss_associations || a.wallet.localeCompare(b.wallet)).slice(0, 50);
}

export async function runReviews(db: D1Database, now = new Date()): Promise<{ days: string[] }> {
  const today = researchDay(now), days: string[] = [];
  // Revisit three prior Sydney calendar days: a next-morning report may still
  // have pending 24h windows. Late endpoints update evidence via new revisions.
  for (let back = 1; back <= 3; back++) {
    const day = new Date(`${today}T12:00:00Z`); day.setUTCDate(day.getUTCDate() - back);
    const key = day.toISOString().slice(0, 10);
    const entries = await db.prepare(`SELECT c.address,COALESCE(s.payload,w.payload,c.payload) AS payload,COALESCE(s.input_hash,w.input_hash,c.input_hash) AS input_hash
      FROM tenx_cohorts c LEFT JOIN tenx_selections s ON s.day=c.day AND s.address=c.address
      LEFT JOIN tenx_wallet_cohorts w ON w.day=c.day AND w.address=c.address
      WHERE c.day=?1 ORDER BY CASE WHEN s.address IS NOT NULL THEN 0 ELSE 1 END,COALESCE(s.selected_at,w.selected_at,c.selected_at),c.address LIMIT 100`).bind(key).all<{ address: string; payload: string; input_hash: string }>();
    if (!entries.results.length && back > 1) continue;
    const outcomes: Outcome[] = [];
    for (const entry of entries.results) {
      const cohort = CohortSchema.parse(JSON.parse(entry.payload));
      const history = await db.prepare("SELECT payload FROM tenx_market_history WHERE address=?1 AND fetched_at>=?2 AND fetched_at<=?3 ORDER BY fetched_at LIMIT 1000")
        .bind(entry.address, cohort.selected_at, new Date(Date.parse(cohort.selected_at) + 26 * 3600000).toISOString()).all<{ payload: string }>();
      outcomes.push(measureOutcome(cohort, history.results.map(p => MarketSchema.parse(JSON.parse(p.payload))), entry.input_hash, now));
    }
    const previousReports = await db.prepare(`SELECT payload FROM (SELECT day,payload,ROW_NUMBER() OVER(PARTITION BY day ORDER BY created_at DESC,input_hash) AS position FROM tenx_reviews WHERE day<>?1 AND day>=?2) WHERE position=1 ORDER BY day DESC LIMIT 30`).bind(key, new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)).all<{ payload: string }>();
    const priorOutcomes = previousReports.results.flatMap(row => ReviewSchema.parse(JSON.parse(row.payload)).outcomes);
    const body = {
      day: key, timezone: "Australia/Sydney" as const, version: "outcomes-v1" as const, policy_activation: "review_required" as const,
      counts: { observed: outcomes.length, recommended: outcomes.filter(o => o.recommended).length, measured: outcomes.filter(o => o.status === "measured").length, pending: outcomes.filter(o => o.status === "pending").length, insufficient_data: outcomes.filter(o => o.status === "insufficient_data").length, severe_loss_signals: outcomes.filter(o => o.outcome === "severe_loss_signal").length },
      outcomes, proposals: proposeRules(outcomes), wallet_watch: walletWatch([...outcomes, ...priorOutcomes]),
      gaps: ["observational_selection_bias", "unknown_fees_bundles_and_buyer_history", "loss_is_not_proof_of_rug_or_fraud", "no_automatic_wallet_bans", ...(outcomes.filter(o => o.status === "measured").length < 40 ? ["too_few_measured_outcomes_for_rule_proposal"] : [])],
    };
    const inputHash = await hashJson(body), report = ReviewSchema.parse({ ...body, input_hash: inputHash, created_at: now.toISOString() });
    await db.prepare("INSERT OR IGNORE INTO tenx_reviews(day,input_hash,payload,created_at) VALUES(?1,?2,?3,?4)").bind(key, inputHash, JSON.stringify(report), now.toISOString()).run();
    days.push(key);
  }
  return { days };
}
