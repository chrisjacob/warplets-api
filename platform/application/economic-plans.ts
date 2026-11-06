import type {Principal,RepositoryOutcome} from './ports';
import type {ActionRequestV1,PreparedSwapPlan,PendingSwapPlan} from './action-plans';
/** Economic review records are not executable transaction intents or receipts. */
export interface EconomicPreparationReference {readonly intentId:string;readonly preparationId:string;readonly planDigest:string}
export interface EconomicPreparationRequest {readonly principal:Principal;readonly intentKey:string;readonly requestKey:string;readonly request:ActionRequestV1}
export type EconomicPreparationOutcome=RepositoryOutcome<EconomicPreparationReference>|PendingSwapPlan;
export type EconomicPlanReadOutcome=Readonly<{kind:'missing'}>|Readonly<{kind:'pending';reason:string;dependencyIds:readonly string[]}>|Readonly<{kind:'found';value:EconomicPreparationReference&Readonly<{plan:PreparedSwapPlan;expired:boolean}>}>;
export interface EconomicPlanRepository {
 prepare(request:EconomicPreparationRequest):Promise<EconomicPreparationOutcome>;
 read(query:Readonly<{principal:Principal;intentId:string;preparationId?:string}>):Promise<EconomicPlanReadOutcome>;
}
