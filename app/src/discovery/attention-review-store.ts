import { z } from "zod";
import { AttentionQueue, type AttentionQueueResult } from "../../../discovery/src/attention-queue-model";
import { AttentionCandleReview } from "../../../discovery/src/attention-candle-model";
import { attentionAddress } from "../../../discovery/src/attention-feed-contract";

export const ATTENTION_REVIEW_KEY="tenx:attention-personal-reviews:v1";
export const REVIEW_RECORD_LIMIT=200, REVIEW_BYTE_LIMIT=2_000_000;
const Hash=z.string().regex(/^[a-f0-9]{64}$/),Text=z.string().trim().max(600).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/);
export const AttentionReviewLabels=z.object({
  decision:z.enum(["follow","needs_evidence","set_aside"]), relevance:z.enum(["memecoin","not_memecoin","uncertain"]),
  catalyst:Text, concerns:Text, rationale:Text.pipe(z.string().min(10)),
  outcome:z.enum(["not_followed_up","still_active","attention_faded","adverse_reported","unknown"]), outcome_note:Text,
}).strict().refine(v=>v.decision!=="follow"||v.catalyst.length>=10,"Explain the current catalyst before choosing Follow.")
  .refine(v=>v.outcome==="not_followed_up"||v.outcome_note.length>=10,"Explain the reported follow-up outcome.");
export const AttentionReviewContext=z.object({
  as_of:z.iso.datetime(), token:AttentionQueue.shape.rows.element,
  candle_review:AttentionCandleReview.nullable(), history_truncated:z.boolean(), gaps:z.array(z.string().max(100)).max(60),
}).strict().refine(v=>attentionAddress(v.token.chain,v.token.address)===v.token.address&&
  v.token.sources.every(s=>Date.parse(s.received_at)<=Date.parse(v.as_of))&&(!v.candle_review||v.candle_review.chain===v.token.chain&&v.candle_review.address===v.token.address&&Date.parse(v.candle_review.received_at)<=Date.parse(v.as_of)),"Review context identity/time mismatch.");
const RecordBody=z.object({id:z.uuid(),recorded_at:z.iso.datetime(),review_day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone:z.literal("Australia/Sydney"),previous_hash:Hash.nullable(),previous_review_hash:Hash.nullable(),revision:z.number().int().min(1).max(REVIEW_RECORD_LIMIT),
  context:AttentionReviewContext,context_hash:Hash,labels:AttentionReviewLabels}).strict();
export const AttentionReviewRecord=RecordBody.extend({hash:Hash});
const Ledger=z.object({version:z.literal("attention-personal-reviews-v1"),records:z.array(AttentionReviewRecord).max(REVIEW_RECORD_LIMIT)}).strict();
export type ReviewContext=z.infer<typeof AttentionReviewContext>;
export type ReviewLabels=z.infer<typeof AttentionReviewLabels>;
export type ReviewRecord=z.infer<typeof AttentionReviewRecord>;
export type ReviewLedger=z.infer<typeof Ledger>;
type LocalStore=Pick<Storage,"getItem"|"setItem">;
const bytes=(text:string)=>new TextEncoder().encode(text).byteLength;
function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
  if(value!==null&&typeof value==="object")return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  const encoded=JSON.stringify(value);if(encoded===undefined)throw Error("review_hash_value_unsupported");return encoded;
}
export async function reviewHash(value:unknown) {
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
export function reviewDay(date:Date) {
  const parts=new Intl.DateTimeFormat("en",{timeZone:"Australia/Sydney",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const part=(kind:string)=>parts.find(p=>p.type===kind)!.value;return `${part("year")}-${part("month")}-${part("day")}`;
}
const identity=(context:ReviewContext)=>`${context.token.chain}:${context.token.address}`;
export const reviewHead=(ledger:ReviewLedger)=>ledger.records.at(-1)?.hash??null;
export function captureAttentionReview(report:AttentionQueueResult,address:string,chain:string):ReviewContext {
  const token=report.rows.find(r=>r.address===address&&r.chain===chain);if(!token)throw Error("review_subject_missing");
  return AttentionReviewContext.parse(structuredClone({as_of:report.as_of,token,candle_review:report.candle_reviews.find(c=>c.address===address&&c.chain===chain)??null,history_truncated:report.history_truncated,gaps:report.gaps}));
}
export async function parseAttentionReviews(raw:string|null):Promise<ReviewLedger> {
  if(raw===null)return{version:"attention-personal-reviews-v1",records:[]};
  if(bytes(raw)>REVIEW_BYTE_LIMIT)throw Error("review_storage_bound");
  const ledger=Ledger.parse(JSON.parse(raw)),seen=new Set<string>(),prior=new Map<string,ReviewRecord>();let head:string|null=null,lastTime=-Infinity;
  for(const record of ledger.records){const{hash,...body}=record,key=identity(record.context),previous=prior.get(key);
    if(seen.has(record.id)||record.previous_hash!==head||record.previous_review_hash!==(previous?.hash??null)||record.revision!==(previous?.revision??0)+1||
      Date.parse(record.recorded_at)<lastTime||Date.parse(record.recorded_at)<Date.parse(record.context.as_of)||record.review_day!==reviewDay(new Date(record.recorded_at))||
      record.context_hash!==await reviewHash(record.context)||hash!==await reviewHash(body))throw Error("review_history_invalid");
    seen.add(record.id);prior.set(key,record);head=hash;lastTime=Date.parse(record.recorded_at);
  }
  return ledger;
}
export async function appendAttentionReview(ledger:ReviewLedger,context:ReviewContext,rawLabels:unknown,now=new Date()):Promise<ReviewLedger> {
  // Validate history before extending it; never repair or silently prune it.
  const original=await parseAttentionReviews(JSON.stringify(ledger)),captured=AttentionReviewContext.parse(context),labels=AttentionReviewLabels.parse(rawLabels);
  if(original.records.length>=REVIEW_RECORD_LIMIT)throw Error("review_storage_full");
  const previous=[...original.records].reverse().find(r=>identity(r.context)===identity(captured));
  const body=RecordBody.parse({id:crypto.randomUUID(),recorded_at:now.toISOString(),review_day:reviewDay(now),timezone:"Australia/Sydney",
    previous_hash:reviewHead(original),previous_review_hash:previous?.hash??null,revision:(previous?.revision??0)+1,context:captured,context_hash:await reviewHash(captured),labels});
  const next={...original,records:[...original.records,{...body,hash:await reviewHash(body)}]};
  const encoded=JSON.stringify(next);if(bytes(encoded)>REVIEW_BYTE_LIMIT)throw Error("review_storage_bound");
  return parseAttentionReviews(encoded);
}
// The caller must hold the named exclusive browser lock for this entire turn.
// Compare the head again after hashing, before writing. A failed write never
// becomes an in-memory "saved" state, and corrupt history is never overwritten.
export async function saveAttentionReview(storage:LocalStore,expectedHead:string|null,context:ReviewContext,labels:unknown,now=new Date()) {
  const raw=storage.getItem(ATTENTION_REVIEW_KEY),original=await parseAttentionReviews(raw);
  if(reviewHead(original)!==expectedHead)throw Error("review_history_changed");
  const next=await appendAttentionReview(original,context,labels,now);
  if(storage.getItem(ATTENTION_REVIEW_KEY)!==raw)throw Error("review_history_changed");
  storage.setItem(ATTENTION_REVIEW_KEY,JSON.stringify(next));return next;
}
export async function exportAttentionReviews(storage:LocalStore,now=new Date()) {
  const ledger=await parseAttentionReviews(storage.getItem(ATTENTION_REVIEW_KEY));
  return{...ledger,export_version:"attention-personal-review-export-v1",exported_at:now.toISOString(),integrity:"local_sha256_chain_not_identity_or_source_proof",provider_requests:0,scoring_effect:"none",evidence_gates_changed:false,launch_enabled:false};
}
