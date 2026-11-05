import type {AtomicDriver} from './atomic-earn.mjs';
import type {AppTelemetry,ArtifactIdentity,CanonicalCrypto,OperatorPrincipal,RepositoryOutcome,Revisions} from '../application/ports';
import type {CutoffInventoryQuery,CutoffInventoryResult} from './cutoff-inventory.mjs';
import type {BoardInputRead} from './atomic-board-input.mjs';
import type {RequirementSpec} from '../evidence/requirements.mjs';
import type {EvidenceResult} from '../evidence/types';
export const SNAPSHOT_ATTEMPT:'earn.snapshot-attempt.v1';
export type SnapshotMetadata={epoch:number;status:'pending'|'ready';manifestDigest:string;objectKey:string;byteDigest:string;
 requirementsDigest:string;evidenceDigest:string;inputDigest:string|null};
export type SnapshotAttemptCommand={principal:OperatorPrincipal;input:SnapshotMetadata;nowMs:number;expectedRevisions:Revisions;
 operationKind:typeof SNAPSHOT_ATTEMPT;businessIdentity:string;requestKey:string;requestDigest:string};
export function createSnapshotAttemptCommand(input:{principal:OperatorPrincipal;input:SnapshotMetadata;nowMs:number;expectedRevisions:Revisions},crypto:CanonicalCrypto):Promise<SnapshotAttemptCommand>;
export interface CutoffSnapshotRepository {
 hasPrivateObject(identity:ArtifactIdentity):Promise<boolean>;
 loadInventory(query:CutoffInventoryQuery):Promise<CutoffInventoryResult>;
 loadBoardInput(query:{epoch:number;nowMs:number;sourceRef:string}):Promise<BoardInputRead>;
 selectHeads(specs:readonly RequirementSpec[]):Promise<Map<string,EvidenceResult|null>>;
 readVersions():Promise<Revisions>;
 readPointer(epoch:number):Promise<string|null>;
 recordAttempt(command:SnapshotAttemptCommand):Promise<RepositoryOutcome<SnapshotMetadata>|{kind:'replayed';value:SnapshotMetadata}>;
}
export function createCutoffSnapshotRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};telemetry?:AppTelemetry}):CutoffSnapshotRepository;
