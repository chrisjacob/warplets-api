import {Hono} from 'hono';
import {getCookie} from 'hono/cookie';
import {sessionOwner,sessionCookie} from './wallet';
import {createD1AtomicDriver} from '../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../security/web-crypto.mjs';
import {createFinancialVaultRepository} from '../../storage/financial-vault.mjs';
import {createFinancialFarmRepository} from '../../storage/financial-farms.mjs';
import {createFinancialReadService} from '../../financial/service.mjs';
import {handleFinancialReads} from '../../financial/http.mjs';
export const financialReads=new Hono<{Bindings:Env}>();
financialReads.all('*',async(c,next)=>{
 const driver=createD1AtomicDriver(c.env.DB),service=createFinancialReadService({vaultRepository:createFinancialVaultRepository(driver),farmRepository:createFinancialFarmRepository(driver),crypto:createWebCrypto(),clock:{nowMs:Date.now}});
 const response=await handleFinancialReads(c.req.raw,{service,authenticate:async(request)=>{const wallet=await sessionOwner(request,c.env.DB,getCookie(c,sessionCookie));return wallet?{kind:'wallet' as const,wallet}:null;}});
 if(response)return response;await next();
});
