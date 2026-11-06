import {Hono} from 'hono';
import {getCookie} from 'hono/cookie';
import {sessionOwner,sessionCookie} from './wallet';
import {createD1AtomicDriver} from '../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../security/web-crypto.mjs';
import {createActionRecoveryReadRepository} from '../../transactions/recovery-reads.mjs';
import {handleActionRecovery} from '../../transactions/recovery-http.mjs';
export const transactions=new Hono<{Bindings:Env}>();
transactions.all('/transactions/*',async(c,next)=>{
 const repository=createActionRecoveryReadRepository(createD1AtomicDriver(c.env.DB),{crypto:createWebCrypto(),clock:{nowMs:Date.now}});
 const response=await handleActionRecovery(c.req.raw,{repository,authenticate:async(request:Request)=>{const wallet=await sessionOwner(request,c.env.DB,getCookie(c,sessionCookie));return wallet?{kind:'wallet' as const,wallet}:null;}});
 if(response)return response;await next();
});
