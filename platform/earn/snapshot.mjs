import {canonicalJson,utf8} from '../security/canonical.mjs';
import {buildRequirementSpecs,selectRequirementReceipts} from '../evidence/requirements.mjs';
import {createSnapshotAttemptCommand} from '../storage/cutoff-snapshot.mjs';
import {createSettlementCommand,SEAL_INPUT} from '../storage/atomic-settlement.mjs';
import {computeBoard} from './settlement.mjs';
const clone=value=>JSON.parse(canonicalJson(value)),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const accepted=r=>r.kind==='committed'||r.kind==='replayed';
const conflict=()=>({kind:'conflict',code:'revision_conflict'});
// This service is internal. Financial paths and public publication are absent.
// A frozen SQL value is admitted only with matching complete current evidence;
// all reads and the final seal compare the same dependency revision vector.
export function createCutoffSnapshotService({repository,settlementRepository,privateReferences,crypto,clock}){
 const hash=value=>crypto.sha256(utf8(canonicalJson(value)));
 async function persist(principal,value,semanticDigest=null){
  const bytes=utf8(canonicalJson(value));
  if(bytes.length>256*1024)return {kind:'pending',reason:'manifest-page-bound',dependencyIds:[]};
  const byteDigest=await crypto.sha256(bytes),identity={key:'private/'+byteDigest+'.json',byteDigest,size:bytes.length,semanticDigest,visibility:'private',contentType:'application/json'};
  const result=await privateReferences.persist(principal,{identity,bytes,requestKey:byteDigest});
  const reused=result.code==='artifact_reference_exists'&&await repository.hasPrivateObject(identity);
  return accepted(result)||reused?{kind:'stored',identity}:result;
 }
 async function pages(principal,kind,items){
  const result=[];let page=[];
  const save=async()=>{const stored=await persist(principal,{version:1,kind,index:result.length,items:page});if(stored.kind!=='stored')return stored;result.push(stored.identity);page=[];return null;};
  for(const item of items){
   if(utf8(canonicalJson({version:1,kind,index:result.length,items:[...page,item]})).length>256*1024){
    if(!page.length)return {kind:'pending',reason:'manifest-item-bound',dependencyIds:[]};
    const failure=await save();if(failure)return failure;
   }page.push(item);
  }
  if(page.length||!result.length){const failure=await save();if(failure)return failure;}
  return {kind:'stored',pages:result};
 }
 return Object.freeze({async assemble(principal,query){
  principal=clone(principal);query=clone(query);
  const inventory=await repository.loadInventory({...query,nowMs:clock.nowMs()});if(inventory.kind!=='loaded')return inventory;
  const specs=await buildRequirementSpecs(inventory.inputs,crypto),heads=await repository.selectHeads(specs);
  const selection=await selectRequirementReceipts(specs,heads,crypto);
  if(!same(inventory.versions,await repository.readVersions()))return conflict();
  const sourceRef='cutoff-v1:'+selection.requirementsDigest+':'+selection.evidenceDigest;
  let loaded=null;
  if(selection.kind==='ready'){
   loaded=await repository.loadBoardInput({epoch:query.epoch,nowMs:inventory.asOfMs,sourceRef});
   if(loaded.kind!=='loaded')return loaded;
   if(!same(inventory.versions,loaded.versions))return conflict();
   const plan=computeBoard(loaded.input);
   if(plan.status!=='ready')return {kind:'pending',reason:plan.reason,dependencyIds:[]};
  }
  const artifacts={};
  for(const [kind,items] of [['frozen-facts',inventory.inputs],['requirements',selection.requirements],['evidence',selection.evidence],['dependencies',selection.dependencies]]){
   const result=await pages(principal,kind,items);if(result.kind!=='stored')return result;artifacts[kind]=result.pages;
  }
  let inputObject=null;
  if(loaded){const stored=await persist(principal,loaded.input);if(stored.kind!=='stored')return stored;inputObject=stored.identity;}
  const manifest={version:1,mode:'synthetic-fixture',epoch:query.epoch,cutoffMs:inventory.cutoff,asOfMs:inventory.asOfMs,
   status:selection.kind==='ready'?'ready':'pending',admissionDigest:inventory.freeze.admission_digest,dependencyVersions:inventory.versions,
   requirementsDigest:selection.requirementsDigest,evidenceDigest:selection.evidenceDigest,sourceRef,artifacts,inputObject,inputDigest:loaded?.inputDigest??null};
  const manifestDigest=await hash(['cutoff-manifest-v1',manifest]),root=await persist(principal,manifest,manifestDigest);if(root.kind!=='stored')return root;
  const metadata={epoch:query.epoch,status:manifest.status,manifestDigest,objectKey:root.identity.key,byteDigest:root.identity.byteDigest,
   requirementsDigest:selection.requirementsDigest,evidenceDigest:selection.evidenceDigest,inputDigest:manifest.inputDigest};
  const recorded=await repository.recordAttempt(await createSnapshotAttemptCommand({principal,input:metadata,nowMs:clock.nowMs(),expectedRevisions:inventory.versions},crypto));
  if(!accepted(recorded))return recorded;
  if(!loaded)return {kind:'pending',reason:'snapshot-dependencies',dependencyIds:selection.dependencies.map(d=>d.id),manifestDigest};
  const previousManifestDigest=await repository.readPointer(query.epoch);
  if(previousManifestDigest===manifestDigest)return {kind:'replayed',value:metadata};
  const command=await createSettlementCommand(SEAL_INPUT,{principal,requestKey:manifestDigest,nowMs:clock.nowMs(),expectedRevisions:inventory.versions,
   input:{epoch:query.epoch,manifestDigest,inputDigest:loaded.inputDigest,objectKey:root.identity.key,byteDigest:root.identity.byteDigest,asOfMs:inventory.asOfMs,sourceRef,previousManifestDigest}},crypto);
  return settlementRepository.sealBoardInput(command);
 }});
}
