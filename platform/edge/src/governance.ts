import {Hono} from 'hono';
import {getCookie} from 'hono/cookie';
import {sessionOwner,sessionCookie} from './wallet';
import {createD1AtomicDriver} from '../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../security/web-crypto.mjs';
import {createGovernanceRepository} from '../../governance/repository.mjs';
import {createGovernanceReadModel} from '../../governance/read-model.mjs';
import {createGovernanceService} from '../../application/governance-service.mjs';
import {handleInteractiveGovernance} from '../../governance/interactive-http.mjs';
export function createWorkerGovernanceService(db:D1Database,nowMs=Date.now()){
 const driver=createD1AtomicDriver(db),ports={crypto:createWebCrypto(),ids:{next:()=>crypto.randomUUID()},clock:{nowMs:()=>nowMs}};
 return createGovernanceService({repository:createGovernanceRepository(driver,ports),reads:createGovernanceReadModel(driver),...ports});
}
export const governance=new Hono<{Bindings:Env}>();
governance.all('/genesis/ballots*',async(c,next)=>{
 const at=Date.now(),service=createWorkerGovernanceService(c.env.DB,at);
 const response=await handleInteractiveGovernance(c.req.raw,{service,peer:'worker-loopback',
  authenticate:async(request:Request)=>{const wallet=await sessionOwner(request,c.env.DB,getCookie(c,sessionCookie));return wallet?{kind:'wallet' as const,wallet}:null;},
  consumeQuota:async(bucket:string,limit:number)=>{
   const row=await c.env.DB.prepare(`INSERT INTO request_limits VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN resets_at<=? THEN 1 ELSE hits+1 END,resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END RETURNING hits,resets_at`)
    .bind(bucket,at+60000,at,at).first<{hits:number;resets_at:number}>();
   if(!row||row.hits>limit)return new Response(JSON.stringify({error:{code:'rate_limited',message:'Please retry later.'}}),{status:429,headers:{'content-type':'application/json','retry-after':String(Math.max(1,Math.ceil(((row?.resets_at??at+60000)-at)/1000)))}});
   return null;
  }});
 if(response)return response;await next();
});
