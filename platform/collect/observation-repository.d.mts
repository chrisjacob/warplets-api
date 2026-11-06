import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,AppTelemetry} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {CollectionObservationRepository} from './observation-service.mjs';
export function createCollectionObservationRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};clock:{nowMs():number};artifacts:ArtifactStore;telemetry?:AppTelemetry}):CollectionObservationRepository;
