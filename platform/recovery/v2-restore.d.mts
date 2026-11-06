import type {RecoveryV2Ports,RecoveryV2Input} from './v2-contracts';
import type {RecoveryReport} from './types';
import type {PinnedBeaconVerifier} from '../beacon/portable.mjs';
export type ContinuedRecoveryPhase='metadata'|'objects'|'publications'|'tables'|'fences'|'pin-target'
 |'reconcile-objects'|'reconcile-table-metadata'|'reconcile-tables'|'reconcile-audit'|'reconcile-economics'
 |'reconcile-collection-authorities'|'reconcile-collection-admissions'|'reconcile-collection-traits'|'reconcile-collection-fulfillments'
 |'reconcile-publications'|'reconcile-checkpoints'|'reconcile-final'|'final-ready';
export type ContinuedRecoveryOutcome={kind:'started'|'progress'|'replayed';restoreId:string;revision:number;phase:ContinuedRecoveryPhase}
 |{kind:'restored';restoreId:string;report:RecoveryReport}
 |{kind:'held';restoreId:string;revision:number;reason:string}|{kind:'conflict';code:string};
export interface ContinuedPrivateRecovery {
 start(input:RecoveryV2Input):Promise<ContinuedRecoveryOutcome>;
 step(input:RecoveryV2Input&{expectedRevision:number}):Promise<ContinuedRecoveryOutcome>;
 /** Missing revision is permitted only when the pinned restore is already ready. */
 finish(input:RecoveryV2Input&{expectedRevision?:number}):Promise<ContinuedRecoveryOutcome>;
}
/** Private local operator service. Fresh targets remain mutation-disabled until
 * exact rows, artifacts, economic checks and the final watermark are verified.
 * The optional verifier is a trusted offline adapter, never request data. */
export function createRecoveryV2Restore(ports:RecoveryV2Ports&{beaconVerifier?:PinnedBeaconVerifier}):ContinuedPrivateRecovery;
