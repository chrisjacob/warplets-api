import type {CanonicalCrypto} from '../application/ports';
import type {CostReadinessService} from '../application/cost-readiness';
import type {CostReadinessRepository} from './readiness-repository.mjs';
import type {createCostPacketService} from './packet-service.mjs';
export type {CostReadinessQuery,CostReadinessPlanning,CostReadinessReport,CostReadinessOutcome,CostReadinessService} from '../application/cost-readiness';
export const COST_READINESS_FORMAT:'10x.cost-readiness.v1';
export const COST_READINESS_LIMITS:Readonly<{inputBytes:65536;reportBytes:196608;serializedWorkingBytes:1048576}>;
export function createCostReadinessService(ports:{repository:CostReadinessRepository;crypto:CanonicalCrypto;clock:{nowMs():number};calculator?:ReturnType<typeof createCostPacketService>}):CostReadinessService;
