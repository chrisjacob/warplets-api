import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,AppTelemetry} from '../application/ports';
import type {StagePublicationRepository} from './stage-service.mjs';
export function createStagePublicationRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};clock:{nowMs():number};telemetry?:AppTelemetry}):StagePublicationRepository;
