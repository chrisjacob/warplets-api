import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createCollectionSourceRepository} from './source-repository.mjs';
import {createCollectionSourceIntake} from './source-intake.mjs';
import {canonicalStateFixture,stateBundle,legacyStateTestCrypto as crypto} from './legacy-state-audit.fixtures.mjs';
import {createLegacySourceRelationAudit} from './legacy-source-relation.mjs';
export {crypto};
export const principal={kind:'operator',id:'synthetic-source-relation-auditor'};
export const legacyJson=state=>JSON.stringify(state,(_k,v)=>typeof v==='bigint'?{$lamports:v.toString()}:v);
export async function relationFixture(t,{state=canonicalStateFixture(),mutateRaw=raw=>raw}={}){
 const db=openDatabase();t.after(()=>db.close());const driver=createNodeAtomicDriver(db),ports={crypto,ids:{next:randomUUID},clock:{nowMs:()=>1800000000000}};
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-import');
 const raw=mutateRaw(legacyJson(state));db.prepare("INSERT INTO collect_inventories VALUES(?,?,?, ?,?,?,?,'synthetic-origin')").run(state.id,state.kind,state.tranche??null,state.kind==='season'?1700000000000:null,state.kind==='season'?'2023-11':null,state.version,raw);
 const {bundle,records}=await stateBundle(state),intake=createCollectionSourceIntake({...ports,repository:createCollectionSourceRepository(driver,ports)});
 for(const record of records.values())assert.equal((await intake.stageRecord(principal,{record,requestKey:record.id})).kind,'committed');
 for(const list of bundle.listManifests)assert.equal((await intake.sealList(principal,{id:list.id,requestKey:list.id})).kind,'committed');
 assert.equal((await intake.sealSource(principal,{id:bundle.root.id,requestKey:bundle.root.id})).kind,'committed');
 const input={inventoryId:state.id,rootId:bundle.root.id,checkpoint:null},service=createLegacySourceRelationAudit({driver,crypto});
 return {db,driver,ports,raw,state,bundle,records,input,service};
}
export async function runRelation(service,input,{limit=4000,onStep=()=>{}}={}){let checkpoint=input.checkpoint,steps=0,maxWorkingBytes=0,maxOperations=0,maxBatchBytes=0,maxResultBytes=0;
 while(steps<limit){const result=await service.step({...input,checkpoint});steps++;for(const [name,key]of [['maxWorkingBytes','maxWorkingBytes'],['maxOperations','operations'],['maxBatchBytes','maxBatchBytes'],['maxResultBytes','resultBytes']]){if(name==='maxWorkingBytes')maxWorkingBytes=Math.max(maxWorkingBytes,result.metrics[key]);if(name==='maxOperations')maxOperations=Math.max(maxOperations,result.metrics[key]);if(name==='maxBatchBytes')maxBatchBytes=Math.max(maxBatchBytes,result.metrics[key]);if(name==='maxResultBytes')maxResultBytes=Math.max(maxResultBytes,result.metrics[key]);}await onStep(result);if(result.kind!=='continue')return {result,steps,maxWorkingBytes,maxOperations,maxBatchBytes,maxResultBytes};checkpoint=JSON.parse(JSON.stringify(result.checkpoint));}throw Error('Synthetic relation continuation bound');
}
