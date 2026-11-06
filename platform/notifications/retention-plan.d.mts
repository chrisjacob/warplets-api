export const NOTICE_RETENTION:'notification-retention-v1';
export type RetentionPayload=Readonly<{kind:typeof NOTICE_RETENTION;runKey:string;limit:number}>;
export function retentionPayload(value:unknown):RetentionPayload;
export function retentionBusinessKey(value:unknown):string;
export function retentionSourceKey(value:unknown):string;
