// Private local acceptance worker; no application route or financial capability.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {quoteTestDispatch} from '../../../quotes/guarded-test-harness.mjs';
import {createQuoteRepository} from '../../../quotes/repository.mjs';
import {createQuoteService} from '../../../quotes/service.mjs';
import {createSwapPlanService} from '../../../transactions/swap-plan-service.mjs';
export default {async fetch(request:Request,env:Env){
 const body=await request.json() as any,raw=createD1AtomicDriver(env.DB),base=createWebCrypto(),store=r2ArtifactStore(env.MANIFESTS);
 if(body.request.method!=='prepare')return Response.json(await quoteTestDispatch({driver:raw,store,crypto:base,ids:{next:()=>crypto.randomUUID()},fixture:body.fixture,request:body.request}));
 let now=body.request.nowMs,fired=0;const metrics={sqlStatements:0,objectReads:0,objectWrites:0};
 const driver={...raw,async batch(statements:any[]){metrics.sqlStatements+=statements.length;return raw.batch(statements);}};
 const c={...base,async sha256(bytes:Uint8Array){const result=await base.sha256(bytes);if(new TextDecoder().decode(bytes).includes('"kind":"prepared-economic-plan"')){
  if(body.request.fault==='expire'){now+=30001;fired++;}
  if(body.request.fault==='change-context'){fired++;await env.DB.prepare("UPDATE market_fixtures SET body=json_set(body,'$.fixtureExtra',?) WHERE id=?").bind(fired,body.request.input.request.parameters.marketId).run();}
 }return result;}};
 const artifacts={...store,async getVerified(identity:any){metrics.objectReads++;return store.getVerified(identity);}},clock={nowMs:()=>now};
 const repository=createQuoteRepository(driver,{crypto:c,ids:{next:()=>crypto.randomUUID()}}),quotes=createQuoteService({repository,store:artifacts,crypto:c,clock});
 return Response.json({result:await createSwapPlanService({quoteRepository:repository,quoteService:quotes,crypto:c,clock}).prepare(body.request.input),metrics,faultInjected:fired});
}};
