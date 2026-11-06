import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {prepareConfigAudit} from '../storage/atomic-audit.mjs';
import {buildActionPolicyCommand,CONFIGURE_ACTION} from '../earn/action-policy-service.mjs';
const need=(ok,message)=>{if(!ok)throw new TypeError('Recovery action policy '+message);};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const bounded=(column,size)=>`CASE WHEN length(CAST(${column} AS BLOB))<=${size} THEN ${column} ELSE NULL END ${column}`;
/** Verify one historical accepted policy at a time; never compare to today's epoch. */
export async function verifyRecoveredActionPolicy(receipt,read,crypto){
 const r=structuredClone(receipt);need(r.operation_kind===CONFIGURE_ACTION&&r.state==='committed','receipt state.');
 const envelope=JSON.parse(r.input_json),{audit,...input}=envelope;need(same(envelope,JSON.parse(canonicalJson(envelope)))&&canonicalJson(envelope)===r.input_json,'canonical envelope.');
 need(audit&&Object.keys(audit).length===5&&Number.isSafeInteger(audit.seq)&&audit.seq>0&&audit.recordedMs===r.created_ms,'audit metadata.');
 need(typeof r.principal_key==='string'&&r.principal_key.startsWith('operator:'),'principal.');
 const principal={kind:'operator',id:r.principal_key.slice(9)},command=await buildActionPolicyCommand({principal,requestKey:r.request_key,input,nowMs:r.created_ms,expectedRevisions:JSON.parse(r.expected_revisions)},crypto);
 need(command.businessIdentity===r.business_key&&r.result_ref===r.business_key&&command.requestDigest===r.request_digest&&input.effectiveEpoch>Math.floor(r.created_ms/86400000),'command identity or historical time.');
 const result={actionId:input.actionId,effectiveEpoch:input.effectiveEpoch,enabled:input.enabled,source:'local-fixture',executable:false};
 need(r.result_json===canonicalJson(result)&&r.output_digest===await crypto.sha256(utf8(r.result_json)),'result identity.');
 const [policies,audits]=await read([
  sql(`SELECT CASE WHEN length(CAST(c.label AS BLOB))<=1024 THEN c.label ELSE NULL END label,CASE WHEN length(CAST(c.verifier AS BLOB))<=1024 THEN c.verifier ELSE NULL END verifier,p.enabled,p.recorded_ms FROM earn_action_catalog c JOIN earn_action_changes p ON p.action_id=c.id WHERE c.id=? AND p.effective_epoch=?`,input.actionId,input.effectiveEpoch),
  sql(`SELECT seq,${bounded('previous_hash',64)},${bounded('event_hash',64)},${bounded('category',64)},${bounded('entity',1024)},${bounded('change_key',256)},recorded_ms,${bounded('actor',128)},${bounded('evidence_ref',1024)},${bounded('payload',16384)} FROM ops_config_audit WHERE seq IN (?,?) ORDER BY seq`,audit.seq,audit.seq-1)
 ]);
 need(policies.length===1&&policies[0].label===input.label&&policies[0].verifier===input.verifier&&policies[0].enabled===Number(input.enabled)&&policies[0].recorded_ms===r.created_ms,'immutable policy binding.');
 const row=audits.find(v=>v.seq===audit.seq),previous=audits.find(v=>v.seq===audit.seq-1);
 need(row&&audits.length===(audit.seq===1?1:2)&&(audit.seq===1?audit.previousHash===null:previous?.event_hash===audit.previousHash),'audit predecessor.');
 const event={category:'action-policy',entity:input.actionId,changeKey:String(input.effectiveEpoch),atMs:r.created_ms,actor:principal.id,evidenceRef:input.evidenceRef,payload:{label:input.label,verifier:input.verifier,enabled:input.enabled,effectiveEpoch:input.effectiveEpoch}},expected=await prepareConfigAudit(previous??null,event,crypto);
 need(same(audit,expected)&&row.previous_hash===expected.previousHash&&row.event_hash===expected.eventHash&&row.payload===expected.payload&&row.category===event.category&&row.entity===event.entity&&row.change_key===event.changeKey&&row.recorded_ms===event.atMs&&row.actor===event.actor&&row.evidence_ref===event.evidenceRef,'audit binding.');
 return command;
}
export function createRecoveryV2ActionPolicyReconciler({driver,crypto,repository}){
 const read=async statements=>(await driver.batch(statements)).map(r=>r.rows);
 return {async step(loaded,c){
  const [rows]=await read([sql(`SELECT rowid recovery_cursor,operation_kind,state,${['principal_key','business_key','request_key','request_digest','expected_revisions','input_json','result_json','output_digest','result_ref'].map(k=>bounded(k,k.endsWith('_json')?16384:1024)).join(',')},created_ms FROM app_command_receipts WHERE operation_kind=? AND rowid>? ORDER BY rowid LIMIT 1`,CONFIGURE_ACTION,c.actionPolicyCursor??-9007199254740991)]);
  let delta,check;
  if(rows.length){const r=rows[0];need(Object.values(r).every(v=>v!==null),'bounded receipt.');await verifyRecoveredActionPolicy(r,read,crypto);delta={actionPolicyCursor:r.recovery_cursor,checkedActionPolicies:(c.checkedActionPolicies??0)+1};check={phase:'action-policy',scope:r.business_key,ordinal:0,resultDigest:r.output_digest,itemCount:1};}
  else {const [counts]=await read([sql('SELECT COUNT(*) n FROM app_command_receipts WHERE operation_kind=?',CONFIGURE_ACTION)]);need(counts[0].n===(c.checkedActionPolicies??0),'receipt count.');delta={phase:'reconcile-economics',boardCursor:-9007199254740991,checkedBoards:0};check={phase:'action-policy-count',scope:'receipts',ordinal:0,resultDigest:await crypto.sha256(utf8(canonicalJson(['action-policy-count',counts[0].n]))),itemCount:counts[0].n};}
  return repository.advance(loaded,{delta,targetWatermark:c.targetWatermark,check:{...check,targetWatermark:c.targetWatermark}});
 }};
}
