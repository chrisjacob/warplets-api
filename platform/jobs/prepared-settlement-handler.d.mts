import type {EarnSettlementService} from '../earn/settlement-service.mjs';
import type {AtomicSettlementRepository} from '../storage/atomic-settlement.mjs';
import type {CanonicalCrypto,OperatorPrincipal} from '../application/ports';
import type {Handler} from './runner.mjs';
export function createPreparedSettlementHandler(ports:{service:EarnSettlementService;repository:AtomicSettlementRepository;
 crypto:CanonicalCrypto;clock:{nowMs():number};principal:OperatorPrincipal}):Handler;
