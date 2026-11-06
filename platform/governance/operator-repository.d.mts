import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,AppTelemetry} from '../application/ports';
import type {GovernanceOperatorRepository} from './operator-service.mjs';
export function createGovernanceOperatorRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};telemetry?:AppTelemetry}):GovernanceOperatorRepository;
