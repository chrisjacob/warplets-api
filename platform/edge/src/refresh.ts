import {Hono} from 'hono';
import {getCookie} from 'hono/cookie';
import {sessionOwner,sessionCookie} from './wallet';
import {createD1AtomicDriver} from '../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../artifacts/r2';
import {createAtomicReceipts} from '../../storage/atomic-receipts.mjs';
import {createRefreshRepository} from '../../nfts/refresh-repository.mjs';
import {createRefreshOwnerService} from '../../nfts/refresh-owner-service.mjs';
import {handleRefreshOwner} from '../../nfts/refresh-owner-http.mjs';
// Intentionally bounded ephemeral review tokens, not workflow state or cached views.
// Isolate loss permits accepted-receipt lookup only; it never recreates a command.
const preparations=new Map();
export const refreshOwner=new Hono<{Bindings:Env}>();
refreshOwner.all('/nfts/refreshes/*',async(c,next)=>{const driver=createD1AtomicDriver(c.env.DB),crypto=createWebCrypto(),clock={nowMs:Date.now},ids={next:()=>globalThis.crypto.randomUUID()},ports={crypto,clock,ids,artifacts:r2ArtifactStore(c.env.MANIFESTS)},live=async(a:any)=>!!await c.env.DB.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND wallet=? AND origin=? AND expires_at>?').bind(a.sessionHash,a.principal.wallet,a.origin,Date.now()).first();
 const service=createRefreshOwnerService({...ports,preparations,authorize:live,repositoryFor:(a:any)=>createRefreshRepository(driver,{...ports,authoritySnapshot:()=>({sql:"EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND wallet=? AND origin=? AND expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER))",values:[a.sessionHash,a.principal.wallet,a.origin]})}),replayFor:(a:any,command:any)=>createAtomicReceipts(driver,ports).replay(command)});
 const response=await handleRefreshOwner(c.req.raw,{service,authenticate:async(req:Request)=>{const raw=getCookie(c,sessionCookie),wallet=await sessionOwner(req,c.env.DB,raw);return wallet&&raw?{principal:{kind:'wallet',wallet},sessionHash:await crypto.sha256(new TextEncoder().encode(raw)),origin:new URL(req.url).origin}:null;},consumeQuota:async(bucket:string,limit:number)=>{const at=Date.now(),r=await c.env.DB.prepare('INSERT INTO request_limits VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN resets_at<=? THEN 1 ELSE hits+1 END,resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END RETURNING hits').bind(bucket,at+60000,at,at).first<{hits:number}>();return !r||r.hits>limit?new Response(JSON.stringify({error:{code:'rate_limited',message:'Please retry later.'}}),{status:429,headers:{'content-type':'application/json','cache-control':'private, no-store'}}):null;}});if(response)return response;await next();});
