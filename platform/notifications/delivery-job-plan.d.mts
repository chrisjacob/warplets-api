export const NOTICE_DELIVERY_JOB:'notification-delivery-v1';
export type DeliveryJobPayload=Readonly<{kind:typeof NOTICE_DELIVERY_JOB;noticeId:string}>;
export function deliveryJobPayload(value:unknown):DeliveryJobPayload;
export function deliveryJobBusinessKey(value:unknown):string;
export function deliveryJobSourceKey(value:unknown):string;
