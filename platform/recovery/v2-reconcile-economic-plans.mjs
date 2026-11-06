import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {bindActionRequest} from '../transactions/plan-contracts.mjs';
import {createSwapPlanService} from '../transactions/swap-plan-service.mjs';
import {createQuoteService} from '../quotes/service.mjs';
import {PREPARE_ECONOMIC_PLAN} from '../storage/economic-plans.mjs';
const START=-9007199254740991,need=(ok,reason)=>{if(!ok)throw new TypeError('Recovery economic preparation '+reason);};
const bytes=v=>utf8(canonicalJson(v)).length,hash=(crypto,v)=>crypto.sha256(utf8(canonicalJson(v))),hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const bounded=(field,size,alias=field)=>`CASE WHEN length(CAST(${field} AS BLOB))<=${size} THEN ${field} ELSE NULL END ${alias}`;
const receiptFields=['operation_id','principal_key','operation_kind','business_key','request_key','request_digest','expected_revisions','input_json','result_json','output_digest','result_ref','state'].map(k=>bounded(k,k==='input_json'?4096:k==='result_json'?512:1024)).join(',')+',created_ms';
export const economicPreparationCountsSql=()=>sql(`SELECT
 (SELECT COUNT(*) FROM app_command_receipts WHERE operation_kind='${PREPARE_ECONOMIC_PLAN}') receipts,
 (SELECT COUNT(*) FROM app_economic_intents) intents,(SELECT COUNT(*) FROM app_economic_preparations) preparations,
 (SELECT COUNT(*) FROM app_economic_preparations p JOIN app_command_receipts r ON r.operation_id=p.operation_id WHERE r.operation_kind='${PREPARE_ECONOMIC_PLAN}' AND r.state='committed' AND r.result_ref=p.id AND r.created_ms=p.created_ms) preparation_origins,
 (SELECT COUNT(*) FROM app_economic_intents i JOIN app_command_receipts r ON r.operation_id=i.operation_id JOIN app_economic_preparations p ON p.operation_id=r.operation_id AND p.intent_id=i.id WHERE r.operation_kind='${PREPARE_ECONOMIC_PLAN}' AND r.state='committed' AND r.created_ms=i.created_ms AND r.principal_key='wallet:'||i.wallet AND json_extract(r.result_json,'$.intentId')=i.id AND json_extract(r.input_json,'$.intentKey')=i.intent_key) intent_origins`);
/** Historical verification only: select immutable named quote inputs, never heads,
 * current market presentation, operator grants or today's quote time. */
export async function verifyRecoveredEconomicPreparation(receipt,{read,artifacts,crypto,onWorking=(_n)=>{}}){
 const r=structuredClone(receipt);need(Object.values(r).every(v=>v!==null)&&r.operation_kind===PREPARE_ECONOMIC_PLAN&&r.state==='committed','bounded committed receipt.');
 const input=JSON.parse(r.input_json),result=JSON.parse(r.result_json),versions=JSON.parse(r.expected_revisions);
 need(canonicalJson(input)===r.input_json&&Object.keys(input).sort().join(',')==='intentKey,request'&&typeof input.intentKey==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(input.intentKey),'canonical input.');
 need(Object.keys(versions).sort().join(',')==='control,earn,source'&&Object.values(versions).every(v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&Number.isSafeInteger(Number(v))),'revision identities.');
 need(typeof r.request_key==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(r.request_key)&&r.principal_key.startsWith('wallet:'),'principal or request key.');
 const principal={kind:'wallet',wallet:r.principal_key.slice(7)},bound=await bindActionRequest({principal,request:input.request},crypto);
 need(bound.request.action==='swap'&&r.business_key===canonicalJson([principal.wallet,input.intentKey,r.request_key])&&r.request_digest===await hash(crypto,[PREPARE_ECONOMIC_PLAN,principal.wallet,input]),'command identity.');
 need(Object.keys(result).sort().join(',')==='intentId,planDigest,preparationId'&&Object.values(result).every(hex)&&canonicalJson(result)===r.result_json&&r.output_digest===await hash(crypto,result)&&r.result_ref===result.preparationId,'compact result identity.');
 const [found]=await read([sql(`SELECT p.id,p.intent_id,p.plan_digest,p.plan_request_digest,${bounded('p.plan_json',16384,'plan_json')},p.quoted_ms,p.expires_ms,p.created_ms,p.operation_id,
 ${bounded('i.wallet',64,'wallet')},${bounded('i.intent_key',128,'intent_key')},i.economic_digest,i.action,i.created_ms intent_created_ms FROM app_economic_preparations p JOIN app_economic_intents i ON i.id=p.intent_id WHERE p.id=?`,result.preparationId)]);
 need(found.length===1&&Object.values(found[0]).every(v=>v!==null),'retained preparation.');const p=found[0],plan=JSON.parse(p.plan_json),{planDigest,...body}=plan;
 need(canonicalJson(plan)===p.plan_json&&planDigest===p.plan_digest&&planDigest===result.planDigest&&planDigest===await hash(crypto,body),'plan digest.');
 need(p.intent_id===result.intentId&&p.wallet===principal.wallet&&p.intent_key===input.intentKey&&p.action==='swap'&&p.economic_digest===bound.economicIntentDigest&&plan.economicIntentDigest===bound.economicIntentDigest&&plan.requestDigest===bound.requestDigest&&p.plan_request_digest===bound.requestDigest&&canonicalJson(plan.principal)===canonicalJson(principal)&&canonicalJson(plan.request)===canonicalJson(bound.request),'economic owner/request binding.');
 need(result.intentId===await hash(crypto,['10x.economic-intent.v1',principal.wallet,input.intentKey])&&result.preparationId===await hash(crypto,['10x.economic-preparation.v1',result.intentId,planDigest]),'stable identifiers.');
 need([r.created_ms,p.created_ms,p.intent_created_ms,p.quoted_ms,p.expires_ms].every(v=>Number.isSafeInteger(v)&&v>=0)&&p.intent_created_ms<=p.created_ms&&p.created_ms<=r.created_ms&&p.quoted_ms===plan.quotedAtMs&&p.expires_ms===plan.expiresAtMs&&p.quoted_ms<=p.created_ms&&r.created_ms<p.expires_ms,'historical time.');
 need(plan.wire===null&&plan.wireStatus==='unsupported'&&plan.executable===false&&plan.financialExecution===false&&plan.serverSigning===false&&plan.broadcast===false,'disabled execution.');
 const b=plan.bindings;need(b&&['bindingDigest','inputDigest','receiptDigest'].every(k=>hex(b[k])),'named quote identities.');
 const [contexts]=await read([sql(`SELECT ${['binding_digest','market_id','source_id','source_revision','source_config_digest','stream_key'].map(k=>bounded('b.'+k,k==='stream_key'?512:128,k)).join(',')},${bounded('b.metadata_json',8192,'metadata_json')},b.created_ms,${bounded('b.operation_id',128,'operation_id')},
 ${bounded('s.config_json',16384,'config_json')},${bounded('r.receipt_digest',64,'receipt_digest')},${bounded('r.envelope_json',16384,'envelope_json')},${bounded('r.decision_json',32768,'decision_json')},
 ${bounded('a.byte_digest',64,'byte_digest')},a.size,${bounded('a.content_type',64,'content_type')},${bounded('a.semantic_digest',64,'semantic_digest')},${bounded('i.input_digest',64,'input_digest')},${bounded('i.status',32,'input_status')},${bounded('i.reason',256,'input_reason')},${bounded('i.body_json',32768,'body_json')}
 FROM app_quote_bindings b JOIN app_evidence_sources s ON s.source_id=b.source_id AND s.source_revision=b.source_revision
 JOIN app_evidence_receipts r ON r.receipt_digest=? AND r.source_id=b.source_id AND r.source_revision=b.source_revision AND r.stream_key=b.stream_key
 JOIN app_private_artifacts a ON a.object_key=r.object_key JOIN app_quote_inputs i ON i.input_digest=? AND i.binding_digest=b.binding_digest AND i.receipt_digest=r.receipt_digest
 WHERE b.binding_digest=?`,b.receiptDigest,b.inputDigest,b.bindingDigest)]);
 need(contexts.length===1,'original quote context missing.');const context=contexts[0];need(['metadata_json','config_json','envelope_json','decision_json','body_json'].every(k=>typeof context[k]==='string'),'context bounds.');const metadata=JSON.parse(context.metadata_json),m=metadata.market;
 need(m&&m.id===context.market_id&&m.id===bound.request.parameters.marketId&&Number.isSafeInteger(m.activationMs)&&m.activationMs>=0,'original market metadata.');
 Object.assign(context,{market_body:canonicalJson({id:m.id,attMint:m.attMint,ogMint:m.ogMint,poolAddress:m.poolAddress,activatedAt:new Date(m.activationMs).toISOString()}),original_units:metadata.supply.originalUnits,manifest_digest:metadata.supply.manifestDigest,supply_activation_ms:metadata.supplyActivationMs});
 need(context.binding_digest===await hash(crypto,['quote-binding-v1',context.market_id,context.source_config_digest,metadata])&&context.input_digest===await hash(crypto,['quote-input-v1',context.binding_digest,context.receipt_digest]),'original quote identities.');
 const retained=bytes(r)+bytes(p)+bytes(context)+bytes(plan);onWorking(retained*6);const repository={async readContext(id){need(id===context.market_id,'unexpected market lookup.');return context;}},clock={nowMs:()=>p.quoted_ms},store={async getVerified(identity){const result=await artifacts.getVerified(identity);onWorking(retained*6+(result?.status==='verified'?result.bytes.length*4:0));return result;}};
 const service=createSwapPlanService({quoteRepository:repository,quoteService:createQuoteService({repository,store,crypto,clock}),crypto,clock}),reconstructed=await service.prepare({principal,request:bound.request});
 need(reconstructed.kind==='prepared-economic-plan'&&canonicalJson(reconstructed)===p.plan_json,'historical source/quote derivation.');
 return {operationId:r.operation_id,intentId:result.intentId,preparationId:p.id,planDigest,receiptDigest:r.output_digest,resultDigest:await hash(crypto,['v2-economic-preparation',r.operation_id,r.request_digest,r.output_digest,planDigest])};
}
export function createRecoveryV2EconomicPlanReconciler({driver,artifacts,crypto,repository,onMeasure=(_value)=>{}}){
 return {async step(loaded,c){
  const retained=bytes(loaded)+bytes(c);need(retained<=393216&&bytes(c)<=131072,'checkpoint bound.');let operations=0,readBytes=0,workingBytes=retained*2,maxBatchBytes=0;
  const work=n=>{workingBytes=Math.max(workingBytes,retained*2+n);need(workingBytes<=1048576,'working byte bound.');};
  const read=async statements=>{operations+=statements.length;const m=measureBatch(statements);maxBatchBytes=Math.max(maxBatchBytes,m.batchBytes);need(operations<=56&&m.batchBytes<=262144,'SQL bound.');const out=(await driver.batch(statements)).map(v=>v.rows),size=bytes(out);readBytes+=size;need(size<=196608,'read byte bound.');work(size*4);return out;};
  const [rows]=await read([sql(`SELECT rowid recovery_cursor,${receiptFields} FROM app_command_receipts WHERE operation_kind=? AND rowid>? ORDER BY rowid LIMIT 1`,PREPARE_ECONOMIC_PLAN,c.economicPreparationCursor??START)]);
  let delta,check;
  if(rows.length){const r=rows[0],proof=await verifyRecoveredEconomicPreparation(r,{read,artifacts,crypto,onWorking:work});delta={economicPreparationCursor:r.recovery_cursor,checkedEconomicPreparations:(c.checkedEconomicPreparations??0)+1};check={phase:'economic-preparation',scope:r.operation_id,ordinal:0,resultDigest:proof.resultDigest,itemCount:1};}
  else {const [counts,proofs]=await read([economicPreparationCountsSql(),sql("SELECT COUNT(*) n,COALESCE(SUM(item_count),0) items FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='economic-preparation' AND target_watermark=?",loaded.run.id,c.targetWatermark)]),n=counts[0];need(n.receipts===(c.checkedEconomicPreparations??0)&&proofs[0].n===n.receipts&&proofs[0].items===n.receipts&&n.preparations===n.preparation_origins&&n.intents===n.intent_origins,'complete receipt/origin coverage.');delta={phase:'reconcile-economics',economicPreparationsComplete:true,economicPreparationCursor:null};check={phase:'economic-preparation-count',scope:'complete',ordinal:0,resultDigest:await hash(crypto,['v2-economic-preparation-count',n]),itemCount:n.receipts};}
  onMeasure({operations,readBytes,workingBytes,maxBatchBytes});return repository.advance(loaded,{delta,targetWatermark:c.targetWatermark,check:{...check,targetWatermark:c.targetWatermark}});
 }};
}
