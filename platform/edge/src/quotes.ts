import {Hono} from 'hono';
import {createD1AtomicDriver} from '../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../artifacts/r2';
import {createQuoteRepository} from '../../quotes/repository.mjs';
import {createQuoteService} from '../../quotes/service.mjs';
import {handleInteractiveQuotes} from '../../quotes/interactive-http.mjs';
export function createWorkerQuoteService(db:D1Database,bucket:R2Bucket,clock={nowMs:Date.now}){
 const cryptoPort=createWebCrypto(),repository=createQuoteRepository(createD1AtomicDriver(db),{crypto:cryptoPort,ids:{next:()=>crypto.randomUUID()}});
 return createQuoteService({repository,store:r2ArtifactStore(bucket),crypto:cryptoPort,clock});
}
export const quotes=new Hono<{Bindings:Env}>();
quotes.all('*',async(c,next)=>{
 const at=Date.now(),response=await handleInteractiveQuotes(c.req.raw,{service:createWorkerQuoteService(c.env.DB,c.env.MANIFESTS),peer:'worker-loopback',
  consumeQuota:async(bucket,limit)=>{
   const row=await c.env.DB.prepare(`INSERT INTO request_limits VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN resets_at<=? THEN 1 ELSE hits+1 END,resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END RETURNING hits,resets_at`)
    .bind(bucket,at+60000,at,at).first<{hits:number;resets_at:number}>();
   return !row||row.hits>limit?new Response(JSON.stringify({error:{code:'rate_limited',message:'Please retry later.'}}),{status:429,headers:{'content-type':'application/json','retry-after':String(Math.max(1,Math.ceil(((row?.resets_at??at+60000)-at)/1000)))}}):null;
  }});
 if(response)return response;await next();
});
