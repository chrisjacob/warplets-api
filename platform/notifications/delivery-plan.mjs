import {canonicalJson,utf8} from '../security/canonical.mjs';
import {notificationPrincipal,NOTICE_TERMS,NOTICE_TOPICS} from './consent.mjs';
export const ENQUEUE_NOTICE='notifications.enqueue.v1',DELIVER_NOTICE='notifications.deliver.v1';
const DAY=86400000,MAX=8640000000000000;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=(ok,message)=>{if(!ok)throw new TypeError(message);};
const name=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v===v.trim();
const time=v=>Number.isSafeInteger(v)&&v>=0&&v<=MAX;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export function noticeWorkerPrincipal(value){const p=structuredClone(value);need(exact(p,['kind','id'])&&p.kind==='operator'&&typeof p.id==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(p.id),'A named private notice worker is required.');return freeze(p);}
export function normalizeEnqueueNoticeInput(value){
 const i=structuredClone(value);need(exact(i,['wallet','topic','subject']),'Supply wallet, topic and named source only.');notificationPrincipal({kind:'wallet',wallet:i.wallet});need(NOTICE_TOPICS.includes(i.topic),'Unknown notice topic.');
 if(i.topic==='rewards')need(exact(i.subject,['tokenId','day'])&&name(i.subject.tokenId)&&Number.isInteger(i.subject.day)&&i.subject.day>=1&&i.subject.day<=10,'Invalid reward subject.');else need(name(i.subject),'Invalid notice source.');return freeze(i);
}
export function noticeSourceKey(input){return input.topic==='rewards'?JSON.stringify([input.subject.tokenId,input.subject.day]):input.subject;}
export async function buildEnqueueNoticeCommand(value,crypto){
 const c=structuredClone(value);need(exact(c,['principal','requestKey','input','nowMs']),'Supply exact private enqueue command.');const principal=noticeWorkerPrincipal(c.principal),input=normalizeEnqueueNoticeInput(c.input);need(typeof c.requestKey==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(c.requestKey)&&time(c.nowMs),'Invalid enqueue key or clock.');
 const id=await crypto.sha256(utf8(JSON.stringify([NOTICE_TERMS,input.wallet,input.topic,noticeSourceKey(input)])));
 return freeze({principal,requestKey:c.requestKey,input,nowMs:c.nowMs,operationKind:ENQUEUE_NOTICE,businessIdentity:id,requestDigest:await crypto.sha256(utf8(canonicalJson([ENQUEUE_NOTICE,principal.id,input])))});
}
/** Named source facts are internal repository output, never public message input.
 * Digest commits the retained source bytes/facts, not external authenticity. */
export async function prepareNoticeSource(value,facts,nowMs,crypto){
 const i=normalizeEnqueueNoticeInput(value),f=structuredClone(facts);need(time(nowMs),'Invalid source clock.');if(f===null)return {kind:'skipped',reason:'no-current-event'};
 let title,message,target,expiresMs;
 if(i.topic==='launch'){
  need(exact(f,['body'])&&typeof f.body==='string'&&utf8(f.body).length<=65536,'Notice market source bound.');const market=JSON.parse(f.body),starts=Date.parse(market?.activatedAt);need(time(starts)&&starts<=MAX-DAY,'Invalid market source time.');
  if(nowMs<starts||nowMs>=starts+DAY)return {kind:'skipped',reason:'no-current-event'};
  title='Market opened';message='A local ATT campaign is available.';target='/markets/'+encodeURIComponent(i.subject);expiresMs=starts+DAY;
 }else if(i.topic==='voting'){
  need(exact(f,['id','opensMs','closesMs'])&&f.id===i.subject&&time(f.opensMs)&&time(f.closesMs)&&f.opensMs<f.closesMs,'Invalid ballot source.');
  if(nowMs<f.opensMs||nowMs>=f.closesMs)return {kind:'skipped',reason:'no-current-event'};
  title='Genesis vote is open';message='This wallet is eligible to advise the next Genesis opening.';target='/collections/genesis';expiresMs=f.closesMs;
 }else{
  need(exact(f,['amount','epoch','vestsFromMs','vestsThroughMs'])&&typeof f.amount==='string'&&/^(0|[1-9][0-9]{0,79})$/.test(f.amount)&&Number.isSafeInteger(f.epoch)&&f.epoch>=0&&f.epoch<=Math.floor(MAX/DAY)&&time(f.vestsFromMs)&&time(f.vestsThroughMs)&&f.vestsFromMs<=f.vestsThroughMs&&f.vestsThroughMs<=MAX-DAY,'Invalid award source.');
  if(BigInt(f.amount)===0n||nowMs<=f.vestsFromMs||nowMs>=f.vestsThroughMs+DAY)return {kind:'skipped',reason:'no-current-event'};
  title='Earn award is vesting';message='Review your local Earn award and its release window.';target='/earn/'+new Date(f.epoch*DAY).toISOString().slice(0,10);expiresMs=f.vestsThroughMs+DAY;
 }
 return freeze({kind:'ready',sourceKey:noticeSourceKey(i),sourceDigest:await crypto.sha256(utf8(canonicalJson([NOTICE_TERMS,i.topic,i.subject,f]))),title,message,target,expiresMs});
}


export async function buildDeliverNoticeCommand(value,crypto){
 const v=structuredClone(value);need(exact(v,['principal','input']),'Supply exact internal delivery facts.');const principal=noticeWorkerPrincipal(v.principal),i=v.input;
 need(exact(i,['id','wallet','consentRevision','attempt','deliveredMs'])&&typeof i.id==='string'&&/^[a-f0-9]{64}$/.test(i.id),'Invalid delivery identity.');notificationPrincipal({kind:'wallet',wallet:i.wallet});
 need(Number.isSafeInteger(i.consentRevision)&&i.consentRevision>=1&&Number.isInteger(i.attempt)&&i.attempt>=1&&i.attempt<=5&&time(i.deliveredMs),'Invalid delivery facts.');
 return freeze({principal,input:i,operationKind:DELIVER_NOTICE,requestKey:i.id,businessIdentity:i.id,nowMs:i.deliveredMs,requestDigest:await crypto.sha256(utf8(canonicalJson([DELIVER_NOTICE,principal.id,{id:i.id,wallet:i.wallet,consentRevision:i.consentRevision,attempt:i.attempt}])))});
}
