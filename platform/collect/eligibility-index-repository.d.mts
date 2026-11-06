import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,AppTelemetry} from '../application/ports';
import type {EligibilityIndexRepository} from './eligibility-index-service.mjs';
export function createEligibilityIndexRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;clock:{nowMs():number};ids:{next():string};telemetry?:AppTelemetry}):EligibilityIndexRepository;
