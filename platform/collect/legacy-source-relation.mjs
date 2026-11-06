import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {verifyCollectionRecordBody} from './source-intake.mjs';
export const LEGACY_SOURCE_RELATION_LIMITS=Object.freeze({sourceBytes:33554432,checkpointBytes:8192,workingBytes:1048576,operations:64,pageItems:100});
const FORMAT='legacy-source-relation-v1',topKeys=['id','kind','tranche','version','slots','remaining','fulfilled','stages','admissions'],termKeys=['id','type','publishedAt','opensAt','closesAt','priceLamports','costLamports','allocation','walletLimit','approvedSpendLamports','termsDigest','ballotId','inventoryOverrideReason','wallets'];
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v),digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),nat=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const exact=(v,ks)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k)),same=(a,b)=>canonicalJson(a)===canonicalJson(b),clone=v=>JSON.parse(canonicalJson(v));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
class Held extends Error{constructor(reason){super(reason);this.reason=reason;}}
const need=(condition,reason)=>{if(!condition)throw new Held(reason);};
const pinSql=`SELECT c.id,c.kind,c.tranche,c.season_start,CASE WHEN length(CAST(c.season_month AS BLOB))<=32 THEN c.season_month ELSE NULL END season_month,c.revision,CASE WHEN length(CAST(c.origin_digest AS BLOB))<=128 THEN c.origin_digest ELSE NULL END origin_digest,length(CAST(c.state AS BLOB)) source_bytes,
 CASE WHEN length(CAST(r.generation AS BLOB))<=256 THEN r.generation ELSE NULL END generation,r.mode,r.status,w.revision watermark
 FROM collect_inventories c CROSS JOIN app_recovery_state r CROSS JOIN app_recovery_watermark w WHERE c.id=? AND r.id=1 AND w.id=1 AND r.mode IN ('live','private') AND r.status IN ('live','ready') AND r.write_nonce IS NULL`;
function pinValid(p){return p&&id(p.id)&&['genesis','season'].includes(p.kind)&&nat(p.revision)&&nat(p.watermark)&&nat(p.source_bytes,33554432)&&p.source_bytes>0&&typeof p.generation==='string'&&p.generation.length<=256&&typeof p.origin_digest==='string'&&p.origin_digest.length<=128&&(p.kind==='genesis'?nat(p.tranche,10)&&p.tranche>0&&p.season_start===null:p.tranche===null&&nat(p.season_start,8640000000000000));}
const sourceRecord=id=>sql('SELECT id,size,CASE WHEN size<=131072 AND length(body_base64)<=174764 THEN body_base64 ELSE NULL END body_base64 FROM app_collection_records WHERE id=?',id);
const quoted=values=>values.map(v=>"'"+v+"'").join(',');
/** Returns only bounded scalar field cells. Duplicate/unknown keys and nested
 * wrapper duplicates are counted independently before JS parses any body. */
function objectProjection(selected,allowed,excluded,extra=''){
 return `WITH selected AS MATERIALIZED (${selected}) SELECT json_type(body) object_type,
 (SELECT COUNT(*) FROM json_each(body)) field_count,(SELECT COUNT(DISTINCT key) FROM json_each(body)) unique_count,
 (SELECT COUNT(*) FROM json_each(body) WHERE key NOT IN (${quoted(allowed)})) unknown_count${extra},
 (SELECT json_group_array(json_object('key',e.key,'type',e.type,
 'atom',CASE WHEN e.type IN ('integer','null') THEN e.atom WHEN e.type='text' AND length(CAST(e.atom AS BLOB))<=4096 THEN e.atom ELSE NULL END,
 'body',CASE WHEN e.type IN ('array','object') AND length(CAST(e.value AS BLOB))<=4096 THEN (e.value || '') ELSE NULL END,
 'child_count',CASE WHEN e.type IN ('array','object') THEN (SELECT COUNT(*) FROM json_each(e.value)) ELSE NULL END,
 'child_unique',CASE WHEN e.type='object' THEN (SELECT COUNT(DISTINCT key) FROM json_each(e.value)) ELSE NULL END,
 'child_invalid',CASE WHEN e.type='object' THEN (SELECT COUNT(*) FROM json_each(e.value) WHERE key<>'$lamports' OR type<>'text') WHEN e.type='array' THEN (SELECT COUNT(*) FROM json_each(e.value) WHERE type<>'integer') ELSE NULL END)) FROM (SELECT * FROM json_each(body) WHERE key IN (${quoted(allowed.filter(k=>!excluded.includes(k)))}) LIMIT 32) e) fields_json FROM selected`;
}
const topSql=objectProjection("SELECT state body FROM collect_inventories WHERE id=? AND json_valid(state) AND length(CAST(state AS BLOB))<=33554432",topKeys,['stages','admissions'],",json_type(body,'$.stages') stages_type,json_array_length(body,'$.stages') stage_count,json_type(body,'$.admissions') admissions_type,json_array_length(body,'$.admissions') admission_count");
const stageSql=objectProjection("SELECT s.value body FROM collect_inventories h,json_each(h.state,'$.stages') s WHERE h.id=? AND s.key=? AND s.type='object'",termKeys,['wallets'],",json_type(body,'$.wallets') wallets_type,json_array_length(body,'$.wallets') wallet_count");
const admissionSql=`SELECT a.key ordinal,a.type,
 CASE WHEN length(CAST(a.value AS BLOB))<=2048 THEN a.value ELSE NULL END body_json,
 (SELECT COUNT(*) FROM json_each(a.value)) field_count,(SELECT COUNT(DISTINCT key) FROM json_each(a.value)) unique_count,
 json_type(a.value,'$.admittedAt') admitted_type,json_type(a.value,'$.level') level_type,json_type(a.value,'$.ticket') ticket_type,json_type(a.value,'$.costLamports') cost_type,
 (SELECT COUNT(*) FROM json_each(json_extract(a.value,'$.costLamports'))) cost_count,
 (SELECT COUNT(DISTINCT key) FROM json_each(json_extract(a.value,'$.costLamports'))) cost_unique
 FROM collect_inventories h,json_each(h.state,'$.admissions') a WHERE h.id=? AND a.key>=? AND a.key<? ORDER BY a.key LIMIT 100`;
const walletsSql=`SELECT w.key ordinal,w.type,CASE WHEN w.type='text' AND length(CAST(w.value AS BLOB))<=44 THEN w.value ELSE NULL END wallet
 FROM collect_inventories h,json_each(h.state,?) w WHERE h.id=? AND w.key>=? AND w.key<? ORDER BY w.key LIMIT 100`;
function fields(row,expected,extra){
 need(row&&row.object_type==='object'&&row.unknown_count===0&&row.field_count===row.unique_count&&row.field_count===Object.keys(expected).length+extra,'legacy-relation-object-keys');
 need(typeof row.fields_json==='string'&&utf8(row.fields_json).length<=65536,'legacy-relation-scalar-bound');const cells=JSON.parse(row.fields_json),value={};
 for(const cell of cells){need(Object.hasOwn(expected,cell.key),'legacy-relation-object-keys');
  if(cell.type==='null')value[cell.key]=null;
  else if(cell.type==='integer'){need(Number.isSafeInteger(cell.atom),'legacy-relation-number-format');value[cell.key]=cell.atom;}
  else if(cell.type==='text'){need(typeof cell.atom==='string','legacy-relation-scalar-bound');value[cell.key]=cell.atom;}
  else if(cell.type==='object'||cell.type==='array'){need(typeof cell.body==='string','legacy-relation-scalar-bound');if(cell.type==='object')need(cell.child_count===1&&cell.child_unique===1&&cell.child_invalid===0,'legacy-relation-wrapper-keys');else need(cell.key==='remaining'&&cell.child_count===10&&cell.child_invalid===0,'legacy-relation-array-format');value[cell.key]=JSON.parse(cell.body);}
  else throw new Held('legacy-relation-number-or-type-format');
 }
 need(same(value,expected),'legacy-relation-scalar-mismatch');
}
const cpKeys=['format','inventoryId','rootId','pin','phase','admissionIndex','admissionCount','stageIndex','walletPageIndex','walletCount','lastWallet','listOccurrences','walletOccurrences','checkpointDigest'];
function capture(value){need(exact(value,['inventoryId','rootId','checkpoint'])&&id(value.inventoryId)&&digest(value.rootId),'legacy-relation-input');if(value.checkpoint===null)return {...value};const c=value.checkpoint;
 need(exact(c,cpKeys)&&c.format===FORMAT&&c.inventoryId===value.inventoryId&&c.rootId===value.rootId&&pinValid(c.pin)&&c.pin.id===value.inventoryId&&['admissions','stages','wallets','finish'].includes(c.phase)&&digest(c.checkpointDigest),'legacy-relation-checkpoint');
 for(const [k,max] of [['admissionIndex',16],['admissionCount',1000],['stageIndex',32],['walletPageIndex',100],['walletCount',10000],['listOccurrences',32],['walletOccurrences',320000]])need(nat(c[k],max),'legacy-relation-checkpoint');need(c.lastWallet===null||typeof c.lastWallet==='string'&&c.lastWallet.length<=44,'legacy-relation-checkpoint');need(utf8(canonicalJson(c)).length<=8192,'legacy-relation-checkpoint-bound');return clone(value);
}
function cursor(c,facts){need(c.admissionIndex<=facts.admissions.pageIds.length&&c.admissionCount>=c.admissionIndex&&c.admissionCount<=c.admissionIndex*100&&c.admissionCount<=facts.admissions.count&&c.stageIndex<=facts.stageKinds.length,'legacy-relation-cursor');
 if(c.phase==='admissions')need(c.stageIndex===0&&c.listOccurrences===0&&c.walletOccurrences===0,'legacy-relation-cursor');else need(c.admissionIndex===facts.admissions.pageIds.length&&c.admissionCount===facts.admissions.count,'legacy-relation-cursor');
 need(c.listOccurrences===facts.stageKinds.slice(0,c.stageIndex).filter(kind=>kind==='list').length&&c.walletOccurrences<=c.listOccurrences*10000,'legacy-relation-cursor');
 if(c.phase==='wallets')need(c.stageIndex<facts.stageKinds.length&&facts.stageKinds[c.stageIndex]==='list'&&c.walletCount===c.walletPageIndex*100&&(c.walletCount===0?c.lastWallet===null:c.lastWallet!==null),'legacy-relation-cursor');else need(c.walletCount===0&&c.walletPageIndex===0&&c.lastWallet===null,'legacy-relation-cursor');
 if(c.phase==='finish')need(c.stageIndex===facts.stageKinds.length,'legacy-relation-cursor');
}
/** Read-only semantic relation. Private durable CAS/source schema validation and
 * the independent canonical digest/economic audits remain required authority. */
export function createLegacySourceRelationAudit({driver,crypto}){return Object.freeze({async step(value){
 const metrics={operations:0,maxBatchBytes:0,resultBytes:0,maxResultBatchBytes:0,maxWorkingBytes:0,records:0,retainedFactsBytes:0,phasePeaks:{root:0,component:0,final:0}},held=reason=>freeze({kind:'held',reason,metrics});let c,cpBytes=0,phaseName='root',phaseResultBytes=0,compareBytes=0;
 // Aggregate returned bytes never reset. Only helper-local live buffers are
 // released between phases; each phase still uses the original conservative
 // three-copy accounting plus all facts/checkpoint retained across helpers.
 const bound=()=>{const working=(phaseResultBytes+cpBytes+metrics.retainedFactsBytes+compareBytes)*3+16384;metrics.phasePeaks[phaseName]=Math.max(metrics.phasePeaks[phaseName],working);metrics.maxWorkingBytes=Math.max(metrics.maxWorkingBytes,working);need(working<=1048576,'legacy-relation-working-bound');};
 const phase=async(name,work)=>{phaseName=name;phaseResultBytes=0;compareBytes=0;bound();const result=await work();bound();return result;};
 const read=async statements=>{const m=measureBatch(statements);metrics.operations+=m.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);need(metrics.operations<=64,'legacy-relation-query-bound');const values=await driver.batch(statements);need(values.length===statements.length&&values.every(v=>Array.isArray(v.rows)),'legacy-relation-read-invalid');const bytes=utf8(canonicalJson(values)).length;metrics.resultBytes+=bytes;metrics.maxResultBatchBytes=Math.max(metrics.maxResultBatchBytes,bytes);phaseResultBytes+=bytes;bound();return values.map(v=>v.rows);};
 const record=async (rows,expectedId)=>{need(rows.length===1&&rows[0].id===expectedId&&rows[0].body_base64,'legacy-relation-record-missing');const row=rows[0],bytes=Uint8Array.from(atob(row.body_base64),x=>x.charCodeAt(0));metrics.records++;need(metrics.records<=3,'legacy-relation-record-bound');return verifyCollectionRecordBody({id:row.id,size:row.size,bytes},crypto);};
 const samePin=rows=>{need(rows.length===1&&pinValid(rows[0])&&same(rows[0],c.pin),'legacy-relation-source-pin-changed');};
 // This helper owns the encoded record rows, decoded bytes and complete parsed
 // root. None escape its frame. Selected facts are independently cloned before
 // return, so page SQL never retains a parent root or its encoded buffers.
 async function rootFacts(input){
  const [pins,roots]=await read([sql(pinSql,input.inventoryId),sourceRecord(input.rootId)]);need(pins.length===1&&pinValid(pins[0]),'legacy-relation-source-unavailable');if(c)samePin(pins);
  const root=await record(roots,input.rootId);need(root.format==='collection-source-v1'&&root.source.inventoryId===input.inventoryId&&root.inventory.kind===pins[0].kind&&root.source.revision===String(pins[0].revision)&&(root.inventory.tranche??null)===pins[0].tranche,'legacy-relation-source-identity');
  for(const stage of root.stages)need(Object.keys(stage.terms).every(k=>termKeys.includes(k)&&k!=='wallets'),'legacy-relation-unknown-source-terms');
  const selected=c&&['stages','wallets'].includes(c.phase)?root.stages[c.stageIndex]??null:null;
  const facts=clone({pin:pins[0],inventory:c?null:root.inventory,stateDigest:root.source.stateDigest,admissions:root.admissions,stageKinds:root.stages.map(s=>s.eligibility.kind),stage:selected});
  metrics.retainedFactsBytes=utf8(canonicalJson(facts)).length;bound();return facts;
 }
 // All record rows, comparison rows and parsed pages stay inside this helper.
 // The final checkpoint/hash phase retains only selected facts and counters.
 async function advance(input,facts){
  if(!c){c={format:FORMAT,inventoryId:input.inventoryId,rootId:input.rootId,pin:facts.pin,phase:'admissions',admissionIndex:0,admissionCount:0,stageIndex:0,walletPageIndex:0,walletCount:0,lastWallet:null,listOccurrences:0,walletOccurrences:0};cpBytes=utf8(canonicalJson(c)).length;
   const [top]=await read([sql(topSql,input.inventoryId)]);need(top.length===1,'legacy-relation-top-object');fields(top[0],facts.inventory,2);need(top[0].stages_type==='array'&&top[0].stage_count===facts.stageKinds.length&&top[0].admissions_type==='array'&&top[0].admission_count===facts.admissions.count,'legacy-relation-top-count');return;
  }
  cursor(c,facts);
  if(c.phase==='admissions'){
   if(c.admissionIndex===facts.admissions.pageIds.length){need(c.admissionCount===facts.admissions.count,'legacy-relation-admission-count');c.phase='stages';return;}
   const pageId=facts.admissions.pageIds[c.admissionIndex],[pages]=await read([sourceRecord(pageId)]),page=await record(pages,pageId);need(page.format==='collection-page-v1'&&page.kind==='admissions'&&page.index===c.admissionIndex&&page.entries.length>0&&c.admissionCount+page.entries.length<=facts.admissions.count,'legacy-relation-admission-page');
   // Byte-bounded035 admission pages can contain fewer than100 entries. Read
   // precisely the verified page's contiguous prefix, including its last row.
   const [rows]=await read([sql(admissionSql,c.inventoryId,c.admissionCount,c.admissionCount+page.entries.length)]);need(rows.length===page.entries.length,'legacy-relation-admission-missing');
   for(const [n,expected]of page.entries.entries()){const row=rows[n];need(row.ordinal===c.admissionCount+n&&row.type==='object'&&row.field_count===9&&row.unique_count===9&&row.cost_type==='object'&&row.cost_count===1&&row.cost_unique===1&&typeof row.body_json==='string','legacy-relation-admission-object');need(row.admitted_type==='integer'&&row.level_type===(expected.level===null?'null':'integer')&&row.ticket_type===(expected.ticket===null?'null':'integer'),'legacy-relation-number-format');need(same(JSON.parse(row.body_json),expected),'legacy-relation-admission-mismatch');}
   compareBytes=utf8(canonicalJson(page.entries)).length;bound();c.admissionIndex++;c.admissionCount+=page.entries.length;
  }else if(c.phase==='stages'){
   if(c.stageIndex===facts.stageKinds.length){c.phase='finish';return;}
   const stage=facts.stage,statements=[sql(stageSql,c.inventoryId,c.stageIndex)];if(stage.eligibility.kind==='list')statements.push(sourceRecord(stage.eligibility.manifestId));const [rows,lists]=await read(statements);need(rows.length===1,'legacy-relation-stage-missing');fields(rows[0],stage.terms,1);
   if(stage.eligibility.kind==='list'){const list=await record(lists,stage.eligibility.manifestId);need(list.format==='collection-list-v1'&&rows[0].wallets_type==='array'&&rows[0].wallet_count===list.count,'legacy-relation-wallet-count');c.phase='wallets';}
   else{need(rows[0].wallets_type==='null','legacy-relation-wallet-null');c.stageIndex++;}
  }else if(c.phase==='wallets'){
   const stage=facts.stage,[lists]=await read([sourceRecord(stage.eligibility.manifestId)]),list=await record(lists,stage.eligibility.manifestId);need(list.format==='collection-list-v1'&&c.walletPageIndex<list.pageIds.length,'legacy-relation-list-page');
   const expected=c.walletPageIndex===list.pageIds.length-1?list.count-c.walletPageIndex*100:100,[pages,rows]=await read([sourceRecord(list.pageIds[c.walletPageIndex]),sql(walletsSql,'$.stages['+c.stageIndex+'].wallets',c.inventoryId,c.walletCount,c.walletCount+expected)]),page=await record(pages,list.pageIds[c.walletPageIndex]);
   need(page.format==='collection-page-v1'&&page.kind==='eligibility'&&page.index===c.walletPageIndex&&page.entries.length===expected&&rows.length===expected&&(c.lastWallet===null||page.entries.length>0&&c.lastWallet<page.entries[0]),'legacy-relation-wallet-page');for(const [n,wallet]of page.entries.entries())need(rows[n].ordinal===c.walletCount+n&&rows[n].type==='text'&&rows[n].wallet===wallet,'legacy-relation-wallet-mismatch');
   c.walletPageIndex++;c.walletCount+=expected;c.lastWallet=page.entries.at(-1)??c.lastWallet;if(c.walletPageIndex===list.pageIds.length){need(c.walletCount===list.count,'legacy-relation-wallet-count');c.walletOccurrences+=c.walletCount;c.listOccurrences++;c.stageIndex++;c.phase='stages';c.walletPageIndex=0;c.walletCount=0;c.lastWallet=null;}
  }
 }
 try{
  const input=capture(value);if(input.checkpoint){const {checkpointDigest,...body}=input.checkpoint;need(await crypto.sha256(utf8(canonicalJson(body)))===checkpointDigest,'legacy-relation-checkpoint-digest');c=body;cpBytes=utf8(canonicalJson(c)).length;}
  const facts=await phase('root',()=>rootFacts(input)),finishing=c?.phase==='finish';
  await phase('component',()=>advance(input,facts));cursor(c,facts);cpBytes=Math.max(cpBytes,utf8(canonicalJson(c)).length);
  return freeze(await phase('final',async()=>{
   if(finishing){const result={kind:'verified',pin:c.pin,rootId:c.rootId,inventoryId:c.inventoryId,declaredStateDigest:facts.stateDigest,stageCount:c.stageIndex,admissionCount:c.admissionCount,listOccurrences:c.listOccurrences,walletOccurrences:c.walletOccurrences,verification:'source-components-equal-legacy-json',canonicalDigestVerified:false,rawByteDigestVerified:false,economicsVerified:false,adoptionAuthorized:false,executable:false};
    compareBytes=utf8(canonicalJson(result)).length;bound();result.relationDigest=await crypto.sha256(utf8(canonicalJson(result)));const [after]=await read([sql(pinSql,c.inventoryId)]);samePin(after);return {...result,metrics};
   }
   const checkpoint={...c,checkpointDigest:await crypto.sha256(utf8(canonicalJson(c)))};compareBytes=utf8(canonicalJson(checkpoint)).length;need(compareBytes<=8192,'legacy-relation-checkpoint-bound');bound();const [after]=await read([sql(pinSql,c.inventoryId)]);samePin(after);return {kind:'continue',checkpoint,metrics};
  }));
 }catch(error){return held(error instanceof Held?error.reason:'legacy-relation-read-or-record-invalid');}
 }});}
