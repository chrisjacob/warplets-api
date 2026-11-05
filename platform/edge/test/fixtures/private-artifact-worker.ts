import { r2ArtifactStore } from '../../../artifacts/r2';
import type { ArtifactIdentity } from '../../../application/ports';
export default {
 async fetch(request:Request,env:{PRIVATE:R2Bucket}):Promise<Response>{
  if(new URL(request.url).hostname!=='localhost')return new Response('local fixture only',{status:403});
  const input=await request.json() as {action:string;identity:ArtifactIdentity;bytes:number[]};
  const bucket:Pick<R2Bucket,'get'|'put'>=input.action==='lost-put'?{
   get:env.PRIVATE.get.bind(env.PRIVATE),
   put:async(key,value,options)=>{await env.PRIVATE.put(key,value,options);throw Error('fixture lost write acknowledgement');},
  }:input.action==='read-failure'?{
   get:async()=>{throw Error('fixture read transport failure');},put:env.PRIVATE.put.bind(env.PRIVATE),
  }:env.PRIVATE;
  const store=r2ArtifactStore(bucket);
  try{
   const result=input.action==='get'||input.action==='read-failure'?await store.getVerified(input.identity):
    await store.putIfAbsent(input.identity,new Uint8Array(input.bytes));
   return Response.json(result.status==='verified'?{...result,bytes:[...result.bytes]}:result);
  }catch(error){return Response.json({error:error instanceof Error?error.name:'unknown'},{status:409});}
 }
};
