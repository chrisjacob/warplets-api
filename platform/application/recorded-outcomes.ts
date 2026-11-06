import type {OperatorPrincipal,RepositoryOutcome} from './ports';
export type RecordedOutcomeState='unknown'|'confirmed'|'failed'|'finalized';
export interface RecordedOutcomeInput {readonly intentId:string;readonly attemptId:string;readonly evidenceReceiptDigest:string;readonly expectedIntentRevision:number}
export interface RecordedOutcomeCommand {readonly operationKind:'transactions.record-outcome.v1';readonly principal:OperatorPrincipal;readonly requestKey:string;readonly input:RecordedOutcomeInput;readonly requestDigest:string}
export interface RecordedOutcomeResult {readonly observationDigest:string;readonly eventId:string;readonly intentId:string;readonly attemptId:string;readonly state:RecordedOutcomeState;readonly revision:number;readonly source:'local-rehearsal';readonly provenance:'synthetic-recorded-outcome';readonly legacyAuthority:'unverified';readonly executable:false;readonly financialExecution:false}
export type LegacyRecordedOutcomeReplay=Readonly<{kind:'legacy-replayed';value:Readonly<{eventId:string;attemptId:string;state:RecordedOutcomeState;source:'local-rehearsal';provenance:'legacy-recorded-unverified';executable:false}>}>;
export type RecordedOutcome=RepositoryOutcome<RecordedOutcomeResult>|LegacyRecordedOutcomeReplay;
export interface RecordedOutcomeRepository {record(command:RecordedOutcomeCommand):Promise<RecordedOutcome>}
export interface RecordedOutcomeService {record(principal:OperatorPrincipal,input:RecordedOutcomeInput&Readonly<{requestKey:string}>):Promise<RecordedOutcome>}
