import {createInventoryReadRepository} from '../../collect/inventory-read-model.mjs';
import {handleInventoryReads} from '../../collect/inventory-read-http.mjs';
import {Hono} from 'hono';
import {getCookie} from 'hono/cookie';
import {sessionOwner,sessionCookie} from './wallet';
import {createD1AtomicDriver} from '../../storage/d1/atomic-driver';
import {createCollectionReadRepository} from '../../collect/read-model.mjs';
import {handleCollectionReads} from '../../collect/read-http.mjs';
export const collectionReads=new Hono<{Bindings:Env}>();
collectionReads.all('/collect/*',async(c,next)=>{
 const driver=createD1AtomicDriver(c.env.DB),common={clock:{nowMs:Date.now},
  authenticate:async (request:Request)=>{const wallet=await sessionOwner(request,c.env.DB,getCookie(c,sessionCookie));return wallet?{kind:'wallet' as const,wallet}:null;},
  consumeQuota:async(bucket:string,limit:number)=>{
   const at=Date.now(),row=await c.env.DB.prepare(`INSERT INTO request_limits VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN resets_at<=? THEN 1 ELSE hits+1 END,resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END RETURNING hits,resets_at`)
    .bind(bucket,at+60000,at,at).first<{hits:number;resets_at:number}>();
   if(!row||row.hits>limit)return new Response(JSON.stringify({error:{code:'rate_limited',message:'Please retry later.'}}),{status:429,headers:{'content-type':'application/json','cache-control':'no-store','retry-after':String(Math.max(1,Math.ceil(((row?.resets_at??at+60000)-at)/1000)))}});
   return null;
  }};
 const response=await handleInventoryReads(c.req.raw,{...common,reads:createInventoryReadRepository(driver)})??await handleCollectionReads(c.req.raw,{...common,reads:createCollectionReadRepository(driver)});
 if(response)return response;await next();
});
