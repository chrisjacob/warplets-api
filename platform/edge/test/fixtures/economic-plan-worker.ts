// Private synthetic acceptance control. No public endpoint or external services.
import quoteWorker from './swap-plan-worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createQuoteRepository} from '../../../quotes/repository.mjs';
import {createQuoteService} from '../../../quotes/service.mjs';
import {createSwapPlanService} from '../../../transactions/swap-plan-service.mjs';
import {createEconomicPlanRepository} from '../../../storage/economic-plans.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
export default {async fetch(request:Request,env:Env){
 const copy=request.clone(),body=await request.json() as any;if(!['persist','read-economic'].includes(body.request.method))return quoteWorker.fetch(copy as Parameters<typeof quoteWorker.fetch>[0],env);
 const r=body.request,cryptoPort=createWebCrypto(),raw=createD1AtomicDriver(env.DB),store=r2ArtifactStore(env.MANIFESTS);let fired=0;
 const metrics={sqlStatements:0,maxBatchBytes:0,maxParameters:0,objectReads:0,objectWrites:0};
 // Trusted fixture SQL clock mirrors the scenario; explicit late-claim fault.
 const driver={...raw,leaseNowSql:String(r.nowMs+(r.fault==='clock'?30001:0)),async batch(statements:any[]){
  const commit=statements.some(s=>s.sql.startsWith('INSERT INTO app_economic_preparations'));
  if(commit){
   if(r.fault==='omit-intent'){statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_economic_intents'));fired++;}
   if(r.fault==='omit-preparation'){statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_economic_preparations'));fired++;}
   if(r.fault==='source'){fired++;await env.DB.prepare("UPDATE market_fixtures SET body=json_set(body,'$.fixtureRace',1) WHERE id=?").bind(r.input.request.parameters.marketId).run();}
   if(r.fault==='clock')fired++;
   if(r.fault==='generation'){fired++;await env.DB.prepare("UPDATE app_recovery_state SET generation='changed' WHERE id=1").run();}
  }
  const m=measureBatch(statements);metrics.sqlStatements+=statements.length;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);
  const out=await raw.batch(statements);if(commit&&r.fault==='lose'){fired++;throw Error('Synthetic committed response lost');}return out;
 }};
 const artifacts={...store,async getVerified(i:any){metrics.objectReads++;return store.getVerified(i);}},ports={crypto:cryptoPort,clock:{nowMs:()=>r.nowMs},ids:{next:()=>crypto.randomUUID()}},quoteRepository=createQuoteRepository(driver,ports),quoteService=createQuoteService({...ports,repository:quoteRepository,store:artifacts}),swapPlans=createSwapPlanService({...ports,quoteRepository,quoteService}),repo=createEconomicPlanRepository(driver,{...ports,quoteRepository,swapPlans});
 try{return Response.json({result:r.method==='persist'?await repo.prepare(r.input):await repo.read(r.input),metrics,faultInjected:fired});}
 catch(error){return Response.json({error:String((error as Error).message),metrics,faultInjected:fired});}
}};
