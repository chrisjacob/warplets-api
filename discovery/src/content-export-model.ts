import {z} from "zod";
import {ContentCampaign,ContentRecord} from "./content-model";
import {ContentReportRecord} from "./content-report-model";
import {HoldReviewRecord} from "./content-hold-model";
import {AuthorshipHistory} from "./content-authorship-model";

export const CONTENT_EXPORT_MAX_BYTES=1024*1024;
export const CONTENT_EXPORT_REPORT_LIMIT=10;
export const CONTENT_EXPORT_HOLD_LIMIT=20;
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const ContentCasePayload=z.object({
  version:z.literal("content-case-export-v1"),scope:z.literal("private_local_moderation_case"),
  captured_at:z.iso.datetime(),authority:z.literal("local_database_history_only"),
  campaign:ContentCampaign,
  content:ContentRecord.omit({visibility_held:true}),
  reports:z.array(ContentReportRecord).max(CONTENT_EXPORT_REPORT_LIMIT),
  hold_reviews:z.array(HoldReviewRecord.omit({visibility_held:true})).max(CONTENT_EXPORT_HOLD_LIMIT),
  visibility_held:z.boolean(),
  manifest:z.object({reports:z.number().int().min(0),hold_reviews:z.number().int().min(0),events:z.number().int().min(1),campaign_hash:hash,content_hash:hash,reports_hash:hash,hold_reviews_hash:hash}).strict(),
  source_requests:z.literal(0),rewards_enabled:z.literal(false),
}).strict();
export const ContentCasePayloadV2=ContentCasePayload.extend({version:z.literal("content-case-export-v2"),authorship:AuthorshipHistory,
  manifest:ContentCasePayload.shape.manifest.extend({authorship_hash:hash,authorship_events:z.number().int().min(1).max(10)})});
export const ContentCaseExport=z.discriminatedUnion("version",[ContentCasePayload.extend({export_hash:hash}),ContentCasePayloadV2.extend({export_hash:hash})]);
