import type {AtomicDriver} from './atomic-earn.mjs';
import type {CanonicalCrypto} from '../application/ports';
import type {EconomicPlanRepository} from '../application/economic-plans';
import type {QuoteRepository} from '../quotes/repository.mjs';
import type {createSwapPlanService} from '../transactions/swap-plan-service.mjs';
export type {EconomicPlanRepository,EconomicPreparationReference,EconomicPreparationRequest,EconomicPreparationOutcome,EconomicPlanReadOutcome} from '../application/economic-plans';
export const PREPARE_ECONOMIC_PLAN:'transactions.prepare-economic-plan.v1';
export function createEconomicPlanRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};clock:{nowMs():number};swapPlans:ReturnType<typeof createSwapPlanService>;quoteRepository:Pick<QuoteRepository,'readContext'>}):EconomicPlanRepository;
