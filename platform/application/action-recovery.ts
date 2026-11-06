import type {Principal} from './ports';
/** Read-only local recovery guidance; never transaction or release authority. */
export type LegacyAction='launch'|'fund'|'claim'|'stake'|'unstake'|'harvest'|'swap';
export type ActionIntentState='validated'|'awaiting_signature'|'attempt_expired'|'submitted'|'unknown'|'confirmed'|'failed'|'finalized';
export type ActionAttemptState='awaiting_signature'|'expired'|'submitted'|'unknown'|'confirmed'|'failed'|'finalized';
export type ActionObservationState='unknown'|'confirmed'|'failed'|'finalized';
export interface ActionRecoveryAttempt {readonly id:string;readonly index:number;readonly state:ActionAttemptState;readonly messageHash:string;readonly blockhash:string;readonly lastValidBlockHeight:number;readonly contextSlot:number;readonly observedAtMs:number;readonly hasRecordedSignature:boolean}
export interface ActionRecoveryView {
 readonly id:string;readonly action:LegacyAction;readonly subject:string;readonly state:ActionIntentState;readonly revision:number;readonly planHash:string;readonly createdAtMs:number;readonly planExpiresAtMs:number;readonly asOfMs:number;
 readonly attemptCount:number;readonly currentAttempt:ActionRecoveryAttempt|null;readonly receiptObservations:readonly Readonly<{eventId:string;attemptId:string;state:ActionObservationState}>[];
 readonly nextLocalTransition:'prepare-recorded-packet'|'observe-or-expire-unsubmitted'|'replace-expired-unsubmitted'|'reconcile-existing-attempt'|'none';
 readonly requiredObservation:'fresh-verified-preparation'|'recorded-block-height-or-submission'|'same-attempt-recorded-outcome'|null;
 readonly replacementEligible:boolean;readonly source:'local-rehearsal';readonly provenance:'legacy-recorded-unverified';readonly executable:false;readonly financialExecution:false;
}
export type ActionRecoveryReadOutcome=Readonly<{kind:'not-found'}>|Readonly<{kind:'pending';reason:'history-bound'|'history-inconsistent'|'snapshot-changed'|'snapshot-unavailable'|'recovery-in-progress'}>|Readonly<{kind:'ready';value:ActionRecoveryView}>;
export interface ActionRecoveryReadRepository {readRecovery(principal:Principal,query:Readonly<{intentId:string}>):Promise<ActionRecoveryReadOutcome>}
