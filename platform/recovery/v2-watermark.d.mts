import type {CanonicalCrypto} from '../application/ports';
export interface RecoveryWatermarkTrigger {name:string;sql:string}
export function recoveryWatermarkTriggerInventory(tables:readonly string[]):readonly Readonly<RecoveryWatermarkTrigger>[];
export function recoveryWatermarkTriggerQuery():{sql:string;values:readonly (string|number|null)[]};
export function verifyRecoveryWatermarkTriggers(rows:readonly RecoveryWatermarkTrigger[],tables:readonly string[],crypto:CanonicalCrypto):Promise<Readonly<{fingerprint:string;triggerCount:number;tableCount:number}>>;
