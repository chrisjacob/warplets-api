import {z} from "zod";
import {canonicalContentUrl,ContentError} from "./content-url";
import {hashJson} from "./solana";
import {DuplicateEvidence,DuplicateRequest,DuplicatePayload,DuplicateReport,DUPLICATE_ALGORITHM as algorithm,DUPLICATE_MAX_BYTES,DUPLICATE_GAPS} from "./content-duplicates-model";
type Evidence=z.infer<typeof DuplicateEvidence>;
export function duplicateFail(code="content_duplicate_integrity_failed",status=503):never{throw new ContentError(code,status);}
export function duplicateSize(raw:unknown){if(new TextEncoder().encode(JSON.stringify(raw)).byteLength>DUPLICATE_MAX_BYTES)duplicateFail("content_duplicate_size_exceeded",413);}
export function normalizeExcerpt(value:string){return value.normalize("NFKC").toLowerCase().replace(/\p{Cf}/gu,"").replace(/[^\p{L}\p{N}]+/gu," ").trim().replace(/\s+/g," ");}
export function excerptGrams(value:string){
  const normalized=normalizeExcerpt(value),chars=Array.from(normalized),grams=new Set<string>();
  for(let i=0;i<=chars.length-algorithm.gram_size;i++)grams.add(chars.slice(i,i+algorithm.gram_size).join(""));
  if(chars.length<algorithm.min_normalized_chars||grams.size<algorithm.min_distinct_grams)duplicateFail("content_duplicate_excerpt_too_short_or_repetitive",400);
  return {normalized,grams};
}
export async function verifyDuplicateEvidence(raw:unknown){
  const value=DuplicateEvidence.parse(raw),target=value.target;
  if(canonicalContentUrl(target.source_url).canonical_url!==target.source_url)duplicateFail();
  const ids=new Set<string>();let previous:Evidence["events"][number]|undefined;
  for(const event of value.events){
    const {hash,...unsigned}=event;
    if(ids.has(event.id)||event.submission_id!==target.submission_id||event.source_url!==target.source_url||event.target_content_hash!==target.target_content_hash||event.revision!==(previous?previous.revision+1:0)||event.previous_hash!==(previous?.hash??null)||event.created_at<(previous?.created_at??event.created_at)||await hashJson(unsigned)!==hash)duplicateFail();
    const input=DuplicateRequest.parse({request_id:event.id,submission_id:event.submission_id,expected_revision:event.revision-1,action:event.action,excerpt:event.excerpt,source_inspected:event.source_inspected,reason:event.reason});
    if(await hashJson(input)!==event.request_hash)duplicateFail();
    if(event.action==="RECORD"){
      if(previous?.action==="RECORD"||event.revision===5||event.excerpt===null||event.normalized_excerpt_hash!==await hashJson(excerptGrams(event.excerpt).normalized))duplicateFail();
    }else if(previous?.action!=="RECORD"||event.normalized_excerpt_hash!==null)duplicateFail();
    ids.add(event.id);previous=event;
  }
  return value;
}
function active(value:Evidence){const last=value.events.at(-1);if(!last||last.action!=="RECORD"||!last.excerpt)duplicateFail("content_duplicate_active_excerpt_required",409);return last;}
export function scoreExcerpts(left:string,right:string){
  const a=excerptGrams(left),b=excerptGrams(right);let shared_grams=0;
  for(const gram of a.grams)if(b.grams.has(gram))shared_grams++;
  const union_grams=a.grams.size+b.grams.size-shared_grams;
  return {kind:a.normalized===b.normalized?"EXACT_NORMALIZED_EXCERPT" as const:"SIMILAR_EXCERPT" as const,score_bps:Math.floor(shared_grams*10000/union_grams),shared_grams,union_grams};
}
export function duplicateResults(subject:Evidence,candidates:Evidence[]){
  const source=active(subject),matches=[];
  for(const candidate of candidates){const event=active(candidate),score=scoreExcerpts(source.excerpt!,event.excerpt!);
    if(score.score_bps>=algorithm.review_threshold_bps)matches.push({submission_id:candidate.target.submission_id,source_url:candidate.target.source_url,evidence_id:event.id,evidence_hash:event.hash,...score});}
  matches.sort((a,b)=>b.score_bps-a.score_bps||(a.submission_id<b.submission_id?-1:a.submission_id>b.submission_id?1:0));
  return {matching_candidates:matches.length,matches:matches.slice(0,10)};
}
export async function verifyDuplicateReport(raw:unknown,expectedHash?:string){
  duplicateSize(raw);const value=DuplicateReport.parse(raw),{report_hash,...payload}=value;
  if(expectedHash!==undefined&&z.string().regex(/^[a-f0-9]{64}$/).parse(expectedHash)!==report_hash)duplicateFail();
  if(await hashJson(payload)!==report_hash)duplicateFail();
  await verifyDuplicateEvidence(value.subject);active(value.subject);
  const ids=new Set([value.subject.target.submission_id]);let previous:Evidence["events"][number]|undefined;
  for(const candidate of value.candidates){
    await verifyDuplicateEvidence(candidate);const event=active(candidate);
    if(ids.has(candidate.target.submission_id)||previous&&(event.created_at>previous.created_at||event.created_at===previous.created_at&&event.id>=previous.id))duplicateFail();
    ids.add(candidate.target.submission_id);previous=event;
  }
  if([value.subject,...value.candidates].some(e=>e.events.some(event=>event.created_at>value.captured_at)))duplicateFail();
  const c=value.coverage;
  if(c.compared!==value.candidates.length||c.compared!==Math.min(c.sample_limit,c.available_candidates)||c.omitted!==c.available_candidates-c.compared||c.sample_complete!==(c.omitted===0)||await hashJson(duplicateResults(value.subject,value.candidates))!==await hashJson(value.result))duplicateFail();
  return value;
}
export async function makeDuplicateReport(subject:Evidence,candidates:Evidence[],available:number,captured_at:string){
  const payload=DuplicatePayload.parse({version:"private-duplicate-report-v1",captured_at,algorithm,subject,candidates,
    coverage:{scope:"latest_active_operator_excerpts_across_campaigns",sample_limit:50,available_candidates:available,compared:candidates.length,omitted:available-candidates.length,sample_complete:available===candidates.length,external_content_complete:false},
    result:duplicateResults(subject,candidates),gaps:DUPLICATE_GAPS,source_requests:0,automatic_decisions:false,rewards_enabled:false});
  return verifyDuplicateReport({...payload,report_hash:await hashJson(payload)});
}
