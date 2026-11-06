import type {CanonicalCrypto,OperatorPrincipal,RepositoryOutcome,Revisions} from '../application/ports';
import type {CollectionCutRecord,CollectionCutSeal} from './free-cut-codec.mjs';
export const STAGE_COLLECTION_CUT_RECORD:'collection.stage-cut-record.v1';
export const BEGIN_COLLECTION_FREE_CUT:'collection.begin-free-cut.v1';
export const VALIDATE_COLLECTION_CUT_PAGE:'collection.validate-cut-page.v1';
export const SEAL_COLLECTION_FREE_CUT:'collection.seal-free-cut.v1';
export type CollectionCutOperationKind=typeof STAGE_COLLECTION_CUT_RECORD|typeof BEGIN_COLLECTION_FREE_CUT|typeof VALIDATE_COLLECTION_CUT_PAGE|typeof SEAL_COLLECTION_FREE_CUT;
export type CollectionCutCommandInput=Readonly<{id:string}>|Readonly<{rootId:string}>|Readonly<{attemptId:string;pageIndex:number}>|Readonly<{attemptId:string}>;
export interface CollectionCutCommand {readonly operationKind:CollectionCutOperationKind;readonly principal:OperatorPrincipal;readonly businessIdentity:string;readonly requestKey:string;readonly input:CollectionCutCommandInput;readonly requestDigest:string;readonly expectedRevisions?:Readonly<{earn:string;source:string;control:string}>}
export type CollectionCutSealResult=Omit<CollectionCutSeal,'walletsDigest'|'sourceRef'|'sourceRevision'>;
export interface CollectionCutRecordResult {readonly id:string;readonly format:'collection-cut-page-v1'|'collection-cut-root-v1';readonly size:number;readonly source:'local-fixture';readonly executable:false}
export interface CollectionCutBeginResult {readonly attemptId:string;readonly rootId:string;readonly sourceRevision:string;readonly inventoryId:string;readonly stageId:string;readonly atMs:number;readonly source:'local-fixture';readonly executable:false}
export interface CollectionCutPageResult {readonly attemptId:string;readonly pageIndex:number;readonly pageId:string;readonly holdingCount:number;readonly trackedCount:number;readonly closureDigest:string;readonly source:'local-fixture';readonly executable:false}
export type ReviewedCutRequest=Readonly<{expectedRevisions?:Readonly<{earn:string;source:string;control:string}>}>;
export type CollectionCutPreview={kind:'preview';value:(CollectionCutRecordResult|CollectionCutBeginResult|CollectionCutPageResult|CollectionCutSealResult)&{expectedRevisions:Revisions;context:Readonly<{inventoryId:string;stageId:string;cutMs:number;termsDigest:string;eligibilityListId:string;pageCount:number}>|null;financialExecution:false}};
export interface CollectionCutRepository {
 previewCommand?(command:CollectionCutCommand,record?:CollectionCutRecord):Promise<CollectionCutPreview|RepositoryOutcome<CollectionCutRecordResult|CollectionCutBeginResult|CollectionCutPageResult|CollectionCutSealResult>>;
 stageRecord(command:CollectionCutCommand,record:CollectionCutRecord):Promise<RepositoryOutcome<CollectionCutRecordResult>>;
 beginCut(command:CollectionCutCommand):Promise<RepositoryOutcome<CollectionCutBeginResult>>;
 validatePage(command:CollectionCutCommand):Promise<RepositoryOutcome<CollectionCutPageResult>>;
 sealCut(command:CollectionCutCommand):Promise<RepositoryOutcome<CollectionCutSealResult>>;
}
export interface CollectionCutService {
 stageRecord(principal:OperatorPrincipal,input:Readonly<{requestKey:string;record:CollectionCutRecord}>):Promise<RepositoryOutcome<CollectionCutRecordResult>>;
 beginCut(principal:OperatorPrincipal,input:Readonly<{requestKey:string;rootId:string}>&ReviewedCutRequest):Promise<RepositoryOutcome<CollectionCutBeginResult>>;
 validatePage(principal:OperatorPrincipal,input:Readonly<{requestKey:string;attemptId:string;pageIndex:number}>&ReviewedCutRequest):Promise<RepositoryOutcome<CollectionCutPageResult>>;
 sealCut(principal:OperatorPrincipal,input:Readonly<{requestKey:string;attemptId:string}>&ReviewedCutRequest):Promise<RepositoryOutcome<CollectionCutSealResult>>;
}
export function buildCollectionCutCommand(kind:CollectionCutOperationKind,principal:OperatorPrincipal,input:CollectionCutCommandInput&Readonly<{requestKey:string}>&ReviewedCutRequest,crypto:CanonicalCrypto):Promise<CollectionCutCommand>;
export function createCollectionCutService(ports:{repository:CollectionCutRepository;crypto:CanonicalCrypto}):CollectionCutService;
