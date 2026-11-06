import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {BUSINESS_TABLES,AUTH_TABLES,CONTROL_TABLES} from './schema.mjs';
import {schemaDescriptor} from './inventory.mjs';
import {recoveryWatermarkTriggerQuery,verifyRecoveryWatermarkTriggers} from './v2-watermark.mjs';
const controls=['app_recovery_watermark','app_recovery_captures','app_recovery_capture_pages','app_recovery_capture_objects','app_recovery_reconcile_checks'];
const known=new Set([...BUSINESS_TABLES,...AUTH_TABLES,...CONTROL_TABLES,...controls,'schema_versions','_cf_METADATA']);
export const recoveryV2SourceGuardSql=`SELECT r.generation,r.mode,r.status,r.inventory_digest,r.write_nonce,w.revision watermark FROM app_recovery_state r CROSS JOIN app_recovery_watermark w WHERE r.id=1 AND w.id=1`;
// D1 disallows schema_version. Compare exact persisted table and watermark
// trigger SQL in both directions instead; no metadata hash SQL extension or
// untrusted caller assertion is needed, including between async hashing/commit.
export function recoveryV2SchemaFence(descriptorSql,schemaSql=`json_extract(${descriptorSql},'$.schema')`){
 const expected=`SELECT json_extract(value,'$.type') type,json_extract(value,'$.name') name,json_extract(value,'$.sql') sql FROM json_each(${descriptorSql},'$.schemaInventory') UNION ALL SELECT 'trigger','recovery_watermark_'||t.value||'_'||a.key,replace(a.value,'__TABLE__',t.value) FROM json_each(${descriptorSql},'$.tableNames') t CROSS JOIN json_each(${descriptorSql},'$.watermarkTemplates') a`;
 const actual="SELECT type,name,sql FROM sqlite_schema WHERE (type='table' AND name NOT LIKE 'sqlite_%') OR (type='trigger' AND name GLOB 'recovery_watermark_*')";
 return `NOT EXISTS(${actual} EXCEPT SELECT * FROM (${expected})) AND NOT EXISTS(SELECT * FROM (${expected}) EXCEPT ${actual}) AND NOT EXISTS(SELECT version FROM schema_versions EXCEPT SELECT json_extract(value,'$.file') FROM json_each(${schemaSql},'$.migrations')) AND NOT EXISTS(SELECT json_extract(value,'$.file') FROM json_each(${schemaSql},'$.migrations') EXCEPT SELECT version FROM schema_versions)`;
}
function need(c,message){if(!c)throw new TypeError(message);}
export function checkRecoveryV2SourceGuard(rows,expected=null){
 need(Array.isArray(rows)&&rows.length===1,'V2 source guard unavailable.');const r=rows[0];need(typeof r.generation==='string'&&r.generation.length>0&&r.generation.length<=256&&['live','private'].includes(r.mode)&&['live','ready'].includes(r.status)&&r.write_nonce===null&&Number.isSafeInteger(r.watermark)&&r.watermark>=0,'V2 source is not live or ready.');
 if(expected)need(r.generation===expected.sourceGeneration&&r.watermark===expected.sourceWatermark,'V2 source changed during capture.');return {...r};
}
/** Bounded startup identity read only; column discovery is a later continued
 * phase. All source mutation triggers are verified by exact canonical SQL. */
export async function readRecoveryV2SourceMetadata(driver,{schema,crypto}){
 const trusted=JSON.parse(canonicalJson(schema));need((await schemaDescriptor(trusted.migrations,crypto)).fingerprint===trusted.fingerprint,'V2 trusted schema fingerprint mismatch.');
 const output=await driver.batch([
  sql(`SELECT CASE WHEN length(CAST(name AS BLOB))<=128 THEN name ELSE NULL END name,
   CASE WHEN length(CAST(sql AS BLOB))<=16384 AND (SELECT COALESCE(SUM(length(CAST(sql AS BLOB))),0) FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%')<=262144 THEN sql ELSE NULL END sql
   FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 150`),
  recoveryWatermarkTriggerQuery(),sql(recoveryV2SourceGuardSql),
  sql('SELECT CASE WHEN length(CAST(version AS BLOB))<=256 THEN version ELSE NULL END version FROM schema_versions ORDER BY version LIMIT 129'),
 ]);
 const [tables,triggers,guard,migrations]=JSON.parse(canonicalJson(output.map(r=>r.rows)));need(tables.length<150&&tables.every(row=>typeof row.name==='string'&&known.has(row.name)&&typeof row.sql==='string'),'V2 unknown or oversized source schema.');
 need(canonicalJson(migrations.map(row=>row.version))===canonicalJson(trusted.migrations.map(row=>row.file)),'V2 installed migration inventory mismatch.');
 need([...BUSINESS_TABLES,...AUTH_TABLES,...CONTROL_TABLES,...controls].every(name=>tables.some(row=>row.name===name)),'V2 source schema incomplete.');const state=checkRecoveryV2SourceGuard(guard),verified=await verifyRecoveryWatermarkTriggers(triggers,BUSINESS_TABLES,crypto);
 const watermarkTemplates={},businessNames=new Set();
 for(const action of ['insert','update','delete']){
  const first=BUSINESS_TABLES[0],template=triggers.find(r=>r.name===`recovery_watermark_${first}_${action}`).sql.replaceAll(first,'__TABLE__');watermarkTemplates[action]=template;
  for(const table of BUSINESS_TABLES){const name=`recovery_watermark_${table}_${action}`;need(triggers.find(r=>r.name===name).sql===template.replaceAll('__TABLE__',table),'V2 inconsistent watermark SQL template.');businessNames.add(name);}
 }
 const descriptor={schema:trusted,sourceGeneration:state.generation,sourceWatermark:state.watermark,schemaInventory:[...tables.map(row=>({type:'table',...row})),...triggers.filter(r=>!businessNames.has(r.name)).map(row=>({type:'trigger',...row}))],watermarkTemplates,tableNames:[...BUSINESS_TABLES],tableSignature:await crypto.sha256(utf8(canonicalJson(tables))),triggerFingerprint:verified.fingerprint,sourceRecovery:{mode:state.mode,status:state.status,inventoryDigest:state.inventory_digest}};
 need(utf8(canonicalJson(descriptor)).length<=131072,'V2 captured schema descriptor bound.');return descriptor;
}
