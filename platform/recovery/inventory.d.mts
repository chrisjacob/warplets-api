import type {CanonicalCrypto} from '../application/ports';
import type {RecoveryInventory,RecoverySchema} from './types';
export const RECOVERY_FORMAT:'10x.local.recovery.v1';
export const RECOVERY_LIMITS:Readonly<{inventoryBytes:number;pageBytes:number;totalBytes:number;objects:number;tableRows:number;tables:number;finishOperations:number}>;
export function schemaDescriptor(migrations:RecoverySchema['migrations'],crypto:CanonicalCrypto):Promise<RecoverySchema>;
export function createPinnedInventory(input:Omit<RecoveryInventory,'format'>|RecoveryInventory,crypto:CanonicalCrypto):Promise<{inventory:RecoveryInventory;bytes:Uint8Array;digest:string}>;
export function verifyPinnedInventory(input:RecoveryInventory,pinnedDigest:string,crypto:CanonicalCrypto):Promise<RecoveryInventory>;
