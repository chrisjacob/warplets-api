// Private local fixture only; no progression quote route is exposed publicly.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {dispatchCollectionQuote} from '../../../collect/quote-test-harness.mjs';
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 return Response.json(await dispatchCollectionQuote({driver:createD1AtomicDriver(env.DB),crypto:createWebCrypto(),request:await request.json()}));
}};
