import {sql} from './atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {progressionState} from '../domain/collections/progression.mjs';
export const COLLECTION_CONTEXT_BYTES=65536,COLLECTION_ASSET_BYTES=16384;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
const natural=v=>Number.isSafeInteger(v)&&v>=0;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const clone=v=>JSON.parse(canonicalJson(v));
const frozen=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))frozen(child);Object.freeze(v);}return v;};
function fail(condition,reason){if(!condition){const error=new TypeError(reason);error.code=reason;throw error;}}
function wallet(value){fail(typeof value==='string','invalid-wallet');try{decode58(value,32);}catch{fail(false,'invalid-wallet');}return value;}
function query(input){const value=clone(input);fail(exact(value,['wallet','inventoryId','assetIds','nowMs'])&&id(value.inventoryId)&&time(value.nowMs)&&Array.isArray(value.assetIds)&&value.assetIds.length>=1&&value.assetIds.length<=2&&value.assetIds.every(id)&&new Set(value.assetIds).size===value.assetIds.length,'invalid-context-query');wallet(value.wallet);return value;}
function revisions(rows){fail(rows.length===3&&new Set(rows.map(r=>r.name)).size===3&&rows.every(r=>['earn','source','control'].includes(r.name)&&typeof r.revision==='string'&&/^(0|[1-9][0-9]*)$/.test(r.revision)),'invalid-context-revisions');return Object.fromEntries(rows.map(r=>[r.name,r.revision]));}
/** SQL never selects aggregate inventory.state, slot coordinates or an owner's
 * concealed asset JSON. Only current revealed participants enter the planner. */
export function createCollectionContextRepository(driver){return Object.freeze({
 async readProgressionContext(input){
  const q=query(input),[version,header,participants]=await driver.batch([
   sql("SELECT name,CAST(revision AS TEXT) revision FROM app_revisions WHERE name IN ('earn','source','control') ORDER BY name"),
   sql('SELECT id,kind,tranche,season_start,season_month,CAST(revision AS TEXT) revision,origin_digest FROM collect_inventories WHERE id=?',q.inventoryId),
   sql(`SELECT a.id,a.inventory_id,a.owner,a.bind_ms,a.observed_ms,a.reveal_ms,length(CAST(a.asset AS BLOB)) asset_bytes,
    CASE WHEN a.owner=? AND a.reveal_ms IS NOT NULL AND a.reveal_ms<=? AND a.bind_ms<=? AND a.observed_ms<=? AND length(CAST(a.asset AS BLOB))<=16384 THEN a.asset ELSE NULL END asset_json,
    o.observed_ms owner_observed_ms,o.event_id owner_event_id,o.kind owner_event_kind,
    CASE WHEN a.owner=? AND o.body IS NOT NULL AND length(CAST(o.body AS BLOB))<=4096 AND json_valid(o.body) THEN
     json_object('eventId',json_extract(o.body,'$.eventId'),'assetId',json_extract(o.body,'$.assetId'),'kind',json_extract(o.body,'$.kind'),'at',json_extract(o.body,'$.at'),
      'owner',json_extract(o.body,'$.owner'),'from',json_extract(o.body,'$.from'),'to',json_extract(o.body,'$.to')) ELSE NULL END owner_evidence_json
    FROM collect_assets a LEFT JOIN vault_observations o ON o.rowid=(SELECT v.rowid FROM vault_observations v WHERE v.asset_id=a.id AND v.kind IN ('bind','transfer') ORDER BY v.observed_ms DESC,v.rowid DESC LIMIT 1)
    WHERE a.id IN (SELECT value FROM json_each(?)) ORDER BY a.id LIMIT 3`,q.wallet,q.nowMs,q.nowMs,q.nowMs,q.wallet,canonicalJson(q.assetIds)),
  ]);
  fail(utf8(JSON.stringify([version,header,participants])).length<=COLLECTION_CONTEXT_BYTES,'context-byte-bound');
  const h=header.rows[0];return frozen({revisions:revisions(version.rows),inventory:h?{id:h.id,kind:h.kind,tranche:h.tranche,seasonStartMs:h.season_start,seasonMonth:h.season_month,revision:h.revision,originDigest:h.origin_digest}:null,
   assets:participants.rows.map(a=>({id:a.id,inventoryId:a.inventory_id,owner:a.owner,bindMs:a.bind_ms,observedMs:a.observed_ms,revealMs:a.reveal_ms,assetBytes:a.asset_bytes,assetJson:a.asset_json,
    ownerObservedAtMs:a.owner_observed_ms,ownerEventId:a.owner_event_id,ownerEventKind:a.owner_event_kind,ownerEvidenceJson:a.owner_evidence_json})),nowMs:q.nowMs});
 },
});}
function requested(value){
 const v=clone(value);fail(exact(v,['inventoryId','request'])&&id(v.inventoryId),'invalid-context-request');const r=v.request;
 fail(r&&['upgrade','visual'].includes(r.kind)&&Object.keys(r).every(k=>['kind','targetId','materialId','expectedTargetVersion','expectedMaterialVersion'].includes(k))&&id(r.targetId)&&natural(r.expectedTargetVersion),'invalid-context-request');
 if(r.kind==='upgrade')fail(id(r.materialId)&&r.materialId!==r.targetId&&natural(r.expectedMaterialVersion),'invalid-context-participants');else fail(r.materialId==null&&r.expectedMaterialVersion==null,'unexpected-context-material');
 return v;
}
function ownerEvidence(row){
 fail(time(row.ownerObservedAtMs)&&row.ownerObservedAtMs>=row.bindMs&&row.ownerObservedAtMs<=row.observedMs&&id(row.ownerEventId)&&['bind','transfer'].includes(row.ownerEventKind)&&typeof row.ownerEvidenceJson==='string','owner-evidence-unavailable');
 let body;try{body=JSON.parse(row.ownerEvidenceJson);}catch{fail(false,'owner-evidence-invalid');}
 fail(exact(body,['eventId','assetId','kind','at','owner','from','to'])&&body.eventId===row.ownerEventId&&body.assetId===row.id&&body.kind===row.ownerEventKind&&body.at===new Date(row.ownerObservedAtMs).toISOString(),'owner-evidence-conflict');
 if(body.kind==='bind')fail(body.owner===row.owner&&body.from===null&&body.to===null,'owner-evidence-conflict');
 else{wallet(body.from);fail(body.owner===null&&body.to===row.owner&&body.from!==body.to,'owner-evidence-conflict');}
}
/** This read service issues no quote or reservation. It supplies frozen local
 * facts for derive/accept; later commits must fence all returned revisions. */
export function createCollectionContextService({repository,clock}){return Object.freeze({
 async read(principal,input){
  const p=clone(principal),q=requested(input);fail(exact(p,['kind','wallet'])&&p.kind==='wallet','authentication-required');wallet(p.wallet);
  const nowMs=clock.nowMs();fail(time(nowMs),'invalid-context-clock');
  let snapshot;
  try{snapshot=await repository.readProgressionContext({wallet:p.wallet,inventoryId:q.inventoryId,assetIds:[q.request.targetId,...(q.request.kind==='upgrade'?[q.request.materialId]:[])],nowMs});}
  catch(error){if(['context-byte-bound','invalid-context-revisions'].includes(error.code))return frozen({kind:'unavailable',reason:error.code});throw error;}
  const held=reason=>frozen({kind:'unavailable',reason,revisions:snapshot.revisions});
  try{
   const inventory=snapshot.inventory;fail(inventory,'inventory-missing');fail(inventory.id===q.inventoryId&&inventory.kind==='season'&&inventory.tranche===null&&time(inventory.seasonStartMs)&&inventory.seasonMonth===new Date(inventory.seasonStartMs).toISOString().slice(0,7)&&typeof inventory.revision==='string'&&/^(0|[1-9][0-9]*)$/.test(inventory.revision)&&/^[a-f0-9]{64}$/.test(inventory.originDigest),'invalid-season-header');
   fail(inventory.seasonStartMs<=nowMs,'season-not-started');const ids=[q.request.targetId,...(q.request.kind==='upgrade'?[q.request.materialId]:[])];
   fail(snapshot.nowMs===nowMs&&snapshot.assets.length===ids.length&&new Set(snapshot.assets.map(a=>a.id)).size===ids.length&&snapshot.assets.every(a=>ids.includes(a.id)),'participant-missing');
   const assets=ids.map(assetId=>{
    const row=snapshot.assets.find(a=>a.id===assetId);fail(row.inventoryId===q.inventoryId,'season-mismatch');fail(row.owner===p.wallet,'owner-changed');
    fail(time(row.bindMs)&&time(row.observedMs)&&row.bindMs<=row.observedMs&&row.observedMs<=nowMs&&row.bindMs>=inventory.seasonStartMs,'future-or-invalid-observation');
    fail(row.revealMs!==null,'metadata-unrevealed');fail(time(row.revealMs)&&row.revealMs>=row.bindMs&&row.revealMs<=row.observedMs&&row.revealMs<=nowMs,'future-or-invalid-reveal');
    fail(row.ownerObservedAtMs===null||row.ownerObservedAtMs<=nowMs,'future-owner-observation');ownerEvidence(row);
    fail(natural(row.assetBytes)&&row.assetBytes<=COLLECTION_ASSET_BYTES&&typeof row.assetJson==='string','asset-byte-bound');
    let body;try{body=JSON.parse(row.assetJson);}catch{fail(false,'invalid-asset-json');}
    // Legacy writers emit JSON.stringify output. Reject duplicate-key or
    // alternate-number encodings before a later SQL JSON guard can disagree
    // with JavaScript's parsed version/owner semantics.
    fail(JSON.stringify(body)===row.assetJson,'invalid-asset-json');
    fail(exact(body,['id','owner','level','traits','version','rerolls','eligibleAt','pending','expiresAt'])&&body.id===row.id&&body.owner===row.owner&&natural(body.version)&&natural(body.rerolls)&&time(body.eligibleAt)&&(body.pending===null||id(body.pending))&&time(body.expiresAt),'asset-identity-or-state-mismatch');
    fail(exact(body.traits,['model','backdrop','symbol'])&&Object.values(body.traits).every(v=>typeof v==='string'&&v.length>0&&v.length<=128&&v.trim()===v),'invalid-asset-traits');
    const normalized=progressionState({seasonId:inventory.id,start:inventory.seasonStartMs,assets:[body]}).assets[0];fail(normalized.expiresAt===body.expiresAt,'asset-expiry-mismatch');
    fail(body.version===(assetId===q.request.targetId?q.request.expectedTargetVersion:q.request.expectedMaterialVersion),'asset-version-changed');fail(body.pending===null,'asset-reserved');
    return {...body,inventoryId:inventory.id,revealStatus:'revealed',ownerObservedAtMs:row.ownerObservedAtMs};
   });
   return frozen({kind:'ready',context:{kind:'season',seasonId:inventory.id,start:inventory.seasonStartMs,assets},revisions:snapshot.revisions,inventoryRevision:inventory.revision,observedAtMs:nowMs});
  }catch(error){return held(error.code??'invalid-context-data');}
 },
});}
