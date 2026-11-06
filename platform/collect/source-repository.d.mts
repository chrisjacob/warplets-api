import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,AppTelemetry} from '../application/ports';
import type {CollectionSourceIntakeRepository} from './source-intake.mjs';
export function createCollectionSourceRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;clock:{nowMs():number};ids:{next():string};telemetry?:AppTelemetry}):CollectionSourceIntakeRepository;
