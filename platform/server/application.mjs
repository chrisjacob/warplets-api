import { handleAuth } from './auth.mjs';
import { readApi } from './api.mjs';
import { handleMarkets } from '../markets/catalog.mjs';
import { handleLaunchPlans } from '../launch/router.mjs';
import { handleBallots } from '../governance/ballots.mjs';
import { handleEarn } from '../earn/http.mjs';
export function createApp(db,{clock=Date.now}={}) {
  let nextCleanup=0;
  return async (request,peer='loopback')=>{
    const now=clock();
    if(now>=nextCleanup) {
      db.prepare('DELETE FROM request_limits WHERE resets_at<=?').run(now);
      db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
      db.prepare('DELETE FROM auth_challenges WHERE expires_at<=?').run(now);
      nextCleanup=now+60000;
    }
    return await handleAuth(db,request,peer,now)??handleMarkets(db,request,now)??
      await handleBallots(db,request,peer,now)??
      await handleEarn(db,request,peer,now)??
      await handleLaunchPlans(request,{nowSeconds:Math.floor(now/1000)})??readApi(request);
  };
}
