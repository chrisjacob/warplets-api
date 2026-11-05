import type { AtomicDriver } from './atomic-earn.mjs';
import type { BoardInput,CanonicalCrypto,Revisions,Winner } from '../application/ports';
export type BoardInputRead=Readonly<{kind:'loaded';input:BoardInput;versions:Revisions;inputDigest:string;
  measurements:Readonly<{inputBytes:number;participants:number;posts:number;readBatches:number}>}>
  |Readonly<{kind:'final';epoch:number;snapshotId:string;winners:readonly Winner[]}>
  |Readonly<{kind:'pending';reason:string;dependencyIds:readonly string[]}>
  |Readonly<{kind:'conflict';code:'revision_conflict'}>;
export function loadAtomicBoardInput(driver:AtomicDriver,crypto:CanonicalCrypto,query:{epoch:number;nowMs:number;sourceRef:string}):Promise<BoardInputRead>;
