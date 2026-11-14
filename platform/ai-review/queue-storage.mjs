import {canonicalJson,utf8} from '../security/canonical.mjs';
import {RECOVERY_V2_LIMITS} from '../recovery/v2-codec.mjs';
import {planRecoveryV2Rows} from '../recovery/v2-planning.mjs';
import {ReviewQueueError} from './queue-error.mjs';

const keys=Object.freeze({ai_review_captures:'job_id',ai_review_reports:'report_id'});
const quote=value=>{if(!/^[a-z][a-z0-9_]*$/.test(value))throw new TypeError('Invalid review storage column.');return '"'+value+'"';};
const bytes=value=>utf8(canonicalJson(value)).length;

/** Check the inserted immutable row before its transaction commits. The JSON
 * column's own bound excludes the escaping and metadata in a recovery row.
 * Reserve the longest legal continuation header and rowid, so later pages and
 * restored rowid allocation cannot make accepted evidence unrecoverable.
 */
export function assertReviewRowRecoverable(db,name,id){
 if(!db.isTransaction)throw new TypeError('Review storage preflight requires its write transaction.');
 const key=Object.hasOwn(keys,name)&&keys[name];if(!key)throw new TypeError('Unsupported review storage table.');
 const fields=db.prepare('SELECT name,pk FROM pragma_table_info(?) ORDER BY cid').all(name);
 const table={name,columns:fields.map(field=>field.name),primaryKey:fields.filter(field=>field.pk).sort((a,b)=>a.pk-b.pk).map(field=>field.name),hasRowid:true};
 const record=db.prepare(`SELECT rowid AS recovery_rowid,${table.columns.map(quote).join(',')} FROM ${quote(name)} WHERE ${quote(key)}=?`).get(id);
 if(!record)throw new TypeError('Review storage preflight requires an inserted row.');
 const row=[record.recovery_rowid,...table.columns.map(column=>record[column])];
 if(!Number.isSafeInteger(row[0]))throw new ReviewQueueError(413,'input_too_large','Review evidence cannot be recovered within its storage limit.');
 const plan=planRecoveryV2Rows(table,{index:RECOVERY_V2_LIMITS.objects-1,after:[Number.MIN_SAFE_INTEGER]});
 const actualRowBytes=bytes(row),reservedRowBytes=Math.max(actualRowBytes,bytes([Number.MIN_SAFE_INTEGER+1,...row.slice(1)]));
 if(reservedRowBytes>plan.budget)throw new ReviewQueueError(413,'input_too_large','Review evidence is too large to store and recover safely.');
 return Object.freeze({actualRowBytes,reservedRowBytes,maxPageBytes:plan.limit-plan.budget+reservedRowBytes,pageLimit:plan.limit});
}
