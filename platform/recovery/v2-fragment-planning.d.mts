import type {RecoveryFragmentHeader} from './v2-fragments.mjs';
import type {RecoveryV2Table} from './v2-codec.mjs';
type Statement={sql:string;values:readonly(string|number|null)[]};
export interface RecoveryFragmentProbePlan {readonly header:Omit<RecoveryFragmentHeader,'cursor'|'characters'|'bytes'>;readonly statement:Statement}
export interface RecoveryFragmentChunkPlan {readonly header:RecoveryFragmentHeader;readonly index:number;readonly offset:number;readonly characters:number;readonly statement:Statement}
export function planRecoveryFragmentProbe(table:Pick<RecoveryV2Table,'name'|'columns'|'primaryKey'|'hasRowid'>,input:{index:number;after?:readonly[number]|null;schemaFingerprint:string}):RecoveryFragmentProbePlan;
export function materializeRecoveryFragmentProbe(plan:RecoveryFragmentProbePlan,rows:readonly Record<string,unknown>[]):RecoveryFragmentHeader|null;
export function planRecoveryFragmentChunk(header:RecoveryFragmentHeader,index:number):RecoveryFragmentChunkPlan;
export function materializeRecoveryFragmentChunk(plan:RecoveryFragmentChunkPlan,rows:readonly Record<string,unknown>[]):Readonly<{index:number;offset:number;characters:number;text:string}>;
