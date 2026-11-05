import type {CanonicalCrypto} from '../application/ports';
import type {RecoverySchema} from './types';
export function readInstalledRecoverySchema(crypto:CanonicalCrypto):Promise<RecoverySchema>;
