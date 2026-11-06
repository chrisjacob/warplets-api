import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {dispatchCollectionCut} from '../../../collect/free-cut-test-harness.mjs';
// Private local fixture only; no public cut or free mint authority is mounted.
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 const body=await request.json() as {nowMs:number};if(!Number.isSafeInteger(body.nowMs)||body.nowMs<0)return new Response('Invalid fixture clock',{status:400});
 return Response.json(await dispatchCollectionCut({driver:createD1AtomicDriver(env.DB),crypto:createWebCrypto(),request:body}));
}};
