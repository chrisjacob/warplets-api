// Local-only acceptance harness, isolated from the public Worker entrypoint.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {financialReadTestDispatch} from '../../../financial/read-test-harness.mjs';
import worker from '../../src/worker';
let fixtureNow=Date.now();Date.now=()=>fixtureNow;
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 if(new URL(request.url).pathname.startsWith('/api/v1/'))return worker.fetch(request,env,ctx);
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const input=await request.json() as any;
 fixtureNow=input.nowMs;
 return Response.json(await financialReadTestDispatch({driver:createD1AtomicDriver(env.DB),crypto:createWebCrypto(),input}));
}};
