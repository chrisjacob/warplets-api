import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createNobleBeaconVerifier} from '../../../beacon/noble-verifier.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createCollectionFairnessRepository} from '../../../collect/fairness-repository.mjs';
import {dispatchProgressionReservation} from '../../../collect/reservation-test-harness.mjs';
import {dispatchCollectionFulfillment} from '../../../collect/fulfillment-test-harness.mjs';
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 const body=await request.json() as any;if(!Number.isSafeInteger(body.nowMs))return new Response('Bad fixture clock',{status:400});
 const driver={...createD1AtomicDriver(env.DB),leaseNowSql:String(body.nowMs)},crypto=createWebCrypto(),beaconVerifier=createNobleBeaconVerifier(),store=r2ArtifactStore(env.MANIFESTS);
 if(body.lane==='reservation')return Response.json(await dispatchProgressionReservation({driver,crypto,request:body}));
 if(body.lane==='fulfill')return Response.json(await dispatchCollectionFulfillment({driver,crypto,store,beaconVerifier,request:body}));
 let measured:unknown=null,changed=false;
 const verifier={async verifyShortSignature(value:any){const result=await beaconVerifier.verifyShortSignature(value);if(body.fault==='after-bls'&&!changed){changed=true;await env.DB.prepare('UPDATE collect_assets SET observed_ms=observed_ms+1').run();}return result;}};
 const repo=createCollectionFairnessRepository(driver,{crypto,clock:{nowMs:()=>body.nowMs},beaconVerifier:verifier,onMeasure:m=>{measured=m;}});
 return Response.json({result:await repo.readOwnFairness(body.query),metrics:measured});
}};
