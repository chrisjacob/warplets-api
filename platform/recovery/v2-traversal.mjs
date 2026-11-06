import {canonicalJson,utf8} from '../security/canonical.mjs';
import {verifyObject} from './inventory.mjs';
import {recoveryV2IndexSummary,RECOVERY_V2_LIMITS} from './v2-codec.mjs';
const clone=value=>JSON.parse(canonicalJson(value)),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
function need(c,message){if(!c)throw new TypeError(message);}
/** One verified index node per call. The cursor retains only an <=8-frame
 * traversal stack and counts, never all leaf descriptors or an object list.
 * Durable callers must CAS their own cursor; replaying a cursor replays its
 * entry and does not independently authorize an import or external effect. */
export function createRecoveryV2IndexReader({artifacts,crypto,v2Codec}){
 return Object.freeze({async step(input){
  const request=clone(input),{kind,pointer}=request;
  need(['tables','objects','publications','table-pages'].includes(kind)&&pointer&&Number.isSafeInteger(pointer.count)&&pointer.count>=0&&pointer.count<=RECOVERY_V2_LIMITS.objects&&(pointer.count===0?pointer.identity===null:pointer.identity!==null),'Invalid recovery index pointer.');
  const cursor=request.cursor??{kind,pointer,emitted:0,stack:pointer.identity?[{identity:pointer.identity,position:0,level:null,summary:null}]:[]};
  need(same(cursor.pointer,pointer)&&cursor.kind===kind&&Number.isSafeInteger(cursor.emitted)&&cursor.emitted>=0&&cursor.emitted<=pointer.count&&Array.isArray(cursor.stack)&&cursor.stack.length<=RECOVERY_V2_LIMITS.indexLevels&&utf8(canonicalJson(cursor)).length<=16384,'Invalid recovery traversal cursor.');
  if(!cursor.stack.length){need(cursor.emitted===pointer.count,'Incomplete recovery index traversal.');return {kind:'done',cursor};}
  const frame=cursor.stack.at(-1);need(Number.isSafeInteger(frame.position)&&frame.position>=0,'Invalid index frame position.');
  const object=await verifyObject(artifacts,frame.identity,crypto);if(object.kind!=='verified')return {kind:'pending',reason:object.reason};
  const node=await v2Codec.verifyIndex(object.bytes,frame.identity),summary=recoveryV2IndexSummary(node,frame.identity);
  need(node.kind===kind&&(frame.level===null||node.level===frame.level),'Recovery traversal level or kind mismatch.');
  if(frame.summary!==null)need(same(summary,frame.summary),'Recovery traversal child range or count mismatch.');
  else need(cursor.stack.length===1&&same(frame.identity,pointer.identity)&&summary.count===pointer.count,'Recovery traversal root mismatch.');
  need(frame.position<=node.entries.length,'Recovery traversal index overflow.');
  const metadata={identity:object.identity,bytes:object.bytes};
  if(frame.position===node.entries.length){cursor.stack.pop();return {kind:'progress',cursor,metadata};}
  const entry=node.entries[frame.position++];
  if(node.level>0){need(cursor.stack.length<RECOVERY_V2_LIMITS.indexLevels,'Recovery traversal depth bound.');cursor.stack.push({identity:entry.identity,position:0,level:node.level-1,summary:entry});return {kind:'progress',cursor,metadata};}
  cursor.emitted++;need(cursor.emitted<=pointer.count,'Recovery traversal count overflow.');return {kind:'entry',key:entry.key,value:entry.value,cursor,metadata};
 }});
}
