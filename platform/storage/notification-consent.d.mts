import type {CanonicalCrypto} from '../application/ports';
import type {AtomicDriver} from './atomic-earn.mjs';
import type {NotificationConsentRepository} from '../application/notifications';
export function createNotificationConsentRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;clock:{nowMs():number};ids:{next():string}}):NotificationConsentRepository;
