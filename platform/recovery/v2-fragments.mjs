import {canonicalJson,utf8} from '../security/canonical.mjs';
import {privateIdentity} from '../artifacts/identity.mjs';
export const RECOVERY_FRAGMENT_LIMITS=Object.freeze({rowBytes:1048576,chunkCharacters:8192,chunkBytes:32768,chunks:128,descriptorBytes:65536});
export const RECOVERY_FRAGMENT_COLUMNS=Object.freeze(['inventory_id','policy_hash','traits','registered_ms']);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),nat=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const need=(value,message)=>{if(!value)throw new TypeError('Recovery fragment '+message);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const clone=v=>JSON.parse(canonicalJson(v));
const freeze=v=>{if(v&&typeof v==='object'){for(const item of Object.values(v))freeze(item);Object.freeze(v);}return v;};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
function identity(value,type){const i=privateIdentity(value);need(i.semanticDigest===null&&i.contentType===type&&same(value,i),'byte identity.');return i;}
/** Counts SQLite Unicode characters, not JS UTF-16 code units. Reject lone
 * surrogates instead of allowing TextEncoder to silently replace caller data. */
export function recoveryFragmentCharacters(text){
 need(typeof text==='string','text required.');let count=0;for(let n=0;n<text.length;n++){const code=text.charCodeAt(n);if(code>=0xd800&&code<=0xdbff){need(n+1<text.length&&text.charCodeAt(n+1)>=0xdc00&&text.charCodeAt(n+1)<=0xdfff,'unpaired UTF-16 surrogate.');n++;}else need(code<0xdc00||code>0xdfff,'unpaired UTF-16 surrogate.');count++;}return count;
}
/** Pure structural header only. Installed schema, source revision and exact
 * table ordering remain the caller's guarded repository responsibilities. */
export function recoveryFragmentHeader(input){
 const h=clone(input);need(exact(h,['format','table','schemaFingerprint','index','columns','hasRowid','after','cursor','encoding','characters','bytes']),'header fields.');
 need(h.format==='10x.local.recovery.fragmented-row.v2'&&h.table==='fair_inventories'&&hash(h.schemaFingerprint)&&nat(h.index,16383)&&h.hasRowid===true&&same(h.columns,RECOVERY_FRAGMENT_COLUMNS)&&h.encoding==='sqlite-json-array-text-utf8-v1','header identity.');
 need(Array.isArray(h.cursor)&&h.cursor.length===1&&Number.isSafeInteger(h.cursor[0])&&(h.after===null||Array.isArray(h.after)&&h.after.length===1&&Number.isSafeInteger(h.after[0])&&h.after[0]<h.cursor[0]),'row cursor.');need(h.index===0?h.after===null:h.after!==null,'page boundary.');
 need(nat(h.characters,RECOVERY_FRAGMENT_LIMITS.rowBytes)&&h.characters>0&&nat(h.bytes,RECOVERY_FRAGMENT_LIMITS.rowBytes)&&h.bytes>=h.characters&&h.bytes<=h.characters*4,'row size.');return freeze(h);
}
export function recoveryFragmentDescriptor(input){
 const value=clone(input),{fragments,...rawHeader}=value,h=recoveryFragmentHeader(rawHeader);need(Array.isArray(fragments)&&fragments.length>0&&fragments.length<=RECOVERY_FRAGMENT_LIMITS.chunks,'fragment count.');let offset=1,bytes=0;
 for(const [index,f]of fragments.entries()){need(exact(f,['index','offset','characters','identity'])&&f.index===index&&f.offset===offset&&nat(f.characters,RECOVERY_FRAGMENT_LIMITS.chunkCharacters)&&f.characters>0,'ordered character prefix.');need(index===fragments.length-1||f.characters===RECOVERY_FRAGMENT_LIMITS.chunkCharacters,'nonfinal fragment length.');const i=identity(f.identity,'application/octet-stream');need(i.size>0&&i.size<=RECOVERY_FRAGMENT_LIMITS.chunkBytes&&i.size>=f.characters&&i.size<=f.characters*4,'fragment byte size.');offset+=f.characters;bytes+=i.size;}
 need(offset-1===h.characters&&bytes===h.bytes&&fragments.length===Math.ceil(h.characters/RECOVERY_FRAGMENT_LIMITS.chunkCharacters),'complete character/byte totals.');need(utf8(canonicalJson(value)).length<=RECOVERY_FRAGMENT_LIMITS.descriptorBytes,'descriptor byte bound.');return freeze(value);
}
/** Portable byte codec. Fragment bytes are exact SQLite JSON text substrings,
 * not standalone JSON values and not re-encoded canonical row pages. */
export function createRecoveryV2FragmentCodec({crypto}){
 async function encodeChunk(input){
  const text=input,characters=recoveryFragmentCharacters(text),bytes=utf8(text);need(characters>0&&characters<=RECOVERY_FRAGMENT_LIMITS.chunkCharacters&&bytes.length<=RECOVERY_FRAGMENT_LIMITS.chunkBytes&&!text.includes('\0'),'chunk text bound.');const byteDigest=await crypto.sha256(bytes),i=identity({key:'private/'+byteDigest+'.bin',byteDigest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/octet-stream'},'application/octet-stream');return {text,characters,bytes,identity:freeze(i)};
 }
 async function verifyChunk(input,rawIdentity,expectedCharacters){
  const bytes=new Uint8Array(input),i=identity(clone(rawIdentity),'application/octet-stream');need(i.size>0&&i.size<=RECOVERY_FRAGMENT_LIMITS.chunkBytes&&bytes.length===i.size&&await crypto.sha256(bytes)===i.byteDigest,'chunk byte digest.');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),characters=recoveryFragmentCharacters(text);need(characters>0&&characters<=RECOVERY_FRAGMENT_LIMITS.chunkCharacters&&!text.includes('\0')&&(expectedCharacters===undefined||characters===expectedCharacters),'chunk character count.');return Object.freeze({text,characters,identity:freeze(i)});
 }
 async function encodeRowDescriptor(input){const value=recoveryFragmentDescriptor(input),bytes=utf8(canonicalJson(value)),byteDigest=await crypto.sha256(bytes),i=identity({key:'private/'+byteDigest+'.json',byteDigest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/json'},'application/json');return {value,bytes,identity:freeze(i)};}
 async function verifyRowDescriptor(input,rawIdentity){const bytes=new Uint8Array(input),i=identity(clone(rawIdentity),'application/json');need(bytes.length<=RECOVERY_FRAGMENT_LIMITS.descriptorBytes&&bytes.length===i.size&&await crypto.sha256(bytes)===i.byteDigest,'descriptor byte digest.');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value=JSON.parse(text);need(canonicalJson(value)===text,'canonical descriptor.');return recoveryFragmentDescriptor(value);}
 return Object.freeze({encodeChunk,verifyChunk,encodeRowDescriptor,verifyRowDescriptor});
}
