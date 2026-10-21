import {z} from "zod";
import {CandidateCardSchema,candidateCard} from "./candidate-card";
import {rankedDiscovery,scoreInventoryCandidates} from "./discovery-score-store";
import {ScoreSummaryV4Schema,DISCOVERY_SCORE_POLICY_V4} from "./discovery-score-v4-model";
import {DEFAULT_POLICY} from "./model";
import {hashJson} from "./solana";
import {control} from "./store";

// Bump this contract when evaluator semantics change, even if policy values do not.
const VERSION="discovery-score-read-model-v1" as const;
const MAX_BYTES=1800000, READ_WINDOW_MS=60000;
const Hash=z.string().regex(/^[a-f0-9]{64}$/);
const Snapshot=z.object({
  version:z.literal(VERSION),policy_hash:Hash,source_revision:z.number().int().safe().nonnegative(),
  cutoff:z.iso.datetime(),expires_at:z.iso.datetime(),scope:z.literal("current_evaluation"),
  semantics:z.literal("frozen_at_cutoff"),action_authority:z.literal(false),
  counts:z.object({eligible:z.number().int().nonnegative(),provisional:z.number().int().nonnegative(),excluded:z.number().int().nonnegative()}).strict(),
  candidates:CandidateCardSchema.extend({discovery_score:ScoreSummaryV4Schema,discovery_rank:z.number().int().min(1).max(500)}).array().max(500),
}).strict();
const policyHash=()=>hashJson({contract:VERSION,score:DISCOVERY_SCORE_POLICY_V4,actions:DEFAULT_POLICY});
const held=(reason:string)=>({state:"held" as const,reason,action_authority:false as const});

// Explicit local admin experiment only. No collection, evaluator changes, automatic
// maintenance or public cache-miss rebuilds. Never used to authorize an action.
export async function buildScoreReadModel(db:D1Database,at=new Date()) {
  if((await control(db)).paused)return held("paused");
  let revision:number|null;
  try {revision=await db.prepare("SELECT revision FROM tenx_score_source_revision WHERE id=1").first<number>("revision");}
  catch {return held("read_model_unavailable");}
  if(revision===null)return held("source_revision_missing");
  const candidates=await scoreInventoryCandidates(db,"live",false);
  const ranked=await rankedDiscovery(db,candidates,at,"score","all",{maximum:500});
  const snapshot=Snapshot.parse({version:VERSION,policy_hash:await policyHash(),source_revision:revision,
    cutoff:at.toISOString(),expires_at:new Date(at.getTime()+READ_WINDOW_MS).toISOString(),scope:"current_evaluation",
    semantics:"frozen_at_cutoff",action_authority:false,counts:ranked.counts,candidates:ranked.rows.map(candidateCard)});
  const payload=JSON.stringify(snapshot);
  if(new TextEncoder().encode(payload).byteLength>MAX_BYTES)return held("projection_size_limit");
  // A single conditional statement prevents mixed-source and older concurrent
  // builders replacing a newer snapshot. Evidence writes invalidate atomically.
  const result=await db.prepare(`INSERT INTO tenx_score_read_model(id,source_revision,cutoff,payload_hash,payload)
    SELECT 1,?1,?2,?3,?4 FROM tenx_score_source_revision WHERE id=1 AND revision=?1
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)
      AND NOT EXISTS(SELECT 1 FROM tenx_score_read_model WHERE cutoff>?2)
    ON CONFLICT(id) DO UPDATE SET source_revision=excluded.source_revision,cutoff=excluded.cutoff,payload_hash=excluded.payload_hash,payload=excluded.payload`)
    .bind(revision,snapshot.cutoff,await hashJson(snapshot),payload).run();
  if(result.meta.changes!==1)return held("source_changed_paused_or_newer_snapshot");
  return {state:"built" as const,cutoff:snapshot.cutoff,source_revision:revision,candidates:snapshot.candidates.length,bytes:new TextEncoder().encode(payload).byteLength,action_authority:false as const};
}

export async function readScoreReadModel(db:D1Database,now=new Date()) {
  // One indexed statement; never load candidates, market histories or raw evidence.
  let row:{source_revision:number|null;cutoff:string|null;payload_hash:string|null;payload:string|null;revision:number}|null;
  try {row=await db.prepare(`SELECT s.source_revision,s.cutoff,s.payload_hash,
    CASE WHEN length(CAST(s.payload AS BLOB))<=1800000 THEN s.payload ELSE NULL END AS payload,
    r.revision FROM tenx_score_source_revision r LEFT JOIN tenx_score_read_model s ON s.id=r.id WHERE r.id=1`)
    .first<NonNullable<typeof row>>();}
  catch {return held("read_model_unavailable");}
  if(!row||row.source_revision===null)return held("missing");
  if(row.revision!==row.source_revision)return held("source_changed");
  try {
    const snapshot=Snapshot.parse(JSON.parse(row.payload??"null"));
    if(snapshot.source_revision!==row.source_revision||snapshot.cutoff!==row.cutoff||await hashJson(snapshot)!==row.payload_hash)return held("integrity_mismatch");
    if(snapshot.policy_hash!==await policyHash())return held("policy_changed");
    const cutoff=Date.parse(snapshot.cutoff),expires=Date.parse(snapshot.expires_at);
    if(expires!==cutoff+READ_WINDOW_MS||now.getTime()<cutoff||now.getTime()>=expires)return held("cutoff_expired_or_future");
    const cards=snapshot.candidates;
    if(new Set(cards.map(c=>c.address)).size!==cards.length||cards.some((c,i)=>c.mode!=="live"||c.discovery_rank!==i+1)
      ||(["eligible","provisional","excluded"] as const).some(status=>snapshot.counts[status]!==cards.filter(c=>c.eligibility===status).length))return held("inventory_mismatch");
    return {state:"available" as const,snapshot};
  } catch {return held("invalid_projection");}
}
