import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
export const LEGACY_RAW_AUDIT_LIMITS=Object.freeze({sourceBytes:33554432,chunkBytes:65536,checkpointBytes:8192,workingBytes:1048576});
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const fail=(ok,message)=>{if(!ok)throw new TypeError('Legacy raw audit '+message);};
const copy=v=>JSON.parse(canonicalJson(v));
const headerSql=`SELECT c.id,c.kind,c.tranche,c.season_start,CASE WHEN length(CAST(c.season_month AS BLOB))<=32 THEN c.season_month ELSE NULL END season_month,c.revision,CASE WHEN length(CAST(c.origin_digest AS BLOB))<=128 THEN c.origin_digest ELSE NULL END origin_digest,
 length(CAST(c.state AS BLOB)) source_bytes,CASE WHEN length(CAST(r.generation AS BLOB))<=256 THEN r.generation ELSE NULL END generation,r.mode,r.status,w.revision watermark
 FROM collect_inventories c CROSS JOIN app_recovery_state r CROSS JOIN app_recovery_watermark w
 WHERE c.id=? AND r.id=1 AND w.id=1 AND r.mode IN ('live','private') AND r.status IN ('live','ready') AND r.write_nonce IS NULL`;
function validPin(p){return exact(p,['id','kind','tranche','season_start','season_month','revision','origin_digest','source_bytes','generation','mode','status','watermark'])&&id(p.id)&&['genesis','season'].includes(p.kind)&&Number.isSafeInteger(p.revision)&&p.revision>=0&&Number.isSafeInteger(p.watermark)&&p.watermark>=0&&Number.isSafeInteger(p.source_bytes)&&p.source_bytes>0&&p.source_bytes<=LEGACY_RAW_AUDIT_LIMITS.sourceBytes&&typeof p.origin_digest==='string'&&p.origin_digest.length<=128&&typeof p.generation==='string'&&p.generation.length<=256;}
/** Read-only exact-byte fingerprint. Checkpoints are private continuations, NOT
 * caller/import authority. Durable CAS and canonical/economic relation audits
 * are required before any adoption. No writes or active authority are created. */
export function createLegacyRawStateAudit({driver,hash}){
 return Object.freeze({async step({inventoryId,checkpoint=null}){
  fail(id(inventoryId),'inventory identity');let prior=null;
  if(checkpoint!==null){fail(utf8(canonicalJson(checkpoint)).length<=LEGACY_RAW_AUDIT_LIMITS.checkpointBytes,'checkpoint bound');prior=copy(checkpoint);fail(exact(prior,['format','pin','offset','hashState'])&&prior.format==='legacy-raw-state-audit-v1'&&validPin(prior.pin)&&prior.pin.id===inventoryId&&Number.isSafeInteger(prior.offset)&&prior.offset>0&&prior.offset<prior.pin.source_bytes&&prior.hashState?.bytes===prior.offset,'checkpoint shape');}
  const offset=prior?.offset??0,statements=[sql(headerSql,inventoryId),sql(`SELECT hex(substr(CAST(state AS BLOB),?,?)) chunk_hex FROM collect_inventories WHERE id=? AND length(CAST(state AS BLOB)) BETWEEN 1 AND ?`,offset+1,LEGACY_RAW_AUDIT_LIMITS.chunkBytes,inventoryId,LEGACY_RAW_AUDIT_LIMITS.sourceBytes),sql(headerSql,inventoryId)],batch=measureBatch(statements);
  const rows=await driver.batch(statements),serializedBytes=utf8(canonicalJson(rows)).length;
  const metrics={statements:3,batchBytes:batch.batchBytes,resultBytes:serializedBytes,chunkBytes:0,maxWorkingBytes:serializedBytes*2+LEGACY_RAW_AUDIT_LIMITS.checkpointBytes*2};
  const held=reason=>({kind:'held',reason,metrics});
  if(serializedBytes>262144||rows.length!==3||rows.some(r=>!Array.isArray(r.rows)))return held('source-read-bound');
  const [before,chunks,after]=rows.map(r=>r.rows);if(before.length!==1||after.length!==1||!validPin(before[0])||canonicalJson(before)!==canonicalJson(after))return held('source-unavailable-or-changed');
  const pin=before[0];if(prior&&canonicalJson(prior.pin)!==canonicalJson(pin))return held('source-pin-changed');
  const expected=Math.min(LEGACY_RAW_AUDIT_LIMITS.chunkBytes,pin.source_bytes-offset),hex=chunks[0]?.chunk_hex;
  if(chunks.length!==1||typeof hex!=='string'||hex.length!==expected*2||!/^[A-F0-9]+$/.test(hex))return held('source-chunk-invalid');
  const bytes=new Uint8Array(expected);for(let n=0;n<expected;n++)bytes[n]=parseInt(hex.slice(n*2,n*2+2),16);metrics.chunkBytes=bytes.length;metrics.maxWorkingBytes+=bytes.length*3+hex.length*2;
  if(metrics.maxWorkingBytes>LEGACY_RAW_AUDIT_LIMITS.workingBytes)return held('working-byte-bound');
  const hashState=hash.advance(prior?.hashState??hash.initial(),bytes),nextOffset=offset+bytes.length;
  fail(hashState.bytes===nextOffset,'hash byte count');
  if(nextOffset===pin.source_bytes)return {kind:'verified',pin:copy(pin),rawStateDigest:hash.finish(hashState),verification:'exact-legacy-state-bytes-only',canonicalRelation:false,economics:false,adoption:false,executable:false,metrics};
  const next={format:'legacy-raw-state-audit-v1',pin:copy(pin),offset:nextOffset,hashState};fail(utf8(canonicalJson(next)).length<=LEGACY_RAW_AUDIT_LIMITS.checkpointBytes,'checkpoint bound');
  return {kind:'continue',checkpoint:next,metrics};
 }});
}
