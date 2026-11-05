// Exact historical encodings. These formats are deliberately separate:
// Earn manifests reject non-JSON values; configuration audit JSON retains its
// existing JSON.stringify omission rules. Neither changes stored commitments.
export function canonicalJson(value) {
  if (value===null || typeof value==='string' || typeof value==='boolean' || Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '['+value.map(canonicalJson).join(',')+']';
  if (value && typeof value==='object') {
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}';
  }
  throw new TypeError('Portable manifests accept JSON strings and safe integers only.');
}
function ordered(value) {
  if(Array.isArray(value))return value.map(ordered);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])]));
  return value;
}
export const orderedJson=value=>JSON.stringify(ordered(value));
export const utf8=value=>new TextEncoder().encode(value);
export const EARN_FORMAT='10x.local.earn.public.v1';
export const commitmentBytes=(type,value)=>utf8(canonicalJson([EARN_FORMAT,type,value]));
export function checkedBytes(bytes) {
  if(!(bytes instanceof Uint8Array))throw new TypeError('Expected Uint8Array bytes.');
  return bytes;
}
export const hex=bytes=>[...checkedBytes(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
