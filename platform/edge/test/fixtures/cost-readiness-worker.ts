// Private synthetic acceptance only. Calls actual B04/B15 and readonly metrics.
import economicWorker from './economic-plan-worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createQuoteRepository} from '../../../quotes/repository.mjs';
import {createQuoteService} from '../../../quotes/service.mjs';
import {createSwapPlanService} from '../../../transactions/swap-plan-service.mjs';
import {createEconomicPlanRepository} from '../../../storage/economic-plans.mjs';
import {createOperationalMetrics} from '../../../observability/metrics.mjs';
import {createCostReadinessRepository} from '../../../costs/readiness-repository.mjs';
import {createCostReadinessService} from '../../../costs/readiness-service.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../../../security/canonical.mjs';
export default {async fetch(request:Request,env:Env){const copy=request.clone(),body=await request.json() as any;
 if(body.request.method!=='readiness')return economicWorker.fetch(copy as Parameters<typeof economicWorker.fetch>[0],env);
 const r=body.request,raw=createD1AtomicDriver(env.DB),base=createWebCrypto();let now=r.nowMs,fired=0;
 const metrics={sqlStatements:0,batches:0,maxBatchBytes:0,maxParameters:0,maxResultBytes:0,reportBytes:0};
 const driver={...raw,get leaseNowSql(){return String(now);},async batch(statements:any[]){const m=measureBatch(statements);metrics.sqlStatements+=statements.length;metrics.batches++;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);const out=await raw.batch(statements);metrics.maxResultBytes=Math.max(metrics.maxResultBytes,utf8(canonicalJson(out.map(v=>v.rows))).length);return out;}},cryptoPort={...base,async sha256(bytes:Uint8Array){if(r.fault&&!fired&&new TextDecoder().decode(bytes).includes('"format":"10x.cost-readiness.v1"')){fired++;if(r.fault==='clock')now+=1000;if(r.fault==='source')await env.DB.prepare("UPDATE market_fixtures SET body=json_set(body,'$.readinessRace',1) WHERE id='persist-swap'").run();if(r.fault==='generation')await env.DB.prepare("UPDATE app_recovery_state SET generation='readiness-race' WHERE id=1").run();}return base.sha256(bytes);}},ports={crypto:cryptoPort,clock:{nowMs:()=>now},ids:{next:()=>crypto.randomUUID()}},quoteRepository=createQuoteRepository(driver,ports),quoteService=createQuoteService({...ports,repository:quoteRepository,store:r2ArtifactStore(env.MANIFESTS)}),swapPlans=createSwapPlanService({...ports,quoteRepository,quoteService}),economicPlans=createEconomicPlanRepository(driver,{...ports,quoteRepository,swapPlans}),repository=createCostReadinessRepository({...ports,driver,economicPlans,quoteRepository,metrics:createOperationalMetrics({driver,clock:ports.clock})}),service=createCostReadinessService({...ports,repository});
 try{const result=await service.read(r.query,r.planning??{});metrics.reportBytes=utf8(canonicalJson(result)).length;return Response.json({result,metrics,faultInjected:fired});}catch(error){return Response.json({error:String((error as Error).message),metrics,faultInjected:fired});}
}};
