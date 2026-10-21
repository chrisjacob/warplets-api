import { CandidateSchema, DEFAULT_POLICY, shortlist } from "./model";
import { marketsForPools } from "./market";
import { candidates, captureCohort, control, reserveQuota } from "./store";
import { SourceError } from "./rpc";
import type { Settings } from "./ingest";
import { dexMarketBatch } from "./dex-market";
import { marketBatchWrites } from "./market-batch-store";
import { compareCollectionPotential, createdWithinWindow } from "./priority";
import {ZodError} from "zod";
import {scoreFollowupPlan,verifyScoreFollowup} from "./score-followup";
import {ScoreResearchError} from "./score-research-analysis";
import {DiscoveryScoreError} from "./discovery-score";
import type {ScoreFollowupRowSchema} from "./score-followup-model";
import type {z} from "zod";

export async function runMarketCycle(settings: Settings, observedAt?: Date): Promise<Record<string, unknown>> {
  if (!settings.marketEnabled) return { state: "disabled" };
  const now=observedAt??new Date(),db = settings.db, at = now.toISOString(),owner=crypto.randomUUID();
  const marketProvider=settings.marketProvider??"geckoterminal";
  if ((await control(db)).paused) return { state: "paused" };
  const lease = await db.prepare(`UPDATE tenx_market_control SET lease_owner=?4,lease_until=?1,next_refresh_at=?2 WHERE id=1
    AND (lease_until IS NULL OR lease_until<?3) AND (next_refresh_at IS NULL OR next_refresh_at<=?3)
    AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0) RETURNING id`)
    .bind(new Date(now.getTime() + 120000).toISOString(), new Date(now.getTime() + 180000).toISOString(), at,owner).first();
  if (!lease) return { state: "waiting" };
  let phase="collection";
  try {
    const all = await candidates(db), active = shortlist(all, DEFAULT_POLICY, now);
    const cohort = await db.prepare(`SELECT address FROM (
      SELECT address,selected_at AS tracked_at FROM tenx_cohorts WHERE selected_at>=?1
      UNION ALL SELECT address,captured_at AS tracked_at FROM tenx_signal_cohorts WHERE captured_at>=?1
      ) GROUP BY address ORDER BY MAX(tracked_at) DESC,address LIMIT 200`).bind(new Date(now.getTime() - 26 * 3600000).toISOString()).all<{ address: string }>();
    const tracked = new Set([...active.map(c => c.address), ...cohort.results.map(c => c.address)]);
    const attempts = await db.prepare("SELECT address,attempted_at FROM tenx_market_attempts").all<{ address: string; attempted_at: string }>();
    const attempted = new Map(attempts.results.map(row => [row.address, row.attempted_at]));
    // Ten current contenders receive every batch, up to ten slots screen
    // migrations; up to five remaining slots collect due score endpoints,
    // with all other slots rotating through the current discovery inventory.
    const focus = all.filter(c => createdWithinWindow(c, now)).sort((a, b) => compareCollectionPotential(a, b, DEFAULT_POLICY, now)).slice(0, 10);
    const focused = new Set(focus.map(c => c.address));
    const leads = await db.prepare(`SELECT l.address,l.pool FROM tenx_leads l LEFT JOIN tenx_lead_markets m ON m.address=l.address WHERE l.checked_at IS NULL AND json_extract(l.migration_tx,'$.blockTime')>=?1 AND (m.attempted_at IS NULL OR m.attempted_at<=?2) ORDER BY m.attempted_at,l.first_seen_at DESC,l.address LIMIT 10`).bind(Math.floor(now.getTime() / 1000) - 86400, new Date(now.getTime() - 900000).toISOString()).all<{ address: string; pool: string }>();
    const pending = leads.results.filter(l => !focused.has(l.address)), pendingSet = new Set(pending.map(l => l.address));
    const research:z.infer<typeof ScoreFollowupRowSchema>[]= [];let researchWithheld=0,researchPlanError=false;
    try{
      const followup=await scoreFollowupPlan(db,marketProvider,true,now,new Set([...focused,...pendingSet]));
      for(const row of followup.ready){try{await verifyScoreFollowup(db,row,marketProvider);research.push(row);}catch(error){if(error instanceof ScoreResearchError||error instanceof DiscoveryScoreError||error instanceof ZodError)researchWithheld++;else throw error;}}
    }catch(error){if(error instanceof ScoreResearchError||error instanceof DiscoveryScoreError||error instanceof ZodError)researchPlanError=true;else throw error;}
    const researchSet=new Set(research.map(r=>r.address));
    const rotating = all.filter(c => !focused.has(c.address) && !pendingSet.has(c.address) && !researchSet.has(c.address) && tracked.has(c.address)).sort((a, b) => (attempted.get(a.address) ?? "").localeCompare(attempted.get(b.address) ?? "") || a.address.localeCompare(b.address)).slice(0, 30 - focus.length - pending.length - research.length);
    const rows = [...focus, ...pending, ...research, ...rotating];
    if (!rows.length) { await db.prepare("UPDATE tenx_market_control SET lease_owner=NULL,lease_until=NULL,last_error=CASE WHEN ?2 THEN 'score_followup_evidence_invalid' ELSE last_error END WHERE id=1 AND lease_owner=?1").bind(owner,Number(researchPlanError||researchWithheld>0)).run(); return { state: researchPlanError||researchWithheld?"failed":"empty",research_withheld:researchWithheld,research_plan_error:researchPlanError }; }
    const quota = reserveQuota(db, { rpc: settings.rpcDailyLimit, market: settings.marketDailyLimit }, now);
    const reserve:typeof quota=async provider=>{
      const owns=await db.prepare(`SELECT m.id FROM tenx_market_control m JOIN tenx_control c ON c.id=m.id
        WHERE m.id=1 AND m.lease_owner=?1 AND m.lease_until>COALESCE(?2,strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND c.paused=0`).bind(owner,observedAt?.toISOString()??null).first();
      if(!owns)throw new SourceError("market_pause_or_lease_changed",60);
      await quota(provider);
      if(provider==="market"&&research.length){
        const attempts=await db.prepare(`INSERT INTO tenx_market_attempts(address,attempted_at)
          SELECT value,?2 FROM json_each(?3) WHERE EXISTS(SELECT 1 FROM tenx_market_control m JOIN tenx_control c ON c.id=m.id WHERE m.id=1 AND m.lease_owner=?1 AND m.lease_until>COALESCE(?4,strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND c.paused=0)
          ON CONFLICT(address) DO UPDATE SET attempted_at=excluded.attempted_at WHERE excluded.attempted_at>=tenx_market_attempts.attempted_at`).bind(owner,at,JSON.stringify(research.map(r=>r.address)),observedAt?.toISOString()??null).run();
        if(attempts.meta.changes!==research.length)throw new SourceError("market_pause_or_lease_changed",60);
      }
    };
    const batch=settings.marketProvider==="dexscreener"?await dexMarketBatch(rows,reserve,at,settings.transport):null;
    const markets = batch?.markets??await marketsForPools(rows,reserve,at,settings.transport);
    const incomplete=batch!==null&&batch.record.report.accepted<batch.record.report.requested;
    const issue=incomplete?(markets.size?"market_batch_partial":"market_batch_no_usable_quotes"):researchPlanError||researchWithheld?"score_followup_evidence_invalid":null;
    // The first statement claims this entire atomic commit. Every following
    // write is conditional on it, so pause, expiry or a replacement lease
    // cannot publish a stale response or clobber the current owner's state.
    const guard="EXISTS(SELECT 1 FROM tenx_market_control WHERE id=1 AND last_commit_owner=?)";
    const statements: D1PreparedStatement[] = [db.prepare(`UPDATE tenx_market_control SET last_commit_owner=?1,lease_owner=NULL,lease_until=NULL,
      last_success=CASE WHEN ?2>0 THEN ?3 ELSE last_success END,last_error=?4,next_refresh_at=?5
      WHERE id=1 AND lease_owner=?1 AND lease_until>COALESCE(?6,strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)`)
      .bind(owner,markets.size,at,issue,new Date(now.getTime()+(incomplete&&!markets.size?300000:180000)).toISOString(),observedAt?.toISOString()??null)];
    for (const row of rows) {
      statements.push(db.prepare(`INSERT INTO tenx_market_attempts(address,attempted_at) SELECT ?,? WHERE ${guard} ON CONFLICT(address) DO UPDATE SET attempted_at=excluded.attempted_at`).bind(row.address, at,owner));
      const market = markets.get(row.address);
      if (pendingSet.has(row.address)) {
        statements.push(db.prepare(`INSERT INTO tenx_lead_markets(address,pool,payload,attempted_at) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(address) DO UPDATE SET payload=COALESCE(excluded.payload,tenx_lead_markets.payload),attempted_at=excluded.attempted_at WHERE excluded.attempted_at>=tenx_lead_markets.attempted_at`).bind(row.address, row.pool, market ? JSON.stringify(market) : null, at,owner));
        continue;
      }
      if (!market) continue;
      if(!researchSet.has(row.address))statements.push(db.prepare(`UPDATE tenx_candidates SET payload=json_set(payload,'$.market',json(?),'$.verification_reasons',json((SELECT json_group_array(value) FROM json_each(tenx_candidates.payload,'$.verification_reasons') WHERE value NOT LIKE 'market_%'))) WHERE address=? AND mode='live' AND COALESCE(json_extract(payload,'$.market.fetched_at'),'')<=? AND ${guard}`).bind(JSON.stringify(market), row.address,at,owner));
      statements.push(db.prepare(`INSERT OR IGNORE INTO tenx_market_history(address,fetched_at,payload) SELECT ?,?,? WHERE ${guard}`).bind(row.address, at, JSON.stringify(market),owner));
    }
    if(batch)statements.push(...marketBatchWrites(db,batch.record,owner));
    phase="publication";
    const written=await db.batch(statements);
    if(!written[0]!.meta.changes){await db.prepare("UPDATE tenx_market_control SET lease_owner=NULL,lease_until=NULL WHERE id=1 AND lease_owner=?1").bind(owner).run();return {state:"discarded",reason:"market_pause_or_lease_changed",requested:rows.length,updated:0};}
    phase="cohort";
    for (const row of rows) if (markets.has(row.address)&&!researchSet.has(row.address)) {
      const saved = await db.prepare("SELECT payload FROM tenx_candidates WHERE mode='live' AND address=?1").bind(row.address).first<{ payload: string }>();
      if (saved) await captureCohort(db, CandidateSchema.parse(JSON.parse(saved.payload)), at);
    }
    return { state: incomplete?(markets.size?"partial":"failed"):issue?"partial":"succeeded", requested: rows.length, updated: markets.size,research_requested:research.length,research_updated:research.filter(r=>markets.has(r.address)).length,research_withheld:researchWithheld,research_plan_error:researchPlanError,...(issue?{error_code:issue}:{}),...(batch?{report:batch.record.report}: {}) };
  } catch (error) {
    const code = error instanceof SourceError ? error.code : error instanceof ScoreResearchError ? error.message : error instanceof ZodError ? "market_schema_invalid" : phase==="publication" ? "market_persistence_unavailable" : "market_cycle_unavailable";
    const retry = error instanceof SourceError ? error.retryAfterSeconds : 300;
    await db.prepare("UPDATE tenx_market_control SET lease_owner=NULL,lease_until=NULL,next_refresh_at=?1,last_error=?2 WHERE id=1 AND lease_owner=?3").bind(new Date(now.getTime() + retry * 1000).toISOString(), code,owner).run();
    return { state: "failed", error_code: code };
  }
}
