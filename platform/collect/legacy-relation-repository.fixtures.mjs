import assert from 'node:assert/strict';
import {relationFixture,principal,crypto} from './legacy-source-relation.fixtures.mjs';
import {nativeTranscriptFixture,canonicalStateFixture} from './legacy-state-audit.fixtures.mjs';
import {readInstalledRecoverySchema} from '../recovery/node-schema.mjs';
import {createLegacyAuditRepository} from './legacy-audit-repository.mjs';
import {createLegacyRelationRepository} from './legacy-relation-repository.mjs';
export {principal,crypto};
export async function relationRepositoryFixture(t,{state=canonicalStateFixture({stages:1,members:101,admissions:2}),mutateRaw,prepareParent=true}={}){
 const f=await relationFixture(t,{state,...(mutateRaw?{mutateRaw}:{})});f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run('synthetic-other-auditor','collection-import');
 const schema=await readInstalledRecoverySchema(crypto),hash=nativeTranscriptFixture(),parentPorts={...f.ports,schema,driver:f.driver,createHashAdapter:()=>hash},parentService=createLegacyAuditRepository(parentPorts),parentInput={auditId:'synthetic-relation-fingerprints',inventoryId:state.id,rootId:f.bundle.root.id};
 let parent=null;if(prepareParent){parent=await parentService.start(principal,parentInput);for(let n=0;n<500&&['started','progress','replayed'].includes(parent.kind);n++)parent=await parentService.step(principal,{auditId:parentInput.auditId,expectedRevision:parent.revision});assert.equal(parent.kind,'fingerprints-ready',JSON.stringify(parent));}
 const measurements=[],ports={...f.ports,driver:f.driver,onMeasure:m=>measurements.push(m)},service=createLegacyRelationRepository(ports),input={auditId:'synthetic-durable-relation',fingerprintAuditId:parentInput.auditId};return {...f,pureInput:f.input,input,parent,parentInput,parentService,parentPorts,schema,measurements,ports,service};
}
export async function driveRelation(f,result,{limit=500,onStep=()=>{}}={}){let steps=0;while(['started','progress','replayed'].includes(result.kind)&&steps++<limit){result=await f.service.step(principal,{auditId:f.input.auditId,expectedRevision:result.revision});await onStep(result);}return result;}
export function maximalRelationState({members=10000}={}){
 const state=canonicalStateFixture({stages:32,members:1,admissions:1000,explicitNull:true});state.stages[0].wallets=canonicalStateFixture({stages:1,members,admissions:0}).stages[0].wallets;
 for(const stage of state.stages){const old=stage.id;stage.id=old.padEnd(128,'x');stage.inventoryOverrideReason='雪'.repeat(500);for(const row of state.admissions)if(row.stageId===old)row.stageId=stage.id;}
 const levels=state.remaining.flatMap((count,index)=>Array(count).fill(index+1));for(const [index,row]of state.admissions.entries()){row.operationId=row.operationId.padEnd(128,'x');row.drawCommitment=row.drawCommitment.padEnd(128,'x');row.proofId=('synthetic-proof-'+index).padEnd(128,'x');row.level=levels[index];row.ticket=0;row.costLamports=18446744073709551615n;}state.fulfilled=1000;state.remaining=Array(10).fill(0);return state;
}
