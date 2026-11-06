import {canonicalJson,utf8} from '../security/canonical.mjs';
import {sql} from '../storage/atomic-driver.mjs';
const canonicalSql=value=>value.trim().replace(/\s+/g,' ').replace(/;$/,'');
const control=[
 {name:'recovery_watermark_monotonic',sql:"CREATE TRIGGER recovery_watermark_monotonic BEFORE UPDATE ON app_recovery_watermark WHEN NEW.id<>OLD.id OR NEW.revision<>OLD.revision+1 BEGIN SELECT RAISE(ABORT,'Recovery watermark must advance exactly once'); END;"},
 {name:'recovery_watermark_no_delete',sql:"CREATE TRIGGER recovery_watermark_no_delete BEFORE DELETE ON app_recovery_watermark BEGIN SELECT RAISE(ABORT,'Retain recovery watermark'); END;"},
 {name:'recovery_watermark_no_reinsert',sql:"CREATE TRIGGER recovery_watermark_no_reinsert BEFORE INSERT ON app_recovery_watermark WHEN EXISTS(SELECT 1 FROM app_recovery_watermark WHERE id=1) BEGIN SELECT RAISE(ABORT,'Retain recovery watermark'); END;"},
];
/** Exact trusted SQL, not name/pattern-only inspection. Extra/missing/substituted
 * watermark triggers prevent claiming a consistent continued snapshot. */
export function recoveryWatermarkTriggerInventory(tableNames){
 const tables=[...tableNames].sort();if(tables.length<1||tables.length>128||new Set(tables).size!==tables.length||tables.some(name=>typeof name!=='string'||!/^[a-z][a-z0-9_]*$/.test(name)))throw new TypeError('Invalid recovery business-table inventory.');
 return [...control,...tables.flatMap(table=>['insert','update','delete'].map(action=>({name:`recovery_watermark_${table}_${action}`,sql:`CREATE TRIGGER recovery_watermark_${table}_${action} AFTER ${action.toUpperCase()} ON ${table} BEGIN UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1; END;`})))].map(row=>Object.freeze({...row,sql:canonicalSql(row.sql)})).sort((a,b)=>a.name<b.name?-1:1);
}
export function recoveryWatermarkTriggerQuery(){return sql("SELECT name,CASE WHEN length(CAST(sql AS BLOB))<=1024 THEN sql ELSE NULL END sql FROM sqlite_schema WHERE type='trigger' AND name GLOB 'recovery_watermark_*' ORDER BY name LIMIT 388");}
export async function verifyRecoveryWatermarkTriggers(input,tableNames,crypto){
 const rows=JSON.parse(canonicalJson(input)),expected=recoveryWatermarkTriggerInventory(tableNames);
 if(!Array.isArray(rows)||rows.length!==expected.length||rows.some(row=>!row||Object.keys(row).length!==2||typeof row.name!=='string'||row.name.length>128||typeof row.sql!=='string'||utf8(row.sql).length>1024))throw new TypeError('Recovery watermark trigger inventory mismatch.');
 const actual=rows.map(row=>({name:row.name,sql:canonicalSql(row.sql)})).sort((a,b)=>a.name<b.name?-1:1);if(canonicalJson(actual)!==canonicalJson(expected))throw new TypeError('Recovery watermark trigger SQL mismatch.');
 return Object.freeze({fingerprint:await crypto.sha256(utf8(canonicalJson(expected))),triggerCount:expected.length,tableCount:(expected.length-control.length)/3});
}
