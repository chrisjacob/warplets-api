import {z} from "zod";
const Hash=z.string().regex(/^[a-f0-9]{64}$/), Note=z.string().trim().min(10).max(600);
export const HoldReviewStatus=z.enum(["OPEN","NEEDS_INFO","RESUBMITTED","CLOSED"]);
export const HoldReviewRequest=z.object({request_id:z.uuid(),submission_id:z.uuid(),note:Note,reference_url:z.string().trim().max(2048).nullable()}).strict();
export const HoldReviewReply=z.object({request_id:z.uuid(),review_id:z.uuid(),expected_revision:z.number().int().min(0).max(2),decision:z.enum(["NEEDS_INFO","RESUBMITTED","CLOSED"]),note:Note,reference_url:z.string().trim().max(2048).nullable()}).strict();
export const HoldReviewSnapshot=z.object({id:z.uuid(),submission_id:z.uuid(),owner_identity_id:z.uuid(),target_url:z.url().max(2048),target_content_hash:Hash,hold_set_hash:Hash,created_at:z.iso.datetime(),updated_at:z.iso.datetime(),revision:z.number().int().min(0).max(3),status:HoldReviewStatus}).strict();
export const HoldReviewEvent=z.object({id:z.uuid(),review_id:z.uuid(),revision:z.number().int().min(0).max(3),actor:z.string(),action:z.enum(["request","respond","review"]),note:Note,reference_url:z.url().max(2048).nullable(),created_at:z.iso.datetime(),request_hash:Hash,previous_hash:Hash.nullable(),snapshot:HoldReviewSnapshot,hash:Hash}).strict();
export const HoldReviewRecord=z.object({snapshot:HoldReviewSnapshot,events:z.array(HoldReviewEvent).min(1).max(4),visibility_held:z.boolean(),replay:z.literal("verified"),source_requests:z.literal(0)}).strict();
export const HoldReviewPage=z.object({as_of:z.iso.datetime(),reviews:z.array(HoldReviewSnapshot).max(20),next_cursor:z.string().nullable(),source_requests:z.literal(0)}).strict();
