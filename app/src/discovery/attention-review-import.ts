import { z } from "zod";
import { ATTENTION_REVIEW_KEY, AttentionReviewRecord, REVIEW_RECORD_LIMIT, parseAttentionReviews, reviewHash, reviewHead } from "./attention-review-store";

// Pretty-printed exports can be larger than their compact local ledger. The
// existing 200-record/2MB stored-ledger bound is still checked after parsing.
export const REVIEW_IMPORT_BYTE_LIMIT=6_000_000;
const ExportSchema=z.object({version:z.literal("attention-personal-reviews-v1"),records:z.array(AttentionReviewRecord).max(REVIEW_RECORD_LIMIT),
  export_version:z.literal("attention-personal-review-export-v1"),exported_at:z.iso.datetime(),
  integrity:z.literal("local_sha256_chain_not_identity_or_source_proof"),provider_requests:z.literal(0),scoring_effect:z.literal("none"),
  evidence_gates_changed:z.literal(false),launch_enabled:z.literal(false)}).strict();
type LocalStore=Pick<Storage,"getItem"|"setItem">;
export async function parseAttentionReviewExport(raw:string,now=new Date()) {
  if(new TextEncoder().encode(raw).byteLength>REVIEW_IMPORT_BYTE_LIMIT)throw Error("review_import_size");
  const file=ExportSchema.parse(JSON.parse(raw));
  const ledger=await parseAttentionReviews(JSON.stringify({version:file.version,records:file.records}));
  if(Date.parse(file.exported_at)>now.getTime()||ledger.records.some(r=>Date.parse(r.recorded_at)>Date.parse(file.exported_at)))throw Error("review_import_time");
  return{ledger,export_hash:await reviewHash(file),exported_at:file.exported_at};
}
export async function previewAttentionReviewImport(storage:LocalStore,raw:string,now=new Date()) {
  const local=await parseAttentionReviews(storage.getItem(ATTENTION_REVIEW_KEY)),file=await parseAttentionReviewExport(raw,now),incoming=file.ledger;
  const shared=Math.min(local.records.length,incoming.records.length);
  if(local.records.slice(0,shared).some((record,i)=>record.hash!==incoming.records[i]!.hash))throw Error("review_import_diverged");
  const newRecords=Math.max(0,incoming.records.length-local.records.length),subjects=new Map<string,{chain:string;address:string;symbol:string|null}>();
  for(const record of incoming.records){const token=record.context.token;subjects.set(`${token.chain}:${token.address}`,{chain:token.chain,address:token.address,symbol:token.symbol});}
  return{local_head:reviewHead(local),export_hash:file.export_hash,exported_at:file.exported_at,
    action:newRecords===0?"unchanged" as const:local.records.length===0?"restore" as const:"extend" as const,
    existing_records:local.records.length,incoming_records:incoming.records.length,new_records:newRecords,
    first_record_at:incoming.records[0]?.recorded_at??null,last_record_at:incoming.records.at(-1)?.recorded_at??null,subjects:[...subjects.values()]};
}
export type AttentionReviewImportPreview=Awaited<ReturnType<typeof previewAttentionReviewImport>>;

// Caller holds the same exclusive lock used by ordinary appends. Revalidate the
// chosen file and current head at confirmation; never rebase, rehash, merge
// branches, replace corrupt history, shorten a chain or refresh an old timestamp.
export async function restoreAttentionReviews(storage:LocalStore,raw:string,expected:{local_head:string|null;export_hash:string},now=new Date()) {
  const before=storage.getItem(ATTENTION_REVIEW_KEY),local=await parseAttentionReviews(before);
  if(reviewHead(local)!==expected.local_head)throw Error("review_history_changed");
  const file=await parseAttentionReviewExport(raw,now);
  if(file.export_hash!==expected.export_hash)throw Error("review_import_changed");
  const shared=Math.min(local.records.length,file.ledger.records.length);
  if(local.records.slice(0,shared).some((record,i)=>record.hash!==file.ledger.records[i]!.hash))throw Error("review_import_diverged");
  if(storage.getItem(ATTENTION_REVIEW_KEY)!==before)throw Error("review_history_changed");
  if(file.ledger.records.length<=local.records.length)return{ledger:local,restored_records:0};
  storage.setItem(ATTENTION_REVIEW_KEY,JSON.stringify(file.ledger));
  return{ledger:file.ledger,restored_records:file.ledger.records.length-local.records.length};
}

export async function readAttentionReviewFile(file:Pick<File,"size"|"text">) {
  if(file.size>REVIEW_IMPORT_BYTE_LIMIT)throw Error("review_import_size");
  const raw=await file.text();if(new TextEncoder().encode(raw).byteLength>REVIEW_IMPORT_BYTE_LIMIT)throw Error("review_import_size");return raw;
}
