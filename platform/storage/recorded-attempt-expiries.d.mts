import type {AtomicDriver} from './atomic-earn.mjs';
import type {CanonicalCrypto} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {RecordedHeightRepository} from '../application/recorded-heights';
export function createRecordedAttemptExpiryRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};clock:{nowMs():number};store:ArtifactStore}):RecordedHeightRepository;
