import {canonicalJson,utf8} from '../security/canonical.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {RECOVERY_V2_LIMITS} from './v2-codec.mjs';
const quote=value=>{if(typeof value!=='string'||!/^[a-z][a-z0-9_]*$/.test(value))throw new TypeError('Invalid v2 SQL identifier.');return '"'+value+'"';};
const scalar=value=>value===null||typeof value==='string'||Number.isSafeInteger(value);
/** Pure bounded keyset query planning. Source/target watermark checks must wrap
 * this SELECT in the caller's transactional batch; this is not capture authority. */
export function planRecoveryV2Rows(tableInput,{index,after=null}){
 const table=JSON.parse(canonicalJson(tableInput)),cursor=after===null?null:JSON.parse(canonicalJson(after));
 if(!Number.isSafeInteger(index)||index<0||index>=RECOVERY_V2_LIMITS.objects||typeof table.hasRowid!=='boolean'||!Array.isArray(table.columns)||table.columns.length<1||table.columns.length>64||new Set(table.columns).size!==table.columns.length||!Array.isArray(table.primaryKey)||table.primaryKey.some(key=>!table.columns.includes(key)))throw new TypeError('Invalid v2 table plan.');
 const columns=table.columns.map(quote),keys=table.hasRowid?['rowid']:table.primaryKey.map(quote);if(!keys.length)throw new TypeError('V2 table ordering key required.');
 if(index===0?cursor!==null:cursor===null)throw new TypeError('Invalid v2 continuation boundary.');
 if(cursor!==null&&(!Array.isArray(cursor)||cursor.length!==keys.length||!cursor.every(v=>typeof v==='string'||Number.isSafeInteger(v))||utf8(canonicalJson(cursor)).length>4096||table.hasRowid&&!Number.isSafeInteger(cursor[0])))throw new TypeError('Invalid v2 continuation cursor.');
 const header={format:'10x.local.recovery.rows.v2',table:table.name,index,columns:table.columns,hasRowid:table.hasRowid,after:cursor,rows:[]},limit=table.name==='app_collection_records'?RECOVERY_V2_LIMITS.sourcePageBytes:RECOVERY_V2_LIMITS.pageBytes,budget=limit-utf8(canonicalJson(header)).length;
 const fields=[...(table.hasRowid?['rowid']:[]),...columns],row=`json_array(${fields.join(',')})`,key=`json_array(${keys.join(',')})`,baseBytes=fields.map(name=>`COALESCE(length(CAST(${name} AS BLOB)),0)`).join('+'),order=keys.map((_,n)=>'k'+n).join(','),where=cursor===null?'1':keys.length===1?`${keys[0]}>?`:`(${keys.join(',')})>(${keys.map(()=>'?').join(',')})`;
 const statement=sql(`WITH candidates AS (
 SELECT ${keys.map((key,n)=>`${key} k${n}`).join(',')},CASE WHEN (${baseBytes})<=${limit} THEN ${row} ELSE NULL END raw_json,
 CASE WHEN length(CAST(${key} AS BLOB))<=4096 THEN ${key} ELSE NULL END cursor_json FROM ${quote(table.name)} WHERE ${where} ORDER BY ${keys.join(',')} LIMIT 101
 ), sized AS (SELECT *,COALESCE(length(CAST(raw_json AS BLOB)),${limit+1}) row_bytes FROM candidates),
 running AS (SELECT *,ROW_NUMBER() OVER(ORDER BY ${order}) ordinal,SUM(row_bytes+1) OVER(ORDER BY ${order})-1 running_bytes FROM sized)
 SELECT CASE WHEN ordinal<=100 AND running_bytes<=? THEN raw_json ELSE NULL END row_json,cursor_json,row_bytes,
 CASE WHEN ordinal<=100 AND running_bytes<=? THEN 0 ELSE 1 END excluded FROM running
 WHERE running_bytes-row_bytes<=? ORDER BY ${order}`,...(cursor??[]),budget,budget,budget+1);
 measureBatch([statement]);return Object.freeze({header:Object.freeze(header),statement,limit,budget});
}
/** Decode only the already bounded SQL result. A sentinel never becomes a
 * silently skipped row; an oversized first row holds the entire continuation. */
export function materializeRecoveryV2Rows(plan,result){
 const rows=JSON.parse(canonicalJson(result));if(!Array.isArray(rows)||rows.length>101)throw new TypeError('V2 page query row bound.');
 const accepted=[],cursors=[];let excluded=false;
 for(const row of rows){if(excluded)throw new TypeError('Rows followed a v2 page boundary.');if(row.excluded===1){excluded=true;if(!accepted.length)throw new TypeError('V2 source row exceeds page byte bound.');continue;}if(row.excluded!==0||typeof row.row_json!=='string'||typeof row.cursor_json!=='string')throw new TypeError('Invalid v2 page query result.');const value=JSON.parse(row.row_json),cursor=JSON.parse(row.cursor_json);if(!Array.isArray(value)||value.length!==plan.header.columns.length+Number(plan.header.hasRowid)||!value.every(scalar)||!Array.isArray(cursor)||cursor.length<1||!cursor.every(scalar))throw new TypeError('Invalid v2 page values.');accepted.push(value);cursors.push(cursor);}
 if(accepted.length>100)throw new TypeError('V2 page row bound.');const value={...plan.header,rows:accepted};if(utf8(canonicalJson(value)).length>plan.limit)throw new TypeError('V2 canonical page byte bound.');
 return {value:accepted.length?value:null,first:cursors[0]??null,last:cursors.at(-1)??null,exhausted:!excluded&&rows.length<100};
}
