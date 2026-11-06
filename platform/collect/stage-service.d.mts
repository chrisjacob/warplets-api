import type {OperatorPrincipal,CanonicalCrypto,RepositoryOutcome} from '../application/ports';
export const PUBLISH_COLLECTION_STAGE:'collection.publish-stage.v1';
import type {StagePublicationInput} from '../application/collections';
export type {StagePublicationInput} from '../application/collections';
export interface StagePublicationCommand {readonly operationKind:typeof PUBLISH_COLLECTION_STAGE;readonly principal:OperatorPrincipal;readonly requestKey:string;readonly input:StagePublicationInput;readonly businessIdentity:string;readonly requestDigest:string}
export interface StagePublicationResult {readonly inventoryId:string;readonly stageId:string;readonly termsDigest:string;readonly publicationRevision:number;readonly eligibility:Readonly<{kind:'list'|'pending'|'unrestricted';listId:string|null;count:number|null}>;readonly source:'local-fixture';readonly executable:false}
export interface StagePublicationRepository {publishStage(command:StagePublicationCommand):Promise<RepositoryOutcome<StagePublicationResult>>}
export function buildStagePublicationCommand(principal:OperatorPrincipal,request:{requestKey:string;input:StagePublicationInput},crypto:CanonicalCrypto):Promise<StagePublicationCommand>;
export function createStagePublicationService(ports:{repository:StagePublicationRepository;crypto:CanonicalCrypto}):{publishStage(principal:OperatorPrincipal,request:{requestKey:string;input:StagePublicationInput}):Promise<RepositoryOutcome<StagePublicationResult>>};
