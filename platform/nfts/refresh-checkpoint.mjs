import {canonicalJson,utf8} from '../security/canonical.mjs';
import {privateIdentity} from '../artifacts/identity.mjs';
import {createRefreshWorkflow} from './refresh-workflow.mjs';

export const REFRESH_CHECKPOINT_LIMIT=32768;
const need=(v,message)=>{if(!v)throw new TypeError('Refresh checkpoint: '+message);};
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const pending=reason=>({kind:'pending',reason});
// A checkpoint is an immutable private rehearsal archive. It is not an
// authenticated event ledger, current-owner observation or latest-state pointer.
// Retain its pin independently; deriving a pin from untrusted bytes proves nothing.
export function createRefreshCheckpoints({crypto,store}){
 const workflow=createRefreshWorkflow({crypto});
 function pin(value){
  need(value&&Object.getPrototypeOf(value)===Object.prototype,'plain pin required');
  const keys=['identity','requestDigest','stateDigest'];
  need(Reflect.ownKeys(value).length===keys.length&&keys.every(k=>Object.getOwnPropertyDescriptor(value,k)?.value!==undefined),'pin fields');
  const identity=value.identity;
  const fields=['key','byteDigest','size','semanticDigest','visibility','contentType'];
  need(identity&&Object.getPrototypeOf(identity)===Object.prototype&&Reflect.ownKeys(identity).length===fields.length&&fields.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(identity,k)??{},'value')),'identity fields');
  const checked=privateIdentity(identity);
  need(checked.contentType==='application/json'&&checked.size<=REFRESH_CHECKPOINT_LIMIT&&checked.semanticDigest===value.stateDigest&&digest(value.requestDigest)&&digest(value.stateDigest),'pin binding');
  return Object.freeze({identity:checked,requestDigest:value.requestDigest,stateDigest:value.stateDigest});
 }
 async function restore(captured){
  const retained=await store.getVerified(captured.identity);
  if(retained.status!=='verified')return pending('refresh-checkpoint-'+retained.status);
  need(retained.bytes instanceof Uint8Array&&retained.bytes.byteLength===captured.identity.size,'byte size');
  const bytes=new Uint8Array(retained.bytes);
  need(await crypto.sha256(bytes)===captured.identity.byteDigest,'byte digest');
  const encoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes),parsed=JSON.parse(encoded);
  need(canonicalJson(parsed)===encoded,'canonical bytes');
  const state=await workflow.restore(parsed);
  need(state.requestDigest===captured.requestDigest&&state.stateDigest===captured.stateDigest,'state binding');
  return Object.freeze({kind:'restored',pin:captured,state,authority:'unverified-rehearsal',isAuthorization:false});
 }
 return Object.freeze({
  async save(value){
   // restore captures caller data before its first asynchronous hash.
   const state=await workflow.restore(value),bytes=utf8(canonicalJson(state));
   need(bytes.length<=REFRESH_CHECKPOINT_LIMIT,'byte bound');
   const byteDigest=await crypto.sha256(bytes);
   const captured=pin({identity:{key:'private/'+byteDigest+'.json',byteDigest,size:bytes.length,semanticDigest:state.stateDigest,visibility:'private',contentType:'application/json'},requestDigest:state.requestDigest,stateDigest:state.stateDigest});
   const put=await store.putIfAbsent(captured.identity,bytes);
   need(['created','exists','unknown'].includes(put.status),'write status');
   // Even an unknown PUT may have completed. Only exact-byte readback and
   // complete event replay permit returning a recoverable checkpoint.
   const result=await restore(captured);
   return result.kind==='restored'?Object.freeze({...result,kind:'saved'}):Object.freeze({...result,pin:captured});
  },
  async restore(value){return restore(pin(value));}
 });
}
