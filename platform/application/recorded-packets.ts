import type {OperatorPrincipal,RepositoryOutcome} from './ports';
import type {RecordedOutcomeInput} from './recorded-outcomes';
import type {ActionAttemptState} from './action-recovery';
export type RecordedPacketInput=RecordedOutcomeInput;
export interface RecordedPacketCommand {readonly operationKind:'transactions.prepare-recorded-attempt.v1';readonly principal:OperatorPrincipal;readonly requestKey:string;readonly input:RecordedPacketInput;readonly requestDigest:string}
export interface RecordedPacketResult {readonly eventId:string;readonly intentId:string;readonly attemptId:string;readonly state:'awaiting_signature';readonly revision:number;readonly index:number;readonly messageHash:string;readonly packetDigest:string;readonly simulationDigest:string;readonly source:'local-rehearsal';readonly provenance:'synthetic-recorded-preparation';readonly legacyAuthority:'unverified';readonly executable:false;readonly financialExecution:false}
export type RecordedPacketOutcome=RepositoryOutcome<RecordedPacketResult>|Readonly<{kind:'legacy-replayed';value:Readonly<{intentId:string;attemptId:string;state:ActionAttemptState;source:'local-rehearsal';provenance:'legacy-recorded-unverified';executable:false}>}>;
export interface RecordedPacketRepository {prepare(command:RecordedPacketCommand):Promise<RecordedPacketOutcome>}
export interface RecordedPacketService {prepare(principal:OperatorPrincipal,input:RecordedPacketInput&Readonly<{requestKey:string}>):Promise<RecordedPacketOutcome>}
