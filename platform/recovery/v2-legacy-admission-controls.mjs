import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {historicalUsageSql,historicalSpendSql} from '../storage/atomic-operations.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {privateIdentity} from '../artifacts/identity.mjs';
import {verifyLegacyControlSelection} from '../collect/legacy-control-audit.mjs';
const size=v=>utf8(canonicalJson(v)).length,clone=v=>JSON.parse(canonicalJson(v)),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const need=(yes,reason)=>{if(!yes)throw new TypeError('retained-control-'+reason);};
const pinSql='SELECT r.generation,r.mode,r.status,r.write_nonce,w.revision watermark FROM app_recovery_state r CROSS JOIN app_recovery_watermark w WHERE r.id=1 AND w.id=1';
const scopeFields=['revision','scope','paused','previous_revision','at_ms','actor','reason','evidence_ref','request_key'];
const usageFields=['receipt','provider','metric','period','at_ms','measured','quota','evidence_ref'];
const spendFields=['request_key','scope','period','at_ms','limit_usd_micros','actor','quote_ref','status','actual_usd_micros','settlement_ref','settled_ms'];
function selected(statement,fields,max){
 const json=`json_object(${fields.flatMap(k=>["'"+k+"'",k]).join(',')})`;
 return sql(`WITH selected AS (${statement.sql}) SELECT COUNT(*) count,CASE WHEN COALESCE(SUM(length(CAST(${json} AS BLOB))),0)<=${max} THEN json_group_array(${json}) END body FROM selected`,...statement.values);
}
/** Revalidates one retained historical control selection on a private target.
 * The caller supplies an independently verified certificate and mint anchor;
 * neither these arguments nor this helper authorize recovery readiness. */
export function createRetainedLegacyControlVerifier({driver,crypto,artifacts}){
 return Object.freeze({async verify(value){
  const q=clone(value),metrics={sql:0,objectReads:0,maxBatchBytes:0,maxReturnedBytes:0,workingBytes:0};let retained=0;
  const bound=extra=>{metrics.workingBytes=Math.max(metrics.workingBytes,(q.retainedBytes??0)+size(q)*3+retained+extra+32768);need(metrics.workingBytes<=1048576,'working-bound');};
  async function read(statements){const m=measureBatch(statements);metrics.sql+=m.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);need(metrics.sql+metrics.objectReads<=64&&m.batchBytes<=262144,'operation-bound');bound(m.batchBytes*3);const rows=(await driver.batch(statements)).map(r=>r.rows),n=size(rows);metrics.maxReturnedBytes=Math.max(metrics.maxReturnedBytes,n);bound((n+m.batchBytes)*3);return rows;}
  function pin(rows){need(rows.length===1&&rows[0].generation===q.pin.generation&&rows[0].watermark===q.pin.watermark&&rows[0].mode==='private'&&['restoring','ready'].includes(rows[0].status)&&rows[0].write_nonce===null,'target-changed');}
  try{
   need(size(q)<=16384&&Number.isSafeInteger(q.retainedBytes??0)&&(q.retainedBytes??0)>=0&&q.pin&&typeof q.pin.generation==='string'&&Number.isSafeInteger(q.pin.watermark)&&q.pin.watermark>=0,'input');
   const a=q.anchor,c=q.certificate;need(a.adoptionId===c.adoptionId&&a.inventoryId===c.inventoryId&&a.rootId===c.rootId,'anchor-certificate');
   const identity=privateIdentity(a.controlSelectionIdentity);need(same(identity,a.controlSelectionIdentity)&&identity.size>0&&identity.size<=147456&&identity.contentType==='application/json'&&identity.semanticDigest===null&&identity.byteDigest===a.controlFact.sourceDigest,'identity');bound(identity.size*7);
   const [pins,objects,headers,ops]=await read([sql(pinSql),sql('SELECT identity_json,body_json,body_digest FROM app_collection_legacy_adoption_objects WHERE adoption_id=? AND object_key=? AND length(CAST(identity_json AS BLOB))<=1024 AND length(CAST(body_json AS BLOB))<=8192',a.adoptionId,identity.key),sql('SELECT id,kind,tranche,season_start,season_month,revision,origin_digest FROM collect_inventories WHERE id=?',a.inventoryId),sql('SELECT id,kind,inventory_id,owner,request_key,request_digest,commitment,created_ms FROM collect_operations WHERE id=? AND length(CAST(json_array(id,kind,inventory_id,owner,request_key,request_digest,commitment) AS BLOB))<=4096',a.operation.id)]);pin(pins);
   need(objects.length===1&&objects[0].identity_json===canonicalJson(identity),'object-reference');const objectProof={format:'legacy-adoption-object-proof-v1',adoptionId:a.adoptionId,identity,descriptorChildren:[]};need(objects[0].body_json===canonicalJson(objectProof)&&objects[0].body_digest===await crypto.sha256(utf8(canonicalJson(objectProof))),'object-proof');need(headers.length===1&&ops.length===1,'source-facts');
   metrics.objectReads++;let artifact=await artifacts.getVerified(identity);need(artifact.status==='verified'&&artifact.bytes instanceof Uint8Array&&artifact.bytes.length===identity.size&&await crypto.sha256(artifact.bytes)===identity.byteDigest,'artifact');
   let text=new TextDecoder('utf-8',{fatal:true}).decode(artifact.bytes),selection=JSON.parse(text);need(canonicalJson(selection)===text,'canonical-selection');artifact=null;text=null;retained=identity.size*7;bound(size([headers,ops,objects])*3);
   const source={inventoryId:c.inventoryId,sourceRevision:String(c.sourceRevision),generation:c.sourceGeneration,watermark:c.sourceWatermark};
   need(same(selection.request,{rootId:c.rootId,operationId:a.operation.id,atMs:a.operation.admittedAtMs,source}),'historical-source');
   const h=headers[0],o=ops[0],s=selection.header;need(h.id===c.inventoryId&&h.revision===c.sourceRevision&&h.origin_digest===c.originDigest&&s.inventory_id===h.id&&s.inventory_kind===h.kind&&s.tranche===h.tranche&&s.season_start===h.season_start&&s.season_month===h.season_month&&s.header_revision===h.revision&&s.origin_digest===h.origin_digest&&s.declared_state_digest===c.canonicalDigest,'header-binding');
   need(o.id===a.operation.id&&o.kind==='mint'&&o.inventory_id===c.inventoryId&&o.owner===a.operation.wallet&&o.request_key===a.operation.requestKey&&o.request_digest===a.operation.requestDigest&&o.commitment===a.operation.commitment&&o.created_ms===a.operation.admittedAtMs&&s.operation_id===o.id&&s.operation_kind===o.kind&&s.operation_inventory===o.inventory_id&&s.owner===o.owner&&s.request_key===o.request_key&&s.request_digest===o.request_digest&&s.commitment===o.commitment&&s.created_ms===o.created_ms,'operation-binding');
   const result=await verifyLegacyControlSelection(selection,{crypto});need(same(result.controlFact,a.controlFact)&&result.controlFact.decision.allowed===true,'accepted-control-fact');
   retained=identity.size*3;bound(identity.size*2);const expectedHistoryDigest=await crypto.sha256(utf8(canonicalJson([selection.scopeRows,selection.usageRows,selection.spendRows])));selection=null;retained=size([headers,ops,objects,result])*3;
   const at=a.operation.admittedAtMs;let rows=await read([selected(sql("SELECT * FROM ops_scope_log WHERE scope='collection-mint' AND at_ms<=? ORDER BY at_ms DESC LIMIT 2",at),scopeFields,8192),selected(historicalUsageSql(at),usageFields,65536),selected(historicalSpendSql(at),spendFields,65536)]);
   const limits=[2,100,100];let actual=rows.map((r,i)=>{need(r.length===1&&Number.isSafeInteger(r[0].count)&&r[0].count<=limits[i]&&typeof r[0].body==='string','selected-row-bound');const value=JSON.parse(r[0].body);need(value.length===r[0].count,'selected-count');return value;});
   actual[1].sort((a,b)=>{const x=a.provider+'\0'+a.metric,y=b.provider+'\0'+b.metric;return x<y?-1:x>y?1:0;});actual[2].sort((a,b)=>a.request_key<b.request_key?-1:a.request_key>b.request_key?1:0);bound(size(rows)*2+size(actual)*4);
   need(await crypto.sha256(utf8(canonicalJson(actual)))===expectedHistoryDigest,'retained-history-mismatch');rows=null;actual=null;
   const [after]=await read([sql(pinSql)]);pin(after);
   return Object.freeze({kind:'verified',controlFact:result.controlFact,sourcePin:source,verification:'retained-control-selection-and-history',readiness:false,metrics});
  }catch(error){return Object.freeze({kind:'held',reason:error.message,metrics});}
 }});
}
