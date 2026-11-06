import type {CanonicalCrypto} from '../application/ports';
import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {ActionRecoveryReadRepository,ActionRecoveryView} from '../application/action-recovery';
export const ACTION_RECOVERY_LIMITS:Readonly<{attempts:16;receipts:64;planBytes:65536;packetBytes:32768;observationBytes:2048;resultBytes:262144;outputBytes:32768;statements:8}>;
export function createActionRecoveryReadRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;clock:{nowMs():number}}):ActionRecoveryReadRepository;

export interface ActionRecoveryHistoryInput {row:Record<string,any>;attempts:Record<string,any>[];receipts:Record<string,any>[];count:{attempts:number;lastIndex:number};keys:{requests:number;bad:number};owner:string;nowMs:number}
export interface ActionRecoveryEventLineage {eventId:string;attemptId:string;ordinal:number;priorState:string;priorRevision:number;revision:number;observationDigest:string}
export function actionRecoveryHistoryStatements(intentId:string,wallet:string):Array<{sql:string;values:any[]}>;
export function verifyActionRecoveryHistory(input:ActionRecoveryHistoryInput,crypto:CanonicalCrypto):Promise<Readonly<{value:ActionRecoveryView;eventLineage:readonly ActionRecoveryEventLineage[]}>>;
