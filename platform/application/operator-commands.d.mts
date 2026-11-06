import type {CanonicalCrypto,OperatorPrincipal} from './ports';
import type {OperationInputs,OperationsCommand,AtomicOperationsRepository} from '../storage/atomic-operations.mjs';
export type LocalOperatorKind='ops.configure-workload.v1'|'ops.change-scope.v1';
export type OperatorRevisions=Readonly<{earn:string;source:string;control:string}>;
type DeepReadonly<T>=T extends object?{readonly [K in keyof T]:DeepReadonly<T[K]>}:T;
export type LocalOperatorRequest<K extends LocalOperatorKind=LocalOperatorKind>={
 [P in K]:Readonly<{operationKind:P;requestKey:string;input:DeepReadonly<OperationInputs[P]>;expectedRevisions:OperatorRevisions}>
}[K];
export type OperatorPreview<K extends LocalOperatorKind>=Readonly<{
 operationKind:K;requestKey:string;requestDigest:string;expectedRevisions:OperatorRevisions;financialExecution:false;
 summary:DeepReadonly<OperationInputs[K] & (K extends 'ops.configure-workload.v1'?{calculatedCapacity:number;currentOrFutureEpoch:boolean}:{})>;
}>;
export type PreparedOperatorCommand<K extends LocalOperatorKind=LocalOperatorKind>={
 [P in K]:Readonly<{command:DeepReadonly<OperationsCommand<P>>;preview:OperatorPreview<P>}>
}[K];
export const LOCAL_OPERATOR_COMMANDS:readonly LocalOperatorKind[];
export function prepareOperatorCommand<K extends LocalOperatorKind>(args:{principal:OperatorPrincipal;request:LocalOperatorRequest<K>;nowMs:number},crypto:CanonicalCrypto):Promise<PreparedOperatorCommand<K>>;
export function dispatchOperatorCommand(repository:Pick<AtomicOperationsRepository,'configureWorkload'|'changeScope'>,prepared:PreparedOperatorCommand<'ops.configure-workload.v1'>):ReturnType<AtomicOperationsRepository['configureWorkload']>;
export function dispatchOperatorCommand(repository:Pick<AtomicOperationsRepository,'configureWorkload'|'changeScope'>,prepared:PreparedOperatorCommand<'ops.change-scope.v1'>):ReturnType<AtomicOperationsRepository['changeScope']>;
export function dispatchOperatorCommand(repository:Pick<AtomicOperationsRepository,'configureWorkload'|'changeScope'>,prepared:PreparedOperatorCommand):ReturnType<AtomicOperationsRepository['configureWorkload']>|ReturnType<AtomicOperationsRepository['changeScope']>;
