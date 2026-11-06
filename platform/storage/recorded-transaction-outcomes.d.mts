import type {AtomicDriver} from './atomic-earn.mjs';
import type {CanonicalCrypto} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {RecordedOutcomeRepository} from '../application/recorded-outcomes';
export function createRecordedTransactionOutcomeRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};clock:{nowMs():number};store:ArtifactStore}):RecordedOutcomeRepository;
