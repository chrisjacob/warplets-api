import { CandidateSchema, DEFAULT_POLICY, MarketSchema } from "./model";
import { SignalCohortSchema, SignalDetailSchema, SignalOutcomeSchema, SignalResearchSchema, SignalSummarySchema, type Signal } from "./signal-model";
import { freezeSignal, measureSignalOutcome, OUTCOME_DELAY_MS, replaySignal, SignalResearchError, validateSignal, verifySignalOutcome, verifySignalSummary, type SignalCohort, type SignalSummary } from "./signal-analysis";

const kinds: Signal[] = ["new_token_high_cap", "smooth_price_rise"];
export async function signalCohort(db: D1Database, address: string, signal: Signal) {
  const row = await db.prepare("SELECT payload,record_hash FROM tenx_signal_cohorts WHERE address=?1 AND signal=?2").bind(address,signal).first<{ payload: string; record_hash: string }>();
  if (!row) return null;
  const r = await replaySignal(SignalCohortSchema.parse(JSON.parse(row.payload)));
  if (r.address !== address || r.signal !== signal || r.record_hash !== row.record_hash) throw new SignalResearchError("signal_record_identity_mismatch");
  return r;
}
export async function saveSignal(db: D1Database, raw: SignalCohort) {
  const r = await replaySignal(raw), payload = JSON.stringify(r);
  if (new TextEncoder().encode(payload).length > 1_800_000) throw new SignalResearchError("signal_snapshot_size_limit");
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO tenx_signal_cohorts(address,signal,captured_at,record_hash,payload) VALUES(?1,?2,?3,?4,?5)").bind(r.address,r.signal,r.captured_at,r.record_hash,payload),
    db.prepare("INSERT OR IGNORE INTO tenx_audit(id,action,actor,reason,data_hash,created_at) SELECT ?1,'signal_snapshot','local-research-timer','First usable diagnostic observation; not a recommendation',?2,?3 WHERE EXISTS(SELECT 1 FROM tenx_signal_cohorts WHERE address=?4 AND signal=?5 AND record_hash=?2)").bind(`signal:${r.signal}:${r.address}`,r.record_hash,r.captured_at,r.address,r.signal),
  ]);
  return (await signalCohort(db,r.address,r.signal))!;
}
export async function signalDetail(db: D1Database, address: string, signal: Signal) {
  const record = await signalCohort(db,address,signal); if (!record) return null;
  const row = await db.prepare("SELECT payload FROM tenx_signal_outcomes WHERE address=?1 AND signal=?2").bind(address,signal).first<{ payload: string }>();
  const outcome = row ? await verifySignalOutcome(SignalOutcomeSchema.parse(JSON.parse(row.payload)),record.record_hash,record) : null;
  return SignalDetailSchema.parse({ record, outcome, replay: "verified", provider_requests: 0 });
}

export async function runSignalCycle(db: D1Database, observedAt?: Date) {
  const now = observedAt ?? new Date();
  if ((await db.prepare("SELECT paused FROM tenx_control WHERE id=1").first<{ paused: number }>())?.paused) return { state: "paused" };
  const at = now.toISOString(), owner = crypto.randomUUID();
  const lease = await db.prepare("UPDATE tenx_signal_control SET lease_owner=?1,lease_until=?2,next_at=?3 WHERE id=1 AND (lease_until IS NULL OR lease_until<?4) AND (next_at IS NULL OR next_at<=?4) RETURNING id").bind(owner,new Date(now.getTime()+120_000).toISOString(),new Date(now.getTime()+60_000).toISOString(),at).first();
  if (!lease) return { state: "waiting" };
  let captured = 0, finalized = 0;
  try {
    // Finalize after the 24h target plus the complete two-hour collection grace.
    const mature = await db.prepare("SELECT c.address,c.signal FROM tenx_signal_cohorts c LEFT JOIN tenx_signal_outcomes o ON o.address=c.address AND o.signal=c.signal WHERE o.address IS NULL AND c.captured_at<=?1 ORDER BY c.captured_at,c.address,c.signal LIMIT 5").bind(new Date(now.getTime()-OUTCOME_DELAY_MS).toISOString()).all<{ address: string; signal: Signal }>();
    for (const row of mature.results) {
      const record = (await signalCohort(db,row.address,row.signal))!;
      const target = Date.parse(record.captured_at)+86_400_000;
      const history = await db.prepare("SELECT payload FROM tenx_market_history WHERE address=?1 AND fetched_at>=?2 AND fetched_at<=?3 ORDER BY fetched_at LIMIT 1001").bind(row.address,new Date(target-1_800_000).toISOString(),new Date(target+7_200_000).toISOString()).all<{ payload: string }>();
      const result = await measureSignalOutcome(record,history.results.map(p => MarketSchema.parse(JSON.parse(p.payload))),observedAt ?? new Date());
      if (!result) continue;
      await db.prepare("INSERT OR IGNORE INTO tenx_signal_outcomes(address,signal,cohort_hash,finalized_at,payload) VALUES(?1,?2,?3,?4,?5)").bind(row.address,row.signal,record.record_hash,result.finalized_at,JSON.stringify(result)).run(); finalized++;
    }
    const rows = await db.prepare(`SELECT c.address,json_extract(c.payload,'$.symbol') AS symbol,
      CASE WHEN length(CAST(c.payload AS BLOB))<=1600000 THEN c.payload ELSE NULL END AS payload,
      cap.address IS NOT NULL AS has_cap,pat.address IS NOT NULL AS has_pattern
      FROM tenx_candidates c
      LEFT JOIN tenx_signal_cohorts cap ON cap.address=c.address AND cap.signal='new_token_high_cap'
      LEFT JOIN tenx_signal_cohorts pat ON pat.address=c.address AND pat.signal='smooth_price_rise'
      LEFT JOIN tenx_signal_attempts a ON a.address=c.address
      WHERE c.mode='live' AND (cap.address IS NULL OR pat.address IS NULL)
      AND json_extract(c.payload,'$.verification')='verified'
      AND julianday(json_extract(c.payload,'$.creation.block_time')) BETWEEN julianday(?1)-1 AND julianday(?1)
      AND julianday(json_extract(c.payload,'$.market.fetched_at')) BETWEEN julianday(?1)-180.0/86400 AND julianday(?1)
      AND json_extract(c.payload,'$.market.price_usd')>0
      ORDER BY COALESCE(a.attempted_at,''),c.address LIMIT 3`).bind(at).all<{ address: string; symbol: string; payload: string | null; has_cap: number; has_pattern: number }>();
    for (const row of rows.results) {
      const gaps: string[] = [];
      if (!row.payload) gaps.push("signal_snapshot_size_limit");
      else {
        const candidate = CandidateSchema.parse(JSON.parse(row.payload));
        const history = row.has_pattern || !candidate.graduation ? [] : (await db.prepare("SELECT payload FROM tenx_market_history WHERE address=?1 AND fetched_at>=?2 AND fetched_at<=?3 ORDER BY fetched_at DESC LIMIT 1000").bind(row.address,new Date(Math.max(now.getTime()-86_400_000, Date.parse(candidate.graduation.block_time))).toISOString(),candidate.market!.fetched_at).all<{ payload: string }>()).results.reverse().map(p => MarketSchema.parse(JSON.parse(p.payload)));
        for (const signal of kinds) {
          if (signal === "new_token_high_cap" ? row.has_cap : row.has_pattern) continue;
          try {
            const record = await freezeSignal({ version: "signal-input-v1", signal, at: observedAt?.toISOString() ?? new Date().toISOString(), candidate, policy: DEFAULT_POLICY, history: signal === "smooth_price_rise" ? history : [] });
            await saveSignal(db,record); captured++;
          } catch (error) { if (error instanceof SignalResearchError) gaps.push(`${signal}: ${error.message}`); else throw error; }
        }
      }
      await db.prepare("INSERT INTO tenx_signal_attempts(address,symbol,attempted_at,gaps) VALUES(?1,?2,?3,?4) ON CONFLICT(address) DO UPDATE SET symbol=excluded.symbol,attempted_at=excluded.attempted_at,gaps=excluded.gaps").bind(row.address,row.symbol,at,JSON.stringify(gaps)).run();
    }
    await db.prepare("UPDATE tenx_signal_control SET lease_owner=NULL,lease_until=NULL,last_success=?1,last_error=NULL WHERE id=1 AND lease_owner=?2").bind(at,owner).run();
    return { state: "succeeded", captured, finalized, provider_requests: 0 };
  } catch (error) {
    const code = error instanceof SignalResearchError ? error.message : "signal_research_unavailable";
    await db.prepare("UPDATE tenx_signal_control SET lease_owner=NULL,lease_until=NULL,last_error=?1 WHERE id=1 AND lease_owner=?2").bind(code,owner).run();
    return { state: "failed", error_code: code, provider_requests: 0 };
  }
}

export async function signalResearch(db: D1Database, now = new Date()) {
  const rows = await db.prepare("SELECT c.address,c.signal,c.record_hash,json_remove(c.payload,'$.inputs') AS summary,o.payload AS outcome FROM tenx_signal_cohorts c LEFT JOIN tenx_signal_outcomes o ON o.address=c.address AND o.signal=c.signal ORDER BY c.captured_at DESC,c.address,c.signal LIMIT 1001").all<{ address: string; signal: string; record_hash: string; summary: string; outcome: string | null }>();
  const summaries: SignalSummary[] = [];
  for (const row of rows.results.slice(0,1000)) {
    const r = SignalSummarySchema.parse({ ...JSON.parse(row.summary), outcome: row.outcome ? JSON.parse(row.outcome) : null });
    await verifySignalSummary(r);
    if (r.address !== row.address || r.signal !== row.signal || r.record_hash !== row.record_hash || Date.parse(r.captured_at)>now.getTime()) throw new SignalResearchError("signal_summary_identity_mismatch");
    if (r.outcome) { await verifySignalOutcome(r.outcome,r.record_hash); if (r.outcome.address!==r.address || r.outcome.signal!==r.signal || r.outcome.captured_at!==r.captured_at || Date.parse(r.outcome.finalized_at)>now.getTime()) throw new SignalResearchError("signal_outcome_from_future_or_wrong_cohort"); }
    summaries.push(r);
  }
  const automation = await db.prepare("SELECT next_at,last_success,last_error FROM tenx_signal_control WHERE id=1").first();
  const attempts = await db.prepare("SELECT address,symbol,attempted_at,gaps FROM tenx_signal_attempts WHERE gaps<>'[]' ORDER BY attempted_at DESC LIMIT 10").all<{ address: string; symbol: string; attempted_at: string; gaps: string }>();
  return SignalResearchSchema.parse({ at: now.toISOString(), scope: "latest_1000_diagnostic_cohorts", capped: rows.results.length>1000, automatic_policy_changes: false, automation, attempts: attempts.results.map(r => ({ ...r, gaps: JSON.parse(r.gaps) })),
    totals: kinds.map(signal => { const items = summaries.filter(r => r.signal===signal); return { signal, captured: items.length, flagged: items.filter(r => r.feature.flagged).length, pending: items.filter(r => !r.outcome).length, measured: items.filter(r => r.outcome?.status==="measured").length, insufficient: items.filter(r => r.outcome?.status==="insufficient_data").length }; }),
    validation: kinds.map(signal => validateSignal(summaries,signal)), recent: summaries.slice(0,20),
  });
}
