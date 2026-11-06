// Disposable local acceptance wrapper. Restore uses the existing normal V2 harness.
import recovery from './recovery-v2-restore-worker';
import {createRefreshRepository} from '../../../nfts/refresh-repository.mjs';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
export default {async fetch(request:Request,env:Env&{RECOVERY_SOURCE:R2Bucket}){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body:any=await request.clone().json();if(body.method!=='refresh-read')return recovery.fetch(request,env);
 const repository=createRefreshRepository({...createD1AtomicDriver(env.DB),leaseNowSql:String(body.nowMs)},{crypto:createWebCrypto(),artifacts:r2ArtifactStore(env.MANIFESTS),clock:{nowMs:()=>body.nowMs},ids:{next:()=>globalThis.crypto.randomUUID()}});
 return Response.json(await repository.read(body.principal,{requestId:body.requestId}));
}};
