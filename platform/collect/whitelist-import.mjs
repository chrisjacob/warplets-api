import { createHash } from 'node:crypto';
import { decode58 } from '../server/base58.mjs';
/** Operator-only offline preparation. No HTTP route and no state changes.
 * Copy the accepted wallets into the existing immutable stage publication packet.
 * Source is operator-provided fixture provenance, not verified chain provenance.
 */
export function dryRunWhitelist({source,entries}) {
  if(typeof source!=='string'||!source.trim()||source.length>256)throw Error('Provide a bounded fixture source.');
  if(!Array.isArray(entries)||entries.length>10000)throw Error('Provide at most 10000 entries.');
  const accepted=new Set(),errors=[];let duplicates=0;
  for(let index=0;index<entries.length;index++){
    const value=entries[index];
    try{
      if(typeof value!=='string')throw Error('Expected a string.');
      decode58(value,32);
      if(accepted.has(value))duplicates++;else accepted.add(value);
    }catch{errors.push({index,reason:'noncanonical-solana-address'});}
  }
  const wallets=[...accepted].sort();
  const digest=createHash('sha256').update(JSON.stringify(['local-whitelist-v1',source,wallets])).digest('hex');
  return {mode:'local-fixture',source,inputCount:entries.length,acceptedCount:wallets.length,duplicateCount:duplicates,
    errorCount:errors.length,errors,wallets,digest,publishable:errors.length===0};
}
