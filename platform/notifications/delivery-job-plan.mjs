import {canonicalJson} from '../security/canonical.mjs';
export const NOTICE_DELIVERY_JOB='notification-delivery-v1';
export function deliveryJobPayload(value){
 const p=structuredClone(value);
 if(!p||Object.keys(p).sort().join(',')!=='kind,noticeId'||p.kind!==NOTICE_DELIVERY_JOB||typeof p.noticeId!=='string'||!/^[a-f0-9]{64}$/.test(p.noticeId))throw new TypeError('Invalid private notice delivery job.');
 return Object.freeze(p);
}
export const deliveryJobBusinessKey=value=>canonicalJson([NOTICE_DELIVERY_JOB,deliveryJobPayload(value).noticeId]);
export const deliveryJobSourceKey=value=>NOTICE_DELIVERY_JOB+':'+deliveryJobPayload(value).noticeId;
