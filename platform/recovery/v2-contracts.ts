import type {RecoveryPorts,RecoveryReport} from './types';
import type {RecoveryV2Codec,RecoveryV2Root,RecoveryV2Pinned} from './v2-codec.mjs';
/** Private local operator seams. Capture is implemented; continued restore is
 * still planned. These types do not advertise a public runtime capability. */
export type RecoveryV2Phase='reading'|'verifying'|'indexing'|'ready'|'held'|'superseded';
export type RecoveryV2CaptureOutcome={kind:'started'|'progress'|'replayed';captureId:string;revision:number;phase:RecoveryV2Phase}
 |({kind:'captured';captureId:string;revision:number}&RecoveryV2Pinned)
 |{kind:'held';captureId:string;reason:string;revision:number}|{kind:'conflict';code:string};
export interface RecoveryV2CaptureService {
 start(input:{captureId:string;sourceCommit:string}):Promise<RecoveryV2CaptureOutcome>;
 step(input:{captureId:string;expectedRevision:number}):Promise<RecoveryV2CaptureOutcome>;
 finish(input:{captureId:string;expectedRevision:number}):Promise<RecoveryV2CaptureOutcome>;
}
export type RecoveryV2Input={root:RecoveryV2Root;pinnedDigest:string};
export type RecoveryV2RestorePhase='metadata'|'objects'|'tables'|'fences'|'reconcile-objects'|'reconcile-tables'|'reconcile-audit'|'reconcile-economics'|'reconcile-final'|'ready'|'held';
export type RecoveryV2RestoreOutcome={kind:'started'|'progress'|'replayed';restoreId:string;revision:number;phase:RecoveryV2RestorePhase}
 |{kind:'restored';restoreId:string;report:RecoveryReport}|{kind:'held';restoreId:string;reason:string;revision:number}|{kind:'conflict';code:string};
export interface RecoveryV2RestoreService {
 start(input:RecoveryV2Input):Promise<RecoveryV2RestoreOutcome>;
 step(input:RecoveryV2Input&{expectedRevision:number}):Promise<RecoveryV2RestoreOutcome>;
 finish(input:RecoveryV2Input&{expectedRevision:number}):Promise<RecoveryV2RestoreOutcome>;
}
export type RecoveryV2Ports=RecoveryPorts&{schema:NonNullable<RecoveryPorts['schema']>;v2Codec:RecoveryV2Codec};
