// Synthetic historical local fixtures: retained originals are captured at publication.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {legacyAdmissionFixture,legacyAdmissionWallet,LEGACY_ADMISSION_FIXTURE_START as START,DAY} from './legacy-admission-audit.fixtures.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeRecoveryDigest} from '../recovery/v2-node-digest.mjs';
import {createCollectionStateCodec} from './state-codec.mjs';
import {createCollectionSourceRepository} from './source-repository.mjs';
import {createCollectionSourceIntake} from './source-intake.mjs';
import {createEligibilityIndexService} from './eligibility-index-service.mjs';
import {createEligibilityIndexRepository} from './eligibility-index-repository.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createLegacyStageSource} from './legacy-stage-source.mjs';
export {legacyAdmissionWallet,START,DAY};
export const stageSourceTables=['app_operator_scopes','collect_inventories','genesis_ballots','genesis_voters','app_command_receipts','app_collection_records','app_collection_list_seals','app_collection_source_seals','app_collection_eligibility_pages'];
export function stageSourceScene(t,options={}){return legacyAdmissionFixture(t,options);}
export async function retainStageSources(f,{omitIndex=false,omitOriginalSeal=false}={}){
 const {db,crypto}=f,driver=createNodeAtomicDriver(db),ports={crypto,ids:{next:randomUUID},clock:{nowMs:()=>START+30*DAY}},codec=createCollectionStateCodec({crypto}),artifacts=memoryArtifacts(),principal={kind:'operator',id:'synthetic-stage-source'},preimages=new Map(),identities=new Map(),originalLists=new Map();
 db.prepare('INSERT OR IGNORE INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-import');
 const row=db.prepare('SELECT * FROM collect_inventories WHERE id=?').get(f.inventoryId),state=JSON.parse(row.state,(_k,v)=>v&&typeof v==='object'&&Object.hasOwn(v,'$lamports')?BigInt(v.$lamports):v),bundle=await codec.encodeReferenceInventory(state),records=new Map([bundle.root,...bundle.listManifests,...bundle.pages].map(r=>[r.id,r])),lists=new Map(bundle.listManifests.map(r=>[r.id,r]));
 async function retain(value){const bytes=utf8(canonicalJson(value)),byteDigest=await crypto.sha256(bytes),identity={key:'private/'+byteDigest+'.json',byteDigest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/json'};await artifacts.putIfAbsent(identity,bytes);return identity;}
 for(const [id,s]of f.originals){const originalList=await codec.encodeWalletList([...new Set(s.wallets??[])].sort());for(const record of [originalList.manifest,...originalList.pages])records.set(record.id,record);lists.set(originalList.manifest.id,originalList.manifest);originalLists.set(id,originalList);const p={format:'legacy-stage-publication-preimage-v1',inventoryId:f.inventoryId,stageId:id,type:s.type,publishedAt:s.publishedAt,opensAt:s.opensAt,closesAt:s.closesAt,priceLamports:s.priceLamports,costLamports:s.costLamports,allocation:s.allocation,walletLimit:s.walletLimit??null,founderApproved:s.founderApproved??false,approvedSpendLamports:s.approvedSpendLamports??null,ballotId:s.ballotId??null,inventoryOverrideReason:s.inventoryOverrideReason??null,walletListId:originalList.manifest.id};preimages.set(id,p);identities.set(id,await retain(p));}
 const intake=createCollectionSourceIntake({...ports,repository:createCollectionSourceRepository(driver,ports)}),indexer=createEligibilityIndexService({...ports,repository:createEligibilityIndexRepository(driver,ports)});
 for(const record of records.values())assert.ok(['committed','replayed'].includes((await intake.stageRecord(principal,{record,requestKey:record.id})).kind));
 for(const record of lists.values())if(!omitOriginalSeal||bundle.listManifests.some(x=>x.id===record.id))assert.ok(['committed','replayed'].includes((await intake.sealList(principal,{id:record.id,requestKey:record.id})).kind));
 for(const record of records.values())if(!omitIndex&&JSON.parse(new TextDecoder().decode(record.bytes)).kind==='eligibility')assert.ok(['committed','replayed'].includes((await indexer.materializePage(principal,{id:record.id,requestKey:record.id})).kind));
 assert.equal((await intake.sealSource(principal,{id:bundle.root.id,requestKey:bundle.root.id})).kind,'committed');
 const source=readStageSourcePin(db,f.inventoryId),service=createLegacyStageSource({...ports,driver,artifacts,createDigest:createNodeRecoveryDigest}),input=id=>({rootId:bundle.root.id,stageIndex:state.stages.findIndex(s=>s.id===id),original:identities.get(id),source});
 return {...f,ports,driver,artifacts,records,bundle,state,preimages,identities,originalLists,source,service,input,retain};
}
export function readStageSourcePin(db,id){return db.prepare('SELECT c.id inventoryId,CAST(c.revision AS TEXT) sourceRevision,r.generation,w.revision watermark FROM collect_inventories c CROSS JOIN app_recovery_state r CROSS JOIN app_recovery_watermark w WHERE c.id=? AND r.id=1 AND w.id=1').get(id);}
