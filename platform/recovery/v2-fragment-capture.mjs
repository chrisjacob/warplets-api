import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {hashJson,persistObject} from './inventory.mjs';
import {RECOVERY_V2_LIMITS} from './v2-codec.mjs';
import {createRecoveryV2FragmentCodec} from './v2-fragments.mjs';
import {planRecoveryFragmentProbe,materializeRecoveryFragmentProbe,planRecoveryFragmentChunk,materializeRecoveryFragmentChunk} from './v2-fragment-planning.mjs';
import {recoveryV2SourceGuardSql,checkRecoveryV2SourceGuard} from './v2-schema.mjs';
const need=(c,m)=>{if(!c)throw new TypeError('Recovery fragmented capture '+m);};
class SourceChanged extends Error {}
export function createRecoveryV2FragmentCapture({driver,artifacts,crypto,source}){
 const codec=createRecoveryV2FragmentCodec({crypto}),read=async s=>(await driver.batch(s)).map(r=>r.rows);
 async function guarded(run,plan,materialize){const descriptor=JSON.parse(run.descriptor_json),rows=await read([sql(recoveryV2SourceGuardSql),plan.statement,sql(recoveryV2SourceGuardSql)]);try{checkRecoveryV2SourceGuard(rows[0],descriptor);checkRecoveryV2SourceGuard(rows[2],descriptor);}catch{throw new SourceChanged();}return materialize(plan,rows[1]);}
 async function record(run,next,{scope,ordinal,object,count,first,last}){
  const stored=await persistObject(artifacts,object.identity,object.bytes,crypto);if(stored.kind!=='verified')return {kind:'conflict',code:stored.reason};const identityJson=canonicalJson(object.identity),proof=await hashJson(crypto,['capture-v2-fragment-page',run.id,scope,ordinal,object.identity,count,first,last]),verified=await hashJson(crypto,['capture-v2-object',object.identity]);
  return source.advance(run,next,{child:[
   (gate,v)=>sql(`INSERT INTO app_recovery_capture_pages(capture_id,scope,ordinal,kind,identity_json,item_count,first_cursor_json,last_cursor_json,result_digest) SELECT ?,?,?,'rows',?,?,?,?,? WHERE ${gate} ON CONFLICT DO NOTHING`,run.id,scope,ordinal,identityJson,count,canonicalJson(first),canonicalJson(last),proof,...v),
   (gate,v)=>sql(`INSERT INTO app_recovery_capture_objects(capture_id,object_key,identity_json,verified,verification_digest) SELECT ?,?,?,1,? WHERE ${gate} ON CONFLICT DO NOTHING`,run.id,object.identity.key,identityJson,verified,...v),
  ],requiredSql:`EXISTS(SELECT 1 FROM app_recovery_capture_pages WHERE capture_id=? AND scope=? AND ordinal=? AND identity_json=? AND item_count=? AND result_digest=?) AND EXISTS(SELECT 1 FROM app_recovery_capture_objects WHERE capture_id=? AND object_key=? AND identity_json=? AND verified=1 AND verification_digest=?) AND (SELECT COUNT(*) FROM app_recovery_capture_objects WHERE capture_id=?)<=? AND (SELECT COALESCE(SUM(json_extract(identity_json,'$.size')),0) FROM app_recovery_capture_objects WHERE capture_id=?)<=?`,requiredValues:[run.id,scope,ordinal,identityJson,count,proof,run.id,object.identity.key,identityJson,verified,run.id,RECOVERY_V2_LIMITS.objects,run.id,RECOVERY_V2_LIMITS.totalBytes]});
 }
 async function start(run,c,table){
  const plan=planRecoveryFragmentProbe(table,{index:c.pageIndex,after:c.after,schemaFingerprint:JSON.parse(run.descriptor_json).schema.fingerprint});let header;try{header=await guarded(run,plan,materializeRecoveryFragmentProbe);}catch(error){return source.hold(run,error instanceof SourceChanged?'capture-source-changed':'capture-fragment-row-bound-or-invalid');}need(header,'oversized row disappeared.');return source.advance(run,{...c,phase:'fragments',fragmentHeader:header,fragmentIndex:0});
 }
 async function step(run,c){
  const h=c.fragmentHeader,scope='fragments:'+h.table+':'+h.index;
  if(c.fragmentIndex<Math.ceil(h.characters/8192)){
   const plan=planRecoveryFragmentChunk(h,c.fragmentIndex);let piece;try{piece=await guarded(run,plan,materializeRecoveryFragmentChunk);}catch{return source.hold(run,'capture-source-changed');}const object=await codec.encodeChunk(piece.text);need(object.characters===piece.characters,'chunk character mismatch.');return record(run,{...c,fragmentIndex:c.fragmentIndex+1},{scope,ordinal:piece.index,object,count:piece.characters,first:[piece.offset],last:[piece.offset+piece.characters-1]});
  }
  const [rows]=await read([sql('SELECT ordinal,identity_json,item_count,first_cursor_json,last_cursor_json FROM app_recovery_capture_pages WHERE capture_id=? AND scope=? ORDER BY ordinal LIMIT 129',run.id,scope)]),fragments=rows.map(row=>({index:row.ordinal,offset:JSON.parse(row.first_cursor_json)[0],characters:row.item_count,identity:JSON.parse(row.identity_json)}));need(rows.length===c.fragmentIndex&&rows.every((r,n)=>JSON.parse(r.last_cursor_json)[0]===fragments[n].offset+r.item_count-1),'fragment ledger prefix.');const object=await codec.encodeRowDescriptor({...h,fragments}),next={...c,phase:'rows',tableCounts:[...c.tableCounts],tablePages:[...c.tablePages],pageIndex:c.pageIndex+1,after:h.cursor};next.tableCounts[c.tableIndex]++;next.tablePages[c.tableIndex]++;need(next.tableCounts[c.tableIndex]<=RECOVERY_V2_LIMITS.tableRows,'row count bound.');delete next.fragmentHeader;delete next.fragmentIndex;
  return record(run,next,{scope:'rows:'+h.table,ordinal:h.index,object,count:1,first:h.cursor,last:h.cursor});
 }
 return Object.freeze({start,step});
}
