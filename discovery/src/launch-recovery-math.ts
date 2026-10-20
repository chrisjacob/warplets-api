import type {z} from "zod";
import {RECOVERY_REVISION,RecoveryScenario,RecoveryResult,RecoveryStep,type RecoveryInput,type RecoveryJournal,type RecoveryState} from "./launch-recovery-model";

export class RecoveryError extends Error {constructor(message:string,readonly status=400){super(message);}}
export function evaluateRecovery(raw:unknown){
  const input=RecoveryScenario.parse(raw);
  // Journal and mock source are separate model state. Restart retains both; only read freshness is lost.
  const steps=RecoveryStep.options.map(step=>({step,idempotency_key:`${input.edition_alias}/${step}`,phase:"not_started" as z.infer<typeof RecoveryJournal>["phase"],attempts:0,tx_alias:null as string|null,receipts:[] as z.infer<typeof RecoveryJournal>["receipts"],effects:0,uncertain:false,generation:-1,observed_revision:-1,retry:false}));
  let generation=0,revision=0,restarts=0,announcements=0,paused=false,aborted=false,configurationConflict=false;
  let verification:{generation:number;revision:number}|null=null;
  const preflight=Object.values(input.assumed_preflight).every(Boolean),last=(p:typeof steps[number])=>p.receipts.at(-1);
  const sourceRevision=(p:typeof steps[number])=>Math.max(0,...p.receipts.map(r=>r.revision));
  const fresh=(p:typeof steps[number])=>p.generation===generation&&p.observed_revision===sourceRevision(p);
  const complete=(p:typeof steps[number])=>p.phase==="confirmed"&&fresh(p)&&!p.uncertain&&last(p)?.status==="finalized"&&last(p)?.configuration_matches&&last(p)?.resource_matches;
  const healthy=()=>!paused&&!aborted&&!configurationConflict&&preflight&&!steps.some(p=>p.uncertain||p.phase==="conflict");
  const verified=()=>healthy()&&steps.every(complete)&&verification?.generation===generation&&verification.revision===revision;
  const current=()=>steps.find(p=>!complete(p));
  function modeledState():z.infer<typeof RecoveryState>{
    if(aborted)return "ABORTED";if(paused||!preflight)return "BLOCKED";
    if(configurationConflict||steps.some(p=>p.uncertain||p.phase==="uncertain"||p.phase==="conflict"||p.phase==="failed"||p.phase==="submitted"||(p.phase==="confirmed"&&!fresh(p))))return "RECOVERY_REQUIRED";
    if(verified())return announcements?"ACTIVE":"LOCKS_VERIFIED";
    if(announcements)return "RECOVERY_REQUIRED";
    const count=steps.findIndex(p=>!complete(p));return (["FUNDED","TOKEN_CREATED","NATIVE_POOL_CREATED","OG_POOL_CREATED","TENX_POOL_CREATED","TENX_POOL_CREATED"] as const)[count<0?5:count]!;
  }
  function apply(event:RecoveryInput["events"][number]):string{
    if(event.kind==="restart"){
      generation++;restarts++;verification=null;for(const p of steps)if(p.phase==="ready")p.phase="intent";
      return "restart_preserved_journal_reconciliation_required";
    }
    if(event.kind==="pause"){paused=true;generation++;verification=null;return "paused_no_principal_change";}
    if(event.kind==="resume"){paused=false;generation++;verification=null;return "resumed_verification_required";}
    if(event.kind==="abort"){aborted=true;verification=null;return "aborted_existing_resources_preserved";}
    if(event.kind==="configuration_change"){
      if(event.fingerprint!==input.configuration_fingerprint){configurationConflict=true;verification=null;return "configuration_conflict_frozen_identity_held";}
      return "configuration_unchanged";
    }
    if(event.kind==="chain_status"){
      const p=steps.find(p=>p.step===event.step)!,receipt=p.receipts[event.attempt-1];if(!receipt)return "ignored_no_mock_transaction";
      if(receipt.status===event.status)return "duplicate_source_observation";
      if(receipt!==last(p)||receipt.status==="failed"&&event.status==="finalized")p.uncertain=true;
      if(receipt.effect_applied&&event.status!=="finalized")p.uncertain=true;
      if(event.status==="missing")p.uncertain=true;
      receipt.status=event.status;receipt.revision=++revision;verification=null;
      if(event.status==="finalized"&&!receipt.effect_applied){receipt.effect_applied=true;p.effects++;}
      return p.uncertain?"source_changed_manual_recovery_required":"mock_transaction_status_changed";
    }
    if(event.kind==="reconcile"){
      const p=steps.find(p=>p.step===event.step)!;
      if(complete(p))return "already_reconciled_no_new_effect";
      if(p!==current()||p.phase==="not_started")return "ignored_out_of_order_reconciliation";
      p.generation=generation;p.observed_revision=sourceRevision(p);
      const receipt=last(p);
      if(!receipt){p.phase="ready";return "mock_absence_confirmed_ready";}
      p.tx_alias=receipt.tx_alias;
      if(p.uncertain||receipt.status==="missing"){p.phase="uncertain";return "ambiguous_receipt_retry_held";}
      if(!receipt.configuration_matches||!receipt.resource_matches){p.phase="conflict";return "receipt_identity_or_configuration_conflict";}
      if(receipt.status==="finalized"){p.phase="confirmed";return "finalized_effect_recovered_without_resubmit";}
      if(receipt.status==="pending"){p.phase="submitted";return "pending_transaction_retry_held";}
      if(p.retry&&p.attempts<2&&!receipt.effect_applied){p.phase="ready";return "known_failed_absence_ready_for_explicit_retry";}
      p.phase="failed";return "known_failure_requires_explicit_retry";
    }
    if(event.kind==="verify"){
      verification=null;
      if(!healthy()||!steps.every(complete))return "verification_held_incomplete_or_stale_steps";
      if(!event.deployment_matches||!event.permanent_locks||!event.fee_rights)return "critical_deployment_lock_or_fee_check_missing";
      verification={generation,revision};return "hypothetical_critical_checks_passed";
    }
    if(event.kind==="announce"){
      if(!verified())return "announcement_held_unverified_or_disabled";
      if(announcements)return "duplicate_announcement_suppressed";
      announcements=1;return "modeled_announcement_only_nothing_published";
    }
    if(!healthy())return "mutation_held_preflight_pause_abort_or_conflict";
    const p=current();
    if(event.kind==="tick"){
      if(!p)return verified()?"ready_for_modeled_announcement":"all_steps_need_critical_verification";
      if(p.phase==="not_started")p.phase="intent";
      return p.phase==="ready"&&fresh(p)?"mock_submission_allowed":"reconcile_before_any_submission_or_retry";
    }
    if(event.kind==="retry_failed"){
      const target=steps.find(p=>p.step===event.step)!,receipt=last(target);
      if(target!==p||target.phase!=="failed"||!fresh(target)||receipt?.status!=="failed"||receipt.effect_applied||target.attempts>=2)return "retry_held_no_certified_failure_or_attempt_cap";
      target.retry=true;target.phase="intent";target.generation=-1;return "explicit_retry_still_requires_reconciliation";
    }
    if(event.kind==="submit"){
      const target=steps.find(p=>p.step===event.step)!,prior=last(target);
      if(target!==p||target.phase!=="ready"||!fresh(target)||target.attempts>=2||prior&&(prior.status!=="failed"||!target.retry||prior.effect_applied))return "submission_held_missing_fresh_intent_or_existing_effect";
      target.attempts++;target.retry=false;verification=null;
      const receipt={tx_alias:`sim-tx-${target.step}-${target.attempts}`,status:event.outcome,configuration_matches:event.configuration_matches,resource_matches:event.resource_matches,effect_applied:event.outcome==="finalized",revision:++revision};
      target.receipts.push(receipt);if(receipt.effect_applied)target.effects++;
      target.phase=event.lose_response?"uncertain":"submitted";target.tx_alias=event.lose_response?null:receipt.tx_alias;
      // Lost acknowledgement alone is recoverable. Disappeared/contradictory source evidence is not.
      return event.lose_response?"mock_broadcast_ack_lost_reconcile_not_resubmit":"mock_broadcast_recorded_reconciliation_required";
    }
    return "ignored_event";
  }
  const trace=input.events.map((event,index)=>{const outcome=apply(event);return {index,event:event.kind,outcome,modeled_state:modeledState(),phases:steps.map(p=>p.phase),submissions:steps.reduce((s,p)=>s+p.attempts,0),effects:steps.reduce((s,p)=>s+p.effects,0),announcements};});
  return RecoveryResult.parse({version:RECOVERY_REVISION,revision:RECOVERY_REVISION,scope:"hypothetical_launch_recovery_exercise",as_of:input.as_of,modeled_state:modeledState(),steps:steps.map(({generation:_g,observed_revision:_r,retry:_retry,...p})=>p),restarts,modeled_announcements:announcements,trace,
    launch_enabled:false,signing_enabled:false,publishing_enabled:false,chain_evidence_verified:false,provider_requests:0,
    gaps:["all_preflight_guards_receipts_finality_locks_and_fee_rights_are_assumed","mock_source_and_journal_are_in_memory_during_evaluation","saved_exercise_is_not_a_production_execution_journal","no_real_chain_reconciliation_or_blockhash_expiry_proof","actual_signer_custody_locks_and_partial_launch_recovery_unverified","no_real_publication_or_active_spotlight","no_principal_withdrawal_or_rollback_action","D08_D09_D10_D14_D15_D16_D18_open"]});
}

export function recoveryExample(kind:"lost_response"|"missing_lock"|"reorg"|"configuration"="lost_response"):RecoveryInput{
  const events:RecoveryInput["events"]=[];
  for(const [i,step] of RecoveryStep.options.entries()){
    events.push({kind:"tick"},{kind:"reconcile",step},{kind:"submit",step,outcome:"finalized",lose_response:i===0,configuration_matches:true,resource_matches:true});
    if(i===0)events.push({kind:"restart"},{kind:"tick"},{kind:"submit",step,outcome:"finalized",lose_response:false,configuration_matches:true,resource_matches:true});
    events.push({kind:"reconcile",step});
  }
  events.push({kind:"verify",deployment_matches:true,permanent_locks:kind!=="missing_lock",fee_rights:true});
  if(kind==="reorg")events.push({kind:"chain_status",step:"create_token",attempt:1,status:"missing"},{kind:"tick"},{kind:"reconcile",step:"create_token"});
  if(kind==="configuration")events.push({kind:"configuration_change",fingerprint:"b".repeat(64)},{kind:"tick"});
  events.push({kind:"announce"},{kind:"announce"});
  return RecoveryScenario.parse({version:RECOVERY_REVISION,as_of:new Date().toISOString(),edition_alias:"sim_edition",configuration_fingerprint:"a".repeat(64),assumed_preflight:{winner_frozen:true,simulation_passed:true,budget_funded:true,same_chain_tenx_ready:true},events});
}
