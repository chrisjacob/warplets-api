import { handleAuth } from './auth.mjs';
import { readApi } from './api.mjs';
import { handleMarkets } from '../markets/catalog.mjs';
import { handleLaunchPlans } from '../launch/router.mjs';
import { handleInteractiveGovernance } from '../governance/interactive-http.mjs';
import { handleEarn } from '../earn/http.mjs';
import { handleWeb } from '../web/handler.mjs';
import { serveSite } from '../site/serve.mjs';
import {handleFinancialReads} from '../financial/http.mjs';
import { handleTransactions } from '../transactions/http.mjs';
import { represent } from '../contracts/transport.mjs';
import { handleCollect } from '../collect/http.mjs';
import { handleOperations } from '../operations/http.mjs';
import { handleNotifications } from '../notifications/http.mjs';
import { handleInteractiveQuotes } from '../quotes/interactive-http.mjs';
import { createNodeQuoteService,createNodeFinancialReadService,createNodeGovernanceService } from '../application/node-context.mjs';
import { consumeQuota,currentSession } from './auth.mjs';
export function createApp(db,{clock=Date.now,artifactStore}={}) {
  const quotes=createNodeQuoteService(db,{clock:{nowMs:clock},store:artifactStore});
  const financial=createNodeFinancialReadService(db,{clock:{nowMs:clock}});
  const governance=createNodeGovernanceService(db,{clock:{nowMs:clock}});
  let nextCleanup=0;
  return async function dispatch(request,peer='loopback'){
    const now=clock();
    if(now>=nextCleanup) {
      db.prepare('DELETE FROM request_limits WHERE bucket IN (SELECT bucket FROM request_limits WHERE resets_at<=? ORDER BY resets_at LIMIT 100)').run(now);
      db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=? ORDER BY expires_at LIMIT 100)').run(now);
      db.prepare('DELETE FROM auth_challenges WHERE nonce IN (SELECT nonce FROM auth_challenges WHERE expires_at<=? ORDER BY expires_at LIMIT 100)').run(now);
      nextCleanup=now+60000;
    }
    const response=await handleAuth(db,request,peer,now)??handleOperations(db,request,now)??await handleInteractiveQuotes(request,{service:quotes,peer,consumeQuota:async(bucket,limit)=>consumeQuota(db,bucket,now,limit)})??handleMarkets(db,request,now)??
      await handleFinancialReads(request,{service:financial,authenticate:async(req)=>{const session=currentSession(db,req,clock());return session?{kind:'wallet',wallet:session.wallet}:null;}})??handleTransactions(db,request,now)??await handleNotifications(db,request,peer,now)??
      await handleInteractiveGovernance(request,{service:governance,peer,authenticate:async(req)=>{const session=currentSession(db,req,clock());return session?{kind:'wallet',wallet:session.wallet}:null;},consumeQuota:async(bucket,limit)=>consumeQuota(db,bucket,now,limit)})??
      await handleEarn(db,request,peer,now)??
      await handleCollect(db,request,peer,now)??
      await handleLaunchPlans(request,{nowSeconds:Math.floor(now/1000)})??
      await serveSite(request,undefined,path=>{
        if(typeof path!=='string'||!path.startsWith('/api/v1/'))throw Error('Invalid public SSR resource.');
        return dispatch(new Request(new URL(path,request.url)),peer);
      })??await handleWeb(request)??readApi(request);
    return represent(request,response,now);
  };
}
