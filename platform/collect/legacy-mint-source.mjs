import {createLegacyAdmissionSource} from './legacy-admission-source.mjs';
import {committedCollectionSourceSealSql} from './source-seal-guard.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
const size=v=>utf8(canonicalJson(v)).length,clone=v=>JSON.parse(canonicalJson(v)),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const held=reason=>({kind:'held',reason}),id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v),digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
// Bound complete JSON projections before transport, including escaped strings.
const projection=(table,fields,where,values,max=16384)=>{const body=`json_object(${fields.flatMap(([key,column])=>["'"+key+"'",column]).join(',')})`;return sql(`SELECT ${body} body FROM ${table} WHERE ${where} AND length(CAST(${body} AS BLOB))<=${max}`, ...values);};
const parse=rows=>rows.map(row=>JSON.parse(row.body));
const pinSql=`SELECT c.id inventoryId,CAST(c.revision AS TEXT) sourceRevision,r.generation,w.revision watermark FROM app_collection_source_seals s JOIN collect_inventories c ON c.id=s.inventory_id AND CAST(c.revision AS TEXT)=s.source_revision CROSS JOIN app_recovery_state r CROSS JOIN app_recovery_watermark w WHERE s.id=? AND ${committedCollectionSourceSealSql('s')} AND r.id=1 AND w.id=1 AND r.mode IN ('live','private') AND r.status IN ('live','ready') AND r.write_nonce IS NULL AND length(CAST(r.generation AS BLOB))<=256`;
/** Retained database facts only. The private caller still supplies an original
 * manual fixture or original configured policy parts to the27 cryptographic
 * audit. Current mutable NFT fields are deliberately never selected. */
export function createLegacyMintSource({driver,crypto}){return Object.freeze({async read(input){
 const request=clone(input),metrics={sql:0,maxBatchBytes:0,maxReturnedBytes:0,workingBytes:0};
 const measured={async batch(statements){const batch=measureBatch(statements);metrics.sql+=batch.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,batch.batchBytes);if(metrics.sql>64)throw new TypeError('Legacy mint source query bound');const results=await driver.batch(statements);metrics.maxReturnedBytes=Math.max(metrics.maxReturnedBytes,size(results));return results;}};
 const admission=await createLegacyAdmissionSource({driver:measured,crypto}).read(request);if(admission.kind!=='verified')return admission;
 const operation=admission.operation;if(!time(operation.settled_ms)||!id(operation.proof_id)||!digest(operation.evidence_digest)||typeof operation.receipt!=='string')return held('legacy-mint-source-not-settled');
 let receipt;try{receipt=JSON.parse(operation.receipt);}catch{return held('legacy-mint-source-receipt');}
 if(!receipt||!id(receipt.assetId)||operation.receipt!==JSON.stringify({operationId:operation.id,assetId:receipt.assetId,at:operation.settled_ms}))return held('legacy-mint-source-receipt');
 const key=receipt.assetId,op=operation.id,inventoryId=operation.inventory_id;
 const statements=[
  projection('collect_inventories',[['id','id'],['kind','kind'],['tranche','tranche'],['seasonStart','season_start'],['originDigest','origin_digest']],'id=?',[inventoryId],1024),
  projection('collect_assets',[['id','id'],['inventory_id','inventory_id'],['bind_ms','bind_ms'],['slot','slot']],'id=?',[key],2048),
  projection('vault_assets',[['id','id'],['slot_key','slot_key'],['coords','coords']],'id=?',[key],4096),
  projection('vault_observations',[['event_id','event_id'],['asset_id','asset_id'],['kind','kind'],['observed_ms','observed_ms'],['body','body']],'event_id=?',['collect:'+op],8192),
  projection('collect_level_history',[['asset_id','asset_id'],['effective_ms','effective_ms'],['level','level'],['source_ref','source_ref']],'source_ref=? AND (SELECT COUNT(*) FROM collect_level_history WHERE source_ref=?)<=1',[op,op],2048),
  sql('SELECT COUNT(*) count FROM collect_level_history WHERE source_ref=?',op),
  projection('fair_inventories',[['inventoryId','inventory_id'],['policyHash','policy_hash'],['registeredMs','registered_ms']],'inventory_id=?',[inventoryId],1024),
  projection('fair_requests',[['operationId','operation_id'],['targetRound','target_round'],['contextDigest','context_digest']],'operation_id=?',[op],1024),
  projection('fair_results',[['operationId','operation_id'],['proofId','proof_id'],['signedRoundJson','signed_round'],['fixtureJson','fixture'],['settledMs','settled_ms']],'operation_id=?',[op],16384),
  sql('SELECT (SELECT COUNT(*) FROM fair_inventories WHERE inventory_id=?) policy,(SELECT COUNT(*) FROM fair_requests WHERE operation_id=?) request,(SELECT COUNT(*) FROM fair_results WHERE operation_id=?) result',inventoryId,op,op)
 ];
 const results=await measured.batch(statements),[headers,collect,vault,observations,history]=results.slice(0,5).map(r=>parse(r.rows));
 const policies=parse(results[6].rows),requests=parse(results[7].rows),draws=parse(results[8].rows),counts=results[9].rows[0];
 if(headers.length!==1||collect.length!==1||vault.length!==1||observations.length!==1||results[5].rows.length!==1||results[5].rows[0].count!==history.length||!counts)return held('legacy-mint-source-missing-or-oversized');
 const header=headers[0],binding=collect[0],vaultBinding=vault[0],observation=observations[0];
 if(header.id!==inventoryId||!['genesis','season'].includes(header.kind)||!digest(header.originDigest)||header.originDigest!==await crypto.sha256(utf8(JSON.stringify([header.id,header.kind,header.tranche,header.seasonStart]))))return held('legacy-mint-source-header');
 if(header.kind==='genesis'?(header.seasonStart!==null||!Number.isInteger(header.tranche)||header.tranche<1||header.tranche>10||history.length!==0):(header.tranche!==null||!time(header.seasonStart)||history.length!==1))return held('legacy-mint-source-header-history');
 if(binding.id!==key||binding.inventory_id!==inventoryId||binding.bind_ms!==operation.settled_ms||vaultBinding.id!==key||observation.event_id!=='collect:'+op||observation.asset_id!==key||observation.kind!=='bind'||observation.observed_ms!==operation.settled_ms)return held('legacy-mint-source-binding');
 if(history.some(h=>h.asset_id!==key||h.source_ref!==op||h.effective_ms!==operation.settled_ms||!Number.isInteger(h.level)||h.level<1||h.level>10))return held('legacy-mint-source-history');
 let configured=null;
 if(counts.policy||counts.request||counts.result){if(counts.policy!==1||counts.request!==1||counts.result!==1||policies.length!==1||requests.length!==1||draws.length!==1)return held('legacy-mint-source-configured-incomplete');const policy=policies[0],request=requests[0],result=draws[0];if(policy.inventoryId!==inventoryId||!digest(policy.policyHash)||!time(policy.registeredMs)||policy.registeredMs>operation.created_ms||request.operationId!==op||!Number.isSafeInteger(request.targetRound)||request.targetRound<=0||!digest(request.contextDigest)||result.operationId!==op||result.proofId!==operation.proof_id||!time(result.settledMs)||result.settledMs<operation.settled_ms||typeof result.signedRoundJson!=='string'||utf8(result.signedRoundJson).length>2048||typeof result.fixtureJson!=='string'||utf8(result.fixtureJson).length>4096)return held('legacy-mint-source-configured-identity');configured={policy,request,result};}
 const facts={header,operation,collectBinding:binding,vaultBinding,vaultObservation:observation,initialHistory:history,configured};
 metrics.workingBytes=Math.max(admission.metrics.workingBytes,3*(size(admission)+size(results)+size(facts)+measureBatch(statements).batchBytes)+16384);if(metrics.workingBytes>1048576)return held('legacy-mint-source-working-bound');
 const sourceDigest=await crypto.sha256(utf8(canonicalJson({format:'legacy-mint-source-facts-v1',rootId:request.rootId,ordinal:request.ordinal,source:request.source,admissionSourceDigest:admission.sourceDigest,facts})));
 const [after]=await measured.batch([sql(pinSql,request.rootId)]);if(after.rows.length!==1||!same(after.rows[0],request.source))return held('legacy-mint-source-changed');
 return {kind:'verified',facts,sourceDigest,sourcePin:request.source,provenance:'retained-original-mint-database-facts',originalPreimageVerified:false,prefixAuthority:false,economics:false,adoption:false,metrics};
}});}
