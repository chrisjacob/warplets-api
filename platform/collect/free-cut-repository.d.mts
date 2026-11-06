import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,AppTelemetry} from '../application/ports';
import type {CollectionCutRepository} from './free-cut-service.mjs';
export function createCollectionCutRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;clock:{nowMs():number};ids:{next():string};telemetry?:AppTelemetry}):CollectionCutRepository;
