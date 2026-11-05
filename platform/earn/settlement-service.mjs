import {canonicalJson,utf8} from '../security/canonical.mjs';
import {buildRequirementSpecs,selectRequirementReceipts} from '../evidence/requirements.mjs';
import {computeBoard,computeAllocation} from './settlement.mjs';
import {allocationWindow,DAY_MS} from '../domain/earn/index.mjs';
import {launchAllocations} from '../domain/economics/index.mjs';
import {createSettlementCommand,COMMIT_BOARD,COMMIT_ALLOCATION} from '../storage/atomic-settlement.mjs';
import {name,nat,requireValue} from './validation.mjs';
const clone=value=>JSON.parse(canonicalJson(value)),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const pending=(reason,dependencyIds=[])=>({kind:'pending',reason,dependencyIds});
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const kinds=['frozen-facts','requirements','evidence','dependencies'];
// These limits include persisted B05 facts (8 MiB) and their requirement and
// evidence vectors. No object, vector or retry may silently truncate coverage.
export const SETTLEMENT_PREPARATION_LIMITS=Object.freeze({objectBytes:256*1024,totalBytes:24*1024*1024,pages:512,items:16384});
class Held extends Error {constructor(reason,ids=[]){super(reason);this.result=pending(reason,ids);}}
function demand(value,reason,ids=[]){if(!value)throw new Held(reason,ids);}
function capture(principal,query,fields){
 const p=clone(principal),q=clone(query);
 requireValue(p.kind==='operator','Settlement requires an operator principal.');name(p.id,'operator');
 requireValue(Object.keys(q).every(k=>fields.includes(k)),'Unexpected settlement preparation fields.');name(q.requestKey,'request key');
 return {principal:p,query:q};
}
// Preparation is deliberately separate from commit. Jobs persist only the
// compact immutable command; B03 binds that payload to the B02 SQL lease fence.
// There is no sourceComplete flag, provider read, transfer or publication here.
export function createEarnSettlementService({repository,artifacts,crypto,clock}){
 const hash=value=>crypto.sha256(utf8(canonicalJson(value)));
 async function bounded(operation){
  for(let attempt=0;attempt<2;attempt++){
   try{const result=await operation();if(result.kind!=='conflict'||result.code!=='revision_conflict')return freeze(result);}
   catch(error){if(error instanceof Held)return freeze(error.result);throw error;}
  }return freeze(pending('settlement-revision-conflict',['cutoff-reassembly']));
 }
 async function stable(versions,epoch,manifestDigest){
  if(!same(versions,await repository.readVersions()))return false;
  return epoch===undefined||await repository.readPointer(epoch)===manifestDigest;
 }
 function reader(){
  let totalBytes=0;
  return async identity=>{
   demand(identity&&identity.visibility==='private'&&identity.contentType==='application/json'&&digest(identity.byteDigest)&&
    identity.key==='private/'+identity.byteDigest+'.json'&&Number.isSafeInteger(identity.size)&&identity.size>=0&&
    identity.size<=SETTLEMENT_PREPARATION_LIMITS.objectBytes,'settlement-object-identity');
   totalBytes+=identity.size;demand(totalBytes<=SETTLEMENT_PREPARATION_LIMITS.totalBytes,'settlement-artifact-byte-bound');
   const read=await artifacts.getVerified(clone(identity));
   demand(read.status==='verified','settlement-object-'+read.status,[identity.key]);
   // Copy before the hash await even when an injected store reuses its buffer.
   const bytes=new Uint8Array(read.bytes);
   demand(bytes.byteLength===identity.size&&await crypto.sha256(bytes)===identity.byteDigest,'settlement-object-conflict',[identity.key]);
   let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Held('settlement-object-json',[identity.key]);}
   demand(canonicalJson(value)===new TextDecoder().decode(bytes),'settlement-object-canonical',[identity.key]);return value;
  };
 }
 async function board(principal,query){
  const loaded=clone(await repository.loadBoardPreparation({epoch:query.epoch}));if(loaded.kind!=='loaded')return loaded;
  const {versions,sealed,manifestIdentity,attempt}=loaded,read=reader();
  demand(sealed.epoch===query.epoch,'settlement-epoch-mismatch');
  demand(same(versions,sealed.dependencyVersions),'input-revision-changed',['cutoff-reassembly']);
  demand(attempt&&attempt.status==='ready'&&attempt.epoch===sealed.epoch&&attempt.manifestDigest===sealed.manifestDigest&&
   attempt.inputDigest===sealed.inputDigest&&attempt.objectKey===sealed.objectKey&&attempt.byteDigest===sealed.byteDigest&&same(attempt.dependencyVersions,versions),'complete-manifest-attempt-required');
  demand(manifestIdentity.key===sealed.objectKey&&manifestIdentity.byteDigest===sealed.byteDigest&&manifestIdentity.semanticDigest===sealed.manifestDigest,'settlement-manifest-identity');
  const manifest=await read(manifestIdentity);
  demand(manifest.version===1&&manifest.mode==='synthetic-fixture'&&manifest.status==='ready','complete-manifest-required');
  demand(await hash(['cutoff-manifest-v1',manifest])===sealed.manifestDigest,'settlement-manifest-digest');
  demand(manifest.epoch===query.epoch&&manifest.cutoffMs===(query.epoch+1)*DAY_MS-1&&manifest.asOfMs===sealed.asOfMs&&
   manifest.asOfMs>manifest.cutoffMs&&manifest.asOfMs<=nat(clock.nowMs(),'now')&&manifest.inputDigest===sealed.inputDigest&&manifest.sourceRef===sealed.sourceRef&&
   same(manifest.dependencyVersions,versions)&&digest(manifest.admissionDigest)&&manifest.requirementsDigest===attempt.requirementsDigest&&
   manifest.evidenceDigest===attempt.evidenceDigest,'settlement-manifest-metadata');
  const vectors={};let pageCount=0;
  demand(manifest.artifacts&&same(Object.keys(manifest.artifacts).sort(),[...kinds].sort()),'settlement-manifest-pages');
  for(const kind of kinds){
   const identities=manifest.artifacts[kind];demand(Array.isArray(identities)&&identities.length>0,'settlement-manifest-pages');
   pageCount+=identities.length;demand(pageCount<=SETTLEMENT_PREPARATION_LIMITS.pages,'settlement-page-bound');
   const items=[];
   for(let index=0;index<identities.length;index++){
    const page=await read(identities[index]);
    demand(page.version===1&&page.kind===kind&&page.index===index&&Array.isArray(page.items),'settlement-page-order');
    demand(items.length+page.items.length<=SETTLEMENT_PREPARATION_LIMITS.items,'settlement-item-bound');items.push(...page.items);
   }vectors[kind]=items;
  }
  demand(vectors.dependencies.length===0,'snapshot-dependencies',vectors.dependencies.map(d=>d.id));
  const specs=await buildRequirementSpecs(vectors['frozen-facts'],crypto),heads=await repository.selectHeads(specs);
  const selection=await selectRequirementReceipts(specs,heads,crypto);
  if(selection.kind!=='ready')return pending('snapshot-dependencies',selection.dependencies.map(d=>d.id));
  demand(same(selection.requirements,vectors.requirements)&&same(selection.evidence,vectors.evidence)&&
   selection.requirementsDigest===manifest.requirementsDigest&&selection.evidenceDigest===manifest.evidenceDigest&&
   manifest.sourceRef==='cutoff-v1:'+selection.requirementsDigest+':'+selection.evidenceDigest,'settlement-receipt-vector-changed',['cutoff-reassembly']);
  const input=await read(manifest.inputObject);
  demand(await hash(input)===sealed.inputDigest&&input.epoch===query.epoch&&input.cutoff===manifest.cutoffMs&&input.nowMs===manifest.asOfMs&&input.sourceRef===manifest.sourceRef,'settlement-input-digest');
  // The historical board commitment uses JSON.stringify insertion order for
  // SQL projections. Preserve that order while copying the live input, then
  // require canonical identity with the independently persisted B05 input.
  const current=JSON.parse(JSON.stringify(await repository.loadBoardInput({epoch:query.epoch,nowMs:manifest.asOfMs,sourceRef:manifest.sourceRef})));
  if(current.kind!=='loaded')return current;
  demand(current.inputDigest===sealed.inputDigest&&same(current.versions,versions)&&same(current.input,input),'input-revision-changed',['cutoff-reassembly']);
  const plan=computeBoard(current.input);if(plan.status!=='ready')return pending(plan.reason);
  const planDigest=await hash(plan),command=await createSettlementCommand(COMMIT_BOARD,{principal,requestKey:query.requestKey,nowMs:nat(clock.nowMs(),'now'),expectedRevisions:versions,
   input:{epoch:query.epoch,manifestDigest:sealed.manifestDigest,planDigest}},crypto);
  if(!await stable(versions,query.epoch,sealed.manifestDigest))return {kind:'conflict',code:'revision_conflict'};
  return {kind:'prepared',command,plan,dependencies:{manifestDigest:sealed.manifestDigest,inputDigest:sealed.inputDigest,requirementsDigest:manifest.requirementsDigest,evidenceDigest:manifest.evidenceDigest}};
 }
 async function allocation(principal,query){
  const nowMs=nat(clock.nowMs(),'now'),loaded=clone(await repository.loadAllocationPreparation({...query,nowMs}));if(loaded.kind!=='loaded')return loaded;
  const {versions,campaign,board}=loaded;
  try{
   if(typeof campaign.originalSupplyUnits!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(campaign.originalSupplyUnits))throw new TypeError('Canonical supply required.');
   // Season weight does not alter the shared supply-policy checks; preparation
   // does not select or persist any Vault allocation here.
   launchAllocations({supply:BigInt(campaign.originalSupplyUnits),activeSeasonWeight:0n});
  }catch{return pending('campaign-supply-policy',[query.tokenId]);}
  const window=allocationWindow(campaign.activationMs,query.day);
  if(nowMs<window.startsAtMs)return {...pending('allocation-scheduled',[query.tokenId+':'+query.day]),readyMs:window.startsAtMs};
  if(!board)return pending('board-required',['board:'+window.boardEpoch]);
  demand(board.epoch===window.boardEpoch&&board.status==='final'&&digest(board.snapshotId),'allocation-board-mismatch');
  demand(Array.isArray(board.winners)&&board.winners.length<=100,'allocation-winner-bound');
  const plan=computeAllocation({tokenId:query.tokenId,day:query.day,nowMs,originalSupplyUnits:campaign.originalSupplyUnits,activationMs:campaign.activationMs,board});
  if(plan.status!=='ready')return pending('allocation-'+plan.status);
  demand(plan.awards.reduce((sum,a)=>sum+BigInt(a.amountUnits),BigInt(plan.burnUnits))===BigInt(plan.budgetUnits),'allocation-conservation');
  const command=await createSettlementCommand(COMMIT_ALLOCATION,{principal,requestKey:query.requestKey,nowMs,expectedRevisions:versions,
   input:{tokenId:query.tokenId,day:query.day,boardDigest:board.snapshotId,planDigest:await hash(plan)}},crypto);
  if(!await stable(versions))return {kind:'conflict',code:'revision_conflict'};
  return {kind:'prepared',command,plan,dependencies:{boardDigest:board.snapshotId}};
 }
 return Object.freeze({
  async prepareBoard(principal,query){const c=capture(principal,query,['epoch','requestKey']);nat(c.query.epoch,'epoch');return bounded(()=>board(c.principal,c.query));},
  async prepareAllocation(principal,query){const c=capture(principal,query,['tokenId','day','requestKey']);name(c.query.tokenId,'token');requireValue(Number.isInteger(c.query.day)&&c.query.day>=1&&c.query.day<=10,'Invalid campaign day.');return bounded(()=>allocation(c.principal,c.query));},
 });
}
