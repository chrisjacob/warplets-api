import {hex} from '../security/canonical.mjs';
export const LEGACY_HASH_IMPLEMENTATION_PIN='@noble/hashes@2.2.0:sha256-source:eca9066af2132571a2e991f8acf66b976caa077705fc84428709ababa234f25d';
export const LEGACY_HASH_LIMITS=Object.freeze({sourceBytes:33554432,chunkBytes:65536,stateBytes:1024});
const FORMAT='10x.local.legacy-audit-sha256.v1';
const IV=Object.freeze([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
const need=(c,message)=>{if(!c)throw new TypeError('Legacy audit hash '+message);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const word=n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
const freeze=s=>Object.freeze({...s,words:Object.freeze([...s.words])});
/** Structural validation does not establish that later words are a reachable
 * source prefix. Only private durable state from guarded audit steps may resume.
 * The package/source pin is fixed; callers cannot select another algorithm. */
export function validateLegacyAuditHashState(value){
 need(exact(value,['format','algorithm','implementationPin','bytes','words','tailHex']),'state fields.');
 need(Array.isArray(value.words)&&value.words.length===8,'state words.');
 const s={format:value.format,algorithm:value.algorithm,implementationPin:value.implementationPin,bytes:value.bytes,words:[...value.words],tailHex:value.tailHex};
 need(s.format===FORMAT&&s.algorithm==='SHA-256'&&s.implementationPin===LEGACY_HASH_IMPLEMENTATION_PIN,'implementation pin.');
 need(Number.isSafeInteger(s.bytes)&&s.bytes>=0&&s.bytes<=LEGACY_HASH_LIMITS.sourceBytes,'byte count.');need(Array.isArray(s.words)&&s.words.length===8&&s.words.every(word),'state words.');
 need(typeof s.tailHex==='string'&&/^(?:[a-f0-9]{2}){0,63}$/.test(s.tailHex)&&s.tailHex.length===(s.bytes%64)*2,'partial block.');
 need(s.bytes>=64||s.words.every((v,n)=>v===IV[n]),'pre-block initialization.');return freeze(s);
}
const initial=()=>freeze({format:FORMAT,algorithm:'SHA-256',implementationPin:LEGACY_HASH_IMPLEMENTATION_PIN,bytes:0,words:IV,tailHex:''});
/** Inject the pinned constructor only at trusted composition. This optional
 * adapter imports no package, provider, database or application authority. */
export function createLegacyAuditHashAdapter({createSha256,implementationPin}){
 need(implementationPin===LEGACY_HASH_IMPLEMENTATION_PIN&&typeof createSha256==='function','trusted factory pin.');
 function restore(state){const h=createSha256();need(h&&h.blockLen===64&&h.outputLen===32&&h.padOffset===8&&h.isLE===false&&h.finished===false&&h.destroyed===false&&h.length===0&&h.pos===0&&h.buffer instanceof Uint8Array&&h.buffer.length===64&&typeof h.get==='function'&&typeof h.set==='function'&&typeof h.update==='function'&&typeof h.digest==='function'&&typeof h.destroy==='function'&&h.get().length===8&&h.get().every((v,n)=>(v>>>0)===IV[n]),'constructor identity.');h.set(...state.words);h.length=state.bytes;h.pos=state.bytes%64;h.buffer.fill(0);for(let n=0;n<h.pos;n++)h.buffer[n]=Number.parseInt(state.tailHex.slice(n*2,n*2+2),16);return h;}
 return Object.freeze({
  initial,
  advance(value,input){const state=validateLegacyAuditHashState(value);need(input instanceof Uint8Array&&input.length>0&&input.length<=LEGACY_HASH_LIMITS.chunkBytes&&state.bytes+input.length<=LEGACY_HASH_LIMITS.sourceBytes,'chunk bound.');const bytes=input.slice(),h=restore(state);try{h.update(bytes);need(h.finished===false&&h.destroyed===false&&h.length===state.bytes+bytes.length&&h.pos===h.length%64,'updated runtime state.');return validateLegacyAuditHashState({format:FORMAT,algorithm:'SHA-256',implementationPin:LEGACY_HASH_IMPLEMENTATION_PIN,bytes:h.length,words:h.get().map(n=>n>>>0),tailHex:hex(h.buffer.subarray(0,h.pos))});}finally{h.destroy();}},
  finish(value){const state=validateLegacyAuditHashState(value),h=restore(state);try{const digest=h.digest();need(digest instanceof Uint8Array&&digest.length===32,'digest length.');return hex(digest);}finally{h.destroy();}},
 });
}
