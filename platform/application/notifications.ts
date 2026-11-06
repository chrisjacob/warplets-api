import type {Principal,CanonicalCrypto} from './ports';
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
