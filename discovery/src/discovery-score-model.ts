import {z} from "zod";
import {CandidateSchema,MarketSchema} from "./model";

export const SCORE_CATEGORIES=["origin","controls","market","holders","wallets","performance"] as const;
const Category=z.enum(SCORE_CATEGORIES),Percent=z.number().finite().min(0).max(100),Hash=z.string().regex(/^[a-f0-9]{64}$/);
export const ScorePolicySchema=z.object({
  version:z.literal("discovery-score-v1"),weights:z.object({origin:z.literal(10),controls:z.literal(15),market:z.literal(20),holders:z.literal(25),wallets:z.literal(25),performance:z.literal(5)}).strict(),
  targets:z.object({market_cap_usd:z.literal(100000),liquidity_usd:z.literal(25000),liquidity_cap_ratio:z.literal(.05),holders:z.literal(100),buyers:z.literal(3),top1_pct:z.literal(10),top10_pct:z.literal(35),creator_pct:z.literal(5),dev_funded_pct:z.literal(20),dev_sold_pct:z.literal(5)}).strict(),
  freshness_seconds:z.object({controls:z.literal(600),market:z.literal(180),holders:z.literal(1800),wallets:z.literal(3600)}).strict(),
  decay_end_multiple:z.literal(4),performance:z.object({window_seconds:z.literal(7200),min_span_seconds:z.literal(1800),max_gap_seconds:z.literal(1800),min_samples:z.literal(6),max_samples:z.literal(64),return_band:z.literal(.25)}).strict(),
  risk_ceiling:z.object({rejected_origin:z.literal(0),active_authority:z.literal(40),single_owner_end:z.literal(10),top10_end:z.literal(30),wallet_exposure_end:z.literal(20)}).strict(),
}).strict();
export const DISCOVERY_SCORE_POLICY=ScorePolicySchema.parse({version:"discovery-score-v1",weights:{origin:10,controls:15,market:20,holders:25,wallets:25,performance:5},targets:{market_cap_usd:100000,liquidity_usd:25000,liquidity_cap_ratio:.05,holders:100,buyers:3,top1_pct:10,top10_pct:35,creator_pct:5,dev_funded_pct:20,dev_sold_pct:5},freshness_seconds:{controls:600,market:180,holders:1800,wallets:3600},decay_end_multiple:4,performance:{window_seconds:7200,min_span_seconds:1800,max_gap_seconds:1800,min_samples:6,max_samples:64,return_band:.25},risk_ceiling:{rejected_origin:0,active_authority:40,single_owner_end:10,top10_end:30,wallet_exposure_end:20}});
export const ScorePriceSchema=MarketSchema.pick({source:true,fetched_at:true,observed_at:true,price_usd:true}).strict();
export const ScoreInputSchema=z.object({version:z.literal("discovery-score-input-v1"),as_of:z.string().datetime(),policy:ScorePolicySchema,candidate:CandidateSchema,prices:z.array(ScorePriceSchema).max(64),history_limited:z.boolean()}).strict();
export const ScoreCriterionSchema=z.object({id:z.string().max(40),label:z.string().max(100),category:Category,maximum:Percent,points:Percent,evidence_points:Percent,status:z.enum(["observed","unknown","partial","stale","future"]),value:z.union([z.number().finite(),z.boolean(),z.null()]),observed_at:z.string().datetime().nullable(),notes:z.array(z.string().max(100)).max(8)}).strict();
export const ScoreResultSchema=z.object({version:z.literal("discovery-score-result-v1"),as_of:z.string().datetime(),value:Percent.int(),evidence_coverage:Percent.int(),base_points:Percent,ceiling:Percent,
  criteria:z.array(ScoreCriterionSchema).length(18),components:z.array(z.object({category:Category,maximum:Percent,points:Percent,evidence_points:Percent}).strict()).length(6),
  concerns:z.array(z.object({code:z.string().max(100),ceiling:Percent,observed_at:z.string().datetime().nullable()}).strict()).max(12),
}).strict();
export const ScoreSummarySchema=z.object({version:z.literal("discovery-score-v1"),as_of:z.string().datetime(),value:Percent.int(),evidence_coverage:Percent.int(),ceiling:Percent,input_hash:Hash,policy_hash:Hash,result_hash:Hash,record_hash:Hash}).strict();
export const ScoreRecordSchema=z.object({version:z.literal("discovery-scorecard-v1"),inputs:ScoreInputSchema,result:ScoreResultSchema,input_hash:Hash,policy_hash:Hash,result_hash:Hash,record_hash:Hash}).strict();
export const ScoreResponseSchema=z.object({record:ScoreRecordSchema,replay:z.literal("verified"),provider_requests:z.literal(0)}).strict();
export type ScoreInput=z.infer<typeof ScoreInputSchema>;
export type ScoreResult=z.infer<typeof ScoreResultSchema>;
export type ScoreRecord=z.infer<typeof ScoreRecordSchema>;
export type ScoreSummary=z.infer<typeof ScoreSummarySchema>;
