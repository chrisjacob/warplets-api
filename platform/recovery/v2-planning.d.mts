import type {RecoveryV2Rows,RecoveryV2Cursor,RecoveryV2Table} from './v2-codec.mjs';
export interface RecoveryV2PagePlan {header:RecoveryV2Rows;statement:{sql:string;values:readonly (string|number|null)[]};limit:number;budget:number}
export function planRecoveryV2Rows(table:Pick<RecoveryV2Table,'name'|'columns'|'primaryKey'|'hasRowid'>,input:{index:number;after?:RecoveryV2Cursor}):Readonly<RecoveryV2PagePlan>;
export function materializeRecoveryV2Rows(plan:RecoveryV2PagePlan,rows:readonly Record<string,unknown>[]):{value:RecoveryV2Rows|null;first:RecoveryV2Cursor;last:RecoveryV2Cursor;exhausted:boolean};
