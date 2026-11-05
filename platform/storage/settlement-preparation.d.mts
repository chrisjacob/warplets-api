import type {AtomicDriver} from './atomic-earn.mjs';
import type {AppTelemetry,CanonicalCrypto} from '../application/ports';
import type {SettlementPreparationRepository} from '../earn/settlement-service.mjs';
export function createSettlementPreparationRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};telemetry?:AppTelemetry}):SettlementPreparationRepository;
