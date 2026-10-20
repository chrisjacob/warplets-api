import { z } from "zod";
import { IdentityAddress } from "./identity-model";
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Reason = z.string().trim().min(3).max(500);
export const ContentStatus = z.enum(["PENDING", "VISIBLE", "FLAGGED", "REJECTED", "APPEALED"]);
export const ContentCampaignRequest = z.object({ request_id: z.uuid(), title: z.string().trim().min(3).max(100), og_address: IdentityAddress, reason: Reason }).strict();
export const ContentCampaign = z.object({ id: z.uuid(), title: z.string(), og_address: IdentityAddress, chain: z.literal("solana"), starts_at: z.iso.datetime(), ends_at: z.iso.datetime(), kind: z.literal("local_review_only"), rewards_enabled: z.literal(false), reason: Reason, request_hash: Hash, record_hash: Hash }).strict();
export const PublicContentCampaign = ContentCampaign.omit({ reason: true, request_hash: true, record_hash: true });
export const ContentSubmissionRequest = z.object({ request_id: z.uuid(), campaign_id: z.uuid(), url: z.string().trim().min(8).max(2048), category: z.enum(["meme", "video", "article", "thread", "other"]), author_claim: z.string().trim().min(1).max(120), comment: z.string().trim().max(500), permission_to_feature: z.literal(true), rights_confirmed: z.literal(true) }).strict();
export const ContentSnapshot = z.object({ id: z.uuid(), campaign_id: z.uuid(), identity_id: z.uuid(), created_at: z.iso.datetime(), updated_at: z.iso.datetime(), revision: z.number().int().min(0).max(19), status: ContentStatus,
  content: z.object({ canonical_url: z.url().max(2048), platform: z.enum(["x", "youtube", "farcaster", "web"]), category: ContentSubmissionRequest.shape.category, author_claim: z.string().min(1).max(120), comment: z.string().max(500), permission_to_feature: z.literal(true), rights_confirmed: z.literal(true) }).strict(),
  authorship: z.literal("unverified"), engagement: z.literal("unavailable"), reward_eligible: z.literal(false),
}).strict();
export const ContentEvent = z.object({ id: z.uuid(), submission_id: z.uuid(), revision: z.number().int().min(0).max(19), actor: z.string(), action: z.enum(["submit", "review", "appeal"]), reason: Reason, created_at: z.iso.datetime(), request_hash: Hash, previous_hash: Hash.nullable(), snapshot: ContentSnapshot, hash: Hash }).strict();
export const ContentRecord = z.object({ snapshot: ContentSnapshot, events: z.array(ContentEvent).min(1).max(20), visibility_held:z.boolean(), replay: z.literal("verified"), source_requests: z.literal(0) }).strict();
export const ContentReviewRequest = z.object({ request_id: z.uuid(), submission_id: z.uuid(), expected_revision: z.number().int().min(0).max(18), decision: z.enum(["VISIBLE", "FLAGGED", "REJECTED"]), reason: Reason }).strict();
export const ContentAppealRequest = z.object({ request_id: z.uuid(), submission_id: z.uuid(), expected_revision: z.number().int().min(0).max(18), reason: Reason }).strict();
export const PublicContent = ContentSnapshot.omit({ identity_id: true });
export const ContentCampaignList = z.object({ scope: z.literal("local_content_review"), as_of: z.iso.datetime(), campaigns: z.array(PublicContentCampaign).max(20), next_cursor: z.string().nullable() }).strict();
export const ContentPage = z.object({ scope: z.literal("local_content_review"), as_of: z.iso.datetime(), submissions: z.array(ContentSnapshot).max(20), held_submission_ids:z.array(z.uuid()).max(20), next_cursor: z.string().nullable(), rewards_enabled: z.literal(false) }).strict();
export const PublicContentPage = ContentPage.extend({ submissions: z.array(PublicContent).max(20) }).strict();
export const ContentCampaignDetail = z.object({ campaign: PublicContentCampaign, feed: PublicContentPage }).strict();
export const ContentChangeResponse = z.object({ event: ContentEvent, replay: z.literal("verified") }).strict();
