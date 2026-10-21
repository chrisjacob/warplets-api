import {z} from "zod";
import {Address} from "./model";

export const MarketBatchInputSchema=z.object({version:z.literal("dex-market-input-v1"),at:z.string().datetime(),rows:z.array(z.object({address:Address,pool:Address}).strict()).min(1).max(30),pairs:z.array(z.unknown()).max(900)}).strict();
export const MarketBatchReportSchema=z.object({
  version:z.literal("dex-market-report-v1"),at:z.string().datetime(),provider:z.literal("dexscreener"),
  requested:z.number().int().min(1).max(30),accepted:z.number().int().min(0).max(30),not_reported:z.number().int().min(0).max(30),rejected:z.number().int().min(0).max(30),
  response_pairs:z.number().int().min(0).max(900),ignored_pairs:z.number().int().min(0).max(900),unscoped_pairs:z.number().int().min(0).max(900),
  rows:z.array(z.object({address:Address,pool:Address,state:z.enum(["accepted","not_reported","rejected"]),code:z.enum(["market_pool_not_reported","market_duplicate_pool","market_identity_mismatch","market_pair_schema_invalid","market_unscoped_pair_identity"]).nullable(),fields:z.array(z.string().max(80)).max(6)}).strict()).min(1).max(30),
}).strict();
const Hash=z.string().regex(/^[a-f0-9]{64}$/);
export const MarketBatchSummarySchema=z.object({report:MarketBatchReportSchema,input_hash:Hash,report_hash:Hash,record_hash:Hash}).strict();
export const MarketBatchRecordSchema=MarketBatchSummarySchema.extend({inputs:MarketBatchInputSchema}).strict();
export const MarketBatchDetailSchema=z.object({record:MarketBatchRecordSchema,replay:z.object({status:z.literal("verified"),provider_requests:z.literal(0),report:MarketBatchReportSchema}).strict()}).strict();
export const MarketBatchesSchema=z.object({retention:z.literal("latest_response_and_latest_issue"),latest:MarketBatchSummarySchema.nullable(),latest_issue:MarketBatchSummarySchema.nullable(),provider_requests:z.literal(0)}).strict();
export type MarketBatchInput=z.infer<typeof MarketBatchInputSchema>;
export type MarketBatchReport=z.infer<typeof MarketBatchReportSchema>;
export type MarketBatchRecord=z.infer<typeof MarketBatchRecordSchema>;
