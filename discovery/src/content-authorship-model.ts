import {z} from "zod";
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const AUTHORSHIP_REVIEW_DAILY_LIMIT=20;
export const AuthorshipReviewRequest=z.object({request_id:z.uuid(),submission_id:z.uuid(),expected_revision:z.number().int().min(-1).max(8),decision:z.enum(["MANUAL_REVIEWED","WITHDRAWN"]),
  evidence_url:z.url().max(2048).nullable(),reason:z.string().trim().min(10).max(600),source_and_author_checked:z.boolean()}).strict().superRefine((value,ctx)=>{
    if(value.decision==="MANUAL_REVIEWED"&&(!value.evidence_url||!value.source_and_author_checked))ctx.addIssue({code:"custom",message:"Manual review requires a source reference and explicit author check"});
    if(value.decision==="WITHDRAWN"&&(value.source_and_author_checked||value.evidence_url!==null))ctx.addIssue({code:"custom",message:"Withdrawal must not assert a new author check or source reference"});
  });
export const AuthorshipEvent=z.object({id:z.uuid(),submission_id:z.uuid(),revision:z.number().int().min(0).max(9),created_at:z.iso.datetime(),actor:z.literal("local_operator"),
  decision:z.enum(["MANUAL_REVIEWED","WITHDRAWN"]),method:z.literal("manual_source_review"),target_content_hash:hash,author_claim:z.string().min(1).max(120),
  evidence_url:z.url().max(2048).nullable(),reason:z.string().min(10).max(600),source_and_author_checked:z.boolean(),request_hash:hash,previous_hash:hash.nullable(),hash}).strict();
export const AuthorshipHistory=z.object({submission_id:z.uuid(),target_content_hash:hash,events:z.array(AuthorshipEvent).max(10),replay:z.literal("verified"),source_requests:z.literal(0),reward_eligible:z.literal(false)}).strict();
export const AuthorshipSummary=z.object({submission_id:z.uuid(),status:z.enum(["UNVERIFIED","MANUAL_REVIEWED","WITHDRAWN"]),reviewed_at:z.iso.datetime().nullable(),
  method:z.enum(["none","manual_source_review"]),external_account_control:z.literal("unverified"),rights:z.literal("not_certified"),rewards_enabled:z.literal(false),source_requests:z.literal(0)}).strict();
