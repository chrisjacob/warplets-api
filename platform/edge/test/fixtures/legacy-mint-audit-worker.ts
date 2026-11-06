import {auditLegacyMint} from '../../../collect/legacy-mint-audit.mjs';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createWorkerRecoveryDigest} from '../../../recovery/v2-worker-digest.mjs';
import {createNobleBeaconVerifier} from '../../../beacon/noble-verifier.mjs';
// Private fixture only: original policy parts reside in local R2, not the body.
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 const body=await request.json() as any;let measurements:any=null,reads=0;
 const record=(r:any)=>({id:r.id,size:r.size,bytes:Uint8Array.from(atob(r.base64),c=>c.charCodeAt(0))});
 try{const input={...body,sourceRoot:record(body.sourceRoot),admissionPage:record(body.admissionPage)},result=await auditLegacyMint(input,{crypto:createWebCrypto(),createDigest:createWorkerRecoveryDigest,beaconVerifier:createNobleBeaconVerifier(),async readOriginalPolicyPart(ref){reads++;const object=await env.MANIFESTS.get('synthetic-legacy-policy/'+ref.byteDigest);if(!object)return null;if(object.size!==ref.size)throw new TypeError('legacy-mint-policy-part-size');return new Uint8Array(await object.arrayBuffer());},onMeasure:m=>{measurements=m;}});return Response.json({result,measurements,reads});}catch(error){return Response.json({error:String(error),code:(error as {code?:string}).code??null,measurements,reads},{status:409});}
}};
