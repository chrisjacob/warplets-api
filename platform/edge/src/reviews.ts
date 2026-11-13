import {Hono} from 'hono';
import {getCookie} from 'hono/cookie';
import {sessionOwner,sessionCookie} from './wallet';
import {createD1AtomicDriver} from '../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../security/web-crypto.mjs';
import {createReviewFeedbackService} from '../../ai-review/portable-queue-service.mjs';
import {handleReviewQueue} from '../../ai-review/queue-http.mjs';

// Owner feedback and appeals only. No provider, capture or processing route.
export const reviews=new Hono<{Bindings:Env}>();
reviews.all('/earn/submissions/:submissionId/:action',async(c,next)=>{
 const at=Date.now(),service=createReviewFeedbackService({driver:createD1AtomicDriver(c.env.DB),crypto:createWebCrypto(),clock:{nowMs:()=>at}});
 const response=await handleReviewQueue(c.req.raw,{service,
  authenticate:async(request:Request)=>{const wallet=await sessionOwner(request,c.env.DB,getCookie(c,sessionCookie));return wallet?{kind:'wallet' as const,wallet}:null;},
  consumeQuota:async(bucket:string,limit:number)=>{
   const row=await c.env.DB.prepare(`INSERT INTO request_limits SELECT ?,?,1 WHERE NOT EXISTS(SELECT 1 FROM app_recovery_state WHERE mode='public' OR status IN ('restoring','held')) ON CONFLICT(bucket) DO UPDATE SET
    hits=CASE WHEN resets_at<=? THEN 1 ELSE hits+1 END,resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END WHERE NOT EXISTS(SELECT 1 FROM app_recovery_state WHERE mode='public' OR status IN ('restoring','held')) RETURNING hits,resets_at`)
    .bind(bucket,at+60000,at,at).first<{hits:number;resets_at:number}>();
   if(!row)return Response.json({error:{code:'review_unavailable',message:'Review access is paused during recovery.'}},{status:409,headers:{'cache-control':'no-store'}});
   if(row.hits>limit)return Response.json({error:{code:'rate_limited',message:'Please retry later.'}},{status:429,headers:{'cache-control':'no-store','retry-after':String(Math.max(1,Math.ceil(((row?.resets_at??at+60000)-at)/1000)))}});
   return null;
  }});
 if(response)return response;await next();
});
