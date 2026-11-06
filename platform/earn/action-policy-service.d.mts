import type {OperatorPrincipal,CanonicalCrypto,RepositoryOutcome} from '../application/ports';
export const CONFIGURE_ACTION:'earn.configure-action.v1';
export interface ActionPolicyInput {readonly actionId:string;readonly label:string;readonly verifier:string;readonly effectiveEpoch:number;readonly enabled:boolean;readonly evidenceRef:string}
export type ActionPolicyRevisions=Readonly<{earn:string;source:string;control:string}>;
export interface ActionPolicyRequest {readonly requestKey:string;readonly input:ActionPolicyInput;readonly expectedRevisions:ActionPolicyRevisions}
export interface ActionPolicyCommand extends ActionPolicyRequest {readonly operationKind:typeof CONFIGURE_ACTION;readonly principal:OperatorPrincipal;readonly nowMs:number;readonly businessIdentity:string;readonly requestDigest:string}
export interface ActionPolicyResult {readonly actionId:string;readonly effectiveEpoch:number;readonly enabled:boolean;readonly source:'local-fixture';readonly executable:false}
export interface ActionPolicyPreview extends ActionPolicyResult {readonly label:string;readonly verifier:string;readonly expectedRevisions:ActionPolicyRevisions;readonly financialExecution:false}
export interface ActionPolicyRepository {configureAction(command:ActionPolicyCommand):Promise<RepositoryOutcome<ActionPolicyResult>>;previewAction(command:ActionPolicyCommand):Promise<RepositoryOutcome<ActionPolicyResult>|{kind:'preview';value:ActionPolicyPreview}>}
export function buildActionPolicyCommand(value:ActionPolicyRequest&{principal:OperatorPrincipal;nowMs:number},crypto:CanonicalCrypto):Promise<ActionPolicyCommand>;
export function createActionPolicyService(ports:{repository:ActionPolicyRepository;crypto:CanonicalCrypto;clock:{nowMs():number}}):{configureAction(principal:OperatorPrincipal,request:ActionPolicyRequest):Promise<RepositoryOutcome<ActionPolicyResult>>;previewAction(principal:OperatorPrincipal,request:ActionPolicyRequest):Promise<RepositoryOutcome<ActionPolicyResult>|{kind:'preview';value:ActionPolicyPreview}>};
