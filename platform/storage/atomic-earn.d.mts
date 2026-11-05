import type { CanonicalCrypto, AppTelemetry, GuardedAdmissionRepository } from '../application/ports';
export interface AtomicDriver {
  /** Trusted fixture drivers may override the SQL clock for deterministic time. Never accept from a request. */
  readonly leaseNowSql?:string;
  batch(statements:readonly {sql:string;values:readonly (string|number|null)[]}[]):Promise<{rows:Record<string,unknown>[];changes:number}[]>;
  getBookmark():string|null;
}
export function createAtomicEarnRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};telemetry?:AppTelemetry}):GuardedAdmissionRepository;
