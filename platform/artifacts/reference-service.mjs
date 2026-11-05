import { privateIdentity } from './identity.mjs';
import { canonicalJson,utf8 } from '../security/canonical.mjs';
import { name,nat } from '../earn/validation.mjs';
export const PRIVATE_REFERENCE='evidence.private-reference.v1';
export const privateReferenceBytes=({principal,input})=>utf8(canonicalJson([PRIVATE_REFERENCE,principal,input]));
// Byte verification is a storage fact, never proof of source authenticity or
// historical coverage. The reference is private and cannot publish an award.
export function createPrivateReferenceService({store,repository,crypto,clock}) {
  return Object.freeze({async persist(principal,{identity,bytes,requestKey}) {
    if(principal?.kind!=='operator')throw new TypeError('Evidence operator required.');
    principal=Object.freeze({kind:'operator',id:name(principal.id,'operator')});
    name(requestKey,'request key');identity=privateIdentity(identity);
    const stored=await store.putIfAbsent(identity,bytes);
    if(stored.status==='unknown')return {kind:'pending',reason:'artifact-write-unknown',dependencyIds:[identity.key]};
    const verified=await store.getVerified(identity);
    if(verified.status!=='verified')return {kind:'pending',reason:'artifact-'+verified.status,dependencyIds:[identity.key]};
    const command={principal,operationKind:PRIVATE_REFERENCE,businessIdentity:identity.key,requestKey,input:identity,
      nowMs:nat(clock.nowMs(),'now'),expectedRevisions:{}};
    command.requestDigest=await crypto.sha256(privateReferenceBytes(command));
    return await repository.recordVerifiedReference(command);
  }});
}
