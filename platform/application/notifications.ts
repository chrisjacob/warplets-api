import type {Principal,OperatorPrincipal,CanonicalCrypto} from './ports';
/** Private local inbox only. Consent never authorizes external delivery. */
export type NoticeTopic='launch'|'voting'|'rewards';
export interface NotificationConsentInput {
 readonly channel:'local-inbox';readonly enabled:boolean;readonly topics:readonly NoticeTopic[];
 readonly terms:'10x-notice-local-inbox-v1';readonly expectedRevision:number;
}
export interface NotificationPreference {
 readonly channel:'local-inbox';readonly revision:number;readonly enabled:boolean;
 readonly topics:readonly NoticeTopic[];readonly terms:'10x-notice-local-inbox-v1';readonly changedAtMs:number|null;
}
export interface NotificationConsentCommand {
 readonly principal:Principal;readonly operationKind:'notifications.set-consent.v1';readonly requestKey:string;
 readonly input:NotificationConsentInput;readonly nowMs:number;readonly businessIdentity:string;readonly requestDigest:string;
}
export type NotificationConsentOutcome=Readonly<{appliedRevision:number;preference:NotificationPreference;replay:boolean}>
 |Readonly<{kind:'conflict';code:string}>|Readonly<{kind:'pending';reason:string;dependencyIds:readonly string[]}>;
export interface NotificationConsentRepository {
 readPreferences(principal:Principal):Promise<NotificationPreference>;
 setConsent(command:NotificationConsentCommand):Promise<NotificationConsentOutcome>;
}
export interface NotificationConsentServicePorts {readonly repository:NotificationConsentRepository;readonly crypto:CanonicalCrypto;readonly clock:{nowMs():number}}
export interface NotificationConsentService {
 readPreferences(principal:Principal):Promise<NotificationPreference>;
 setConsent(principal:Principal,request:Readonly<{requestKey:string;input:NotificationConsentInput}>):Promise<NotificationConsentOutcome>;
}

export type NoticeState='queued'|'leased'|'retry'|'delivered'|'unknown'|'cancelled';
export type NoticeFailure=Readonly<{kind:'conflict';code:string}>|Readonly<{kind:'pending';reason:string;dependencyIds:readonly string[]}>;
export type EnqueueNoticeInput=Readonly<{wallet:string;topic:'launch'|'voting';subject:string}>|Readonly<{wallet:string;topic:'rewards';subject:Readonly<{tokenId:string;day:number}>}>;
export interface EnqueueNoticeCommand {readonly principal:OperatorPrincipal;readonly requestKey:string;readonly input:EnqueueNoticeInput;readonly nowMs:number;readonly operationKind:'notifications.enqueue.v1';readonly businessIdentity:string;readonly requestDigest:string}
export interface DeliverNoticeInput {readonly id:string;readonly wallet:string;readonly consentRevision:number;readonly attempt:number;readonly deliveredMs:number}
export interface DeliverNoticeCommand {readonly principal:OperatorPrincipal;readonly requestKey:string;readonly input:DeliverNoticeInput;readonly nowMs:number;readonly operationKind:'notifications.deliver.v1';readonly businessIdentity:string;readonly requestDigest:string}
export type EnqueueNoticeOutcome=Readonly<{state:NoticeState;id:string;replay:boolean}>|Readonly<{state:'skipped';reason:'no-consent'|'no-current-event'|'daily-cap'}>|Readonly<{state:'held';reason:'delivery-paused'}>|Readonly<{state:'held';reason:'notice-history-unavailable';id:string;replay:true}>|NoticeFailure;
export interface LocalNotice {readonly id:string;readonly topic:NoticeTopic;readonly title:string;readonly message:string;readonly target:string;readonly deliveredMs:number}
export interface LocalInbox {readonly mode:'local-inbox';readonly items:readonly LocalNotice[];readonly nextCursor:string|null}
export type FinishNoticeOutcome=Readonly<{state:'delivered';id:string}>|Readonly<{state:'fenced'|'cancelled'|'retry'|'unknown'}>|NoticeFailure;
export interface NotificationDeliveryRepository {
 enqueueNotice(command:EnqueueNoticeCommand):Promise<EnqueueNoticeOutcome>;
 readInbox(principal:Principal,query?:Readonly<{cursor?:string|null;limit?:number}>):Promise<LocalInbox>;
 leaseDue(principal:OperatorPrincipal,query?:Readonly<{limit?:number}>):Promise<readonly Readonly<{id:string;lease:string}>[]|NoticeFailure>;
 finishLease(principal:OperatorPrincipal,input:Readonly<{id:string;lease:string;outcome?:'delivered'|'retryable'|'unknown'}>):Promise<FinishNoticeOutcome>;
 reconcileUnknown(principal:OperatorPrincipal,input:Readonly<{id:string}>):Promise<Readonly<{state:NoticeState|'missing'}>|NoticeFailure>;
}
