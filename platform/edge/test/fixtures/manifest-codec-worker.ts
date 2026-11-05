import {createManifestCodec} from '../../../artifacts/manifest-codec.mjs';
import type {ManifestCodec,PublicAllocation} from '../../../artifacts/manifest-codec.mjs';
import type {ArtifactIdentity} from '../../../application/ports';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
const cryptoPort=createWebCrypto();
export default {async fetch(request:Request,env:Env){
 const body=await request.json() as {method:string;input:Parameters<ManifestCodec['build']>[0];bytes:number[];pins:{semanticDigest:string;byteDigest:string};
  allocation:PublicAllocation;wallet:string;size:number;identity:ArtifactIdentity};
 const codec=createManifestCodec({crypto:cryptoPort}),store=r2ArtifactStore(env.MANIFESTS);
 try{
  if(body.method==='build'||body.method==='verify'){
   const result=body.method==='build'?await codec.build(body.input):await codec.verify(new Uint8Array(body.bytes),body.pins);
   return Response.json({...result,bytes:[...result.bytes]});
  }
  if(body.method==='proof'){
   const proof=await codec.proof(body.allocation,body.wallet);return Response.json({proof,verified:proof?await codec.verifyProof(proof,body.allocation.awardRoot):null});
  }
  if(body.method==='bound'){
   const bytes=new TextEncoder().encode(JSON.stringify('x'.repeat(body.size-2))),byteDigest=await cryptoPort.sha256(bytes);
   const identity:ArtifactIdentity={key:'public/'+byteDigest+'.json',byteDigest,semanticDigest:null,size:bytes.length,visibility:'public',contentType:'application/json'};
   const put=await store.putIfAbsent(identity,bytes),read=await store.getVerified(identity);
   return Response.json({put,read:read.status,readSize:read.status==='verified'?read.bytes.length:null});
  }
  if(body.method==='get'){
   const result=await store.getVerified(body.identity);return Response.json(result.status==='verified'?{...result,bytes:[...result.bytes]}:result);
  }
  const target=body.method==='lost-put'?r2ArtifactStore({get:env.MANIFESTS.get.bind(env.MANIFESTS),put:async(key,value,options)=>{
   await env.MANIFESTS.put(key,value,options);throw Error('Synthetic lost public write acknowledgement');
  }}):store;
  return Response.json(await target.putIfAbsent(body.identity,new Uint8Array(body.bytes)));
 }catch(error){return Response.json({error:String(error)},{status:409});}
}};
