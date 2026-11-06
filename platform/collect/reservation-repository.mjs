import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createCollectionContextRepository,createCollectionContextService} from '../storage/collection-context.mjs';
import {createCollectionQuoteRepository} from './quote-repository.mjs';
import {createCollectionQuotePlanning} from '../application/collection-quotes.mjs';
import {COLLECTION_QUOTE_POLICY} from './quote-service.mjs';
import {buildProgressionReservationCommand,RESERVE_COLLECTION_PROGRESSION} from './reservation-service.mjs';
import {period,pressureFromRows,decisionFromRows} from '../operations/portable-controls.mjs';
import {drawRequestPreimage,genesisMs,roundTime} from '../randomness/request-plan.mjs';
const clone=v=>JSON.parse(canonicalJson(v));
const pending=reason=>({kind:'pending',reason,dependencyIds:[]});
const conflict=code=>({kind:'conflict',code});
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,79})$/.test(v);
const requireValue=(c,message)=>{if(!c)throw new TypeError(message);};
function controls(scopeRows,usage,spend,now){
 if(scopeRows.length>1||scopeRows.some(r=>![0,1].includes(r.paused)||!time(r.at_ms)||r.at_ms>now)
  ||usage.some(r=>!decimal(r.measured)||!time(r.at_ms)||r.at_ms>now||!['new-monthly-usd','daily-provider-units'].includes(r.metric)||(r.metric==='daily-provider-units'&&(!decimal(r.quota)||BigInt(r.quota)===0n)))
  ||spend.some(r=>!['reserved','settled'].includes(r.status)||!time(r.at_ms)||r.at_ms>now||!decimal(r.limit_usd_micros)||(r.status==='settled'&&(!decimal(r.actual_usd_micros)||!time(r.settled_ms)))))return {allowed:false,reason:'operating-input-invalid'};
 const pressure=pressureFromRows(usage,spend,now);if(!['ready','pending'].includes(pressure.status))return {allowed:false,reason:'operating-decision-unavailable'};
 const decision=decisionFromRows('collection-progression',scopeRows[0],pressure);return decision?.allowed===true?decision:{allowed:false,reason:decision?.reason??'operating-decision-unavailable'};
}
/** Private command adapter. This reserves local rows only, never chain custody. */
export function createProgressionReservationRepository(driver,ports){
 const {crypto,clock,ids}=ports,{replay,execute}=createAtomicReceipts(driver,ports),quotes=createCollectionQuoteRepository(driver,ports),planning=createCollectionQuotePlanning({crypto}),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 async function capturedCommand(value){
  const c=clone(value);requireValue(c&&Object.keys(c).length===6&&c.operationKind===RESERVE_COLLECTION_PROGRESSION,'Invalid progression reservation command.');
  const expected=await buildProgressionReservationCommand(c.principal,{requestKey:c.requestKey,...c.input},crypto);requireValue(canonicalJson(c)===canonicalJson(expected),'Reservation request digest or identity mismatch.');return c;
 }
 return Object.freeze({async reserve(value){
  const c=await capturedCommand(value),prior=await replay(c);if(prior)return prior;const i=c.input;
  const stored=await quotes.readQuote(c.principal,i.quoteId);if(stored.kind!=='found')return pending(stored.kind==='missing'?'stored-quote-missing':stored.reason);
  const now=clock.nowMs();if(!time(now))return pending('reservation-clock-unavailable');
  const request={kind:i.kind,targetId:i.targetId,materialId:i.materialId,expectedTargetVersion:i.expectedTargetVersion,expectedMaterialVersion:i.expectedMaterialVersion};let extra;
  // Extend this one bounded context snapshot with its authority inputs. The
  // context reader still validates the same exact named participant DTO.
  const snapshotDriver={...driver,async batch(statements){
   requireValue(statements.length===3,'Unexpected collection context query plan.');
   const result=await driver.batch([...statements,
    sql("SELECT revision,paused,at_ms FROM ops_scope_log WHERE scope='collection-progression' AND at_ms<=? ORDER BY at_ms DESC LIMIT 1",now),
    sql(`SELECT * FROM ops_usage u WHERE u.at_ms<=? AND NOT EXISTS(SELECT 1 FROM ops_usage n WHERE n.provider=u.provider AND n.metric=u.metric AND (u.metric='new-monthly-usd' OR n.period=u.period) AND n.at_ms>u.at_ms AND n.at_ms<=?) AND (u.metric='new-monthly-usd' OR u.period=?) ORDER BY u.provider LIMIT 101`,now,now,period(now)),
    sql("SELECT * FROM ops_optional_spend WHERE at_ms<=? AND (status='reserved' OR COALESCE(settled_ms,at_ms)>=?) LIMIT 101",now,Date.parse(period(now,true)+'-01T00:00:00Z')),
    sql('SELECT policy_hash,registered_ms FROM fair_inventories WHERE inventory_id=?',i.inventoryId),
    sql('SELECT id FROM collect_operations WHERE owner=? AND request_key=?',c.principal.wallet,c.requestKey),
   ]);extra=result.slice(3).map(r=>r.rows);return result.slice(0,3);
  }};
  const facts=await createCollectionContextService({repository:createCollectionContextRepository(snapshotDriver),clock:{nowMs:()=>now}}).read(c.principal,{inventoryId:i.inventoryId,request});
  if(!extra||utf8(canonicalJson(extra)).length>131072)return pending('reservation-authority-byte-bound');
  const [scope,usage,spend,policies,old]=extra;if(old.length)return conflict('legacy_operation_key');
  if(facts.kind!=='ready')return pending(facts.reason);
  const decision=controls(scope,usage,spend,now);if(decision.allowed!==true)return pending(decision.reason);
  const policy=policies[0]??null;if(policies.length>1||policy&&(!/^[a-f0-9]{64}$/.test(policy.policy_hash)||!time(policy.registered_ms)||policy.registered_ms<genesisMs||policy.registered_ms>now))return pending('fairness-policy-unavailable');
  const operationId=ids.next(),commitment=ids.next();requireValue(id(operationId)&&id(commitment),'Server reservation identities unavailable.');const command={...c,nowMs:now,expectedRevisions:facts.revisions};let plan;
  try{plan=await planning.accept(command,stored.quote,facts.context,{policyVersion:COLLECTION_QUOTE_POLICY,operationId,commitment});}
  catch(error){if(typeof error.code==='string')return pending(error.code);throw error;}
  let fair=null;if(policy){const request=drawRequestPreimage(policy,{opId:operationId,kind:i.kind,inventoryId:i.inventoryId,owner:c.principal.wallet,commitment,now});fair={policyHash:policy.policy_hash,registeredMs:policy.registered_ms,targetRound:request.targetRound,contextDigest:await crypto.sha256(utf8(canonicalJson(request.preimage)))};}
  const quote=stored.quote,operationJson=canonicalJson({...plan.operation,feeLamports:{$lamports:plan.operation.feeLamports}}),assets=new Map(plan.assetWrites.map(a=>[a.id,canonicalJson(a)])),targetJson=assets.get(i.targetId),materialJson=i.materialId===null?null:assets.get(i.materialId);
  requireValue(targetJson&&assets.size===(i.kind==='upgrade'?2:1)&&[...assets.values()].every(v=>utf8(v).length<=16384),'Invalid reserved asset effects.');
  const result={operationId,inventoryId:i.inventoryId,wallet:c.principal.wallet,kind:i.kind,targetId:i.targetId,materialId:i.materialId,quoteId:quote.id,bindingDigest:quote.bindingDigest,feeLamports:quote.feeLamports,maxTotalLamports:quote.maxTotalLamports,createdMs:now,status:'awaiting-evidence',fairness:fair?'configured-offline-beacon':'manual-fixture',source:'local-fixture',executable:false},resultJson=canonicalJson(result);
  if(clock.nowMs()<now||clock.nowMs()>=quote.expiresMs)return pending('quote-expired-before-reservation');
  if(fair&&clock.nowMs()>=roundTime(fair.targetRound))return pending('fairness-window-expired');
  const authority=[`${nowSql}>=? AND ${nowSql}<?`,
   `strftime('%Y-%m-%d',${nowSql}/1000.0,'unixepoch')=?`,
   "EXISTS(SELECT 1 FROM app_collection_quotes WHERE id=? AND wallet=? AND binding_digest=? AND body_json=?)",
   "NOT EXISTS(SELECT 1 FROM app_collection_reservations WHERE quote_id=?)",
   "NOT EXISTS(SELECT 1 FROM collect_operations WHERE owner=? AND request_key=?)",
   "EXISTS(SELECT 1 FROM collect_inventories WHERE id=? AND kind='season' AND season_start=? AND revision=?)",
   ...facts.context.assets.map(()=>`EXISTS(SELECT 1 FROM collect_assets WHERE id=? AND inventory_id=? AND owner=? AND reveal_ms IS NOT NULL AND reveal_ms<=? AND observed_ms<=? AND json_valid(asset) AND json_extract(asset,'$.version')=? AND json_extract(asset,'$.pending') IS NULL)`),
   `COALESCE((SELECT paused FROM ops_scope_log WHERE scope='collection-progression' AND at_ms<=${nowSql} ORDER BY at_ms DESC LIMIT 1),0)=0`,
   `NOT EXISTS(SELECT 1 FROM ops_scope_log WHERE scope='collection-progression' AND at_ms>? AND at_ms<=${nowSql})`,
   `NOT EXISTS(SELECT 1 FROM ops_usage WHERE at_ms>? AND at_ms<=${nowSql})`,
   `NOT EXISTS(SELECT 1 FROM ops_optional_spend WHERE (at_ms>? AND at_ms<=${nowSql}) OR (settled_ms>? AND settled_ms<=${nowSql}))`,
   ...(fair?[`${nowSql}<?`]:[]),
   fair?'EXISTS(SELECT 1 FROM fair_inventories WHERE inventory_id=? AND policy_hash=? AND registered_ms=?)':'NOT EXISTS(SELECT 1 FROM fair_inventories WHERE inventory_id=?)',
  ].join(' AND ');
  const values=[now,quote.expiresMs,period(now),quote.id,c.principal.wallet,quote.bindingDigest,canonicalJson(quote),quote.id,c.principal.wallet,c.requestKey,i.inventoryId,facts.context.start,Number(facts.inventoryRevision),...facts.context.assets.flatMap(a=>[a.id,i.inventoryId,c.principal.wallet,now,now,a.version]),now,now,now,now,...(fair?[roundTime(fair.targetRound),i.inventoryId,fair.policyHash,fair.registeredMs]:[i.inventoryId])];
  const outcome=await execute(command,{businessKey:c.businessIdentity,input:i,result,resultRef:operationId,version:facts.revisions,authoritySql:authority,authorityValues:values,child:(gate,v)=>[
   sql(`INSERT INTO collect_operations(id,kind,inventory_id,owner,request_key,request_digest,commitment,created_ms,operation) SELECT ?,?,?,?,?,?,?,?,? WHERE ${gate}`,operationId,i.kind,i.inventoryId,c.principal.wallet,c.requestKey,c.requestDigest,commitment,now,operationJson,...v),
   ...facts.context.assets.map(a=>sql(`UPDATE collect_assets SET asset=?,observed_ms=? WHERE id=? AND owner=? AND inventory_id=? AND observed_ms<=? AND json_extract(asset,'$.version')=? AND json_extract(asset,'$.pending') IS NULL AND ${gate}`,assets.get(a.id),now,a.id,c.principal.wallet,i.inventoryId,now,a.version,...v)),
   ...(fair?[sql(`INSERT INTO fair_requests SELECT ?,?,? WHERE ${gate}`,operationId,fair.targetRound,fair.contextDigest,...v)]:[]),
   sql(`INSERT INTO app_collection_reservations(operation_id,quote_id,quote_binding_digest,target_id,material_id,target_after_json,material_after_json,operation_json,fair_policy_hash,fair_registered_ms,target_round,context_digest,command_operation_id,result_json) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,operation_id,? FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,operationId,quote.id,quote.bindingDigest,i.targetId,i.materialId,targetJson,materialJson,operationJson,fair?.policyHash??null,fair?.registeredMs??null,fair?.targetRound??null,fair?.contextDigest??null,resultJson,...v,...v),
  ]});
  if(outcome.kind==='conflict'&&(clock.nowMs()<now||clock.nowMs()>=quote.expiresMs))return pending('quote-expired-before-reservation');
  if(outcome.kind==='conflict'&&fair&&clock.nowMs()>=roundTime(fair.targetRound))return pending('fairness-window-expired');return outcome;
 }});
}
