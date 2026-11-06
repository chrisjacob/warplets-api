import type {CanonicalCrypto,Principal} from '../application/ports';
import type {ActionRequestV1} from '../application/action-plans';
import type {QuoteService} from '../quotes/service.mjs';
import type {QuoteRepository} from '../quotes/repository.mjs';
import type {PreparedSwapPlan,PendingSwapPlan} from '../application/action-plans';
export type {PreparedSwapPlan,PendingSwapPlan} from '../application/action-plans';
export const SWAP_PLAN_LIMITS:Readonly<{contextBytes:131072;planBytes:16384;attempts:2}>;
export function createSwapPlanService(ports:{quoteService:Pick<QuoteService,'quote'>;quoteRepository:Pick<QuoteRepository,'readContext'>;crypto:CanonicalCrypto;clock:{nowMs():number}}):Readonly<{
 prepare(value:{principal:Principal;request:ActionRequestV1}):Promise<PreparedSwapPlan|PendingSwapPlan>;
}>;

export function swapPlanContextDigest(value:Readonly<Record<string,unknown>>,crypto:CanonicalCrypto):Promise<string>;
