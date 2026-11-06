import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
export const SET_NOTIFICATION_CONSENT='notifications.set-consent.v1';
export const NOTICE_TERMS='10x-notice-local-inbox-v1';
export const NOTICE_TOPICS=Object.freeze(['launch','voting','rewards']);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const require=(ok,message)=>{if(!ok)throw new TypeError(message);};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export function notificationPrincipal(value){
 const p=structuredClone(value);require(exact(p,['kind','wallet'])&&p.kind==='wallet','A wallet principal is required.');decode58(p.wallet,32);return freeze(p);
}
export function normalizeNotificationConsentInput(value){
 const i=structuredClone(value);require(exact(i,['channel','enabled','topics','terms','expectedRevision']),'Supply exact consent fields.');
 require(i.channel==='local-inbox'&&i.terms===NOTICE_TERMS&&typeof i.enabled==='boolean','Explicit local inbox consent and current terms are required.');
 require(Array.isArray(i.topics)&&i.topics.length<=3&&i.topics.every(t=>NOTICE_TOPICS.includes(t))&&new Set(i.topics).size===i.topics.length,'Choose supported topics once.');
 require(i.enabled?i.topics.length>0:i.topics.length===0,'Enable requires topics; revoke requires an empty list.');
 require(Number.isSafeInteger(i.expectedRevision)&&i.expectedRevision>=0&&i.expectedRevision<Number.MAX_SAFE_INTEGER,'Invalid expected consent revision.');
 i.topics.sort();return freeze(i);
}
/** Preserve the original ordered legacy hash, independent of time and key. */
export async function buildNotificationConsentCommand(value,crypto){
 const c=structuredClone(value);require(exact(c,['principal','requestKey','input','nowMs']),'Supply exact consent command fields.');
 const principal=notificationPrincipal(c.principal),input=normalizeNotificationConsentInput(c.input);
 require(typeof c.requestKey==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(c.requestKey),'Invalid consent request key.');
 require(Number.isSafeInteger(c.nowMs)&&c.nowMs>=0&&c.nowMs<=8640000000000000,'Invalid consent clock.');
 const requestDigest=await crypto.sha256(utf8(JSON.stringify([input.channel,input.enabled,input.topics,input.terms,input.expectedRevision])));
 return freeze({principal,requestKey:c.requestKey,input,nowMs:c.nowMs,operationKind:SET_NOTIFICATION_CONSENT,businessIdentity:canonicalJson([principal.wallet,input.channel,c.requestKey]),requestDigest});
}
export function createNotificationConsentService({repository,crypto,clock}){
 return Object.freeze({readPreferences:principal=>repository.readPreferences(notificationPrincipal(principal)),async setConsent(principal,request){
  const p=structuredClone(principal),r=structuredClone(request);require(exact(r,['requestKey','input']),'Supply requestKey and consent input only.');
  return repository.setConsent(await buildNotificationConsentCommand({principal:p,...r,nowMs:clock.nowMs()},crypto));
 }});
}
