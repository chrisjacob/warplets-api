import type { CanonicalCrypto,AppTelemetry,OperatorPrincipal,Revisions,RepositoryOutcome } from '../application/ports';
import type { AtomicDriver } from './atomic-earn.mjs';
export type OperationInputs={
 'ops.change-scope.v1':{scope:string;paused:boolean;previousRevision:string|null;reason:string;evidenceRef:string};
 'ops.configure-workload.v1':{effectiveEpoch:number;staffedMinutes:number;secondsPerReview:number;admissionLimit:number;reason:string};
 'ops.reserve-cost.v1':{scope:string;upperUsdMicros:string;quoteRef:string};
 'ops.settle-cost.v1':{reservationKey:string;actualUsdMicros:string;evidenceRef:string};
 'ops.meter-attempt.v1':{attemptId:string;provider:string;units:string;quota:string;evidenceRef:string};
};
export type OperationKind=keyof OperationInputs;
export type OperationsCommand<K extends OperationKind>=Readonly<{operationKind:K;principal:OperatorPrincipal;
 requestKey:string;businessIdentity:string;requestDigest:string;expectedRevisions:Revisions;nowMs:number;input:OperationInputs[K]}>;
export const OPERATIONS:Readonly<{changeScope:'ops.change-scope.v1';configureWorkload:'ops.configure-workload.v1';reserveOptionalCost:'ops.reserve-cost.v1';
 settleOptionalCost:'ops.settle-cost.v1';meterProviderAttempt:'ops.meter-attempt.v1'}>;
export function createOperationsCommand<K extends OperationKind>(operationKind:K,input:{principal:OperatorPrincipal;requestKey:string;
 input:OperationInputs[K];nowMs:number;expectedRevisions?:Revisions},crypto:CanonicalCrypto):Promise<OperationsCommand<K>>;
export type CostPressure={status:'ready';level:'normal'|'warning'|'limit';recurring:{limitUsdMicros:string;totalUsdMicros:string;status:'over-limit'|'at-limit'|'warning'|'within-limit'};
 providers:readonly {provider:string;status:'normal'|'warning'|'limit'}[];measuredProviderCount:number;period:string}|{status:'pending';reason:string};
export interface AtomicOperationsRepository {
 changeScope(command:OperationsCommand<'ops.change-scope.v1'>):Promise<RepositoryOutcome<{scope:string;paused:boolean;revision:string}>>;
 configureWorkload(command:OperationsCommand<'ops.configure-workload.v1'>):Promise<RepositoryOutcome<{revision:string;effectiveEpoch:number;limit:number}>>;
 reserveOptionalCost(command:OperationsCommand<'ops.reserve-cost.v1'>):Promise<RepositoryOutcome<{status:'reserved';requestKey:string}>>;
 settleOptionalCost(command:OperationsCommand<'ops.settle-cost.v1'>):Promise<RepositoryOutcome<{status:'settled';requestKey:string;overrun:boolean}>>;
 /** Reserve quota before any attempt. Pending means do not call a provider. Replay alone never authorizes redispatch; B03 owns dispatch checkpoint/outcome. Failed admitted attempts retain consumed units. */
 meterProviderAttempt(command:OperationsCommand<'ops.meter-attempt.v1'>):Promise<RepositoryOutcome<{phase:'pre-attempt';attemptId:string;receipt:string;period:string;measured:string;quota:string}>>;
 costPressure(nowMs:number):Promise<CostPressure>;
 actionDecision(scope:string,nowMs:number):Promise<{scope:string;allowed:boolean;reason:string;revision?:string|null}>;
 capacityAt(epoch:number,nowMs:number):Promise<{epoch:number;limit:number;admitted:number;remaining:number;accepting:boolean;policy:string|null}>;
 getBookmark():string|null;
}
export function createAtomicOperationsRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};telemetry?:AppTelemetry}):AtomicOperationsRepository;

/** Export-only historical aliases; selection predicates and bounds are unchanged. */
export function historicalUsageSql(nowMs:number):{sql:string;values:readonly (string|number|null)[]};
export function historicalSpendSql(nowMs:number):{sql:string;values:readonly (string|number|null)[]};
