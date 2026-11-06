import type {CanonicalCrypto,OperatorPrincipal} from '../application/ports';
import type {NotificationRetentionRepository} from '../storage/notification-delivery.mjs';
import type {Handler} from './runner.mjs';
export function createNotificationRetentionHandler(ports:{repository:NotificationRetentionRepository;crypto:CanonicalCrypto;clock:{nowMs():number};principal:OperatorPrincipal}):Handler;
