import {executionContextPreimage,calculateCostPacket} from './packet-core.mjs';
export const COST_PACKET_SERVICE_LIMITS=Object.freeze({inputBytes:262144,depth:32,entries:10000});
/** Copy bounded plain data without invoking getters/toJSON before crypto yields.
 * This is an adapter bound, not a change to the legacy synchronous calculator. */
function capture(value){let bytes=0,entries=0;const encoder=new TextEncoder(),seen=new Set();
 const add=text=>{bytes+=encoder.encode(text).length;if(bytes>262144)throw new RangeError('Cost packet input byte bound.');};
 function copy(v,depth){if(depth>32||++entries>10000)throw new RangeError('Cost packet input structure bound.');if(v===undefined){add('null');return v;}if(v===null||typeof v==='boolean'||typeof v==='number'||typeof v==='string'){add(JSON.stringify(v));return v;}
  if(typeof v!=='object'||seen.has(v))throw new TypeError('Plain acyclic cost packet data required.');const array=Array.isArray(v),prototype=Object.getPrototypeOf(v);if(array?prototype!==Array.prototype:![Object.prototype,null].includes(prototype))throw new TypeError('Plain cost packet data required.');seen.add(v);add(array?'[]':'{}');const out=array?[]:{},keys=Reflect.ownKeys(v).filter(k=>!(array&&k==='length'));
  if(keys.length>10000)throw new RangeError('Cost packet field bound.');if(array&&(keys.length!==v.length||keys.some((k,i)=>k!==String(i))))throw new TypeError('Dense cost packet arrays required.');
  for(const key of keys){if(typeof key!=='string')throw new TypeError('Cost packet string keys required.');const d=Object.getOwnPropertyDescriptor(v,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))throw new TypeError('Cost packet data fields required.');add((array?'':JSON.stringify(key)+':')+',');const item=copy(d.value,depth+1);Object.defineProperty(out,key,{value:item,enumerable:true,writable:true,configurable:true});}seen.delete(v);return out;
 }
 return copy(value,0);
}
/** Read-only calculator, not a quote/closure verifier or spending authority.
 * Always computes the context ID. No caller-supplied ID can replace it. */
export function createCostPacketService({crypto}){if(typeof crypto?.sha256!=='function')throw new TypeError('Canonical SHA256 port required.');return Object.freeze({async calculate(input){const captured=capture(input),preimage=executionContextPreimage(captured?.context),contextId=await crypto.sha256(new TextEncoder().encode(preimage));if(typeof contextId!=='string'||!/^[a-f0-9]{64}$/.test(contextId))throw new TypeError('Invalid cost context digest.');return calculateCostPacket(captured,contextId);}});}
