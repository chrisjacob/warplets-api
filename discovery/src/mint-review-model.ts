import { z } from "zod";
import { Address, Signature } from "./model";

export const MINT_REVIEW_LIMITS = { active: 8, retained: 100, pages: 3, page_size: 30, bodies_per_turn: 2, rpc_daily_subset: 20 } as const;
export const MintReviewRequest = z.object({address:Address,reason:z.string().min(3).max(300)}).strict();
export const MintReviewSchema = z.object({
  address:Address,curve:Address,state:z.enum(["queued","scanning","admitted","unsupported_quote","not_found","expired"]),
  queued_at:z.string().datetime(),updated_at:z.string().datetime(),pages:z.number().int().min(0).max(3),
  bodies_checked:z.number().int().min(0).max(90),migration_signature:Signature.nullable(),quote:Address.nullable(),
  last_error:z.string().max(100).nullable(),candidate_present:z.boolean(),
}).strict();
export const MintReviewsResponse = z.object({data:z.object({
  at:z.string().datetime(),reviews:z.array(MintReviewSchema).max(100),
  limits:z.object({active:z.literal(8),retained:z.literal(100),pages:z.literal(3),page_size:z.literal(30),bodies_per_turn:z.literal(2),rpc_daily_subset:z.literal(20)}).strict(),
  reserved_today:z.number().int().min(0).max(20),provider_requests:z.literal(0),evidence_gates_changed:z.literal(false),
}).strict()});
