import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createWorkerRecoveryDigest} from '../../../recovery/v2-worker-digest.mjs';
import {createRecoveryV2FreeCutReconciler} from '../../../recovery/v2-reconcile-free-cuts.mjs';
// Private synthetic local semantic harness; no production recovery route.
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 const body=await request.json() as any,driver=createD1AtomicDriver(env.DB),crypto=createWebCrypto();let metrics:any=null,writes=0,aborts=0;
 const createDigest=()=>{const stream=createWorkerRecoveryDigest();return {...stream,async write(bytes:Uint8Array){if(++writes===body.failAfterWrite)throw Error('Synthetic interrupted stream');await stream.write(bytes);if(writes===2&&body.mutateDuringHash)await env.DB.prepare("UPDATE app_revisions SET revision=revision+1 WHERE name='source'").run();},async abort(error:unknown){aborts++;await stream.abort(error);}};};
 const repository={async advance(_loaded:any,result:any){return {kind:'progress',...result};}},reconciler=createRecoveryV2FreeCutReconciler({driver,crypto,repository,createDigest,onMeasure:(value:any)=>{metrics=value;}});
 try{const result=await reconciler.step({run:{checkpoint_json:JSON.stringify(body.checkpoint)}},body.checkpoint);return Response.json({result,metrics,writes,aborts});}catch(error){return Response.json({error:String(error),aborts,writes},{status:409});}
}};
