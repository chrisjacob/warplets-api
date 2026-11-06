import {Hono} from 'hono';
import {getCookie} from 'hono/cookie';
import {sessionOwner,sessionCookie} from './wallet';
import {createD1AtomicDriver} from '../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../security/web-crypto.mjs';
import {createNotificationConsentService} from '../../notifications/consent.mjs';
import {createNotificationConsentRepository} from '../../storage/notification-consent.mjs';
import {handleNotificationConsent} from '../../notifications/consent-http.mjs';
export function createWorkerConsentService(db:D1Database,nowMs=Date.now()){
 const ports={crypto:createWebCrypto(),clock:{nowMs:()=>nowMs},ids:{next:()=>crypto.randomUUID()}};
 return createNotificationConsentService({...ports,repository:createNotificationConsentRepository(createD1AtomicDriver(db),ports)});
}
// No enqueue/delivery endpoint. Mount only after runtime acceptance/capability update.
export const notifications=new Hono<{Bindings:Env}>();
notifications.all('/notifications/*',async(c,next)=>{
 const at=Date.now(),service=createWorkerConsentService(c.env.DB,at);
 const response=await handleNotificationConsent(c.req.raw,{service,
  authenticate:async(request:Request)=>{const wallet=await sessionOwner(request,c.env.DB,getCookie(c,sessionCookie));return wallet?{kind:'wallet' as const,wallet}:null;},
  consumeQuota:async(bucket:string,limit:number)=>{
   const row=await c.env.DB.prepare(`INSERT INTO request_limits VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET
    hits=CASE WHEN resets_at<=? THEN 1 ELSE hits+1 END,resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END RETURNING hits,resets_at`)
    .bind(bucket,at+60000,at,at).first<{hits:number;resets_at:number}>();
   return !row||row.hits>limit?new Response(JSON.stringify({error:{code:'rate_limited',message:'Please retry later.'}}),{status:429,headers:{'content-type':'application/json','cache-control':'no-store','retry-after':String(Math.max(1,Math.ceil(((row?.resets_at??at+60000)-at)/1000)))}}):null;
  }});
 if(response)return response;await next();
});
