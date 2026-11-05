import type {ArtifactIdentity,CanonicalCrypto,OperatorPrincipal,RepositoryOutcome} from '../application/ports';
import type {CutoffSnapshotRepository,SnapshotMetadata} from '../storage/cutoff-snapshot.mjs';
import type {CutoffInventoryQuery} from '../storage/cutoff-inventory.mjs';
import type {AtomicSettlementRepository} from '../storage/atomic-settlement.mjs';
import type {BoardInputRead} from '../storage/atomic-board-input.mjs';
export interface PrivateSnapshotReferences {persist(principal:OperatorPrincipal,input:{identity:ArtifactIdentity;bytes:Uint8Array;requestKey:string}):Promise<RepositoryOutcome<ArtifactIdentity&{verification:'exact-bytes'}>>;}
export type SnapshotAssemblyResult=RepositoryOutcome<SnapshotMetadata|{epoch:number;manifestDigest:string;inputDigest:string}>
 |{kind:'replayed';value:SnapshotMetadata}|{kind:'pending';reason:string;dependencyIds:readonly string[];manifestDigest?:string}
 |Extract<BoardInputRead,{kind:'final'}>;
export interface CutoffSnapshotService {assemble(principal:OperatorPrincipal,query:Omit<CutoffInventoryQuery,'nowMs'>):Promise<SnapshotAssemblyResult>;}
export function createCutoffSnapshotService(ports:{repository:CutoffSnapshotRepository;settlementRepository:Pick<AtomicSettlementRepository,'sealBoardInput'>;
 privateReferences:PrivateSnapshotReferences;crypto:CanonicalCrypto;clock:{nowMs():number}}):CutoffSnapshotService;
