// Disposable local test worker, with no browser/public route registration.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {quoteTestDispatch} from '../../../quotes/guarded-test-harness.mjs';
import worker from '../../src/worker';
let fixtureNow=Date.now();Date.now=()=>fixtureNow;
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 if(new URL(request.url).pathname.startsWith('/api/v1/'))return worker.fetch(request,env,ctx);
 const body=await request.json() as any;
 fixtureNow=body.request.nowMs;
 return Response.json(await quoteTestDispatch({driver:createD1AtomicDriver(env.DB),store:r2ArtifactStore(env.MANIFESTS),crypto:createWebCrypto(),ids:{next:()=>crypto.randomUUID()},fixture:body.fixture,request:body.request}));
}};
