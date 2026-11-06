import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,AppTelemetry} from '../application/ports';
import type {CollectionQuoteRepository} from './quote-service.mjs';
export function createCollectionQuoteRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};clock:{nowMs():number};telemetry?:AppTelemetry}):CollectionQuoteRepository;
