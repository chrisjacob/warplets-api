import {measureBatch} from '../../../storage/atomic-driver.mjs';
import {createLegacyAdoptionActivation} from '../../../collect/legacy-adoption-activation.mjs';
import auditWorker from './legacy-adoption-activation-worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {dispatchImportedLifecycle} from '../../../collect/imported-lifecycle-test-harness.mjs';
// Fixture-only metering, including direct schema reads outside driver.batch.
function meteredDatabase(db:D1Database){
 const known=new WeakMap<object,any>(),metrics={sql:0,maxBatchBytes:0,maxParameters:0};
 const record=(statements:any[])=>{const m=measureBatch(statements);metrics.sql+=m.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);};
 function statement(raw:D1PreparedStatement,sql:string,values:unknown[]=[]):D1PreparedStatement{const proxy=new Proxy(raw,{get(target,key){if(key==='bind')return (...next:unknown[])=>statement(target.bind(...next),sql,next);if(['all','first','run','raw'].includes(String(key)))return (...args:any[])=>{record([{sql,values}]);return (target as any)[key](...args);};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;}});known.set(proxy,{sql,values,raw});return proxy;}
 const proxy=new Proxy(db,{get(target,key){if(key==='prepare')return (sql:string)=>statement(target.prepare(sql),sql);if(key==='batch')return (statements:D1PreparedStatement[])=>{const facts=statements.map(s=>known.get(s));if(facts.some(x=>!x))throw new Error('Unmetered fixture statement');record(facts);return target.batch(facts.map(x=>x.raw));};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;}});
 return {db:proxy,metrics};
}
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body=await request.clone().json() as any;
 if(body.phase==='audit'){
  const measured=meteredDatabase(env.DB),bindings={...env,DB:measured.db};
  if(body.method==='activate'){let sequence=0,metrics:any=null;const activation=createLegacyAdoptionActivation({driver:{...createD1AtomicDriver(measured.db),leaseNowSql:String(body.nowMs)},crypto:createWebCrypto(),clock:{nowMs:()=>body.nowMs},ids:{next:()=> 'synthetic-imported-activation-'+(++sequence)},onMeasure:(m:any)=>{metrics=m;}});return Response.json({result:await activation.activate(body.principal,body.input),sqlError:null,metrics,transportMetrics:measured.metrics});}
  const response=await auditWorker.fetch(request,bindings),result=await response.json() as any;return Response.json({...result,transportMetrics:measured.metrics},{status:response.status});
 }
 try{return Response.json(await dispatchImportedLifecycle({driver:createD1AtomicDriver(env.DB),crypto:createWebCrypto(),store:r2ArtifactStore(env.MANIFESTS),request:body}));}catch(error){return Response.json({error:String(error)},{status:409});}
}};
