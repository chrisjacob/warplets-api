import type {CanonicalCrypto,OperatorPrincipal,Revisions,RepositoryOutcome} from '../application/ports';
import type {CollectionSourceRecord} from './state-codec.mjs';
export const STAGE_COLLECTION_RECORD:'collection.stage-record.v1';
export const SEAL_COLLECTION_LIST:'collection.seal-list.v1';
export const SEAL_COLLECTION_SOURCE:'collection.seal-source.v1';
export const COLLECTION_INTAKE_BOUNDS:Readonly<{recordBytes:131072;pageBytes:65536;listBytes:16384;listReadBytes:524288;sourceReadBytes:2097152;sourceSealBytes:32768;listPages:100;sourceLists:32;admissionPages:16;admissions:1000}>;
export type CollectionIntakeKind=typeof STAGE_COLLECTION_RECORD|typeof SEAL_COLLECTION_LIST|typeof SEAL_COLLECTION_SOURCE;
export interface VerifiedCollectionRecord {readonly id:string;readonly size:number;readonly format:'collection-page-v1'|'collection-list-v1'|'collection-source-v1';readonly kind:'eligibility'|'admissions'|null;readonly pageIndex:number|null;readonly bodyBase64:string}
export interface CollectionListSeal {readonly id:string;readonly count:number;readonly pageIds:readonly string[];readonly walletsDigest:string;readonly closureDigest:string;readonly firstWallet:string|null;readonly lastWallet:string|null}
export interface CollectionSourceSeal {readonly id:string;readonly inventoryId:string;readonly sourceRevision:string;readonly declaredStateDigest:string;readonly stageCount:number;readonly admissionCount:number;readonly closureDigest:string;
 readonly stageBindings:readonly Readonly<{stageId:string;listId:string|null;eligibilityKind:'list'|'pending'|'unrestricted'}>[];readonly admissionPageIds:readonly string[];readonly listIds:readonly string[];
 readonly verification:'record-closure-only';readonly semanticStateDigestVerified:false;readonly economicsVerified:false;readonly provenanceVerified:false}
export interface CollectionIntakeCommand {readonly operationKind:CollectionIntakeKind;readonly principal:OperatorPrincipal;readonly businessIdentity:string;readonly input:Readonly<{id:string}>;readonly requestKey:string;readonly expectedRevisions:Revisions;readonly nowMs:number;readonly requestDigest:string}
export type CollectionIntakeResult=RepositoryOutcome<Readonly<{id:string;[key:string]:unknown}>>;
export interface CollectionSourceIntakeRepository {
 /** Raw bytes are copied and independently verified by the concrete adapter. */
 stageRecord(command:CollectionIntakeCommand,record:CollectionSourceRecord):Promise<CollectionIntakeResult>;
 /** Exact named set only, at most101 records and2MiB. Missing or extra rows fail closure validation. */
 readRecords(ids:readonly string[]):Promise<readonly CollectionSourceRecord[]>;
 readListSeals(ids:readonly string[]):Promise<readonly CollectionListSeal[]>;
 /** Recompute from fresh stored bytes, compare metadata and atomically guard immutable dependencies. */
 sealList(command:CollectionIntakeCommand,seal:CollectionListSeal):Promise<CollectionIntakeResult>;
 sealSource(command:CollectionIntakeCommand,seal:CollectionSourceSeal):Promise<CollectionIntakeResult>;
}
export interface CollectionIntakeRequest {readonly requestKey:string;readonly expectedRevisions?:Revisions}
export interface CollectionSourceIntakeService {
 stageRecord(principal:OperatorPrincipal,input:CollectionIntakeRequest&Readonly<{record:CollectionSourceRecord}>):Promise<CollectionIntakeResult>;
 sealList(principal:OperatorPrincipal,input:CollectionIntakeRequest&Readonly<{id:string}>):Promise<CollectionIntakeResult>;
 sealSource(principal:OperatorPrincipal,input:CollectionIntakeRequest&Readonly<{id:string}>):Promise<CollectionIntakeResult>;
}
export function prepareCollectionRecord(record:CollectionSourceRecord,crypto:CanonicalCrypto):Promise<VerifiedCollectionRecord>;
export function prepareCollectionList(input:{manifest:CollectionSourceRecord;pages:readonly CollectionSourceRecord[]},crypto:CanonicalCrypto):Promise<CollectionListSeal>;
export function prepareCollectionSource(input:{root:CollectionSourceRecord;lists:readonly CollectionListSeal[];admissionPages:readonly CollectionSourceRecord[]},crypto:CanonicalCrypto):Promise<CollectionSourceSeal>;
export function collectionIntakeCommandBytes(command:Omit<CollectionIntakeCommand,'requestDigest'>):Uint8Array;
export function createCollectionSourceIntake(ports:{repository:CollectionSourceIntakeRepository;crypto:CanonicalCrypto;clock:{nowMs():number}}):CollectionSourceIntakeService;
