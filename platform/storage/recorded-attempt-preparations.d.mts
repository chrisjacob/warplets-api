import type {AtomicDriver} from './atomic-earn.mjs';
import type {CanonicalCrypto} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {RecordedPacketRepository} from '../application/recorded-packets';
export function createRecordedAttemptPreparationRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};clock:{nowMs():number};store:ArtifactStore}):RecordedPacketRepository;
