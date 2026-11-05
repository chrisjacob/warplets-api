import type { AtomicDriver } from './atomic-earn.mjs';
import type { CanonicalCrypto,AppTelemetry,OperatorPrincipal,Revisions,RepositoryOutcome,Leaderboard,RecordedAllocation,JobLease } from '../application/ports';
import type { BoardInputRead } from './atomic-board-input.mjs';
export const SEAL_INPUT:'earn.seal-input.v1',COMMIT_BOARD:'earn.commit-board.v1',COMMIT_ALLOCATION:'earn.commit-allocation.v1';
export type SettlementInputs={
 'earn.seal-input.v1':{epoch:number;asOfMs:number;sourceRef:string;objectKey:string;byteDigest:string;manifestDigest:string;inputDigest:string;previousManifestDigest:string|null};
 'earn.commit-board.v1':{epoch:number;manifestDigest:string;planDigest:string};
 'earn.commit-allocation.v1':{tokenId:string;day:number;boardDigest:string;planDigest:string};
};
export type SettlementKind=keyof SettlementInputs;
export type SettlementCommand<K extends SettlementKind>=Readonly<{operationKind:K;principal:OperatorPrincipal;requestKey:string;
 nowMs:number;expectedRevisions:Revisions;input:SettlementInputs[K];businessIdentity:string;requestDigest:string}>;
export type SettlementLease=Pick<JobLease,'businessKey'|'token'|'payloadDigest'|'revision'>;
export function createSettlementCommand<K extends SettlementKind>(kind:K,args:{principal:OperatorPrincipal;requestKey:string;nowMs:number;
 expectedRevisions?:Revisions;input:SettlementInputs[K]},crypto:CanonicalCrypto):Promise<SettlementCommand<K>>;
export function settlementFenceKey(kind:SettlementKind,input:SettlementInputs[SettlementKind]):string;
export interface AtomicSettlementRepository {
 sealBoardInput(command:SettlementCommand<'earn.seal-input.v1'>):Promise<RepositoryOutcome<{epoch:number;manifestDigest:string;inputDigest:string}>>;
 commitBoard(command:SettlementCommand<'earn.commit-board.v1'>,lease:SettlementLease):Promise<RepositoryOutcome<Leaderboard>>;
 commitAllocation(command:SettlementCommand<'earn.commit-allocation.v1'>,lease:SettlementLease):Promise<RepositoryOutcome<RecordedAllocation>>;
 loadBoardInput(query:{epoch:number;nowMs:number;sourceRef:string}):Promise<BoardInputRead>;
}
export function createAtomicSettlementRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};clock:{nowMs():number};telemetry?:AppTelemetry}):AtomicSettlementRepository;
