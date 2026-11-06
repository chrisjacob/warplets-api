import type {CanonicalCrypto,OperatorPrincipal,Revisions,RepositoryOutcome} from '../application/ports';
export const MATERIALIZE_ELIGIBILITY_PAGE:'collection.materialize-eligibility-page.v1';
export interface EligibilityIndexCommand {readonly operationKind:typeof MATERIALIZE_ELIGIBILITY_PAGE;readonly principal:OperatorPrincipal;readonly businessIdentity:string;readonly input:Readonly<{id:string}>;readonly requestKey:string;readonly expectedRevisions:Revisions;readonly nowMs:number;readonly requestDigest:string}
export interface EligibilityIndexResult {readonly id:string;readonly entryCount:number;readonly visibility:'private-staging'}
export interface EligibilityIndexRepository {previewPage?(command:EligibilityIndexCommand):Promise<RepositoryOutcome<EligibilityIndexResult>|{kind:'preview';value:EligibilityIndexResult;expectedRevisions:Revisions}>;materializePage(command:EligibilityIndexCommand):Promise<RepositoryOutcome<EligibilityIndexResult>>}
export interface EligibilityIndexService {materializePage(principal:OperatorPrincipal,input:{id:string;requestKey:string;expectedRevisions?:Revisions}):Promise<RepositoryOutcome<EligibilityIndexResult>>}
export function eligibilityIndexCommandBytes(command:Omit<EligibilityIndexCommand,'requestDigest'>):Uint8Array;
export function prepareEligibilityIndexCommand(input:Pick<EligibilityIndexCommand,'principal'|'input'|'requestKey'|'expectedRevisions'|'nowMs'>,crypto:CanonicalCrypto):Promise<EligibilityIndexCommand>;
export function createEligibilityIndexService(ports:{repository:EligibilityIndexRepository;crypto:CanonicalCrypto;clock:{nowMs():number}}):EligibilityIndexService;
