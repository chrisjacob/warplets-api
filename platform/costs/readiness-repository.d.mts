import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto} from '../application/ports';
import type {EconomicPlanRepository,EconomicPreparationReference} from '../application/economic-plans';
import type {PreparedSwapPlan} from '../application/action-plans';
import type {QuoteRepository} from '../quotes/repository.mjs';
import type {CostReadinessQuery,CostReadinessReport} from '../application/cost-readiness';
import type {createOperationalMetrics} from '../observability/metrics.mjs';
export interface CostReadinessSnapshot {readonly asOfMs:number;readonly reference:EconomicPreparationReference;readonly plan:PreparedSwapPlan;readonly source:Omit<CostReadinessReport['source'],'interpretation'>;readonly usage:CostReadinessReport['usage'];readonly usageDigest:string;readonly revisions:CostReadinessReport['snapshot']['revisions'];readonly watermark:string}
export interface CostReadinessRepository {read(query:CostReadinessQuery):Promise<{kind:'missing'}|{kind:'pending';reason:string}|{kind:'snapshot';value:CostReadinessSnapshot;token:object}>;verifySnapshot(token:object,options:{validUntilMs:number}):Promise<boolean>}
export const COST_READINESS_READ_LIMITS:Readonly<{sourceBytes:131072;snapshotBytes:49152;maxClockSkewMs:30000}>;
export function createCostReadinessRepository(ports:{driver:AtomicDriver;economicPlans:Pick<EconomicPlanRepository,'read'>;quoteRepository:Pick<QuoteRepository,'readContext'>;metrics:ReturnType<typeof createOperationalMetrics>;crypto:CanonicalCrypto;clock:{nowMs():number}}):CostReadinessRepository;
