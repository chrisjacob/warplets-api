import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {LEVEL_QUOTAS} from '../domain/collections/policy.mjs';
import {stageEligibility,stageReservationStatus,expirySchedule} from './projections.mjs';

export const INVENTORY_READ_LIMITS=Object.freeze({page:25,stages:32,legacyBytes:524288,contextBytes:2097152});
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const iso=v=>new Date(v).toISOString();
const revision="SELECT CAST(v.revision AS TEXT) revision,r.generation,r.mode,r.status FROM app_revisions v CROSS JOIN app_recovery_state r WHERE v.name='source' AND r.id=1";
function check(ok,reason){if(!ok){const error=new TypeError(reason);error.code=reason;throw error;}}
function query(value){
 const q=JSON.parse(canonicalJson(value));check(time(q.nowMs)&&(q.inventoryId===undefined||id(q.inventoryId))&&(q.after===undefined||q.after===''||id(q.after)),'invalid-inventory-query');
 if(q.principal!==null&&q.principal!==undefined){check(q.principal.kind==='wallet'&&Object.keys(q.principal).length===2,'invalid-inventory-principal');decode58(q.principal.wallet,32);}
 return {...q,wallet:q.principal?.wallet??null};
}
// A legacy row is only a bounded read-compatibility source. Its large wallet and
// admission arrays are projected inside SQL and never enter the application DTO.
// A normalized inventory never reads h.state, including for counts or membership.
const publicTerms=expression=>`json_object(${['id','type','publishedAt','opensAt','closesAt','priceLamports','costLamports','allocation','walletLimit','termsDigest','ballotId'].map(key=>"'"+key+"',json_extract("+expression+",'$."+key+"')").join(',')},'inventoryOverrideReason',json_extract(${expression},'$.inventoryOverrideReason') IS NOT NULL)`;
const contextSql=`WITH h AS (
 SELECT c.id,c.kind,c.tranche,c.season_start,c.revision,a.inventory_id normalized,a.admitted,a.fulfilled,
 CASE WHEN a.inventory_id IS NULL AND length(CAST(c.state AS BLOB))<=524288 AND json_valid(c.state) THEN c.state END legacy
 FROM collect_inventories c LEFT JOIN app_collection_authorities a ON a.inventory_id=c.id WHERE c.id=?
), stages AS (
 SELECT s.ordinal,s.stage_id,CASE WHEN length(CAST(s.terms_json AS BLOB))<=8192 THEN ${publicTerms('s.terms_json')} END terms,
 CASE WHEN c.list_id IS NOT NULL THEN 'list' ELSE s.eligibility_kind END eligibility_kind,COALESCE(c.list_id,s.list_id) list_id,
 CASE WHEN s.eligibility_kind='list' OR c.list_id IS NOT NULL THEN EXISTS(SELECT 1 FROM app_collection_list_seals l JOIN json_each(l.page_ids_json) p JOIN app_collection_eligibility_pages e ON e.record_id=p.value JOIN json_each(e.entries_json) w WHERE l.id=COALESCE(c.list_id,s.list_id) AND w.value=?) ELSE 0 END member
 FROM app_collection_stages s JOIN h ON h.id=s.inventory_id
 LEFT JOIN app_collection_free_cuts c ON c.inventory_id=s.inventory_id AND c.stage_id=s.stage_id AND h.kind='season' AND s.stage_type='free' AND s.eligibility_kind='pending' AND s.list_id IS NULL AND c.cut_ms=s.opens_ms
 AND EXISTS(SELECT 1 FROM app_collection_cut_records cr JOIN app_collection_list_seals l ON l.id=c.list_id AND l.member_count=c.eligible_count WHERE cr.id=c.root_id AND cr.format='collection-cut-root-v1' AND json_extract(cr.body_json,'$.inventoryId')=s.inventory_id AND json_extract(cr.body_json,'$.stageId')=s.stage_id AND json_extract(cr.body_json,'$.termsDigest')=s.terms_digest AND json_extract(cr.body_json,'$.atMs')=s.opens_ms AND json_extract(cr.body_json,'$.eligibilityListId')=c.list_id)
 WHERE h.normalized IS NOT NULL
 UNION ALL
 SELECT CAST(e.key AS INTEGER),json_extract(e.value,'$.id'),CASE WHEN length(CAST(json_remove(e.value,'$.wallets') AS BLOB))<=8192 THEN ${publicTerms('e.value')} END,
 CASE WHEN json_extract(e.value,'$.type')='public' THEN 'unrestricted' WHEN json_type(e.value,'$.wallets')='null' THEN 'pending' ELSE 'list' END,NULL,
 EXISTS(SELECT 1 FROM json_each(e.value,'$.wallets') w WHERE w.value=?)
 FROM h JOIN json_each(h.legacy,'$.stages') e WHERE h.normalized IS NULL
), admissions AS (
 SELECT json_extract(o.operation,'$.stageId') stage_id,o.owner wallet,o.settled_ms IS NOT NULL fulfilled
 FROM collect_operations o JOIN h ON h.id=o.inventory_id
 WHERE h.normalized IS NOT NULL AND o.kind='mint' AND length(CAST(o.operation AS BLOB))<=16384 AND json_valid(o.operation)
 UNION ALL
 SELECT json_extract(e.value,'$.stageId'),json_extract(e.value,'$.wallet'),json_type(e.value,'$.level')<>'null'
 FROM h JOIN json_each(h.legacy,'$.admissions') e WHERE h.normalized IS NULL
), grouped AS (
 SELECT stage_id,COUNT(*) admitted,SUM(fulfilled) fulfilled,SUM(wallet=?) mine FROM admissions GROUP BY stage_id
), levels AS (
 SELECT CASE WHEN reveal_ms IS NULL OR reveal_ms>? THEN 0
 WHEN length(CAST(asset AS BLOB))<=16384 AND json_valid(asset) THEN json_extract(asset,'$.level') ELSE -1 END level,COUNT(*) n
 FROM collect_assets JOIN h ON h.id=inventory_id GROUP BY level
)
SELECT h.id,h.kind,h.tranche,h.season_start,h.revision,h.normalized,
 CASE WHEN h.normalized IS NOT NULL THEN h.admitted ELSE json_array_length(h.legacy,'$.admissions') END admitted,
 CASE WHEN h.normalized IS NOT NULL THEN h.fulfilled ELSE json_extract(h.legacy,'$.fulfilled') END fulfilled,
 CASE WHEN h.normalized IS NOT NULL THEN 1 ELSE json_extract(h.legacy,'$.id')=h.id AND json_extract(h.legacy,'$.kind')=h.kind AND json_extract(h.legacy,'$.version')=h.revision AND json_extract(h.legacy,'$.slots')=1000 AND json_type(h.legacy,'$.stages')='array' AND json_type(h.legacy,'$.admissions')='array' END valid,
 (SELECT COUNT(*) FROM stages) stage_count,
 (SELECT json_group_array(json_object('ordinal',s.ordinal,'id',s.stage_id,'terms',s.terms,'eligibilityKind',s.eligibility_kind,'listId',s.list_id,'member',s.member,'admitted',COALESCE(g.admitted,0),'fulfilled',COALESCE(g.fulfilled,0),'mine',COALESCE(g.mine,0),'snapshotId',(SELECT snapshot_hash FROM collect_snapshots WHERE inventory_id=h.id AND stage_id=s.stage_id))) FROM (SELECT * FROM stages ORDER BY ordinal LIMIT 33) s LEFT JOIN grouped g ON g.stage_id=s.stage_id) stages,
 (SELECT COUNT(*) FROM admissions) actual_admitted,(SELECT COALESCE(SUM(fulfilled),0) FROM admissions) actual_fulfilled,
 (SELECT COUNT(*) FROM grouped WHERE stage_id IS NULL OR stage_id NOT IN (SELECT stage_id FROM stages)) unknown_stages,
 (SELECT json_group_array(json_object('level',level,'n',n)) FROM levels) levels,
 (SELECT earliest_ms FROM genesis_decisions WHERE ballot_id=(SELECT json_extract(terms,'$.ballotId') FROM stages WHERE ordinal=0)) earliest_ms,
 (SELECT CASE WHEN a.inventory_id IS NOT NULL THEN a.admitted WHEN length(CAST(p.state AS BLOB))<=524288 AND json_valid(p.state) THEN json_array_length(p.state,'$.admissions') END FROM collect_inventories p LEFT JOIN app_collection_authorities a ON a.inventory_id=p.id WHERE p.tranche=h.tranche-1) previous_admitted
FROM h`;

function units(value){check(value&&Object.keys(value).length===1&&typeof value.$lamports==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value.$lamports)&&BigInt(value.$lamports)<(1n<<64n),'inventory-stage-units');return value.$lamports;}
function project(row,q,normalizedAdmissionAvailable){
 check(row.valid===1&&id(row.id)&&['genesis','season'].includes(row.kind)&&Number.isSafeInteger(row.revision)&&row.revision>=0,'inventory-header-unavailable');
 check(row.kind==='genesis'?Number.isInteger(row.tranche)&&row.tranche>=1&&row.tranche<=10&&row.season_start===null:row.tranche===null&&time(row.season_start),'inventory-header-unavailable');
 check(count(row.admitted)&&count(row.fulfilled)&&row.fulfilled<=row.admitted&&row.actual_admitted===row.admitted&&row.actual_fulfilled===row.fulfilled&&row.unknown_stages===0,'inventory-admission-count-unavailable');
 const sourceStages=JSON.parse(row.stages),levels=JSON.parse(row.levels);
 check(Number.isInteger(row.stage_count)&&row.stage_count>=0&&row.stage_count<=32&&sourceStages.length===row.stage_count,'inventory-stage-count-unavailable');
 const counts={paid:0,free:0,founder:0,pending:row.admitted-row.fulfilled,unsold:1000-row.admitted,unmintedReserve:1000-row.fulfilled};
 const terms=sourceStages.map((s,n)=>{
  check(s.ordinal===n&&id(s.id)&&typeof s.terms==='string'&&count(s.admitted)&&count(s.fulfilled)&&s.fulfilled<=s.admitted&&count(s.mine)&&s.mine<=s.admitted&&[0,1].includes(s.member),'inventory-stage-unavailable');
  const value=JSON.parse(s.terms);check(value.id===s.id&&['whitelist','free','founder','public'].includes(value.type)&&time(value.publishedAt)&&time(value.opensAt)&&time(value.closesAt)&&value.publishedAt<=value.opensAt&&value.opensAt<value.closesAt&&count(value.allocation)&&value.allocation>0&&s.admitted<=value.allocation&&count(value.walletLimit)&&value.walletLimit>0&&hash(value.termsDigest),'inventory-stage-terms-unavailable');
  check(['list','pending','unrestricted'].includes(s.eligibilityKind)&&(s.snapshotId===null||hash(s.snapshotId)),'inventory-stage-source-unavailable');
  check(s.eligibilityKind==='unrestricted'?value.type==='public':s.eligibilityKind==='pending'?value.type==='free':['whitelist','free','founder'].includes(value.type),'inventory-stage-membership-unavailable');
  if(row.normalized!==null&&s.eligibilityKind==='list')check(hash(s.listId),'inventory-stage-list-unavailable');
  counts[value.type==='free'||value.type==='founder'?value.type:'paid']+=s.fulfilled;
  return {...value,priceLamports:units(value.priceLamports),costLamports:units(value.costLamports),wallets:s.eligibilityKind==='pending'||s.eligibilityKind==='unrestricted'?null:s.member?[q.wallet]:[]};
 });
 let openingHold=null;
 if(row.kind==='genesis'&&row.tranche>1&&row.admitted===0&&terms.length){
  if(!time(row.earliest_ms)||q.nowMs<row.earliest_ms)openingHold='Awaiting the founder’s approved opening time.';
  else if(!count(row.previous_admitted)||row.previous_admitted<1000&&!terms[0].inventoryOverrideReason)openingHold='The previous tranche still has available inventory.';
 }
 const stages=terms.map((s,n)=>{
  const fact=sourceStages[n];let status='open';if(q.nowMs<s.opensAt)status='scheduled';else if(q.nowMs>=s.closesAt)status='closed';else if(fact.admitted>=s.allocation||counts.unsold===0)status='sold-out';else if(openingHold)status='postponed';else if(s.type==='free'&&s.wallets===null)status='awaiting-snapshot';
  const eligibility=stageEligibility(s,q.wallet),used=q.wallet?fact.mine:null;
  const reservationStatus=stageReservationStatus(s,q.wallet,{now:q.nowMs,status,used,openingHold,snapshotId:fact.snapshotId});
  if(row.normalized!==null&&!normalizedAdmissionAvailable&&reservationStatus.status==='available'){reservationStatus.status='unavailable';reservationStatus.reason='admission-unavailable';}
  return {id:s.id,type:s.type,status,opensAt:iso(s.opensAt),closesAt:iso(s.closesAt),publishedAt:iso(s.publishedAt),priceLamports:s.priceLamports,costLamports:s.costLamports,allocation:s.allocation,available:Math.min(counts.unsold,s.allocation-fact.admitted),walletLimit:s.walletLimit,eligibility,eligible:eligibility.status==='unknown'?null:eligibility.status==='eligible',walletReservations:used,termsDigest:s.termsDigest,openingHold,reservationStatus};
 });
 const revealedLevelCounts=Array(10).fill(0);let concealedCount=0,total=0;
 for(const item of levels){check(Number.isInteger(item.level)&&item.level>=0&&item.level<=10&&count(item.n),'inventory-reveal-count-unavailable');total+=item.n;if(item.level===0)concealedCount=item.n;else revealedLevelCounts[item.level-1]=item.n;}
 check(total<=1000,'inventory-asset-count-unavailable');
 return {id:row.id,kind:row.kind,tranche:row.tranche,seasonStart:row.season_start===null?null:iso(row.season_start),capacity:1000,asOf:iso(q.nowMs),counts:{...counts,paidStageAllocations:counts.paid,freeStageAllocations:counts.free,founderStageAllocations:counts.founder},revealedLevelCounts,concealedCount,seasonExpiries:row.season_start===null?null:expirySchedule(row.season_start,q.nowMs),initialLevelQuotas:LEVEL_QUOTAS,stages,source:'local-fixture',executable:false};
}

/** Two bounded batches share a source revision. A changed source returns pending;
 * no mixed-era list, partial stage inventory or concealed asset body is returned. */
export function createInventoryReadRepository(driver,{normalizedAdmissionAvailable=false}={}){
 check(typeof normalizedAdmissionAvailable==='boolean','invalid-inventory-read-composition');
 async function read(q,single){
  try{
   const first=(await driver.batch([sql(revision),single?sql('SELECT CASE WHEN length(CAST(id AS BLOB))<=128 THEN id ELSE NULL END id FROM collect_inventories WHERE id=?',q.inventoryId):sql('SELECT CASE WHEN length(CAST(id AS BLOB))<=128 THEN id ELSE NULL END id FROM collect_inventories WHERE id>? ORDER BY id LIMIT 26',q.after??'')])).map(r=>r.rows);
   check(first[0].length===1&&/^(0|[1-9][0-9]*)$/.test(first[0][0].revision)&&typeof first[0][0].generation==='string'&&((first[0][0].mode==='live'&&first[0][0].status==='live')||(['private','public'].includes(first[0][0].mode)&&first[0][0].status==='ready'))&&first[1].length<=26&&first[1].every(r=>id(r.id)),'inventory-read-source-unavailable');
   const ids=first[1].slice(0,25).map(r=>r.id),statements=[sql(revision),...ids.map(inventoryId=>sql(contextSql,inventoryId,q.wallet,q.wallet,q.wallet,q.nowMs)),sql(revision)];measureBatch(statements);
   const data=(await driver.batch(statements)).map(r=>r.rows);
   check(data[0].length===1&&data.at(-1).length===1&&canonicalJson(data[0][0])===canonicalJson(first[0][0])&&canonicalJson(data.at(-1)[0])===canonicalJson(first[0][0]),'inventory-read-revision-changed');
   check(utf8(canonicalJson(data)).length<=INVENTORY_READ_LIMITS.contextBytes,'inventory-read-byte-bound');
   const items=data.slice(1,-1).map((rows,n)=>{check(rows.length===1&&rows[0].id===ids[n],'inventory-read-context-unavailable');return project(rows[0],q,normalizedAdmissionAvailable);});
   if(single)return items.length?{kind:'ready',value:items[0]}:{kind:'missing'};
   return {kind:'ready',value:{items,nextCursor:first[1].length>25?ids.at(-1):null,source:'local-fixture'}};
  }catch(error){if(typeof error.code==='string')return {kind:'pending',reason:error.code};return {kind:'pending',reason:'inventory-read-unavailable'};}
 }
 return Object.freeze({readInventory:input=>read(query(input),true),listInventories:input=>read(query(input),false)});
}
