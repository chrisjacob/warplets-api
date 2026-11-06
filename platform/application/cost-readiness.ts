import type {Principal} from './ports';
import type {PreparedSwapPlan} from './action-plans';
import type {CostPacketInput,CostScenario,CostJson} from '../costs/packet-types.mjs';
import type {CostComparisons} from '../costs/packet-core.mjs';
import type {ScenarioCashflow} from '../costs/scenario-cashflow.mjs';
export type CostReadinessQuery=Readonly<{principal:Extract<Principal,{kind:'wallet'}>;intentId:string;preparationId:string}>;
export type CostReadinessPlanning=Pick<CostPacketInput,'parameters'|'quotes'|'fx'|'availableCashUsdMicros'|'founderBackstopApprovedUsdMicros'>;
export type CostCompleteness='complete'|'reference-only'|'missing'|'expired';
export type CostCategories=Readonly<Record<CostCompleteness,number>>;
export interface CostReadinessReport {
 readonly format:'10x.cost-readiness.v1';readonly mode:'local-read-only';readonly asOfMs:number;
 readonly preparation:Readonly<{intentId:string;preparationId:string;planDigest:string;owner:string;action:'swap';request:PreparedSwapPlan['request'];requestDigest:string;economicIntentDigest:string;quotedAtMs:number;expiresAtMs:number;status:'current'|'expired';quoteDigest:string;bindings:PreparedSwapPlan['bindings']}>;
 readonly inputDigest:string;readonly usageDigest:string;readonly reportDigest:string;
 readonly snapshot:Readonly<{watermark:string;revisions:Readonly<Record<'earn'|'source'|'control',string>>}>;
 readonly source:Readonly<{status:'matching'|'changed'|'unavailable'|'invalid';currentContextDigest:string|null;currentReceiptDigest:string|null;interpretation:'retained-current-head-binding-only'}>;
 readonly executionContext:Readonly<{id:string;known:Readonly<{slot:string;validUntilMs:number;ogMint:string}>;missing:readonly string[]}>;
 readonly costs:Readonly<{status:CostCompleteness;sourceAuthority:'caller-supplied-unverified';categories:CostCategories;scenarios:readonly Readonly<Pick<CostScenario,'id'|'name'|'status'|'byPayer'|'pilotBudget'>&{categories:CostCategories}>[]}>;
 readonly comparisons:CostComparisons;
 readonly cashflows:Readonly<{firstAtt:null;firstAttAlternatives:Readonly<{recipientRoot:ScenarioCashflow;emptyBurn:ScenarioCashflow}>;laterMandatoryRoot:ScenarioCashflow;oneClaim:ScenarioCashflow;oneMint:ScenarioCashflow;monthly:ScenarioCashflow}>;
 readonly selectedActionCosts:Readonly<{status:'missing';reason:'swap-cost-branch-not-enumerated';maximumFeeUnits:string;feeCeilingIsQuote:false;inputUnits:string;expectedOutputUnits:string;minimumOutputUnits:string;economicAmounts:Readonly<Pick<PreparedSwapPlan['quote'],'inputMint'|'outputMint'|'inputDecimals'|'outputDecimals'|'inputUnits'|'grossOutputUnits'|'expectedOutputUnits'|'minimumOutputUnits'|'inputFeeUnits'|'outputFeeUnits'>>;companyCollectibleUnits:null;fees:PreparedSwapPlan['quote']['fees']}>;
 readonly spendReview:Readonly<{status:'not-assessed';reason:'selected-action-costs-incomplete';cashEvidence:'missing'|'caller-supplied-unverified';isAuthorization:false}>;
 readonly protocolReadiness:Readonly<{status:'blocked';reasons:readonly string[];financialExecution:false}>;
 readonly usage:Readonly<{asOfMs:number;watermark:string;budget:Readonly<Record<string,CostJson>>;attempts:Readonly<Record<string,CostJson>>;effects:Readonly<Record<string,CostJson>>;optionalWork:readonly CostJson[];protectedRecovery:readonly CostJson[]}>;
 readonly financialExecution:false;readonly serverSigning:false;readonly broadcast:false;readonly isAuthorization:false;
}
export type CostReadinessOutcome=Readonly<{kind:'missing'}>|Readonly<{kind:'pending';reason:string}>|Readonly<{kind:'report';value:CostReadinessReport}>;
export interface CostReadinessService {read(query:CostReadinessQuery,planning?:CostReadinessPlanning):Promise<CostReadinessOutcome>}
