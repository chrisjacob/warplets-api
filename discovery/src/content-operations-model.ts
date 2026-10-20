import {z} from "zod";
const Count=z.number().int().nonnegative();
export const ContentQueueId=z.enum(["pending","flagged","appealed","open_reports","open_hold_reviews","resubmitted_hold_reviews","contributor_response"]);
export const ContentQuotaId=z.enum(["open_campaigns","campaigns","submissions","content_events","reports","report_events","hold_reviews","hold_events"]);
export const ContentStorageId=z.enum(["campaigns","submissions","content_events","reports","report_events","hold_reviews","hold_events","authorship_events"]);
export const ContentOperations=z.object({
  scope:z.literal("local_content_operations"),as_of:z.iso.datetime(),day_start:z.iso.datetime(),day_end:z.iso.datetime(),
  integrity:z.literal("projection_counts_only"),source_requests:z.literal(0),rewards_enabled:z.literal(false),
  queues:z.array(z.object({id:ContentQueueId,waiting_on:z.enum(["moderator","contributor"]),count:Count,waiting_24h:Count,oldest_updated_at:z.iso.datetime().nullable(),oldest_wait_seconds:Count.nullable()}).strict()).length(7),
  quotas:z.array(z.object({id:ContentQuotaId,used:Count,limit:Count,remaining:Count,resets_at:z.iso.datetime().nullable()}).strict()).length(8),
  identity_daily_limits:z.object({submissions:Count,reports:Count,hold_reviews:Count}).strict(),
  holds:z.object({upheld_reports:Count,held_submissions:Count,visible_but_held:Count}).strict(),
  authorship:z.object({manual_reviews_today:Count,manual_review_limit:Count,remaining:Count,withdrawals_today:Count,withdrawal_daily_limit:z.null()}).strict(),
  storage:z.object({sample_limit:z.literal(200),measurement:z.literal("serialized_payload_bytes_only"),tables:z.array(z.object({id:ContentStorageId,total_rows:Count,sampled_rows:Count,sampled_bytes:Count,oldest_created_at:z.iso.datetime().nullable(),complete:z.boolean()}).strict()).length(8)}).strict(),
  retention:z.object({automatic_deletion:z.literal(false),archive_policy:z.literal("not_configured"),remote_capacity:z.literal("uncertified")}).strict(),
}).strict();
