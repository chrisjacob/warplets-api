import {canonicalJson,utf8} from '../security/canonical.mjs';
export class FinancialReadError extends Error{
 constructor(code,message,status=503){super(message);this.code=code;this.status=status;}
}
export const requireRead=(value,code,message,status)=>{if(!value)throw new FinancialReadError(code,message,status);};
const text=v=>typeof v==='string'&&v.length>0&&v.length<=128;
const time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
export const READ_CURSOR_MAX_AGE_MS=300000;
/** An opaque read context, not an authorization token. Authentication occurs
 * independently on every owner route. Editing scope/owner/revision cannot select
 * another principal or combine snapshots; after merely selects a page boundary. */
export function decodeReadCursor(value,{scope,subject,nowMs}){
 requireRead(text(scope)&&text(subject)&&time(nowMs),'invalid_read_context','Invalid financial read context.',400);
 if(value===undefined||value===null||value==='')return {after:'',evaluatedAtMs:nowMs,sourceRevision:null};
 requireRead(typeof value==='string'&&/^[A-Za-z0-9_-]{1,1024}$/.test(value),'invalid_cursor','Invalid financial read cursor.',400);
 let decoded;
 try{const raw=value.replace(/-/g,'+').replace(/_/g,'/'),binary=atob(raw);if(btoa(binary).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')!==value)throw Error();decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0))));}catch{throw new FinancialReadError('invalid_cursor','Invalid financial read cursor.',400);}
 requireRead(Array.isArray(decoded)&&decoded.length===6&&decoded[0]===1&&decoded[1]===scope&&decoded[2]===subject&&typeof decoded[3]==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(decoded[3])&&time(decoded[4])&&text(decoded[5]),'invalid_cursor','Cursor belongs to a different read context.',400);
 requireRead(decoded[4]<=nowMs&&nowMs-decoded[4]<=READ_CURSOR_MAX_AGE_MS,'stale_cursor','Restart this view to obtain a fresh read snapshot.',409);
 return {sourceRevision:decoded[3],evaluatedAtMs:decoded[4],after:decoded[5]};
}
export function encodeReadCursor({scope,subject,sourceRevision,evaluatedAtMs,after}){
 const value=canonicalJson([1,scope,subject,sourceRevision,evaluatedAtMs,after]);
 return btoa(String.fromCharCode(...utf8(value))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
