import type {CanonicalCrypto,Principal,OperatorPrincipal,ArtifactIdentity,RepositoryOutcome} from '../application/ports';
import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {ArtifactStore} from '../artifacts/store';
import type {RefreshEvent,RefreshWorkflowState} from './refresh-workflow.mjs';
export const REFRESH_COMMAND:'nfts.refresh.v1';
export type RefreshCommandInput=Readonly<{action:'create';assetId:string;expectedAssetVersion:number;referenceIdentity:ArtifactIdentity;quoteIdentity:ArtifactIdentity}>|Readonly<{action:'advance';requestId:string;expectedRevision:number;expectedStateDigest:string;event:Readonly<Pick<RefreshEvent,'kind'|'input'>>}>;
export interface RefreshCommand {readonly principal:Principal|OperatorPrincipal;readonly operationKind:'nfts.refresh.v1';readonly businessIdentity:string;readonly requestKey:string;readonly requestDigest:string;readonly input:RefreshCommandInput;readonly nowMs:number}
export interface RefreshRevisionReference {readonly requestId:string;readonly revision:number;readonly owner:string;readonly assetId:string;readonly requestDigest:string;readonly stateDigest:string;readonly priorStateDigest:string|null;readonly identity:ArtifactIdentity}
export type RefreshRevisionOutcome=RepositoryOutcome<RefreshRevisionReference>|Readonly<{kind:'pending';reason:string;dependencyIds:readonly string[];pin?:Readonly<{identity:ArtifactIdentity;requestDigest:string;stateDigest:string}>}>;
export type RefreshReadOutcome=Readonly<{kind:'found';value:Readonly<{reference:RefreshRevisionReference;state:RefreshWorkflowState;authority:'authenticated-local-rehearsal';isAuthorization:false;metadataApplied:false}>}>|Readonly<{kind:'missing'}>|Readonly<{kind:'pending';reason:string;dependencyIds:readonly string[]}>|Readonly<{kind:'conflict';code:string}>;
export interface RefreshRepository {execute(command:RefreshCommand):Promise<RefreshRevisionOutcome>;read(principal:Principal|OperatorPrincipal,input:{requestId:string}):Promise<RefreshReadOutcome>}
/** Capture server time once and retain the private command for exact unknown-write retry. */
export function prepareRefreshCommand(principal:Principal|OperatorPrincipal,value:{requestKey:string;input:RefreshCommandInput},crypto:CanonicalCrypto,clock:{nowMs():number}):Promise<RefreshCommand>;
export function createRefreshRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;clock:{nowMs():number};ids:{next():string};artifacts:ArtifactStore}):RefreshRepository;
