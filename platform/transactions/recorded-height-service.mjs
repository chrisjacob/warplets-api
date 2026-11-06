import {canonicalJson,utf8} from '../security/canonical.mjs';
import {normalizeRecordedOutcomeInput} from './recorded-outcome-service.mjs';
export const EXPIRE_RECORDED_ATTEMPT='transactions.expire-recorded-attempt.v1';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9:_./-]{1,128}$/.test(v);
const exact=(v,keys)=>{if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v))||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)||!Object.getOwnPropertyDescriptor(v,k)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value')))throw new TypeError('Invalid recorded height input.');return Object.fromEntries(keys.map(k=>[k,v[k]]));};
export const recordedHeightRequestBytes=c=>utf8(canonicalJson([EXPIRE_RECORDED_ATTEMPT,c.principal.id,c.input]));
export async function buildRecordedHeightCommand(principal,value,crypto){const p=exact(principal,['kind','id']),v=exact(value,['requestKey','intentId','attemptId','evidenceReceiptDigest','expectedIntentRevision']);if(p.kind!=='operator'||!id(p.id)||!id(v.requestKey))throw new TypeError('Recorded height operator and request key required.');const {requestKey,...body}=v,input=normalizeRecordedOutcomeInput(body),c={operationKind:EXPIRE_RECORDED_ATTEMPT,principal:p,requestKey,input};return freeze({...c,requestDigest:await crypto.sha256(recordedHeightRequestBytes(c))});}
export function createRecordedHeightService({repository,crypto}){return Object.freeze({async expire(principal,value){return repository.expire(await buildRecordedHeightCommand(principal,value,crypto));}});}
