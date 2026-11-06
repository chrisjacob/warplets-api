import {canonicalJson} from '../security/canonical.mjs';
export const NOTICE_RETENTION='notification-retention-v1';
export function retentionPayload(value){
 const p=structuredClone(value);
 if(!p||Object.keys(p).sort().join(',')!=='kind,limit,runKey'||p.kind!==NOTICE_RETENTION||typeof p.runKey!=='string'||! /^[\x21-\x7e]{1,128}$/.test(p.runKey)||!Number.isInteger(p.limit)||p.limit<1||p.limit>100)throw new TypeError('Invalid private notification retention payload.');
 return Object.freeze(p);
}
export const retentionBusinessKey=value=>canonicalJson([NOTICE_RETENTION,retentionPayload(value).runKey]);
export const retentionSourceKey=value=>NOTICE_RETENTION+':'+retentionPayload(value).runKey;
