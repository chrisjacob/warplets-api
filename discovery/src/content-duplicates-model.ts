import {z} from "zod";
export const DUPLICATE_DAILY_LIMIT=20;
export const DUPLICATE_SAMPLE_LIMIT=50;
export const DUPLICATE_MAX_BYTES=2*1024*1024;
export const DUPLICATE_ALGORITHM={version:"nfkc-char5-jaccard-v1",gram_size:5,min_normalized_chars:60,min_distinct_grams:20,review_threshold_bps:6500} as const;
const hash=z.string().regex(/^[a-f0-9]{64}$/),excerpt=z.string().trim().min(60).max(600),reason=z.string().trim().min(10).max(300);
export const DuplicateRequest=z.object({request_id:z.uuid(),submission_id:z.uuid(),expected_revision:z.number().int().min(-1).max(4),action:z.enum(["RECORD","WITHDRAW"]),excerpt:excerpt.nullable(),source_inspected:z.boolean(),reason}).strict().superRefine((value,ctx)=>{
  if(value.action==="RECORD"?value.excerpt===null||!value.source_inspected:value.excerpt!==null||value.source_inspected)ctx.addIssue({code:"custom",message:"Record requires an inspected short source excerpt; withdrawal requires null excerpt and no new inspection assertion"});
});
export const DuplicateTarget=z.object({submission_id:z.uuid(),source_url:z.url().max(2048),target_content_hash:hash}).strict();
export const DuplicateEvent=z.object({id:z.uuid(),submission_id:z.uuid(),revision:z.number().int().min(0).max(5),created_at:z.iso.datetime(),actor:z.literal("local_operator"),action:z.enum(["RECORD","WITHDRAW"]),
  source_url:z.url().max(2048),target_content_hash:hash,excerpt:excerpt.nullable(),normalized_excerpt_hash:hash.nullable(),source_inspected:z.boolean(),reason,
  request_hash:hash,previous_hash:hash.nullable(),hash}).strict();
export const DuplicateEvidence=z.object({version:z.literal("operator-excerpt-evidence-v1"),target:DuplicateTarget,events:z.array(DuplicateEvent).max(6),replay:z.literal("verified"),source_requests:z.literal(0),reward_eligible:z.literal(false)}).strict();
export const DuplicateCoverage=z.object({scope:z.literal("latest_active_operator_excerpts_across_campaigns"),sample_limit:z.literal(DUPLICATE_SAMPLE_LIMIT),available_candidates:z.number().int().nonnegative(),compared:z.number().int().min(0).max(DUPLICATE_SAMPLE_LIMIT),omitted:z.number().int().nonnegative(),sample_complete:z.boolean(),external_content_complete:z.literal(false)}).strict();
export const DuplicateMatch=z.object({submission_id:z.uuid(),source_url:z.url().max(2048),evidence_id:z.uuid(),evidence_hash:hash,kind:z.enum(["EXACT_NORMALIZED_EXCERPT","SIMILAR_EXCERPT"]),score_bps:z.number().int().min(0).max(10000),shared_grams:z.number().int().nonnegative(),union_grams:z.number().int().positive()}).strict();
export const DuplicateResult=z.object({matching_candidates:z.number().int().min(0).max(DUPLICATE_SAMPLE_LIMIT),matches:z.array(DuplicateMatch).max(10)}).strict();
export const DUPLICATE_GAPS=["Operator-supplied excerpts are not independently authenticated source text.","Only recorded active excerpts are compared; unobserved content remains unknown.","Image, video, audio, translation and semantic similarity are not measured.","Shared wording or boilerplate is not proof of plagiarism, common control or fraud.","Similarity does not decide moderation, authorship, ranking or rewards."] as const;
export const DuplicatePayload=z.object({version:z.literal("private-duplicate-report-v1"),captured_at:z.iso.datetime(),
  algorithm:z.object({version:z.literal(DUPLICATE_ALGORITHM.version),gram_size:z.literal(5),min_normalized_chars:z.literal(60),min_distinct_grams:z.literal(20),review_threshold_bps:z.literal(6500)}).strict(),
  subject:DuplicateEvidence,candidates:z.array(DuplicateEvidence).max(DUPLICATE_SAMPLE_LIMIT),coverage:DuplicateCoverage,result:DuplicateResult,
  gaps:z.tuple([z.literal(DUPLICATE_GAPS[0]),z.literal(DUPLICATE_GAPS[1]),z.literal(DUPLICATE_GAPS[2]),z.literal(DUPLICATE_GAPS[3]),z.literal(DUPLICATE_GAPS[4])]),source_requests:z.literal(0),automatic_decisions:z.literal(false),rewards_enabled:z.literal(false)}).strict();
export const DuplicateReport=DuplicatePayload.extend({report_hash:hash});
