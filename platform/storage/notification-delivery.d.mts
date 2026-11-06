import type {CanonicalCrypto} from '../application/ports';
import type {AtomicDriver} from './atomic-earn.mjs';
import type {NotificationDeliveryRepository} from '../application/notifications';
export function createNotificationDeliveryRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;clock:{nowMs():number};ids:{next():string}}):NotificationDeliveryRepository;
