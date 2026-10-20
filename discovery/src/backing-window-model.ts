import { z } from "zod";
import { Address, Signature } from "./model";
import { MAINNET_GENESIS, SignatureRows } from "./rpc";

export const FinalityObservation = z.object({
  genesis: z.literal(MAINNET_GENESIS), commitment:z.literal("finalized"), slot:z.number().int().safe().nonnegative(),
  block_time:z.number().int().nonnegative(), fetched_at:z.iso.datetime(), source_hash:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const WindowPage = z.object({address:Address,before:Signature.nullable(),limit:z.literal(50),min_context_slot:z.number().int().safe().nonnegative(),fetched_at:z.iso.datetime(),rows:SignatureRows.max(50),rows_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const WindowState = z.object({version:z.literal("wallet-window-v1"),finality:FinalityObservation.nullable(),pages:z.array(WindowPage).max(16),
  processed:z.array(Signature).max(100),
  unavailable:z.array(z.object({signature:Signature,reason:z.enum(["missing","unsupported","oversized"])}).strict()).max(100),capacity_limited:z.boolean(),
}).strict();
export const WindowEvidence = WindowState.extend({reserved_calls:z.number().int().min(0).max(64),last_error:z.string().max(100).nullable()}).strict();
export const WindowCoverage = z.object({
  scope:z.literal("bounded_RPC_wallet_history"),status:z.enum(["rpc_window_covered","incomplete","no_linked_wallets"]),
  wallets_requested:z.number().int().min(0).max(1000),wallets_tracked:z.number().int().min(0).max(16),wallet_boundaries_reached:z.number().int().min(0).max(16),
  pages:z.number().int().min(0).max(16),signatures_in_window:z.number().int().min(0).max(800),bodies_retained:z.number().int().min(0).max(100),bodies_missing:z.number().int().min(0).max(800),
  finalized_slot:z.number().int().safe().nonnegative().nullable(),finalized_block_time:z.number().int().nonnegative().nullable(),
  reserved_calls:z.number().int().min(0).max(64),independent_finality_verified:z.literal(false),gaps:z.array(z.string()).max(30),
}).strict();
export type Window = z.infer<typeof WindowEvidence>;
export const emptyWindow = ():z.infer<typeof WindowState>=>({version:"wallet-window-v1",finality:null,pages:[],processed:[],unavailable:[],capacity_limited:false});
