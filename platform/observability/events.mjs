import {canonicalJson,utf8} from '../security/canonical.mjs';
const kinds=['command','job','provider-attempt','evidence','publication','notice','recovery'];
const outcomes=['accepted','replayed','pending','held','unknown','succeeded','failed','refused'];
const reasons=['none','dependency','stale-revision','stale-lease','consent-required','scope-required','budget-limit','transport-unknown','validation','resource-bound','reconciliation'];
const own=(o,k)=>{const d=Object.getOwnPropertyDescriptor(o,k);if(d&&!Object.hasOwn(d,'value'))throw new TypeError('Event accessors are forbidden.');return d?.value;};
/** A bounded redacted event, not a logger/sink. Raw input is never persisted.
 * Correlations are domain-separated hashes, not authenticity or payment proof. */
export async function createOperationalEvent(input,{crypto,clock}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Invalid operational event.');
 const runtime=own(input,'runtime'),kind=own(input,'kind'),outcome=own(input,'outcome'),reason=own(input,'reason')??'none',atMs=clock.nowMs();
 if(!['node','workerd'].includes(runtime)||!kinds.includes(kind)||!outcomes.includes(outcome)||!reasons.includes(reason)||!Number.isSafeInteger(atMs)||atMs<0)throw new TypeError('Invalid operational event labels.');
 const value={format:'10x.local.operational-event.v1',scope:'local-fixture',runtime,kind,outcome,reason,atMs,financialExecution:false},correlations={};
 for(const key of ['durationMs','queueAgeMs','retryCount','sourceLagMs','rowsRead','rowsWritten','bytesRead','bytesWritten']){const n=own(input,key);if(n!==undefined){if(!Number.isSafeInteger(n)||n<0)throw new TypeError('Invalid operational counter.');value[key]=n;}}
 // Capture only bounded known fields before the first await. No raw URL, wallet,
 // cookie, signature, note, body or arbitrary label is copied to the event.
 for(const key of ['requestId','jobId','operationId','sourceVersion','policyVersion','decoderVersion']){const raw=own(input,key);if(raw!==undefined){if(typeof raw!=='string'||!raw.length||utf8(raw).length>256)throw new TypeError('Invalid correlation input.');correlations[key]=raw;}}
 for(const [key,raw] of Object.entries(correlations)){const digest=await crypto.sha256(utf8(canonicalJson(['10x.local.event-correlation.v1',key,raw])));if(!/^[a-f0-9]{64}$/.test(digest))throw new TypeError('Invalid event digest.');value[key.replace(/Id$|Version$/,'Digest')]=digest;}
 if(utf8(canonicalJson(value)).length>4096)throw new TypeError('Operational event bound.');return Object.freeze(value);
}
