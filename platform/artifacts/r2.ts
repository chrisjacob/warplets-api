import type { ArtifactIdentity } from '../application/ports';
import type { ArtifactStore,ArtifactPutResult,ArtifactReadResult } from './store';
import { ArtifactConflictError,privateIdentity,preparePrivateArtifact,verifiedBytes } from './identity.mjs';

/** Inject a local R2 binding; this adapter has no REST, listing or public catalog
 * operation. Conditional PUT is the create-once authority, not a prior HEAD. */
export function r2ArtifactStore(bucket:Pick<R2Bucket,'get'|'put'>):ArtifactStore {
  async function getVerified(input:ArtifactIdentity):Promise<ArtifactReadResult>{
    const identity=privateIdentity(input),object=await bucket.get(identity.key);
    if(!object)return {status:'missing',identity};
    if(object.size!==identity.size || object.httpMetadata?.contentType!==identity.contentType){
      await object.body.cancel();
      return {status:'conflict',identity,reason:'size or content type mismatch'};
    }
    // Bound the stream independently of remote size metadata.
    const reader=object.body.getReader(),bytes=new Uint8Array(identity.size);
    let length=0;
    try{
      for(;;){
        const next=await reader.read();if(next.done)break;
        if(length+next.value.byteLength>bytes.byteLength){
          await reader.cancel();return {status:'conflict',identity,reason:'body exceeds declared size'};
        }
        bytes.set(next.value,length);length+=next.value.byteLength;
      }
    }finally{reader.releaseLock();}
    return verifiedBytes(identity,bytes.slice(0,length));
  }
  async function putIfAbsent(input:ArtifactIdentity,value:Uint8Array):Promise<ArtifactPutResult>{
    const {identity,bytes}=await preparePrivateArtifact(input,value);
    try{
      const created=await bucket.put(identity.key,bytes,{onlyIf:new Headers({'If-None-Match':'*'}),
        sha256:identity.byteDigest,httpMetadata:{contentType:identity.contentType}});
      const stored=await getVerified(identity);
      if(stored.status==='conflict')throw new ArtifactConflictError(stored.reason);
      if(stored.status==='missing')return {status:'unknown',identity};
      return {status:created?'created':'exists',identity};
    }catch(error){
      if(error instanceof ArtifactConflictError)throw error;
      return {status:'unknown',identity};
    }
  }
  return Object.freeze({putIfAbsent,getVerified});
}
