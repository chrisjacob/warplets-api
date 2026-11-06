import type {CanonicalCrypto,OperatorPrincipal,JobLease} from '../application/ports';
import type {AtomicDriver} from './atomic-earn.mjs';
import type {NotificationDeliveryRepository,NoticeFailure,FinishNoticeOutcome,NoticeState} from '../application/notifications';
export type PurgeNoticeOutcome={kind:'purged';outboxRemoved:number;consentRequestKeysRemoved:0}|{kind:'pending';reason:string;dependencyIds:readonly string[]};
export type NotificationRetentionRepository=NotificationDeliveryRepository&{
 purgeExpired(principal:OperatorPrincipal,options?:{limit?:number},lease?:JobLease):Promise<PurgeNoticeOutcome>;
 leaseDue(principal:OperatorPrincipal,options?:{limit?:number;noticeId?:string},jobLease?:JobLease):Promise<readonly Readonly<{id:string;lease:string}>[]|NoticeFailure>;
 finishLease(principal:OperatorPrincipal,input:Readonly<{id:string;lease:string;outcome?:'delivered'|'retryable'|'unknown'}>,jobLease?:JobLease):Promise<FinishNoticeOutcome>;
 reconcileUnknown(principal:OperatorPrincipal,input:Readonly<{id:string}>,jobLease?:JobLease):Promise<Readonly<{state:NoticeState|'missing'}>|NoticeFailure>;
};
export function createNotificationDeliveryRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;clock:{nowMs():number};ids:{next():string}}):NotificationRetentionRepository;
