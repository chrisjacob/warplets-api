import {prepareArtifact,verifiedBytes} from '../../artifacts/identity.mjs';
/** Disposable exact-byte local fixture store; never a durable production port. */
export function memoryArtifacts(){
 const objects=new Map();return {objects,
  async putIfAbsent(identity,value){const prepared=await prepareArtifact(identity,value),exists=objects.has(identity.key);if(!exists)objects.set(identity.key,prepared.bytes);const read=await verifiedBytes(identity,objects.get(identity.key));if(read.status!=='verified')throw Error('Conflicting immutable fixture artifact');return {status:exists?'exists':'created',identity};},
  async getVerified(identity){return objects.has(identity.key)?verifiedBytes(identity,objects.get(identity.key)):{status:'missing',identity};},
 };
}
