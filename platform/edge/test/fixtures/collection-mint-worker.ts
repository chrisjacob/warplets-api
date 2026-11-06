import worker from '../../src/worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {dispatchMintReservation} from '../../../collect/mint-test-harness.mjs';
// Synthetic fixture-only entry; no public mint route is mounted by this slice.
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 if(new URL(request.url).pathname!=='/__fixture/mint')return worker.fetch(request,env,ctx);
 const body=await request.json() as {nowMs:number};if(!Number.isSafeInteger(body.nowMs)||body.nowMs<0)return Response.json({error:'Invalid fixture clock.'},{status:400});
 return Response.json(await dispatchMintReservation({driver:createD1AtomicDriver(env.DB),crypto:createWebCrypto(),request:body}));
}};
