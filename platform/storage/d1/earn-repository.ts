import { createD1AtomicDriver } from './atomic-driver';
import { createAtomicEarnRepository } from '../atomic-earn.mjs';
import type { CanonicalCrypto, AppTelemetry } from '../../application/ports';
export function createD1EarnRepository(db:D1Database,ports:{crypto:CanonicalCrypto;ids:{next():string};telemetry?:AppTelemetry}) {
  return createAtomicEarnRepository(createD1AtomicDriver(db),ports);
}
