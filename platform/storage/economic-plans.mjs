import {canonicalJson,utf8} from '../security/canonical.mjs';
import {bindActionRequest,ActionPlanInputError} from '../transactions/plan-contracts.mjs';
import {swapPlanContextDigest} from '../transactions/swap-plan-service.mjs';
import {createAtomicReceipts} from './atomic-receipts.mjs';
import {sql,revisions} from './atomic-driver.mjs';
export const PREPARE_ECONOMIC_PLAN='transactions.prepare-economic-plan.v1';
const pending=reason=>({kind:'pending',reason,dependencyIds:[]}),conflict=code=>({kind:'conflict',code});
const exact=(v,keys)=>{if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v))||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)||!Object.getOwnPropertyDescriptor(v,k)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value')))throw new ActionPlanInputError();return Object.fromEntries(keys.map(k=>[k,v[k]]));};
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(v))throw new ActionPlanInputError();return v;};
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const clockTime=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000-30000;
const sourceFence=`EXISTS(SELECT 1 FROM app_quote_heads h JOIN app_quote_bindings b ON b.binding_digest=h.binding_digest
 JOIN app_evidence_sources s ON s.source_id=b.source_id AND s.source_revision=b.source_revision
 JOIN app_evidence_heads eh ON eh.stream_key=b.stream_key JOIN app_evidence_receipts r ON r.receipt_digest=eh.receipt_digest
 JOIN app_private_artifacts a ON a.object_key=r.object_key JOIN app_quote_inputs q ON q.binding_digest=b.binding_digest AND q.receipt_digest=r.receipt_digest
 JOIN market_fixtures m ON m.id=b.market_id JOIN vault_manifests v ON v.id=b.market_id
 WHERE h.market_id=? AND b.binding_digest=? AND b.metadata_json=? AND s.config_json=? AND r.receipt_digest=? AND r.envelope_json=? AND r.decision_json=?
 AND a.byte_digest=? AND a.size=? AND a.content_type=? AND a.semantic_digest IS ? AND q.input_digest=? AND q.status='verified' AND q.body_json=?
 AND m.body=? AND v.original_units=? AND v.digest=? AND v.activated_ms=?)`;
const sourceValues=r=>[r.market_id,r.binding_digest,r.metadata_json,r.config_json,r.receipt_digest,r.envelope_json,r.decision_json,r.byte_digest,r.size,r.content_type,r.semantic_digest,r.input_digest,r.body_json,r.market_body,r.original_units,r.manifest_digest,r.supply_activation_ms];
/** Named private economic preparation only. No executable intent or attempt. */
export function createEconomicPlanRepository(driver,ports){
 const {crypto,clock,swapPlans,quoteRepository}=ports,{read:rows,replay,execute}=createAtomicReceipts(driver,ports),hash=v=>crypto.sha256(utf8(canonicalJson(v))),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 async function read(value){
  const i=exact(value,Object.hasOwn(value??{},'preparationId')?['principal','intentId','preparationId']:['principal','intentId']),p=exact(i.principal,['kind','wallet']);
  // Reuse the canonical principal validator without granting an action.
  const owner=(await bindActionRequest({principal:p,request:{format:'10x.action-request.v1',action:'swap',parameters:{marketId:'read',direction:'buy-att',inputUnits:'1',slippageBps:0},maximumFeeUnits:'0'}},crypto)).principal;
  if(!digest(i.intentId)||(i.preparationId!==undefined&&!digest(i.preparationId)))throw new ActionPlanInputError();
  const pinSql=()=>sql('SELECT s.mode,s.status,s.generation,s.write_nonce,w.revision AS watermark FROM app_recovery_state s CROSS JOIN app_recovery_watermark w WHERE s.id=1 AND w.id=1');
  const [found,pins]=await rows([sql(`SELECT p.id,p.intent_id,p.plan_digest,p.plan_request_digest,CASE WHEN length(CAST(p.plan_json AS BLOB))<=16384 THEN p.plan_json ELSE NULL END plan_json,p.quoted_ms,p.expires_ms,p.created_ms,
   i.wallet,i.intent_key,i.economic_digest,r.state,r.operation_kind,r.principal_key,r.result_ref,CASE WHEN length(CAST(r.result_json AS BLOB))<=512 THEN r.result_json ELSE NULL END result_json,r.output_digest
   FROM app_economic_intents i JOIN app_economic_preparations p ON p.intent_id=i.id JOIN app_command_receipts r ON r.operation_id=p.operation_id
   WHERE i.id=? AND i.wallet=? ${i.preparationId?'AND p.id=?':''} ORDER BY p.created_ms DESC,p.id DESC LIMIT 1`,i.intentId,owner.wallet,...(i.preparationId?[i.preparationId]:[])),pinSql()]);
  if(!found[0])return {kind:'missing'};const r=found[0],pin=pins[0];if(!pin||!['live','private'].includes(pin.mode)||!['live','ready'].includes(pin.status)||pin.write_nonce!==null)return pending('read-only-recovery');
  try{const plan=JSON.parse(r.plan_json),{planDigest,...body}=plan,bound=await bindActionRequest({principal:owner,request:plan.request},crypto),result={intentId:r.intent_id,preparationId:r.id,planDigest:r.plan_digest};
   if(plan.kind!=='prepared-economic-plan'||plan.format!=='10x.swap-economic-plan.v1'||plan.wireStatus!=='unsupported'||plan.principal.kind!=='wallet'||r.intent_id!==await hash(['10x.economic-intent.v1',owner.wallet,r.intent_key])||r.id!==await hash(['10x.economic-preparation.v1',r.intent_id,planDigest])||r.state!=='committed'||r.operation_kind!==PREPARE_ECONOMIC_PLAN||r.principal_key!=='wallet:'+owner.wallet||r.result_ref!==r.id||r.result_json!==canonicalJson(result)||r.output_digest!==await hash(result)||planDigest!==r.plan_digest||planDigest!==await hash(body)||plan.principal.wallet!==owner.wallet||plan.economicIntentDigest!==r.economic_digest||bound.economicIntentDigest!==r.economic_digest||bound.requestDigest!==r.plan_request_digest||plan.requestDigest!==r.plan_request_digest||plan.quotedAtMs!==r.quoted_ms||plan.expiresAtMs!==r.expires_ms||plan.wire!==null||plan.executable!==false||plan.financialExecution!==false||plan.serverSigning!==false||plan.broadcast!==false)return pending('economic-plan-invalid');
   const [after]=await rows([pinSql()]);if(canonicalJson(after[0]??null)!==canonicalJson(pin))return pending('economic-read-changed');
   const now=clock.nowMs();if(!clockTime(now))return pending('economic-clock-unavailable');return {kind:'found',value:{...result,plan,expired:now>=r.expires_ms}};
  }catch(e){if(e instanceof TypeError||e instanceof SyntaxError)return pending('economic-plan-invalid');throw e;}
 }
 async function prepare(value){
  const v=exact(value,['principal','intentKey','requestKey','request']),intentKey=id(v.intentKey),requestKey=id(v.requestKey),bound=await bindActionRequest({principal:v.principal,request:v.request},crypto);
  if(bound.request.action!=='swap')throw new ActionPlanInputError();const principal=bound.principal,input={intentKey,request:bound.request},businessIdentity=canonicalJson([principal.wallet,intentKey,requestKey]),requestDigest=await hash([PREPARE_ECONOMIC_PLAN,principal.wallet,input]);
  const c={principal,operationKind:PREPARE_ECONOMIC_PLAN,businessIdentity,requestKey,requestDigest,input,nowMs:0,expectedRevisions:{}};
  const prior=await replay(c);if(prior)return prior;
  const intentId=await hash(['10x.economic-intent.v1',principal.wallet,intentKey]);
  const [rs,states,intents]=await rows([sql('SELECT name,CAST(revision AS TEXT) revision FROM app_revisions ORDER BY name'),sql('SELECT mode,status,generation,write_nonce FROM app_recovery_state WHERE id=1'),sql('SELECT wallet,economic_digest FROM app_economic_intents WHERE id=?',intentId)]);
  const state=states[0];if(!state||!['live','private'].includes(state.mode)||!['live','ready'].includes(state.status)||state.write_nonce!==null)return pending('read-only-recovery');
  if(rs.length!==3||new Set(rs.map(r=>r.name)).size!==3||rs.some(r=>!['earn','source','control'].includes(r.name)||!/^(0|[1-9][0-9]*)$/.test(r.revision)||!Number.isSafeInteger(Number(r.revision))))return pending('economic-revisions-unavailable');
  if(intents[0]&&(intents[0].wallet!==principal.wallet||intents[0].economic_digest!==bound.economicIntentDigest))return conflict('economic_intent_conflict');
  const raw=await quoteRepository.readContext(bound.request.parameters.marketId);if(!raw)return pending('evidence_unavailable');const text=canonicalJson(raw);if(utf8(text).length>131072)return pending('quote_context_bound');const context=JSON.parse(text);
  const plan=await swapPlans.prepare({principal,request:bound.request});if(plan.kind!=='prepared-economic-plan')return plan;
  const {planDigest,...body}=plan;
  if(plan.requestDigest!==bound.requestDigest||plan.economicIntentDigest!==bound.economicIntentDigest||canonicalJson(plan.principal)!==canonicalJson(principal)||canonicalJson(plan.request)!==canonicalJson(bound.request)||plan.bindings.contextDigest!==await swapPlanContextDigest(context,crypto)||planDigest!==await hash(body))return pending('quote_evidence_changed');
  const planJson=canonicalJson(plan);if(utf8(planJson).length>16384)return pending('swap_plan_bound');const now=clock.nowMs();
  if(!clockTime(now)||now<plan.quotedAtMs||now>=plan.expiresAtMs)return pending('quote_expired');
  const preparationId=await hash(['10x.economic-preparation.v1',intentId,planDigest]),result={intentId,preparationId,planDigest},version=revisions(rs);
  return execute({...c,nowMs:now,expectedRevisions:version},{businessKey:businessIdentity,input,result,resultRef:preparationId,version,
   authoritySql:`EXISTS(SELECT 1 FROM app_recovery_state WHERE id=1 AND generation=? AND mode IN ('live','private') AND status IN ('live','ready') AND write_nonce IS NULL)
    AND ${nowSql}>=? AND ${nowSql}<=? AND ${nowSql}<?
    AND (NOT EXISTS(SELECT 1 FROM app_economic_intents WHERE id=?) OR EXISTS(SELECT 1 FROM app_economic_intents WHERE id=? AND wallet=? AND economic_digest=?)) AND ${sourceFence}`,
   authorityValues:[state.generation,now,now+30000,plan.expiresAtMs,intentId,intentId,principal.wallet,bound.economicIntentDigest,...sourceValues(context)],
   child:(gate,g)=>[
    sql(`INSERT INTO app_economic_intents(id,wallet,intent_key,economic_digest,action,created_ms,operation_id) SELECT ?,?,?,?,'swap',?,? WHERE ${gate} AND NOT EXISTS(SELECT 1 FROM app_economic_intents WHERE id=?)`,intentId,principal.wallet,intentKey,bound.economicIntentDigest,now,g[0],...g,intentId),
    sql(`INSERT INTO app_economic_preparations(id,intent_id,plan_digest,plan_request_digest,plan_json,quoted_ms,expires_ms,created_ms,operation_id) SELECT ?,?,?,?,?,?,?,?,? WHERE ${gate} AND NOT EXISTS(SELECT 1 FROM app_economic_preparations WHERE id=?)`,preparationId,intentId,planDigest,bound.requestDigest,planJson,plan.quotedAtMs,plan.expiresAtMs,now,g[0],...g,preparationId)
   ]});
 }
 return Object.freeze({prepare,read});
}
