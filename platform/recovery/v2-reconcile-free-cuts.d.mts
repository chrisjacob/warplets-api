import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto} from '../application/ports';
import type {RecoveryDigest} from './v2-node-digest.mjs';
export type FreeCutRecoveryCheckpoint=Readonly<Record<string,unknown>&{phase:string;targetWatermark:number}>;
export interface FreeCutRecoveryMeasurement {operations:number;sqlBytes:number;readBytes:number;contextBytes:number;workingBytes:number;hashedBytes?:number;scope:string}
export function createRecoveryV2FreeCutReconciler(ports:{driver:AtomicDriver;crypto:CanonicalCrypto;repository:{advance(loaded:unknown,input:unknown):Promise<unknown>};createDigest?:()=>RecoveryDigest;onMeasure?:(measurement:FreeCutRecoveryMeasurement)=>void}):{step(loaded:unknown,checkpoint:FreeCutRecoveryCheckpoint):Promise<unknown>};
