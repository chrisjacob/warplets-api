// Strict durable post-commit domain. It can never execute its embedded parent.
import {z} from "zod";
import {createHash} from "node:crypto";
const Id=z.string().uuid(),Binding=z.union([z.string().max(2000000),z.number().finite(),z.null()]);
export const cohortSql="INSERT OR IGNORE INTO tenx_cohorts(day,address,selected_at,recommended,input_hash,payload) VALUES(?1,?2,?3,?4,?5,?6)";
export const walletCohortSql="INSERT OR IGNORE INTO tenx_wallet_cohorts(day,address,selected_at,input_hash,payload) VALUES(?1,?2,?3,?4,?5)";
export const selectionCohortSql="INSERT OR IGNORE INTO tenx_selections(day,address,selected_at,input_hash,payload) VALUES(?1,?2,?3,?4,?5)";
const Operation=z.object({kind:z.literal("sql"),sql:z.string().max(16384),bindings:Binding.array().max(6)}).strict();
const Plan=z.object({kind:z.literal("candidate_cohorts"),publication_id:Id,parent:z.unknown(),heads:z.string().regex(/^[a-f0-9]{64}$/).nullable().array().min(1).max(3),operations:Operation.array().min(1).max(3)}).strict();
const hash=s=>createHash("sha256").update(s).digest("hex");
export function normalizeCohortPublicationPlan(input,validateParent){
  const p=Plan.parse(input),raw=p.parent;
  if(p.heads.length!==p.operations.length)throw Error("publication_cohort_heads");
  if(!raw||![undefined,"candidate_metadata","wallet_snapshot_cycle"].includes(raw.kind))throw Error("publication_cohort_parent_kind");
  const parent=validateParent(raw);if(parent.publication_id===p.publication_id)throw Error("publication_cohort_identity");
  let address;
  if(parent.kind==="wallet_snapshot_cycle"){if(!parent.ticket)throw Error("publication_cohort_snapshot_required");address=parent.cycle.address;}
  else{
    const candidate=parent.operations.find(o=>o.kind==="sql"&&o.sql.startsWith("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?1,?2,?3,?4,?5)"));
    if(!candidate||candidate.bindings.length!==5||candidate.bindings[4]!=="live"||JSON.parse(candidate.bindings[2]).address!==candidate.bindings[0])throw Error("publication_cohort_candidate_parent");address=candidate.bindings[0];
  }
  let base,day,at,last=-1;
  for(const op of p.operations){
    const kind=[cohortSql,walletCohortSql,selectionCohortSql].indexOf(op.sql),b=op.bindings;
    if(kind<0||kind<=last||last===-1&&kind!==0||b.length!==(kind===0?6:5))throw Error("publication_cohort_operation");last=kind;
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(b[0]);z.string().datetime().parse(b[2]);
    const payload=b[kind===0?5:4],pin=b[kind===0?4:3];if(typeof payload!=="string"||Buffer.byteLength(payload)>2000000||hash(payload)!==pin||b[1]!==address)throw Error("publication_cohort_payload");
    const parsed=JSON.parse(payload);
    if(kind===0){day=b[0];at=b[2];base=parsed;if(![0,1].includes(b[3])||b[3]!==Number(base.candidate?.eligibility==="eligible"))throw Error("publication_cohort_recommendation");}
    if(b[0]!==day||b[2]!==at||parsed.candidate?.address!==address||parsed.selected_at!==at||payload!==JSON.stringify(kind===1?{...base,cohort_kind:"first_wallet_sample"}:base)||kind===2&&base.candidate?.eligibility!=="eligible")throw Error("publication_cohort_scope");
  }
  const plan={...p,parent};if(Buffer.byteLength(JSON.stringify(plan))>16*1024**2)throw Error("publication_cohort_plan_bound");return plan;
}
export function cohortKeys(plan){return plan.operations.map(op=>({kind:["cohort","wallet","selection"][[cohortSql,walletCohortSql,selectionCohortSql].indexOf(op.sql)],day:op.bindings[0],address:op.bindings[1]}));}
