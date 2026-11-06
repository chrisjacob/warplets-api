import {canonicalJson,utf8} from '../security/canonical.mjs';
import {name,nat,requireValue} from './validation.mjs';
export const CONFIGURE_ACTION='earn.configure-action.v1';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
/** Execution time is checked after accepted-receipt lookup by the repository.
 * A reviewed request grants no issuer, completion or financial authority. */
export async function buildActionPolicyCommand(value,crypto){
 const c=structuredClone(value);requireValue(exact(c,['principal','requestKey','input','nowMs','expectedRevisions']),'Supply exact action-policy command fields.');
 requireValue(exact(c.principal,['kind','id'])&&c.principal.kind==='operator','An operator principal is required.');name(c.principal.id,'operator');
 requireValue(/^[A-Za-z0-9._:-]{1,128}$/.test(c.principal.id)&&typeof c.requestKey==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(c.requestKey),'Invalid operator identity or request key.');
 nat(c.nowMs,'clock');requireValue(c.nowMs<=8640000000000000,'Invalid clock.');
 requireValue(exact(c.expectedRevisions,['earn','source','control'])&&Object.values(c.expectedRevisions).every(v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&Number.isSafeInteger(Number(v))),'Supply all three exact safe revision strings.');
 const i=c.input;requireValue(exact(i,['actionId','label','verifier','effectiveEpoch','enabled','evidenceRef']),'Invalid action-policy input.');
 for(const key of ['actionId','label','verifier','evidenceRef'])name(i[key],key);nat(i.effectiveEpoch,'effective board');requireValue(typeof i.enabled==='boolean','Specify action enabled state.');
 return freeze({...c,operationKind:CONFIGURE_ACTION,businessIdentity:canonicalJson([i.actionId,i.effectiveEpoch]),requestDigest:await crypto.sha256(utf8(canonicalJson([CONFIGURE_ACTION,c.principal.id,i])))});
}
export function createActionPolicyService({repository,crypto,clock}){
 const prepare=(principal,request)=>buildActionPolicyCommand({...request,principal,nowMs:clock.nowMs()},crypto);
 return Object.freeze({configureAction:async(principal,request)=>repository.configureAction(await prepare(principal,request)),previewAction:async(principal,request)=>repository.previewAction(await prepare(principal,request))});
}
