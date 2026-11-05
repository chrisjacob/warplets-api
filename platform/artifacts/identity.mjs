export const MAX_PRIVATE_ARTIFACT_BYTES=256*1024;
const sha=/^[0-9a-f]{64}$/;
export class ArtifactConflictError extends Error {
  constructor(reason){super('Private artifact conflict: '+reason);this.name='ArtifactConflictError';this.code='artifact_conflict';}
}
export function privateIdentity(value){
  if(!value || value.visibility!=='private' || typeof value.byteDigest!=='string' || !sha.test(value.byteDigest)
    || !Number.isSafeInteger(value.size) || value.size<0 || value.size>MAX_PRIVATE_ARTIFACT_BYTES
    || (value.semanticDigest!==null && (typeof value.semanticDigest!=='string' || !sha.test(value.semanticDigest)))
    || !['application/json','application/octet-stream'].includes(value.contentType))throw new TypeError('Invalid private artifact identity.');
  const extension=value.contentType==='application/json'?'json':'bin';
  if(value.key!=='private/'+value.byteDigest+'.'+extension)throw new TypeError('Private artifact key must match its exact-byte digest and content type.');
  return Object.freeze({key:value.key,byteDigest:value.byteDigest,size:value.size,semanticDigest:value.semanticDigest,
    visibility:'private',contentType:value.contentType});
}
export async function sha256(bytes){
  const result=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(result)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function preparePrivateArtifact(identity,input){
  // Copy before the first await: callers cannot mutate an in-flight write.
  const checked=privateIdentity(identity);
  if(!(input instanceof Uint8Array) || input.byteLength!==checked.size)throw new TypeError('Private artifact size mismatch.');
  const bytes=new Uint8Array(input);
  if(await sha256(bytes)!==checked.byteDigest)throw new TypeError('Private artifact digest mismatch.');
  return {identity:checked,bytes};
}
export async function verifiedBytes(identity,bytes){
  if(bytes.byteLength!==identity.size)return {status:'conflict',identity,reason:'size mismatch'};
  if(await sha256(bytes)!==identity.byteDigest)return {status:'conflict',identity,reason:'digest mismatch'};
  return {status:'verified',identity,bytes};
}
