import {canonicalJson,utf8} from '../security/canonical.mjs';
export const MATERIALIZE_ELIGIBILITY_PAGE='collection.materialize-eligibility-page.v1';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const requireValue=(condition,message)=>{if(!condition)throw new TypeError(message);};
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export function eligibilityIndexCommandBytes(command){return utf8(canonicalJson([command.operationKind,command.principal,command.businessIdentity,command.requestKey,command.expectedRevisions,command.input]));}
export async function prepareEligibilityIndexCommand(value,crypto){
 const c=structuredClone(value);
 requireValue(exact(c.principal,['kind','id'])&&c.principal.kind==='operator'&&text(c.principal.id),'Eligibility materialization requires an operator principal.');
 requireValue(exact(c.input,['id'])&&typeof c.input.id==='string'&&/^[a-f0-9]{64}$/.test(c.input.id)&&text(c.requestKey),'Invalid eligibility page identity.');
 requireValue(c.expectedRevisions&&typeof c.expectedRevisions==='object'&&!Array.isArray(c.expectedRevisions)&&Object.entries(c.expectedRevisions).every(([key,n])=>['source','control','earn'].includes(key)&&typeof n==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(n)),'Invalid expected revisions.');
 requireValue(Number.isSafeInteger(c.nowMs)&&c.nowMs>=0&&c.nowMs<=8640000000000000,'Invalid materialization clock.');
 const command={operationKind:MATERIALIZE_ELIGIBILITY_PAGE,principal:c.principal,businessIdentity:c.input.id,input:c.input,requestKey:c.requestKey,expectedRevisions:c.expectedRevisions,nowMs:c.nowMs};
 return freeze({...command,requestDigest:await crypto.sha256(eligibilityIndexCommandBytes(command))});
}
/** Private indexing only: no active source pointer, approval, membership claim
 * or publication is produced by materializing one independently checked page. */
export function createEligibilityIndexService({repository,crypto,clock}){
 return Object.freeze({async materializePage(principal,input){
  const p=structuredClone(principal),body=structuredClone(input);
  requireValue(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(key=>['id','requestKey','expectedRevisions'].includes(key)),'Supply a page identity and command metadata only.');
  const command=await prepareEligibilityIndexCommand({principal:p,input:{id:body.id},requestKey:body.requestKey,expectedRevisions:body.expectedRevisions??{},nowMs:clock.nowMs()},crypto);
  return repository.materializePage(command);
 }});
}
