// Private, strict snapshot domain. Legacy receipt/direct domains are unchanged.
import {z} from "zod";
import {createHash} from "node:crypto";
import {isDeepStrictEqual as equal} from "node:util";
import {walletFailureRunSql,walletAttemptSql} from "./evidence-wallet-cycle-sql.mjs";
import {directCatchupSql,directBackoffSql,directUnsupportedSql} from "./evidence-wallet-direct-sql.mjs";
import {snapshotCandidateSql,snapshotFinishSql,snapshotWorkSql,snapshotProfileSql} from "./evidence-wallet-snapshot-sql.mjs";
const Hash=z.string().regex(/^[a-f0-9]{64}$/),Id=z.string().uuid(),Time=z.string().datetime(),Limit=z.number().int().safe().positive();
const Cycle=z.object({lease_id:Id,job:Id,address:z.string().min(1).max(4096),at:Time,until:Time,rapid:z.union([z.literal(0),z.literal(1)])}).strict();
const Op=z.discriminatedUnion("kind",[z.object({kind:z.literal("receipt")}).strict(),z.object({kind:z.literal("sql"),sql:z.string().min(1).max(16384),bindings:z.union([z.string().max(2000000),z.number().finite(),z.null()]).array().max(100)}).strict()]);
const Plan=z.object({kind:z.literal("wallet_snapshot_cycle"),publication_id:Id,cycle:Cycle,source_hash:Hash.nullable(),candidate_hash:Hash,limits:z.object({wallet:Limit,rpc:Limit}).strict(),ticket:z.object({context_pin:Hash,stage_id:Id,ticket_sha256:Hash}).strict().optional(),operations:Op.array().min(1).max(128)}).strict();
export const snapshotDigest=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function validateEvidenceWalletSnapshotPlan(input){
  const p=Plan.parse(input),c=p.cycle,ops=p.operations;
  if(p.publication_id===c.lease_id||Date.parse(c.until)!==Date.parse(c.at)+360000)throw Error("publication_wallet_snapshot_identity");
  const time=v=>{Time.parse(v);if(Date.parse(v)<Date.parse(c.at)||Date.parse(v)>Date.parse(c.at)+31536000000)throw Error("publication_wallet_snapshot_time");};
  const run=(op,state)=>{const b=op.bindings;if(op.kind!=="sql"||op.sql!==walletFailureRunSql||b.length!==11||!equal(b.slice(0,6),[c.job,c.address,p.source_hash,"snapshot",state,c.at]))throw Error("publication_wallet_snapshot_run");time(b[6]);z.number().int().min(0).max(18).parse(b[7]);for(const n of b.slice(8,10))z.number().int().min(0).max(40).parse(n);if(state==="succeeded"?b[10]!==null:b[8]!==0||b[9]!==0||!z.string().regex(/^[a-z0-9_]{1,80}$/).safeParse(b[10]).success)throw Error("publication_wallet_snapshot_run");};
  if(p.ticket){
    if(ops.length<6||ops[1].kind!=="receipt"||ops.filter(o=>o.kind==="receipt").length!==1)throw Error("publication_wallet_snapshot_shape");run(ops[0],"succeeded");
    const analysis=JSON.parse(ops[2].bindings?.[0]),a=ops[3],f=ops[4];Hash.parse(analysis.evidence_hash);time(analysis.observed_at);
    if(ops[2].sql!==snapshotCandidateSql||ops[2].bindings.length!==2||ops[2].bindings[1]!==c.address||!Array.isArray(analysis.wallets)||ops.length!==6+analysis.wallets.length)throw Error("publication_wallet_snapshot_analysis");
    if(a.sql!==walletAttemptSql||!equal(a.bindings,[c.address,c.at,new Date(Date.parse(c.at)+3600000).toISOString()])||f.sql!==snapshotFinishSql||f.bindings.length!==4||!equal(f.bindings.slice(0,3),[analysis.observed_at,c.address,c.job])||ops[5].sql!==snapshotWorkSql||!equal(ops[5].bindings,[c.address]))throw Error("publication_wallet_snapshot_completion");time(f.bindings[3]);
    for(const [i,w] of analysis.wallets.entries())if(ops[i+6].sql!==snapshotProfileSql||!equal(ops[i+6].bindings,[c.address,w.wallet,analysis.evidence_hash,JSON.stringify(w),analysis.observed_at]))throw Error("publication_wallet_snapshot_profile");
  }else{
    if(ops.length!==1||ops[0].kind!=="sql")throw Error("publication_wallet_snapshot_shape");const {sql,bindings:b}=ops[0];
    if(sql===directCatchupSql){const cap=Math.min(180,Math.floor(p.limits.wallet/4/18)*18);if(cap<18||!equal(b,[c.at.slice(0,10),cap]))throw Error("publication_wallet_snapshot_catchup");}
    else if(sql===directBackoffSql){if(b.length!==1)throw Error("publication_wallet_snapshot_backoff");time(b[0]);}
    else if(sql===directUnsupportedSql){if(b.length!==6||!z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/).safeParse(b[0]).success||b[1]!=="solana-json-legacy-v0-v1-r1"||b[3]!==b[4]||!["unsupported_transaction_version","wallet_transaction_layout_unsupported"].includes(b[5]))throw Error("publication_wallet_snapshot_unsupported");z.number().int().safe().nonnegative().parse(b[2]);time(b[3]);}
    else run(ops[0],"failed");
  }
  if(Buffer.byteLength(JSON.stringify(p))>10*1024**2)throw Error("publication_wallet_snapshot_bound");return p;
}
export function validateSnapshotReceipt(plan,verified){
  if(!plan.ticket)return;
  const r=verified.row,a=JSON.parse(plan.operations[2].bindings[0]);
  if(verified.table!=="tenx_wallet_evidence"||r.address!==plan.cycle.address||r.payload_hash!==a.evidence_hash||r.observed_at!==a.observed_at||snapshotDigest(JSON.parse(r.payload))!==r.payload_hash||Buffer.byteLength(r.payload)>1800000)throw Error("publication_wallet_snapshot_receipt");
}
