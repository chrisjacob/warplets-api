export const MAX_PRIVATE_ARTIFACT_BYTES=256*1024;
export const MAX_PUBLIC_ARTIFACT_BYTES=2*1024*1024;
const sha=/^[0-9a-f]{64}$/;
export class ArtifactConflictError extends Error {
  constructor(reason){super('Artifact conflict: '+reason);this.name='ArtifactConflictError';this.code='artifact_conflict';}
}
export function artifactIdentity(value){
  if(!value || !['private','public'].includes(value.visibility) || typeof value.byteDigest!=='string' || !sha.test(value.byteDigest)
    || !Number.isSafeInteger(value.size) || value.size<0 || value.size>(value.visibility==='private'?MAX_PRIVATE_ARTIFACT_BYTES:MAX_PUBLIC_ARTIFACT_BYTES)
    || (value.semanticDigest!==null && (typeof value.semanticDigest!=='string' || !sha.test(value.semanticDigest)))
    || !['application/json','application/octet-stream'].includes(value.contentType)
    || (value.visibility==='public'&&value.contentType!=='application/json'))throw new TypeError('Invalid artifact identity.');
  const extension=value.contentType==='application/json'?'json':'bin';
  if(value.key!==value.visibility+'/'+value.byteDigest+'.'+extension)throw new TypeError('Artifact key must match its visibility, exact-byte digest and content type.');
  return Object.freeze({key:value.key,byteDigest:value.byteDigest,size:value.size,semanticDigest:value.semanticDigest,
    visibility:value.visibility,contentType:value.contentType});
}
export function privateIdentity(value){
  if(value?.visibility!=='private')throw new TypeError('Invalid private artifact identity.');
  return artifactIdentity(value);
}
export async function sha256(bytes){
  const result=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(result)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function prepareArtifact(identity,input){
  // Copy before the first await: callers cannot mutate an in-flight write.
  const checked=artifactIdentity(identity);
  if(!(input instanceof Uint8Array) || input.byteLength!==checked.size)throw new TypeError('Artifact size mismatch.');
  const bytes=new Uint8Array(input);
  if(await sha256(bytes)!==checked.byteDigest)throw new TypeError('Artifact digest mismatch.');
  return {identity:checked,bytes};
}
export async function preparePrivateArtifact(identity,input){return prepareArtifact(privateIdentity(identity),input);}
export async function verifiedBytes(identity,bytes){
  if(bytes.byteLength!==identity.size)return {status:'conflict',identity,reason:'size mismatch'};
  if(await sha256(bytes)!==identity.byteDigest)return {status:'conflict',identity,reason:'digest mismatch'};
  return {status:'verified',identity,bytes};
}
