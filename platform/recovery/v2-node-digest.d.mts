export interface RecoveryDigest {write(bytes:Uint8Array):Promise<void>;finish():Promise<string>;abort(reason?:unknown):Promise<void>}
export function createNodeRecoveryDigest():RecoveryDigest;
