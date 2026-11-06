import {canonicalJson,utf8} from '../security/canonical.mjs';
import {normalizeRecordedOutcomeInput} from './recorded-outcome-service.mjs';
export const PREPARE_RECORDED_ATTEMPT='transactions.prepare-recorded-attempt.v1';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9:_./-]{1,128}$/.test(v);
const exact=(v,keys)=>{if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v))||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)||!Object.getOwnPropertyDescriptor(v,k)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value')))throw new TypeError('Invalid recorded packet input.');return Object.fromEntries(keys.map(k=>[k,v[k]]));};
export const recordedPacketRequestBytes=c=>utf8(canonicalJson([PREPARE_RECORDED_ATTEMPT,c.principal.id,c.input]));
export async function buildRecordedPacketCommand(principal,value,crypto){const p=exact(principal,['kind','id']),v=exact(value,['requestKey','intentId','attemptId','evidenceReceiptDigest','expectedIntentRevision']);if(p.kind!=='operator'||!id(p.id)||!id(v.requestKey))throw new TypeError('Recorded height operator and request key required.');const {requestKey,...body}=v,input=normalizeRecordedOutcomeInput(body),c={operationKind:PREPARE_RECORDED_ATTEMPT,principal:p,requestKey,input};return freeze({...c,requestDigest:await crypto.sha256(recordedPacketRequestBytes(c))});}
export function createRecordedPacketService({repository,crypto}){return Object.freeze({async prepare(principal,value){return repository.prepare(await buildRecordedPacketCommand(principal,value,crypto));}});}
