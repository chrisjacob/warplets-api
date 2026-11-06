import type {CanonicalCrypto} from '../application/ports';
import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {ActionRecoveryReadRepository} from '../application/action-recovery';
export const ACTION_RECOVERY_LIMITS:Readonly<{attempts:16;receipts:64;planBytes:65536;packetBytes:32768;observationBytes:2048;resultBytes:262144;outputBytes:32768;statements:8}>;
export function createActionRecoveryReadRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;clock:{nowMs():number}}):ActionRecoveryReadRepository;
