import type {CanonicalCrypto,OperatorPrincipal,FinalReviewCommand,GuardedAdmissionRepository} from './ports';
import type {OperationInputs,OperationsCommand,AtomicOperationsRepository} from '../storage/atomic-operations.mjs';
export type LocalOperatorKind='ops.configure-workload.v1'|'ops.change-scope.v1'|'earn.final-review.v1';
export type OperatorRevisions=Readonly<{earn:string;source:string;control:string}>;
type DeepReadonly<T>=T extends object?{readonly [K in keyof T]:DeepReadonly<T[K]>}:T;
type Inputs=OperationInputs & {'earn.final-review.v1':FinalReviewCommand['input']};
type Command<K extends LocalOperatorKind>=K extends 'earn.final-review.v1'?FinalReviewCommand:K extends keyof OperationInputs?OperationsCommand<K>:never;
export type LocalOperatorRequest<K extends LocalOperatorKind=LocalOperatorKind>={
 [P in K]:Readonly<{operationKind:P;requestKey:string;input:DeepReadonly<Inputs[P]>;expectedRevisions:OperatorRevisions}>
}[K];
export type OperatorPreview<K extends LocalOperatorKind>=Readonly<{
 operationKind:K;requestKey:string;requestDigest:string;confirmationDigest:string;expectedRevisions:OperatorRevisions;financialExecution:false;
 summary:DeepReadonly<Inputs[K] & (K extends 'ops.configure-workload.v1'?{calculatedCapacity:number;currentOrFutureEpoch:boolean}:K extends 'earn.final-review.v1'?{final:true}:{})>;
}>;
export type PreparedOperatorCommand<K extends LocalOperatorKind=LocalOperatorKind>={
 [P in K]:Readonly<{command:DeepReadonly<Command<P>>;preview:OperatorPreview<P>}>
}[K];
export type OperatorCommandRepository=Pick<AtomicOperationsRepository,'configureWorkload'|'changeScope'>&Partial<Pick<GuardedAdmissionRepository,'recordFinalReview'>>;
export const LOCAL_OPERATOR_COMMANDS:readonly LocalOperatorKind[];
export const LOCAL_OPERATOR_SCOPES:Readonly<{'ops.configure-workload.v1':'operations';'ops.change-scope.v1':'operations';'earn.final-review.v1':'earn-review'}>;
export function operatorCommandScope<K extends LocalOperatorKind>(kind:K):typeof LOCAL_OPERATOR_SCOPES[K];
export function prepareOperatorCommand<K extends LocalOperatorKind>(args:{principal:OperatorPrincipal;request:LocalOperatorRequest<K>;nowMs:number},crypto:CanonicalCrypto):Promise<PreparedOperatorCommand<K>>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<'ops.configure-workload.v1'>):ReturnType<AtomicOperationsRepository['configureWorkload']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<'ops.change-scope.v1'>):ReturnType<AtomicOperationsRepository['changeScope']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand<'earn.final-review.v1'>):ReturnType<GuardedAdmissionRepository['recordFinalReview']>;
export function dispatchOperatorCommand(repository:OperatorCommandRepository,prepared:PreparedOperatorCommand):ReturnType<AtomicOperationsRepository['configureWorkload']>|ReturnType<AtomicOperationsRepository['changeScope']>|ReturnType<GuardedAdmissionRepository['recordFinalReview']>;
