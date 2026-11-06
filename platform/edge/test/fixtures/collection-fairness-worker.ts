// Private local conformance fixture; no production mutation route.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createNobleBeaconVerifier} from '../../../beacon/noble-verifier.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createCollectionFairnessRepository} from '../../../collect/fairness-repository.mjs';
import {dispatchMintFulfillment} from '../../../collect/mint-fulfillment-test-harness.mjs';
import {dispatchCollectionObservation} from '../../../collect/observation-test-harness.mjs';
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body=await request.json() as any;if(!Number.isSafeInteger(body.nowMs)||body.nowMs<0)return new Response('Invalid fixture clock',{status:400});
 const driver={...createD1AtomicDriver(env.DB),leaseNowSql:String(body.nowMs)},crypto=createWebCrypto(),beaconVerifier=createNobleBeaconVerifier(),store=r2ArtifactStore(env.MANIFESTS);
 if(body.lane==='fulfill')return Response.json(await dispatchMintFulfillment({driver,crypto,beaconVerifier,store,request:body}));
 if(body.lane==='observe')return Response.json(await dispatchCollectionObservation({driver,crypto,store,request:body}));
 let metrics:unknown=null,changed=false;const proofVerifier={async verifyShortSignature(value:any){const result=await beaconVerifier.verifyShortSignature(value);if(body.fault==='after-bls'&&!changed){changed=true;await env.DB.prepare("UPDATE app_operator_scopes SET revision=revision+1 WHERE operator='synthetic-mint-operator'").run();}return result;}};
 const repository=createCollectionFairnessRepository(driver,{crypto,clock:{nowMs:()=>body.nowMs},beaconVerifier:proofVerifier,onMeasure:value=>{metrics=value;}});
 return Response.json({result:await repository.readOwnFairness(body.query),metrics});
}};
