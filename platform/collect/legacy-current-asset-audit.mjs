import {createLegacyMintSource} from './legacy-mint-source.mjs';
import {createLegacyAdmissionSource} from './legacy-admission-source.mjs';
import {committedCollectionSourceSealSql} from './source-seal-guard.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {seasonExpiry,LEVEL_QUOTAS} from '../domain/collections/policy.mjs';
import {genesisSlotEntitlement} from '../domain/economics/vault.mjs';

const clone=v=>JSON.parse(canonicalJson(v)),same=(a,b)=>canonicalJson(a)===canonicalJson(b),bytes=v=>utf8(canonicalJson(v)).length;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v),digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),nat=v=>Number.isSafeInteger(v)&&v>=0,time=v=>nat(v)&&v<=8640000000000000;
class Hold extends Error{}
const need=(v,reason)=>{if(!v)throw new Hold(reason);};
function wallet(v){need(typeof v==='string'&&v.length<=44,'current-asset-wallet');try{decode58(v,32);}catch{throw new Hold('current-asset-wallet');}return v;}
function json(text){let value;try{value=JSON.parse(text);}catch{throw new Hold('current-asset-json');}need(JSON.stringify(value)===text,'current-asset-json');return value;}
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const pinSql=`SELECT c.id inventoryId,CAST(c.revision AS TEXT) sourceRevision,r.generation,w.revision watermark FROM app_collection_source_seals s JOIN collect_inventories c ON c.id=s.inventory_id AND CAST(c.revision AS TEXT)=s.source_revision CROSS JOIN app_recovery_state r CROSS JOIN app_recovery_watermark w WHERE s.id=? AND ${committedCollectionSourceSealSql('s')} AND r.id=1 AND w.id=1 AND r.mode IN ('live','private') AND r.status IN ('live','ready') AND r.write_nonce IS NULL AND length(CAST(r.generation AS BLOB))<=256`;
const body=fields=>`json_object(${fields.flatMap(k=>["'"+k+"'",k]).join(',')})`;
const transportBody=fields=>`json_object('body',printf('%s',${body(fields)}))`;
const assetFields=['id','inventory_id','owner','bind_ms','observed_ms','reveal_ms','slot','asset'],vaultFields=['id','slot_key','coords','owner','latest_ms'];
const eventFields=['event_id','asset_id','kind','observed_ms','body'],observationFields=['source_id','asset_id','event_kind','observed_ms','digest'],historyFields=['asset_id','effective_ms','level','source_ref'];
const project=(table,fields,where,values,limit,max)=>sql(`SELECT ${body(fields)} body FROM ${table} WHERE ${where} AND length(CAST(${body(fields)} AS BLOB))<=${max} ORDER BY ${fields[0]} LIMIT ${limit}`,...values);
const stats=(table,fields,where,values)=>sql(`SELECT COUNT(*) count,COALESCE(SUM(length(CAST(${body(fields)} AS BLOB))),0) bytes,COALESCE(SUM(length(CAST(${transportBody(fields)} AS BLOB))),0) transportBytes FROM ${table} WHERE ${where}`,...values);
const historyPage=(table,fields,assetId,summary,max)=>project(table,fields,`asset_id=? AND (SELECT COUNT(*) FROM ${table} WHERE asset_id=?)=? AND (SELECT COALESCE(SUM(length(CAST(${body(fields)} AS BLOB))),0) FROM ${table} WHERE asset_id=?)=? AND (SELECT COALESCE(SUM(length(CAST(${transportBody(fields)} AS BLOB))),0) FROM ${table} WHERE asset_id=?)=?`,[assetId,assetId,summary.count,assetId,summary.bytes,assetId,summary.transportBytes],1001,max);
const parsed=rows=>rows.map(r=>JSON.parse(r.body));
const flags={prefixAuthority:false,economics:false,adoption:false};
function capture(input,asset){const q=clone(input);if(!exact(q,asset?['rootId','ordinal','pageIndex','entryIndex','source','asOfMs']:['rootId','source','asOfMs'])||!digest(q.rootId)||!time(q.asOfMs)||!exact(q.source,['inventoryId','sourceRevision','generation','watermark'])||!id(q.source.inventoryId)||typeof q.source.sourceRevision!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(q.source.sourceRevision)||typeof q.source.generation!=='string'||q.source.generation.length<1||q.source.generation.length>256||!nat(q.source.watermark)||(asset&&(!nat(q.ordinal)||q.ordinal>=1000||!nat(q.pageIndex)||q.pageIndex>=16||!nat(q.entryIndex)||q.entryIndex>=100)))throw new TypeError('Invalid private current-asset audit request.');return q;}
function meter(driver){const metrics={sql:0,maxBatchBytes:0,maxParameters:0,maxReturnedBytes:0,workingBytes:0};return {metrics,driver:{async batch(statements){const m=measureBatch(statements);metrics.sql+=m.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);need(metrics.sql<=64,'current-asset-query-bound');const r=await driver.batch(statements);metrics.maxReturnedBytes=Math.max(metrics.maxReturnedBytes,bytes(r));return r;}},working(n){metrics.workingBytes=Math.max(metrics.workingBytes,n);need(n<=1048576,'current-asset-working-bound');}};}
async function pin(driver,q){const [r]=await driver.batch([sql(pinSql,q.rootId)]);need(r.rows.length===1&&same(r.rows[0],q.source),'current-asset-source-changed');}

/** Private, read-only historical consistency. The durable caller separately
 * proves original economics and exact schema, and owns ordinal coverage.
 * Completed progression/claim histories without a replay adapter stay held. */
export function createLegacyCurrentAssetAudit({driver,crypto}){
 async function run(input,asset,fn){const q=capture(input,asset),m=meter(driver);try{return freeze(await fn(q,m));}catch(error){if(error instanceof Hold)return freeze({kind:'held',reason:error.message,metrics:m.metrics});throw error;}}
 return Object.freeze({
  read(input){return run(input,true,async(q,m)=>{
   const {asOfMs,...selection}=q,original=await createLegacyMintSource({driver:m.driver,crypto}).read(selection);need(original.kind==='verified',original.reason??'current-asset-original-missing');m.working(original.metrics.workingBytes+bytes(q)*3+4096);
   const f=original.facts,op=f.operation,assetId=f.collectBinding.id,inventoryId=q.source.inventoryId;
   const [assets,vaults,entries,vs,os,hs,operationStats]=await m.driver.batch([
    project('collect_assets',assetFields,'id=?',[assetId],1,24576),project('vault_assets',vaultFields,'id=?',[assetId],1,8192),
    sql(`SELECT json_extract(a.value,'$.operationId') operationId,json_extract(a.value,'$.ticket') ticket,json_extract(a.value,'$.level') level FROM collect_inventories c,json_each(c.state,'$.admissions') a WHERE c.id=? AND a.key=?`,inventoryId,q.ordinal),
    stats('vault_observations',eventFields,'asset_id=?',[assetId]),stats('collect_observations',observationFields,'asset_id=?',[assetId]),stats('collect_level_history',historyFields,'asset_id=?',[assetId]),
    sql(`SELECT (SELECT COUNT(*) FROM collect_operations WHERE inventory_id=? AND NOT json_valid(operation)) malformed,
     (SELECT COUNT(*) FROM collect_operations WHERE inventory_id=? AND kind<>'mint' AND CASE WHEN json_valid(operation) THEN json_extract(operation,'$.targetId')=? OR json_extract(operation,'$.materialId')=? ELSE 0 END) progressions,
     (SELECT COUNT(*) FROM app_collection_operation_conflicts WHERE asset_id=? AND status='held') conflicts`,inventoryId,inventoryId,assetId,assetId,assetId)
   ]);
   need(assets.rows.length===1&&vaults.rows.length===1&&entries.rows.length===1,'current-asset-missing-or-oversized');const a=parsed(assets.rows)[0],v=parsed(vaults.rows)[0],entry=entries.rows[0],ops=operationStats.rows[0];
   need(entry.operationId===op.id&&nat(entry.ticket)&&entry.ticket<1000&&Number.isInteger(entry.level)&&entry.level>=1&&entry.level<=10,'current-asset-original-entry');
   need(ops&&ops.malformed===0,'current-asset-malformed-operation');need(ops.conflicts===0,'current-asset-external-transfer-hold');need(ops.progressions===0,'current-asset-progression-history-unsupported');
   const summaries=[vs,os,hs].map(r=>r.rows[0]);need(summaries.every(s=>s&&nat(s.count)&&nat(s.bytes)&&nat(s.transportBytes)),'current-asset-history-count');need(summaries.reduce((n,s)=>n+s.count,0)<=1000&&summaries.reduce((n,s)=>n+s.bytes,0)<=196608,'current-asset-history-bound');
   // Check both encoded transport and parsed copies before hydration, rather
   // than discovering an over-budget working set after allocating it.
   m.working(3*(bytes(original)+bytes([a,v,entry])+summaries.reduce((n,s)=>n+s.bytes+s.transportBytes+2*s.count+1024,0))+32768);
   const nft=json(a.asset),slot=json(a.slot),coords=json(v.coords),slotKey=json(v.slot_key);
   need(exact(nft,['id','owner','level','traits','version','rerolls','eligibleAt','pending','expiresAt'])&&nft.id===assetId&&a.id===assetId&&a.inventory_id===inventoryId&&v.id===assetId,'current-asset-identity');
   wallet(a.owner);wallet(nft.owner);wallet(v.owner);need(a.owner===nft.owner&&a.owner===v.owner,'current-asset-owner');need(nft.pending===null,'current-asset-pending-lock');
   need(nft.level===entry.level&&nat(nft.version)&&nft.rerolls===0&&nft.eligibleAt===0,'current-asset-unproven-progression');
   need(exact(nft.traits,['model','backdrop','symbol'])&&Object.values(nft.traits).every(s=>typeof s==='string'&&s.length<=128&&s.trim().length>0),'current-asset-traits');
   need(a.bind_ms===op.settled_ms&&time(a.bind_ms)&&a.bind_ms%1000===0&&a.bind_ms<=asOfMs&&time(a.observed_ms)&&a.observed_ms>=a.bind_ms&&a.observed_ms<=asOfMs&&time(v.latest_ms)&&v.latest_ms>=a.bind_ms&&v.latest_ms<=asOfMs&&(a.reveal_ms===null||(time(a.reveal_ms)&&a.reveal_ms>=a.bind_ms&&a.reveal_ms<=a.observed_ms)),'current-asset-clock');
   need(same(slot,coords)&&same(slot,slotKey),'current-asset-slot');
   if(f.header.kind==='genesis'){need(exact(slot,['kind','tranche','level','ordinal'])&&slot.kind==='genesis'&&slot.tranche===f.header.tranche&&slot.level===entry.level&&nft.expiresAt===null,'current-asset-genesis-slot');try{genesisSlotEntitlement({budget:0n,...slot});}catch{throw new Hold('current-asset-genesis-slot');}}
   else{const lower=LEVEL_QUOTAS.slice(0,entry.level-1).reduce((n,v)=>n+v,0);let expiry;try{expiry=seasonExpiry(f.header.seasonStart,entry.level);}catch{throw new Hold('current-asset-season-slot');}need(exact(slot,['kind','seasonId','slotIndex'])&&slot.kind==='season'&&slot.seasonId===inventoryId&&nat(slot.slotIndex)&&slot.slotIndex>=lower&&slot.slotIndex<lower+LEVEL_QUOTAS[entry.level-1]&&nft.expiresAt===expiry,'current-asset-season-slot');}
   const visuals={model:nft.traits.model,backdrop:nft.traits.backdrop,symbol:nft.traits.symbol};need(await crypto.sha256(utf8(JSON.stringify(['mint',op.id,assetId,op.proof_id,op.settled_ms,entry.ticket,op.commitment,visuals])))===op.evidence_digest,'current-asset-original-traits-digest');
   // The measured history bound is a SQL predicate on each hydrated page too:
   // a writer cannot enlarge transport between the count and data batches.
   const rows=await m.driver.batch([historyPage('vault_observations',eventFields,assetId,summaries[0],8192),historyPage('collect_observations',observationFields,assetId,summaries[1],2048),historyPage('collect_level_history',historyFields,assetId,summaries[2],2048)]);
   const [events,observations,history]=rows.map(r=>parsed(r.rows));need([events,observations,history].every((r,i)=>r.length===summaries[i].count),'current-asset-history-missing-or-oversized');
   m.working(3*(bytes(original)+bytes([a,v,entry])+bytes(rows)+bytes([events,observations,history]))+32768);
   need(same(history,f.initialHistory),'current-asset-level-history-unsupported');
   const bind=events.filter(e=>e.kind==='bind');need(bind.length===1&&same(bind[0],f.vaultObservation),'current-asset-bind-history');
   const initial={eventId:'collect:'+op.id,assetId,kind:'bind',at:new Date(op.settled_ms).toISOString(),owner:op.owner,slot};need(bind[0].body===JSON.stringify(initial),'current-asset-original-bind');wallet(op.owner);
   const transfers=events.filter(e=>e.kind==='transfer');need(events.length===transfers.length+1,'current-asset-vault-history-unsupported');
   const transferById=new Map();for(const e of transfers){const b=json(e.body);need(exact(b,['eventId','assetId','kind','at','from','to'])&&id(e.event_id)&&e.asset_id===assetId&&b.eventId===e.event_id&&b.assetId===assetId&&b.kind==='transfer'&&time(e.observed_ms)&&e.observed_ms%1000===0&&e.observed_ms>=a.bind_ms&&e.observed_ms<=asOfMs&&b.at===new Date(e.observed_ms).toISOString()&&b.from!==b.to,'current-asset-transfer-history');wallet(b.from);wallet(b.to);transferById.set(e.event_id,{...e,from:b.from,to:b.to});}
   let revealMs=null,observedMs=a.bind_ms,transferCount=0;const matched=new Set();
   for(const o of observations){need(id(o.source_id)&&o.asset_id===assetId&&['reveal','transfer'].includes(o.event_kind)&&time(o.observed_ms)&&o.observed_ms>=a.bind_ms&&o.observed_ms<=asOfMs&&digest(o.digest),'current-asset-observation');observedMs=Math.max(observedMs,o.observed_ms);let from=null,to=null;
    if(o.event_kind==='reveal'){need(revealMs===null,'current-asset-duplicate-reveal');revealMs=o.observed_ms;}
    else{const eid='collect:'+await crypto.sha256(utf8(JSON.stringify(o.source_id))),e=transferById.get(eid);need(e&&!matched.has(eid)&&e.observed_ms===o.observed_ms,'current-asset-transfer-pair');matched.add(eid);from=e.from;to=e.to;transferCount++;}
    need(await crypto.sha256(utf8(JSON.stringify([o.event_kind,assetId,o.observed_ms,from,to])))===o.digest,'current-asset-observation-digest');
   }
   need(matched.size===transfers.length,'current-asset-unpaired-vault-transfer');
   // Rowid is not a portable historical ordering. At equal timestamps a unique
   // from-owner chain is required; ambiguous cycles explicitly hold.
   let owner=op.owner,latestMs=a.bind_ms;const pending=[...transferById.values()].sort((a,b)=>a.observed_ms-b.observed_ms);
   while(pending.length){const at=pending[0].observed_ms,group=[];while(pending.length&&pending[0].observed_ms===at)group.push(pending.shift());while(group.length){const next=group.filter(e=>e.from===owner);need(next.length===1,'current-asset-transfer-order-unsupported');owner=next[0].to;group.splice(group.indexOf(next[0]),1);}latestMs=at;}
   need(owner===a.owner&&nft.version===transferCount&&v.latest_ms===latestMs&&a.observed_ms===observedMs&&a.reveal_ms===revealMs,'current-asset-replayed-current-state');
   const current={owner,level:nft.level,version:nft.version,rerolls:nft.rerolls,eligibleAt:nft.eligibleAt,expiresAt:nft.expiresAt,revealMs,observedMs},counts={vaultEvents:events.length,transfers:transferCount,reveals:revealMs===null?0:1,levelHistory:history.length,completedProgressions:0};
   const currentAssetDigest=await crypto.sha256(utf8(canonicalJson({asset:a,vault:v}))),result={kind:'verified',rootId:q.rootId,sourcePin:q.source,operationId:op.id,assetId,ordinal:q.ordinal,currentAssetDigest,current,counts,verification:'historical-current-asset-consistency',...flags};
   const sourceDigest=await crypto.sha256(utf8(canonicalJson({format:'legacy-current-asset-audit-v1',result,asOfMs,originalSourceDigest:original.sourceDigest,events,observations,history})));await pin(m.driver,q);
   return {...result,sourceDigest,metrics:m.metrics};
  });},
  closure(input){return run(input,false,async(q,m)=>{
   const original=await createLegacyAdmissionSource({driver:m.driver,crypto}).closure({rootId:q.rootId,source:q.source});need(original.kind==='verified',original.reason??'current-asset-admission-closure');const inv=q.source.inventoryId;
   const [summary,invalid,orphans,extra]=await m.driver.batch([
    sql(`SELECT s.admission_count admissionCount,json_extract(c.state,'$.fulfilled') fulfilledCount,(SELECT COUNT(*) FROM collect_operations WHERE inventory_id=c.id AND kind='mint') mintOperations,
      (SELECT COUNT(DISTINCT CASE WHEN json_valid(receipt) THEN json_extract(receipt,'$.assetId') END) FROM collect_operations WHERE inventory_id=c.id AND kind='mint') distinctMintAssets,
      (SELECT COUNT(*) FROM collect_assets WHERE inventory_id=c.id) collectAssets,
      (SELECT COUNT(*) FROM collect_assets a JOIN vault_assets v ON v.id=a.id WHERE a.inventory_id=c.id) vaultBindings,
      (SELECT COUNT(*) FROM collect_operations WHERE inventory_id=c.id AND (settled_ms IS NULL OR receipt IS NULL OR proof_id IS NULL OR evidence_digest IS NULL)) pendingOperations,
      (SELECT COUNT(*) FROM collect_assets WHERE inventory_id=c.id AND CASE WHEN json_valid(asset) THEN json_type(asset,'$.pending') IS NOT 'null' ELSE 1 END) lockedAssets,
      (SELECT COUNT(*) FROM app_collection_operation_conflicts x JOIN collect_assets a ON a.id=x.asset_id WHERE a.inventory_id=c.id AND x.status='held') heldConflicts
      FROM app_collection_source_seals s JOIN collect_inventories c ON c.id=s.inventory_id WHERE s.id=?`,q.rootId),
    sql(`SELECT COUNT(*) malformedOperations FROM collect_operations WHERE inventory_id=? AND (NOT json_valid(operation) OR (receipt IS NOT NULL AND NOT json_valid(receipt)))`,inv),
    sql(`SELECT (SELECT COUNT(*) FROM collect_assets a WHERE a.inventory_id=? AND NOT EXISTS(SELECT 1 FROM collect_operations o WHERE o.inventory_id=a.inventory_id AND o.kind='mint' AND CASE WHEN json_valid(o.receipt) THEN json_extract(o.receipt,'$.assetId')=a.id ELSE 0 END)) unboundAssets,
      (SELECT COUNT(*) FROM collect_assets a WHERE a.inventory_id=? AND NOT EXISTS(SELECT 1 FROM vault_assets v WHERE v.id=a.id)) missingVaultBindings`,inv,inv),
    sql(`SELECT COUNT(*) extraVaultBindings FROM vault_assets v,collect_inventories c WHERE c.id=? AND CASE WHEN json_valid(v.coords) THEN (c.kind='season' AND json_extract(v.coords,'$.kind')='season' AND json_extract(v.coords,'$.seasonId')=c.id) OR (c.kind='genesis' AND json_extract(v.coords,'$.kind')='genesis' AND json_extract(v.coords,'$.tranche')=c.tranche) ELSE 0 END AND NOT EXISTS(SELECT 1 FROM collect_assets a WHERE a.id=v.id AND a.inventory_id=c.id)`,inv)
   ]);
   need([summary,invalid,orphans,extra].every(r=>r.rows.length===1),'current-asset-closure-missing');const counts={...summary.rows[0],...invalid.rows[0],...orphans.rows[0],...extra.rows[0]};need(Object.values(counts).every(nat)&&counts.admissionCount<=1000,'current-asset-closure-count');
   need(['fulfilledCount','mintOperations','distinctMintAssets','collectAssets','vaultBindings'].every(k=>counts[k]===counts.admissionCount)&&['pendingOperations','lockedAssets','heldConflicts','malformedOperations','unboundAssets','missingVaultBindings','extraVaultBindings'].every(k=>counts[k]===0),'current-asset-inventory-not-quiescent');
   m.working(3*(bytes(original)+bytes(counts)+bytes(q))+16384);const result={kind:'verified',rootId:q.rootId,sourcePin:q.source,counts,quiescent:true,verification:'inventory-quiescence-and-binding-closure',...flags},sourceDigest=await crypto.sha256(utf8(canonicalJson({format:'legacy-current-asset-closure-v1',result,asOfMs:q.asOfMs,admissionClosureDigest:original.sourceDigest})));await pin(m.driver,q);return {...result,sourceDigest,metrics:m.metrics};
  });}
 });
}
