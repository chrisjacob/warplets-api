import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,AppTelemetry} from '../application/ports';
import type {ProgressionReservationRepository} from './reservation-service.mjs';
export function createProgressionReservationRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};clock:{nowMs():number};telemetry?:AppTelemetry}):ProgressionReservationRepository;
