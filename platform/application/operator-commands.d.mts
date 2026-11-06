import type {CollectionObservationInput,CollectionObservationCommand,CollectionObservationRepository} from '../collect/observation-service.mjs';
import type {CollectionIntakeCommand,CollectionIntakeResult} from '../collect/source-intake.mjs';
import type {EligibilityIndexCommand,EligibilityIndexRepository} from '../collect/eligibility-index-service.mjs';
import type {ActionPolicyInput,ActionPolicyCommand,ActionPolicyRepository} from '../earn/action-policy-service.mjs';
import type {CanonicalCrypto,OperatorPrincipal,FinalReviewCommand,GuardedAdmissionRepository} from './ports';
import type {StagePublicationInput,StagePublicationCommand,StagePublicationRepository} from '../collect/stage-service.mjs';
import type {GovernancePublicationInput,GovernancePublicationCommand,GovernanceOperatorRepository} from '../governance/operator-service.mjs';
import type {CollectionCutCommand,CollectionCutRepository} from '../collect/free-cut-service.mjs';
import type {RecordGenesisDecisionCommand} from './collections';
import type {OperationInputs,OperationsCommand,AtomicOperationsRepository} from '../storage/atomic-operations.mjs';
type LocalSourceKind='collection.seal-list.v1'|'collection.seal-source.v1'|'collection.materialize-eligibility-page.v1';
export type LocalUploadKind='collection.stage-record.v1'|'collection.stage-cut-record.v1';
export type LocalOperatorKind='collection.observe-asset.v1'|LocalUploadKind|LocalSourceKind|'earn.configure-action.v1'|'ops.configure-workload.v1'|'ops.change-scope.v1'|'earn.final-review.v1'|'collection.publish-stage.v1'|'governance.publish-ballot.v1'|'governance.record-decision.v1'|LocalCutKind;
type LocalCommandKind=Exclude<LocalOperatorKind,LocalUploadKind>;
export type OperatorRevisions=Readonly<{earn:string;source:string;control:string}>;
type DeepReadonly<T>=T extends object?{readonly [K in keyof T]:DeepReadonly<T[K]>}:T;
type CutInputs={'collection.begin-free-cut.v1':{rootId:string};'collection.validate-cut-page.v1':{attemptId:string;pageIndex:number};'collection.seal-free-cut.v1':{attemptId:string}};
type LocalCutKind=keyof CutInputs;
type Inputs=OperationInputs & CutInputs & Record<LocalSourceKind,{id:string}> & {'collection.observe-asset.v1':CollectionObservationInput;'earn.configure-action.v1':ActionPolicyInput;'earn.final-review.v1':FinalReviewCommand['input'];'collection.publish-stage.v1':StagePublicationInput;'governance.publish-ballot.v1':GovernancePublicationInput;'governance.record-decision.v1':RecordGenesisDecisionCommand['input']};
type Command<K extends LocalCommandKind>=K extends 'collection.observe-asset.v1'?CollectionObservationCommand:K extends 'collection.materialize-eligibility-page.v1'?EligibilityIndexCommand:K extends LocalSourceKind?CollectionIntakeCommand:K extends 'earn.configure-action.v1'?ActionPolicyCommand:K extends LocalCutKind?Omit<CollectionCutCommand,'operationKind'|'input'|'expectedRevisions'>&{readonly operationKind:K;readonly input:Readonly<CutInputs[K]>;readonly expectedRevisions:OperatorRevisions}:K extends 'governance.publish-ballot.v1'?GovernancePublicationCommand:K extends 'governance.record-decision.v1'?RecordGenesisDecisionCommand:K extends 'collection.publish-stage.v1'?StagePublicationCommand:K extends 'earn.final-review.v1'?FinalReviewCommand:K extends keyof OperationInputs?OperationsCommand<K>:never;
/** Stage requests retain the existing exact input shape. Runtime validation
 * requires type-specific local fixture approval and rejects ballot/overrides.
 * Publication repository grants remain the authority at preview and commit. */
export type LocalOperatorRequest<K extends LocalCommandKind=LocalCommandKind>={
 [P in K]:Readonly<{operationKind:P;requestKey:string;input:DeepReadonly<Inputs[P]>;expectedRevisions:OperatorRevisions}>
}[K];
export type OperatorPreview<K extends LocalCommandKind>=Readonly<{
 operationKind:K;requestKey:string;requestDigest:string;confirmationDigest:string;expectedRevisions:OperatorRevisions;financialExecution:false;
 summary:DeepReadonly<Inputs[K] & (K extends 'collection.observe-asset.v1'?{fixtureOnly:true;financialExecution:false}:K extends LocalSourceKind?{privateStaging:true;financialExecution:false}:K extends 'earn.configure-action.v1'?{futureOnly:true;financialExecution:false}:K extends LocalCutKind?{financialExecution:false}:K extends 'governance.publish-ballot.v1'|'governance.record-decision.v1'?{advisory:true;financialExecution:false}:K extends 'ops.configure-workload.v1'?{calculatedCapacity:number;currentOrFutureEpoch:boolean}:K extends 'earn.final-review.v1'?{final:true}:{})>;
}>;
export type PreparedOperatorCommand<K extends LocalCommandKind=LocalCommandKind>={
 [P in K]:Readonly<{command:DeepReadonly<Command<P>>;preview:OperatorPreview<P>}>
}[K];
export type OperatorCommandRepository=Partial<Pick<CollectionObservationRepository,'observe'>>&Partial<{sealList(command:CollectionIntakeCommand):Promise<CollectionIntakeResult>;sealSource(command:CollectionIntakeCommand):Promise<CollectionIntakeResult>}>&Partial<Pick<EligibilityIndexRepository,'materializePage'>>&Partial<Pick<ActionPolicyRepository,'configureAction'>>&Pick<AtomicOperationsRepository,'configureWorkload'|'changeScope'>&Partial<Pick<GuardedAdmissionRepository,'recordFinalReview'>>&Partial<Pick<StagePublicationRepository,'publishStage'>>&Partial<Pick<GovernanceOperatorRepository,'publishBallot'|'recordDecision'>>&Partial<Pick<CollectionCutRepository,'beginCut'|'validatePage'|'sealCut'>>;
export const LOCAL_OPERATOR_UPLOADS:readonly LocalUploadKind[];
export const LOCAL_OPERATOR_COMMANDS:readonly LocalOperatorKind[];
export const LOCAL_OPERATOR_SCOPES:Readonly<Record<LocalSourceKind,'collection-import'>&{'collection.observe-asset.v1':'collection-evidence';'collection.stage-record.v1':'collection-import';'collection.stage-cut-record.v1':'collection-evidence';'earn.configure-action.v1':'earn-action-policy';'ops.configure-workload.v1':'operations';'ops.change-scope.v1':'operations';'earn.final-review.v1':'earn-review';'collection.publish-stage.v1':'collection-publication';'governance.publish-ballot.v1':'governance-publication';'governance.record-decision.v1':'governance-decision';'collection.begin-free-cut.v1':'collection-evidence';'collection.validate-cut-page.v1':'collection-evidence';'collection.seal-free-cut.v1':'collection-evidence'}>;
export function operatorCommandScope<K extends LocalOperatorKind>(kind:K):typeof LOCAL_OPERATOR_SCOPES[K];
export function prepareOperatorCommand<K extends LocalCommandKind>(args:{principal:OperatorPrincipal;request:LocalOperatorRequest<K>;nowMs:number},crypto:CanonicalCrypto):Promise<PreparedOperatorCommand<K>>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<'ops.configure-workload.v1'>):ReturnType<AtomicOperationsRepository['configureWorkload']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<'ops.change-scope.v1'>):ReturnType<AtomicOperationsRepository['changeScope']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<'earn.final-review.v1'>):ReturnType<GuardedAdmissionRepository['recordFinalReview']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<'collection.publish-stage.v1'>):ReturnType<StagePublicationRepository['publishStage']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<'governance.publish-ballot.v1'>):ReturnType<GovernanceOperatorRepository['publishBallot']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<'governance.record-decision.v1'>):ReturnType<GovernanceOperatorRepository['recordDecision']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<'collection.begin-free-cut.v1'>):ReturnType<CollectionCutRepository['beginCut']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<'collection.validate-cut-page.v1'>):ReturnType<CollectionCutRepository['validatePage']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<'collection.seal-free-cut.v1'>):ReturnType<CollectionCutRepository['sealCut']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<'earn.configure-action.v1'>):ReturnType<ActionPolicyRepository['configureAction']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<LocalSourceKind>):Promise<CollectionIntakeResult>|ReturnType<EligibilityIndexRepository['materializePage']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<'collection.observe-asset.v1'>):ReturnType<CollectionObservationRepository['observe']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand):ReturnType<CollectionObservationRepository['observe']>|Promise<CollectionIntakeResult>|ReturnType<EligibilityIndexRepository['materializePage']>|ReturnType<ActionPolicyRepository['configureAction']>|ReturnType<AtomicOperationsRepository['configureWorkload']>|ReturnType<AtomicOperationsRepository['changeScope']>|ReturnType<GuardedAdmissionRepository['recordFinalReview']>|ReturnType<StagePublicationRepository['publishStage']>|ReturnType<GovernanceOperatorRepository['publishBallot']>|ReturnType<GovernanceOperatorRepository['recordDecision']>|ReturnType<CollectionCutRepository['beginCut']>|ReturnType<CollectionCutRepository['validatePage']>|ReturnType<CollectionCutRepository['sealCut']>;
