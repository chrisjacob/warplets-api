import {canonicalJson,utf8} from '../security/canonical.mjs';
export const RECORD_TRANSACTION_OUTCOME='transactions.record-outcome.v1';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9:_./-]{1,128}$/.test(v),digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v,keys)=>{if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v))||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)||!Object.getOwnPropertyDescriptor(v,k)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value')))throw new TypeError('Invalid recorded outcome input.');return Object.fromEntries(keys.map(k=>[k,v[k]]));};
export function normalizeRecordedOutcomeInput(value){const i=exact(value,['intentId','attemptId','evidenceReceiptDigest','expectedIntentRevision']);if(!id(i.intentId)||!id(i.attemptId)||!digest(i.evidenceReceiptDigest)||!Number.isSafeInteger(i.expectedIntentRevision)||i.expectedIntentRevision<0||i.expectedIntentRevision>=Number.MAX_SAFE_INTEGER)throw new TypeError('Invalid recorded outcome input.');return freeze(i);}
export const recordedOutcomeRequestBytes=c=>utf8(canonicalJson([RECORD_TRANSACTION_OUTCOME,c.principal.id,c.input]));
export async function buildRecordedOutcomeCommand(principal,value,crypto){
 const p=exact(principal,['kind','id']),v=exact(value,['requestKey','intentId','attemptId','evidenceReceiptDigest','expectedIntentRevision']);if(p.kind!=='operator'||!id(p.id)||!id(v.requestKey))throw new TypeError('Recorded outcome operator and request key required.');
 const {requestKey,...raw}=v,input=normalizeRecordedOutcomeInput(raw),c={operationKind:RECORD_TRANSACTION_OUTCOME,principal:p,requestKey,input};return freeze({...c,requestDigest:await crypto.sha256(recordedOutcomeRequestBytes(c))});
}
export function createRecordedOutcomeService({repository,crypto}){return Object.freeze({async record(principal,value){return repository.record(await buildRecordedOutcomeCommand(principal,value,crypto));}});}
