import type {CanonicalCrypto} from '../application/ports';
import type {PreparedSwapPlan} from '../application/action-plans';
import type {CashflowInput,CashflowResult} from './cashflow.mjs';
export const SWAP_COST_REQUIREMENTS_FORMAT:'10x.swap-cost-requirements.v1';
export const SWAP_COST_REQUIREMENTS_LIMITS:Readonly<{inputBytes:16384;outputBytes:32768;requirements:10}>;
export type SwapCostAsset=Readonly<{owner:string;mint:string;tokenAccount:null;exists:null}>;
export type SwapCostRequirement=Readonly<{id:string;operationId:string;kind:'rent'|'consumed';unit:'lamport'|'microUSD';payer:string;payerAssignmentStatus:'unverified';status:'missing';count:null;unitAmount:null;exists:null;accountSizeBytes:null;additionalRentLamports:null;sourceRef:null;observedMs:null;expiresMs:null;reason:string;asset:SwapCostAsset|null}>;
export interface SwapCostRequirements {
 readonly format:typeof SWAP_COST_REQUIREMENTS_FORMAT;readonly source:'local-fixture';readonly evidenceAuthority:'retained-synthetic-plan';readonly requiresVerifiedRepository:true;readonly status:'missing';readonly planDigest:string;readonly requestDigest:string;readonly economicIntentDigest:string;readonly graphDigest:string;
 readonly sourceBindings:PreparedSwapPlan['bindings']&Readonly<{quoteSourceDigest:string;quoteDigest:string;quotedAtMs:number;expiresAtMs:number;contextSlot:string}>;
 readonly ownerAssets:Readonly<{input:SwapCostAsset;output:SwapCostAsset}>;
 readonly knownAccounts:Readonly<Record<'pool'|'attMint'|'ogMint'|'poolProgram'|'attVault'|'ogVault',Readonly<{address:string|null;exists:null;byteDigest:string|null}>>>;
 readonly requirements:readonly SwapCostRequirement[];readonly cashflow:Readonly<{graph:CashflowInput;result:CashflowResult}>;
 readonly protocolAmounts:Readonly<{inputUnits:string;grossOutputUnits:string;inputFeeUnits:string;outputFeeUnits:string;expectedOutputUnits:string;minimumOutputUnits:string;inputMint:string;outputMint:string;companyCollectibleUnits:null;incrementalFundingIncluded:false}>;
 readonly maximumFeeUnits:string;readonly feeCeilingIsQuote:false;readonly unsupported:readonly string[];
 readonly financialExecution:false;readonly serverSigning:false;readonly broadcast:false;readonly isAuthorization:false;
}
/** Repository verification is an input precondition; self-consistent hashes are not provenance. */
export function deriveSwapCostRequirements(plan:PreparedSwapPlan,crypto:Pick<CanonicalCrypto,'sha256'>):Promise<SwapCostRequirements>;
