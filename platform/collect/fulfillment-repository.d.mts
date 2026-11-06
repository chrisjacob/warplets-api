import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,AppTelemetry} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {PinnedBeaconVerifier} from '../beacon/portable.mjs';
import type {CollectionFulfillmentRepository} from './fulfillment-service.mjs';
export function createCollectionFulfillmentRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};clock:{nowMs():number};artifacts:ArtifactStore;beaconVerifier?:PinnedBeaconVerifier|null;telemetry?:AppTelemetry}):CollectionFulfillmentRepository;
