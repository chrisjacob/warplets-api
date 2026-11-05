import type {ArtifactIdentity,CanonicalCrypto,OperatorPrincipal,Revisions,BoardPlan,AllocationPlan,RecordedAllocation,Winner} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {BoardInputRead} from '../storage/atomic-board-input.mjs';
import type {SettlementCommand} from '../storage/atomic-settlement.mjs';
import type {RequirementSpec} from '../evidence/requirements.mjs';
import type {EvidenceResult} from '../evidence/types';
export type PreparationPending=Readonly<{kind:'pending';reason:string;dependencyIds:readonly string[];readyMs?:number}>;
export type PreparationConflict=Readonly<{kind:'conflict';code:string}>;
export type ExistingBoard=Extract<BoardInputRead,{kind:'final'}>;
export type ExistingAllocation=Readonly<{kind:'recorded';value:RecordedAllocation}>;
export type SealedPreparationInput=Readonly<{epoch:number;manifestDigest:string;inputDigest:string;objectKey:string;byteDigest:string;
 asOfMs:number;sourceRef:string;dependencyVersions:Revisions}>;
export type SnapshotPreparationAttempt=Readonly<{epoch:number;status:'ready';manifestDigest:string;inputDigest:string;objectKey:string;byteDigest:string;
 requirementsDigest:string;evidenceDigest:string;dependencyVersions:Revisions}>;
export type BoardPreparationRead=Readonly<{kind:'loaded';versions:Revisions;sealed:SealedPreparationInput;manifestIdentity:ArtifactIdentity;attempt:SnapshotPreparationAttempt}>
 |ExistingBoard|PreparationPending|PreparationConflict;
export type AllocationPreparationRead=Readonly<{kind:'loaded';versions:Revisions;campaign:Readonly<{activationMs:number;originalSupplyUnits:string}>;
 board:Readonly<{epoch:number;status:'final';winners:readonly Winner[];snapshotId:string}>|null}>
 |ExistingAllocation|PreparationPending|PreparationConflict;
/** The SQL adapter joins the current sealed pointer to an exact ready B05
 * attempt and private object identity, and bounds every live read. */
export interface SettlementPreparationRepository {
 loadBoardPreparation(query:{epoch:number}):Promise<BoardPreparationRead>;
 loadAllocationPreparation(query:{tokenId:string;day:number;nowMs:number;requestKey?:string}):Promise<AllocationPreparationRead>;
 loadBoardInput(query:{epoch:number;nowMs:number;sourceRef:string}):Promise<BoardInputRead>;
 selectHeads(specs:readonly RequirementSpec[]):Promise<Map<string,EvidenceResult|null>>;
 readVersions():Promise<Revisions>;
 readPointer(epoch:number):Promise<string|null>;
}
export type PreparedBoard=Readonly<{kind:'prepared';command:SettlementCommand<'earn.commit-board.v1'>;plan:BoardPlan;
 dependencies:Readonly<{manifestDigest:string;inputDigest:string;requirementsDigest:string;evidenceDigest:string}>}>;
export type PreparedAllocation=Readonly<{kind:'prepared';command:SettlementCommand<'earn.commit-allocation.v1'>;plan:AllocationPlan;dependencies:Readonly<{boardDigest:string}>}>;
export interface EarnSettlementService {
 prepareBoard(principal:OperatorPrincipal,query:{epoch:number;requestKey:string}):Promise<PreparedBoard|ExistingBoard|PreparationPending|PreparationConflict>;
 prepareAllocation(principal:OperatorPrincipal,query:{tokenId:string;day:number;requestKey:string}):Promise<PreparedAllocation|ExistingAllocation|PreparationPending|PreparationConflict>;
}
export const SETTLEMENT_PREPARATION_LIMITS:Readonly<{objectBytes:262144;totalBytes:25165824;pages:512;items:16384}>;
export function createEarnSettlementService(ports:{repository:SettlementPreparationRepository;artifacts:Pick<ArtifactStore,'getVerified'>;
 crypto:CanonicalCrypto;clock:{nowMs():number}}):EarnSettlementService;
