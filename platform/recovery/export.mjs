import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {artifactIdentity} from '../artifacts/identity.mjs';
import {createPinnedInventory,clone,demand,hashJson,RECOVERY_LIMITS,verifyObject,persistObject,schemaDescriptor} from './inventory.mjs';
import {readSchema,tableListSql,rowExpression,rowOrder,objectRow,quote} from './schema.mjs';

const pending=reason=>({kind:'pending',reason});
function uniqueObjects(items){const values=new Map();for(const raw of items){const i=artifactIdentity(raw),previous=values.get(i.key);demand(!previous||canonicalJson(previous)===canonicalJson(i),'Conflicting object identities in recovery inventory.');values.set(i.key,i);}return [...values.values()].sort((a,b)=>a.key.localeCompare(b.key,'en'));}
function planTablePages(t){
 const result=[];let rows=[],index=0;
 // A bounded128KiB collection root is retained as base64, so its immutable
 // row can reach175KiB. The192KiB page leaves room for restore SQL under the
 // existing256KiB atomic batch limit. Other tables retain their prior bound.
 const pageLimit=t.name==='app_collection_records'?192*1024:128*1024;
 const page=()=>({format:'10x.local.recovery.table.v1',table:t.name,index,columns:t.columns,hasRowid:t.hasRowid,rows});
 let size=utf8(canonicalJson(page())).length;
 const flush=()=>{result.push({page:page(),bytes:utf8(canonicalJson(page()))});index++;rows=[];size=utf8(canonicalJson(page())).length;};
 for(const row of t.rows){const length=utf8(canonicalJson(row)).length;if(rows.length===100||size+length+Number(rows.length>0)>pageLimit){if(rows.length)flush();}
  demand(size+length+Number(rows.length>0)<=pageLimit,'Private recovery row page bound.');size+=length+Number(rows.length>0);rows.push(row);
 }if(rows.length)flush();return result;
}
export async function publicationPin(verified,codec){
 return {identity:verified.identity,semanticDigest:verified.semanticDigest,boardId:verified.boardId,epoch:verified.manifest.board.epoch,
  allocations:await Promise.all(verified.manifest.allocations.map(async a=>({tokenId:a.tokenId,day:a.day,allocationId:await codec.allocationDigest(a),awardRoot:a.awardRoot})))};
}
export function createRecoveryExporter({driver,artifacts,codec,crypto,clock,schema,sourceCommit}){
 schema=schema?clone(schema):null;demand(/^[a-f0-9]{40}$/.test(sourceCommit),'Recovery source commit required.');
 async function publications(rows){
  if(rows.length>4096)return pending('public-inventory-bound');
  const pins=[];for(const row of rows){
   demand(row.kind==='earn-archive-v1','Unknown catalog object prevents complete recovery export.');
   const identity=artifactIdentity({key:row.object_key,byteDigest:row.byte_digest,size:row.size_bytes,semanticDigest:null,visibility:'public',contentType:'application/json'});
   const stored=await verifyObject(artifacts,identity,crypto);if(stored.kind!=='verified')return stored;
   const bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(stored.bytes));
   const verified=await codec.verify(stored.bytes,{semanticDigest:bundle.sha256,byteDigest:identity.byteDigest});pins.push(await publicationPin(verified,codec));
  }return {kind:'verified',publications:pins.sort((a,b)=>a.identity.key<b.identity.key?-1:1)};
 }
 async function captured(input){try{const pinned=await createPinnedInventory({...input,createdMs:clock.nowMs(),sourceCommit},crypto);return {kind:'captured',...pinned};}catch(error){if(/bound|exceeds/.test(error.message))return pending('recovery-inventory-bound');throw error;}}
 return Object.freeze({
  async capturePublic(){
   const [{rows}]=await driver.batch([sql('SELECT * FROM manifest_catalog ORDER BY byte_digest LIMIT 4097')]);
   if(rows.length+1>RECOVERY_LIMITS.finishOperations||rows.reduce((sum,r)=>sum+r.size_bytes,0)>RECOVERY_LIMITS.totalBytes)return pending('public-capture-operation-or-byte-bound');
   const selected=await publications(rows);
   if(selected.kind!=='verified')return selected;
   return captured({mode:'public',schema:null,tables:[],objects:selected.publications.map(p=>p.identity),publications:selected.publications,checkpoints:{},authPolicy:'no-private-state'});
  },
  async capturePrivate(){
   demand(schema,'Private recovery requires trusted migration metadata.');const expected=await schemaDescriptor(schema.migrations,crypto);demand(expected.fingerprint===schema.fingerprint,'Trusted recovery schema mismatch.');
   const descriptor=await readSchema(driver),sizes=await driver.batch(descriptor.tables.map(t=>sql(`SELECT COUNT(*) n,COALESCE(SUM(length(CAST(${rowExpression(t)} AS BLOB))),0) bytes FROM ${quote(t.name)}`)));
   const budgets=sizes.map(r=>Math.max(256,r.rows[0].bytes));
   if(sizes.some(r=>r.rows[0].n>RECOVERY_LIMITS.tableRows)||budgets.reduce((a,b)=>a+b,0)>RECOVERY_LIMITS.totalBytes)return pending('private-snapshot-bound');
   // These queries execute in ONE SQLite/D1 transaction. Preflight sizes are
   // only budgets: every count/byte guard is rechecked inside this snapshot.
   const statements=[tableListSql(),sql('SELECT * FROM app_recovery_state WHERE id=1')];
   descriptor.tables.forEach((t,index)=>{const expr=rowExpression(t),table=quote(t.name);
    statements.push(sql(`SELECT COUNT(*) n,COALESCE(SUM(length(CAST(${expr} AS BLOB))),0) bytes FROM ${table}`));
    statements.push(sql(`SELECT ${expr} row_json FROM ${table} WHERE (SELECT COUNT(*) FROM ${table})<=?
      AND (SELECT COALESCE(SUM(length(CAST(${expr} AS BLOB))),0) FROM ${table})<=? ORDER BY ${rowOrder(t)} LIMIT ?`,RECOVERY_LIMITS.tableRows,budgets[index],RECOVERY_LIMITS.tableRows+1));
   });
   const snapshot=await driver.batch(statements);if(canonicalJson(snapshot[0].rows)!==descriptor.signature)return pending('private-schema-changed');
   const sourceState=snapshot[1].rows[0];if(!sourceState||sourceState.mode==='public'||!['live','ready'].includes(sourceState.status)||sourceState.write_nonce!==null)return pending('private-source-not-live');
   const data=[];
   for(let n=0;n<descriptor.tables.length;n++){
    const count=snapshot[2+n*2].rows[0],rows=snapshot[3+n*2].rows;
    if(count.n>RECOVERY_LIMITS.tableRows||count.bytes>budgets[n]||rows.length!==count.n)return pending('private-snapshot-changed-or-bound');
    data.push({...descriptor.tables[n],rows:rows.map(r=>JSON.parse(r.row_json))});
   }
   if(data.some(t=>t.name.startsWith('earn_recovered_')&&t.rows.length))return pending('private-source-is-public-recovery');
   const rowsOf=name=>{const t=data.find(t=>t.name===name);return t.rows.map(r=>objectRow(t,r));};
   const catalog=rowsOf('manifest_catalog');
   const referenced=rowsOf('app_private_artifacts').map(r=>({key:r.object_key,byteDigest:r.byte_digest,size:r.size,semanticDigest:r.semantic_digest,visibility:'private',contentType:r.content_type}));
   for(const p of rowsOf('app_artifact_publications')){const chunks=JSON.parse(p.staging_json);demand(Array.isArray(chunks),'Invalid publication staging inventory.');referenced.push(...chunks);}
   let planned;try{planned=data.map(t=>planTablePages(t));}catch(error){if(/bound/.test(error.message))return pending('private-row-page-bound');throw error;}
   const provisional=uniqueObjects([...referenced,...catalog.map(r=>({key:r.object_key,byteDigest:r.byte_digest,size:r.size_bytes,semanticDigest:null,visibility:'public',contentType:'application/json'}))]);
   const pageCount=planned.reduce((sum,pages)=>sum+pages.length,0),pageBytes=planned.flat().reduce((sum,p)=>sum+p.bytes.length,0);
   // Account BEFORE any object loop or page write: schema/preflight/snapshot
   // SQL, catalog verification, reference verification, then put+two readbacks.
   const captureOperations=3+4*data.length+catalog.length+provisional.length+3*pageCount;
   const finishOperations=16+provisional.length+2*pageCount+data.length+2*catalog.length;
   if(captureOperations>RECOVERY_LIMITS.finishOperations||finishOperations>RECOVERY_LIMITS.finishOperations||provisional.reduce((sum,i)=>sum+i.size,0)+pageBytes>RECOVERY_LIMITS.totalBytes)return pending('private-capture-operation-or-byte-bound');
   const selected=await publications(catalog);if(selected.kind!=='verified')return selected;
   let objects=uniqueObjects([...referenced,...selected.publications.map(p=>p.identity)]);
   if(objects.length>RECOVERY_LIMITS.objects||objects.reduce((sum,i)=>sum+i.size,0)>RECOVERY_LIMITS.totalBytes)return pending('private-object-inventory-bound');
   for(const i of objects){const stored=await verifyObject(artifacts,i,crypto);if(stored.kind!=='verified')return stored;}
   const tables=[];
   for(let n=0;n<data.length;n++){
    const t=data[n],pages=[];
    for(const {bytes} of planned[n]){const byteDigest=await crypto.sha256(bytes),identity={key:'private/'+byteDigest+'.json',byteDigest,semanticDigest:null,size:bytes.length,visibility:'private',contentType:'application/json'};
     const result=await persistObject(artifacts,identity,bytes,crypto);if(result.kind!=='verified')return result;pages.push(identity);
    }
    tables.push({name:t.name,columns:t.columns,primaryKey:t.primaryKey,hasRowid:t.hasRowid,rowCount:t.rows.length,rowsDigest:await hashJson(crypto,t.rows),pages});objects.push(...pages);
   }
   const audit=rowsOf('ops_config_audit');
   return captured({mode:'private',schema:expected,tables,objects:uniqueObjects(objects),publications:selected.publications,authPolicy:'revoke-sessions-and-fence-leases',
    checkpoints:{revisions:rowsOf('app_revisions'),auditHead:audit.at(-1)??null,sourceGeneration:sourceState.generation,
     sourceRecovery:{mode:sourceState.mode,status:sourceState.status,inventoryDigest:sourceState.inventory_digest},
     jobs:rowsOf('app_jobs').map(j=>({id:j.id,state:j.state,revision:j.revision,checkpointSeq:j.checkpoint_seq,dependencySeq:j.dependency_seq,attempt:j.attempt})),
     settlementSequence:Math.max(0,...rowsOf('app_settlement_dependencies').map(r=>r.sequence)),sessionsRevoked:true,financialExecution:false}});
  },
 });
}
