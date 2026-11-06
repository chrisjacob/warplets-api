import {committedCollectionSourceSealSql} from './source-seal-guard.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {historicalUsageSql,historicalSpendSql} from '../storage/atomic-operations.mjs';
import {pressureFromRows,decisionFromRows,period,controlledScopes} from '../operations/portable-controls.mjs';
import {decode58} from '../server/base58.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const nat=v=>Number.isSafeInteger(v)&&v>=0;
const time=v=>nat(v)&&v<=8640000000000000;
const generation=v=>typeof v==='string'&&v.length>0&&v.length<=256;
const name=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v===v.trim();
const money=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,79})$/.test(v);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
class Hold extends Error{constructor(reason){super(reason);this.reason=reason;}}
const need=(ok,reason)=>{if(!ok)throw new Hold(reason);};
const clone=v=>JSON.parse(canonicalJson(v));
export const LEGACY_CONTROL_AUDIT_LIMITS=Object.freeze({usageRows:100,spendRows:100,selectionRows:101,selectedRowBytes:65536,sqlBytes:262144,workingBytes:1048576});
/** SQL projection guards run before row hydration. The selected inner statement
 * remains the existing operations query, including its 101-row overflow bound. */
function bounded(statement,columns,budget=65536){
 const checks=Object.entries(columns).map(([key,bound])=>`(${key} IS NULL OR length(CAST(${key} AS BLOB))<=${bound})`).join(' AND '),sizes=`length(CAST(json_object(${Object.keys(columns).map(key=>`'${key}',${key}`).join(',')}) AS BLOB))`;
 return sql(`WITH selected AS (${statement.sql}), totals AS (SELECT COALESCE(SUM(${sizes}),0) bytes FROM selected) SELECT ${Object.keys(columns).map(key=>`CASE WHEN ${checks} AND totals.bytes<=${budget} THEN selected.${key} ELSE NULL END ${key}`).join(',')},CASE WHEN ${checks} AND totals.bytes<=${budget} THEN 1 ELSE 0 END bounded,totals.bytes selected_bytes FROM selected CROSS JOIN totals`,...statement.values);
}
const HEADER={generation:1024,mode:16,status:16,write_nonce:512,watermark:20,inventory_id:128,inventory_kind:16,tranche:2,season_start:20,season_month:32,header_revision:20,origin_digest:64,root_id:64,source_revision:20,declared_state_digest:64,operation_id:128,operation_kind:16,operation_inventory:128,owner:44,request_key:128,request_digest:64,commitment:128,created_ms:20};
const SCOPE={revision:64,scope:64,paused:1,previous_revision:64,at_ms:20,actor:1024,reason:1024,evidence_ref:1024,request_key:1024};
const USAGE={receipt:64,provider:1024,metric:32,period:32,at_ms:20,measured:80,quota:80,evidence_ref:1024};
const SPEND={request_key:1024,scope:64,period:32,at_ms:20,limit_usd_micros:80,actor:1024,quote_ref:1024,status:16,actual_usd_micros:80,settlement_ref:1024,settled_ms:20};
function binding(request){return bounded(sql(`SELECT r.generation,r.mode,r.status,r.write_nonce,w.revision watermark,c.id inventory_id,c.kind inventory_kind,c.tranche,c.season_start,c.season_month,c.revision header_revision,c.origin_digest,s.id root_id,s.source_revision,s.declared_state_digest,o.id operation_id,o.kind operation_kind,o.inventory_id operation_inventory,o.owner,o.request_key,o.request_digest,o.commitment,o.created_ms FROM app_recovery_state r CROSS JOIN app_recovery_watermark w JOIN app_collection_source_seals s ON s.id=? JOIN collect_inventories c ON c.id=s.inventory_id JOIN collect_operations o ON o.id=? WHERE r.id=1 AND w.id=1 AND ${committedCollectionSourceSealSql('s')} LIMIT 2`,request.rootId,request.operationId),HEADER,8192);}
function rows(values,max){need(Array.isArray(values)&&values.length<=max,'legacy-control-input-bound');need(values.every(r=>r.bounded===1&&nat(r.selected_bytes)),'legacy-control-read-byte-bound');return values.map(({bounded:ignore,selected_bytes:ignore2,...r})=>r);}
function validateBinding(r,q){
 need(r&&generation(r.generation)&&['live','private'].includes(r.mode)&&['live','ready'].includes(r.status)&&r.write_nonce===null&&nat(r.watermark),'legacy-control-source-unavailable');
 need(r.generation===q.source.generation&&r.watermark===q.source.watermark,'legacy-control-source-changed');
 need(r.root_id===q.rootId&&r.inventory_id===q.source.inventoryId&&String(r.header_revision)===q.source.sourceRevision&&r.source_revision===q.source.sourceRevision&&digest(r.declared_state_digest)&&digest(r.origin_digest)&&['genesis','season'].includes(r.inventory_kind)&&nat(r.header_revision),'legacy-control-root-binding');
 need(r.inventory_kind==='genesis'?nat(r.tranche)&&r.tranche>=1&&r.tranche<=10&&r.season_start===null&&r.season_month===null:r.tranche===null&&time(r.season_start)&&r.season_month===period(r.season_start,true),'legacy-control-malformed-header');
 need(r.operation_id===q.operationId&&r.operation_kind==='mint'&&r.operation_inventory===r.inventory_id&&r.created_ms===q.atMs&&time(r.created_ms)&&id(r.request_key)&&digest(r.request_digest)&&id(r.commitment)&&typeof r.owner==='string'&&r.owner.length<=44,'legacy-control-operation-binding');try{decode58(r.owner,32);}catch{throw new Hold('legacy-control-malformed-operation');}
}
function scopeRow(row,atMs){if(!row)return;need(digest(row.revision)&&row.scope==='collection-mint'&&(row.paused===0||row.paused===1)&&(row.previous_revision===null||digest(row.previous_revision))&&time(row.at_ms)&&row.at_ms<=atMs&&['actor','reason','evidence_ref','request_key'].every(k=>name(row[k])),'legacy-control-malformed-scope');}
function usageRows(values,atMs){const seen=new Set();for(const r of values){need(digest(r.receipt)&&name(r.provider)&&name(r.evidence_ref)&&['new-monthly-usd','daily-provider-units'].includes(r.metric)&&time(r.at_ms)&&r.at_ms<=atMs&&money(r.measured),'legacy-control-malformed-usage');const monthly=r.metric==='new-monthly-usd';need(r.period===period(r.at_ms,monthly)&&(monthly?r.quota===null:money(r.quota)&&BigInt(r.quota)>0n&&r.period===period(atMs)),'legacy-control-malformed-usage');const key=r.provider+':'+r.metric;need(!seen.has(key),'legacy-control-ambiguous-usage');seen.add(key);}}
function spendRows(values,atMs){for(const r of values){need(name(r.request_key)&&controlledScopes.includes(r.scope)&&r.period===period(r.at_ms,true)&&time(r.at_ms)&&r.at_ms<=atMs&&money(r.limit_usd_micros)&&name(r.actor)&&name(r.quote_ref)&&['reserved','settled'].includes(r.status),'legacy-control-malformed-spend');if(r.status==='reserved')need(r.actual_usd_micros===null&&r.settlement_ref===null&&r.settled_ms===null,'legacy-control-malformed-spend');else need(money(r.actual_usd_micros)&&name(r.settlement_ref)&&(r.settled_ms===null||time(r.settled_ms)&&r.settled_ms>=r.at_ms),'legacy-control-malformed-spend');}}
/** Read-only retained-history semantics. The frozen source pin belongs to the
 * private audit repository, never a caller permission or original-ingestion claim. */
export function createLegacyControlAudit({driver,crypto,onMeasure=()=>{}}){
 return Object.freeze({async read(value){
  const q=clone(value);if(!exact(q,['rootId','operationId','atMs','source'])||!digest(q.rootId)||!id(q.operationId)||!time(q.atMs)||!exact(q.source,['inventoryId','sourceRevision','generation','watermark'])||!id(q.source.inventoryId)||typeof q.source.sourceRevision!=='string'||!/^(0|[1-9][0-9]{0,15})$/.test(q.source.sourceRevision)||!generation(q.source.generation)||!nat(q.source.watermark))throw new TypeError('Invalid private historical control request.');
  const metrics={sqlStatements:0,batches:0,maxBatchBytes:0,readBytes:0,workingBytes:0,usageRows:0,spendRows:0};
  const read=async statements=>{const m=measureBatch(statements);metrics.sqlStatements+=m.statements;metrics.batches++;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);const out=(await driver.batch(statements)).map(r=>r.rows),encoded=canonicalJson(out);metrics.readBytes+=utf8(encoded).length;need(metrics.readBytes<=262144,'legacy-control-read-byte-bound');return JSON.parse(encoded);};
  try{
   const [headers,scopes,usage,spend]=await read([binding(q),bounded(sql("SELECT * FROM ops_scope_log WHERE scope='collection-mint' AND at_ms<=? ORDER BY at_ms DESC LIMIT 2",q.atMs),SCOPE,8192),bounded(historicalUsageSql(q.atMs),USAGE),bounded(historicalSpendSql(q.atMs),SPEND)]);
   need(headers.length===1,'legacy-control-root-or-operation-missing');const header=rows(headers,1)[0];validateBinding(header,q);need(await crypto.sha256(utf8(JSON.stringify([header.inventory_id,header.inventory_kind,header.tranche,header.season_start])))===header.origin_digest,'legacy-control-header-digest');const scope=rows(scopes,2),u=rows(usage,101),s=rows(spend,101);metrics.usageRows=u.length;metrics.spendRows=s.length;
   // Read two only to reject an ambiguous latest timestamp; an older previous
   // row is retained in the source commitment but does not change the decision.
   scope.forEach(r=>scopeRow(r,q.atMs));need(scope.length<2||scope[0].at_ms>scope[1].at_ms,'legacy-control-ambiguous-scope');
   need(u.length<=100&&s.length<=100,'operating-input-bound');usageRows(u,q.atMs);spendRows(s,q.atMs);u.sort((a,b)=>{const x=a.provider+'\0'+a.metric,y=b.provider+'\0'+b.metric;return x<y?-1:x>y?1:0;});s.sort((a,b)=>a.request_key<b.request_key?-1:a.request_key>b.request_key?1:0);const pressure=pressureFromRows(u,s,q.atMs);if(pressure.status==='pending')throw new Hold(pressure.reason);
   if(scope[0])need(await crypto.sha256(utf8(JSON.stringify([scope[0].scope,Boolean(scope[0].paused),scope[0].previous_revision,scope[0].at_ms,scope[0].actor,scope[0].reason,scope[0].evidence_ref,scope[0].request_key])))===scope[0].revision,'legacy-control-scope-digest');
   for(const r of u)need(await crypto.sha256(utf8(JSON.stringify([r.provider,r.metric,r.measured,r.quota,r.at_ms,r.evidence_ref])))===r.receipt,'legacy-control-usage-digest');
   const decision=decisionFromRows('collection-mint',scope[0],pressure),transcript={format:'legacy-control-history-as-of-v1',request:q,header,scopeRows:scope,usageRows:u,spendRows:s};const bytes=utf8(canonicalJson(transcript));metrics.workingBytes=metrics.readBytes*3+bytes.length*2+utf8(canonicalJson(q)).length*3+16384;need(metrics.workingBytes<=1048576,'legacy-control-working-byte-bound');
   const sourceDigest=await crypto.sha256(bytes),[afterRows]=await read([binding(q)]);metrics.workingBytes=Math.max(metrics.workingBytes,metrics.readBytes*3+bytes.length*2+utf8(canonicalJson(q)).length*3+16384);need(metrics.workingBytes<=1048576,'legacy-control-working-byte-bound');need(afterRows.length===1,'legacy-control-source-changed');const after=rows(afterRows,1)[0];validateBinding(after,q);need(canonicalJson(after)===canonicalJson(header),'legacy-control-source-changed');
   return freeze({kind:'verified',controlFact:{rootId:q.rootId,operationId:q.operationId,atMs:q.atMs,scope:'collection-mint',sourceDigest,scopeRevision:scope[0]?.revision??null,paused:Boolean(scope[0]?.paused),pressure:pressure.level,decision},provenance:'retained-history-as-of',sourcePin:q.source,pressure,metrics});
  }catch(error){return freeze({kind:'held',reason:error instanceof Hold?error.reason:'legacy-control-history-unavailable',metrics});}finally{onMeasure({...metrics});}
 }});
}
