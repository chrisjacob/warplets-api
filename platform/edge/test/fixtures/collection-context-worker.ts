// Local acceptance only. No public/member quote route is mounted here.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {dispatchCollectionContext} from '../../../application/fixtures/collection-context-dispatch.mjs';
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const input=await request.json() as any;return Response.json(await dispatchCollectionContext({driver:createD1AtomicDriver(env.DB),crypto:createWebCrypto(),input}));
}};
