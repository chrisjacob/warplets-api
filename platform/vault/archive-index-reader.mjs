import {createRecoveryV2Codec,recoveryV2IndexSummary,verifyRecoveryV2IndexChild,RECOVERY_V2_LIMITS} from '../recovery/v2-codec.mjs';
import {canonicalJson} from '../security/canonical.mjs';
const need=(v,m)=>{if(!v)throw new Error('Vault recovery reader: '+m);};
/** Bounded authenticated index lookup; no aggregate row hydration. */
export async function createVaultRecoveryReader({rootBytes,rootDigest},{crypto,store}){
 const codec=createRecoveryV2Codec({crypto}),root=await codec.verifyRoot(rootBytes,rootDigest),cache=new Map();let reads=0,cachedBytes=0;
 async function bytes(identity,max){
  need(identity.size<=max&&++reads<=64,'object read bound');const found=await store.getVerified(identity);
  need(found.status==='verified'&&found.bytes instanceof Uint8Array&&found.bytes.length===identity.size,'missing or wrong-size object');return found.bytes;
 }
 async function index(identity){
  if(cache.has(identity.key)){const hit=cache.get(identity.key);need(canonicalJson(hit.identity)===canonicalJson(identity),'conflicting index identity');return hit.node;}
  need(cachedBytes+identity.size<=262144,'index cache byte bound');
  const node=await codec.verifyIndex(await bytes(identity,RECOVERY_V2_LIMITS.indexBytes),identity);cache.set(identity.key,{identity,node});cachedBytes+=identity.size;return node;
 }
 async function lookup(pointer,kind,key){
  if(pointer.count===0)return null;
  let identity=pointer.identity,node=await index(identity);
  need(node.kind===kind&&recoveryV2IndexSummary(node,identity).count===pointer.count,'root index type/count');
  for(let depth=0;depth<RECOVERY_V2_LIMITS.indexLevels;depth++){
   if(node.level===0)return node.entries.find(e=>e.key===key)?.value??null;
   const entry=node.entries.find(e=>e.first<=key&&key<=e.last);if(!entry)return null;
   const child=await index(entry.identity);verifyRecoveryV2IndexChild(node,entry,child,entry.identity);node=child;
  }
  throw new Error('Vault recovery reader: index depth');
 }
 return Object.freeze({codec,root,bytes,lookup});
}
