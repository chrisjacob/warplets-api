import {createCollectionObservationRepository} from '../../../collect/observation-repository.mjs';
import {buildCollectionObservationCommand} from '../../../collect/observation-service.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
import {OBSERVATION_TEST_OPERATOR} from '../../../collect/observation-test-harness.mjs';
// Disposable synthetic acceptance control. No public observation route.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {dispatchCollectionObservation} from '../../../collect/observation-test-harness.mjs';
import {dispatchProgressionReservation} from '../../../collect/reservation-test-harness.mjs';
async function operatorObservation({driver:base,crypto,store,request}:any){
 let sequence=0,injected=false;const metrics={statements:0,batches:0,maxBatchBytes:0,maxParameters:0,maxResultBytes:0,objectReads:0};
 const driver={...base,leaseNowSql:String(request.nowMs),async batch(statements:any[]){const m=measureBatch(statements);metrics.statements+=m.statements;metrics.batches++;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);const selected=statements.flatMap(s=>{if(!s.sql.startsWith('INSERT INTO ops_config_audit')||!request.fault)return [s];injected=true;if(request.fault==='omit-audit')return [];const values=[...s.values];values[7]='synthetic-altered-audit-actor';return [{...s,values}];});const rows=await base.batch(selected);metrics.maxResultBytes=Math.max(metrics.maxResultBytes,new TextEncoder().encode(JSON.stringify(rows)).length);return rows;}};
 const artifacts={...store,async getVerified(identity:any){metrics.objectReads++;return store.getVerified(identity);}},ports={crypto,clock:{nowMs:()=>request.nowMs},artifacts,ids:{next:()=>request.idPrefix+'-'+(++sequence)}},repo=createCollectionObservationRepository(driver,ports);
 try{const c=await buildCollectionObservationCommand({kind:'operator',id:OBSERVATION_TEST_OPERATOR.id},request.input,crypto),result=await (request.method==='preview'?repo.previewObservation!(c):repo.observe(c));return {status:200,result,injected,metrics};}catch(error:any){return {status:500,error:injected?'mandatory-audit-aborted':error.message,injected,metrics};}
}

export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body=await request.json() as any,ports={driver:createD1AtomicDriver(env.DB),crypto:createWebCrypto(),request:body};
 return Response.json(body.operator?await operatorObservation({...ports,store:r2ArtifactStore(env.MANIFESTS)}):body.lane==='reservation'?await dispatchProgressionReservation(ports):await dispatchCollectionObservation({...ports,store:r2ArtifactStore(env.MANIFESTS)}));
}};
