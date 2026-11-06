import type {CanonicalCrypto,OperatorPrincipal,Revisions,RepositoryOutcome} from '../application/ports';
import type {PublishGenesisBallotCommand,RecordGenesisDecisionCommand} from '../application/collections';
import type {PlannedDecision} from '../application/collection-governance.mjs';
export const PUBLISH_BALLOT:'governance.publish-ballot.v1';
export const RECORD_DECISION:'governance.record-decision.v1';
export type GovernancePublicationInput=PublishGenesisBallotCommand['input']&Readonly<{cutoffMs:number;sourceKind:'synthetic-local-operator-fixture';holdersListId:string;nextWhitelistListId:string;unionListId:string}>;
export type GovernancePublicationCommand=Omit<PublishGenesisBallotCommand,'input'>&Readonly<{input:GovernancePublicationInput}>;
export interface GovernancePublicationResult {ballotId:string;snapshotHash:string;eligibleCount:number;opensAt:number;closesAt:number;currentTrancheOpenedAt:number;electorateManifestId:string;sourceId:string;sourceDigest:string;executable:false;sourceKind:'synthetic-local-operator-fixture'}
export interface GovernanceOperatorRepository {publishBallot(command:GovernancePublicationCommand):Promise<RepositoryOutcome<GovernancePublicationResult>>;recordDecision(command:RecordGenesisDecisionCommand):Promise<RepositoryOutcome<PlannedDecision>>}
export interface GovernanceOperatorRequest<Input> {input:Input;requestKey:string;expectedRevisions?:Revisions}
export interface GovernanceOperatorService {publishBallot(principal:OperatorPrincipal,request:GovernanceOperatorRequest<GovernancePublicationInput>):Promise<RepositoryOutcome<GovernancePublicationResult>>;recordDecision(principal:OperatorPrincipal,request:GovernanceOperatorRequest<RecordGenesisDecisionCommand['input']>):Promise<RepositoryOutcome<PlannedDecision>>}
type Args<Input>={principal:OperatorPrincipal;input:Input;requestKey:string;expectedRevisions:Revisions;nowMs:number};
export function governanceOperatorCommandBytes(command:Pick<GovernancePublicationCommand|RecordGenesisDecisionCommand,'operationKind'|'principal'|'input'>):Uint8Array;
export function prepareGovernanceOperatorCommand(kind:typeof PUBLISH_BALLOT,args:Args<GovernancePublicationInput>,crypto:CanonicalCrypto):Promise<GovernancePublicationCommand>;
export function prepareGovernanceOperatorCommand(kind:typeof RECORD_DECISION,args:Args<RecordGenesisDecisionCommand['input']>,crypto:CanonicalCrypto):Promise<RecordGenesisDecisionCommand>;
export function createGovernanceOperatorService(ports:{repository:GovernanceOperatorRepository;crypto:CanonicalCrypto;clock:{nowMs():number}}):GovernanceOperatorService;
