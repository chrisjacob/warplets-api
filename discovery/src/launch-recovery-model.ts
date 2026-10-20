import {z} from "zod";
export const RECOVERY_REVISION="offline-launch-recovery-v1";
export const RecoveryStep=z.enum(["create_token","create_native_pool","create_og_pool","create_tenx_pool","lock_positions"]);
const Alias=z.string().regex(/^[a-z][a-z0-9_-]{0,23}$/),Hash=z.string().regex(/^[a-f0-9]{64}$/);
export const RecoveryEvent=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("tick")}).strict(),
  z.object({kind:z.literal("reconcile"),step:RecoveryStep}).strict(),
  z.object({kind:z.literal("submit"),step:RecoveryStep,outcome:z.enum(["pending","finalized","failed"]),lose_response:z.boolean(),configuration_matches:z.boolean(),resource_matches:z.boolean()}).strict(),
  z.object({kind:z.literal("chain_status"),step:RecoveryStep,attempt:z.number().int().min(1).max(2),status:z.enum(["finalized","failed","missing"])}).strict(),
  z.object({kind:z.literal("retry_failed"),step:RecoveryStep}).strict(),
  z.object({kind:z.enum(["restart","pause","resume","abort","announce"])}).strict(),
  z.object({kind:z.literal("configuration_change"),fingerprint:Hash}).strict(),
  z.object({kind:z.literal("verify"),deployment_matches:z.boolean(),permanent_locks:z.boolean(),fee_rights:z.boolean()}).strict(),
]);
export const RecoveryScenario=z.object({
  version:z.literal(RECOVERY_REVISION),as_of:z.iso.datetime(),edition_alias:Alias,configuration_fingerprint:Hash,
  assumed_preflight:z.object({winner_frozen:z.boolean(),simulation_passed:z.boolean(),budget_funded:z.boolean(),same_chain_tenx_ready:z.boolean()}).strict(),
  events:z.array(RecoveryEvent).min(1).max(80),
}).strict();
export type RecoveryInput=z.infer<typeof RecoveryScenario>;
export const RecoveryPhase=z.enum(["not_started","intent","ready","submitted","uncertain","failed","confirmed","conflict"]);
export const RecoveryState=z.enum(["BLOCKED","FUNDED","TOKEN_CREATED","NATIVE_POOL_CREATED","OG_POOL_CREATED","TENX_POOL_CREATED","LOCKS_VERIFIED","ACTIVE","RECOVERY_REQUIRED","ABORTED"]);
const Receipt=z.object({tx_alias:z.string().regex(/^sim-tx-[a-z_]+-[12]$/),status:z.enum(["pending","finalized","failed","missing"]),configuration_matches:z.boolean(),resource_matches:z.boolean(),effect_applied:z.boolean(),revision:z.number().int().min(1).max(160)}).strict();
export const RecoveryJournal=z.object({step:RecoveryStep,idempotency_key:z.string().max(70),phase:RecoveryPhase,attempts:z.number().int().min(0).max(2),tx_alias:Receipt.shape.tx_alias.nullable(),receipts:z.array(Receipt).max(2),effects:z.number().int().min(0).max(2),uncertain:z.boolean()}).strict();
export const RecoveryResult=z.object({
  version:z.literal(RECOVERY_REVISION),revision:z.literal(RECOVERY_REVISION),scope:z.literal("hypothetical_launch_recovery_exercise"),as_of:z.iso.datetime(),
  modeled_state:RecoveryState,steps:z.array(RecoveryJournal).length(5),restarts:z.number().int().min(0).max(80),modeled_announcements:z.number().int().min(0).max(1),
  trace:z.array(z.object({index:z.number().int().min(0).max(79),event:z.enum(["tick","reconcile","submit","chain_status","retry_failed","restart","pause","resume","abort","announce","configuration_change","verify"]),outcome:z.string().max(80),modeled_state:RecoveryState,phases:z.array(RecoveryPhase).length(5),submissions:z.number().int().min(0).max(10),effects:z.number().int().min(0).max(10),announcements:z.number().int().min(0).max(1)}).strict()).max(80),
  launch_enabled:z.literal(false),signing_enabled:z.literal(false),publishing_enabled:z.literal(false),chain_evidence_verified:z.literal(false),provider_requests:z.literal(0),
  gaps:z.array(z.string()).max(12),
}).strict();
export const RecoveryRequest=z.object({request_id:z.uuid(),reason:z.string().trim().min(3).max(300),scenario:RecoveryScenario}).strict();
export const RecoveryRecord=z.object({id:z.uuid(),created_at:z.iso.datetime(),reason:z.string(),request_hash:Hash,input_hash:Hash,result_hash:Hash,record_hash:Hash,inputs:RecoveryScenario,result:RecoveryResult}).strict();
export const RecoverySummary=RecoveryRecord.omit({reason:true,request_hash:true,input_hash:true,inputs:true});
export const RecoveryList=z.object({scope:z.literal("local_launch_recovery_exercises"),runs:z.array(RecoverySummary).max(5)}).strict();
