import type {OperatorPrincipal,RepositoryOutcome} from './ports';
import type {RecordedOutcomeInput} from './recorded-outcomes';
export interface RecordedHeightCommand {readonly operationKind:'transactions.expire-recorded-attempt.v1';readonly principal:OperatorPrincipal;readonly requestKey:string;readonly input:RecordedOutcomeInput;readonly requestDigest:string}
export interface RecordedExpiryResult {readonly eventId:string;readonly intentId:string;readonly attemptId:string;readonly state:'attempt_expired';readonly revision:number;readonly blockHeight:number;readonly lastValidBlockHeight:number;readonly messageHash:string;readonly source:'local-rehearsal';readonly provenance:'synthetic-recorded-height';readonly legacyAuthority:'unverified';readonly executable:false;readonly financialExecution:false}
export interface RecordedHeightRepository {expire(command:RecordedHeightCommand):Promise<RepositoryOutcome<RecordedExpiryResult>>}
export interface RecordedHeightService {expire(principal:OperatorPrincipal,input:RecordedOutcomeInput&Readonly<{requestKey:string}>):Promise<RepositoryOutcome<RecordedExpiryResult>>}
export type RecordedHeightInput=RecordedOutcomeInput;
export type RecordedHeightResult=RecordedExpiryResult;
export type RecordedHeightOutcome=RepositoryOutcome<RecordedExpiryResult>;
