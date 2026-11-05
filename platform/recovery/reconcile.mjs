import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,orderedJson,utf8} from '../security/canonical.mjs';
import {claimableUnits} from '../domain/earn/index.mjs';
import {clone,demand,exact,hashJson,verifyObject,RECOVERY_LIMITS} from './inventory.mjs';
import {AUTH_TABLES,quote,rowExpression,rowOrder,objectRow} from './schema.mjs';
import {publicationPin} from './export.mjs';

export function fenceRow(table,row,{generation,createdMs}){
 row=[...row];const offset=table.hasRowid?1:0,get=name=>row[table.columns.indexOf(name)+offset],set=(name,value)=>{row[table.columns.indexOf(name)+offset]=value;};
 if(table.name==='app_jobs'&&get('state')==='running'){
  set('state','held');set('lease_token',null);set('lease_until_ms',null);set('ready_ms',null);set('reason','recovery-reconciliation');set('dependency','recovery:'+generation);set('revision',get('revision')+1);set('finished_ms',createdMs);
 }
 if(table.name==='app_job_attempts'&&get('ended_ms')===null){set('ended_ms',createdMs);set('outcome','recovery-fenced');}
 if(table.name==='app_execution_fences'){set('holder_token','recovery:'+generation);set('expires_ms',0);set('revision',get('revision')+1);}
 if(table.name==='notice_outbox'&&get('state')==='leased'){set('state','unknown');set('lease',null);set('lease_until_ms',null);set('ready_ms',null);}
 return row;
}
export async function readRecoveryPage(artifacts,identity,table,index,crypto){
 const object=await verifyObject(artifacts,identity,crypto);if(object.kind!=='verified')return object;
 const text=new TextDecoder('utf-8',{fatal:true}).decode(object.bytes),page=JSON.parse(text);
 exact(page,['format','table','index','columns','hasRowid','rows'],'recovery page');
 demand(page.format==='10x.local.recovery.table.v1'&&page.table===table.name&&page.index===index&&canonicalJson(page.columns)===canonicalJson(table.columns)&&page.hasRowid===table.hasRowid&&canonicalJson(page)===text,'Recovery page identity mismatch.');
 demand(Array.isArray(page.rows)&&page.rows.length>0&&page.rows.length<=100&&page.rows.every(row=>Array.isArray(row)&&row.length===table.columns.length+Number(table.hasRowid)&&row.every(v=>v===null||typeof v==='string'||Number.isSafeInteger(v))),'Invalid recovery row values.');
 return {kind:'verified',rows:page.rows};
}
export async function readPinnedPublication(artifacts,pin,codec,crypto){
 const object=await verifyObject(artifacts,pin.identity,crypto);if(object.kind!=='verified')return object;
 const verified=await codec.verify(object.bytes,{semanticDigest:pin.semanticDigest,byteDigest:pin.identity.byteDigest});
 demand(canonicalJson(await publicationPin(verified,codec))===canonicalJson(pin),'Public artifact differs from pinned recovery commitments.');return {kind:'verified',verified};
}

export async function reconcileRecovery({driver,artifacts,codec,crypto,inventory,generation}){
 const [stateResult,...auth]=await driver.batch([sql('SELECT * FROM app_recovery_state WHERE id=1'),...AUTH_TABLES.map(table=>sql('SELECT COUNT(*) n FROM '+quote(table)))]);
 demand(stateResult.rows[0]?.write_nonce===null,'Recovery write nonce escaped its transaction.');
 if(auth.some(r=>r.rows[0].n!==0))return {kind:'held',reason:'recovery-authentication-not-revoked'};
 for(const identity of inventory.objects){const object=await verifyObject(artifacts,identity,crypto);if(object.kind!=='verified')return {kind:'held',reason:object.reason,objectKey:object.objectKey};}
 for(const pin of inventory.publications){
  const result=await readPinnedPublication(artifacts,pin,codec,crypto);if(result.kind!=='verified')return {kind:'held',reason:result.reason};
  const [catalog]=await driver.batch([sql('SELECT * FROM manifest_catalog WHERE byte_digest=?',pin.identity.byteDigest)]),r=catalog.rows[0];
  if(!r||r.object_key!==pin.identity.key||r.size_bytes!==pin.identity.size||r.kind!=='earn-archive-v1')return {kind:'held',reason:'recovery-public-catalog-incomplete'};
  if(inventory.mode==='public'){
   const [boards,allocations]=await driver.batch([sql('SELECT * FROM earn_recovered_boards WHERE epoch=?',pin.epoch),sql('SELECT * FROM earn_recovered_allocations WHERE epoch=?',pin.epoch)]);
   if(boards.rows[0]?.board_id!==pin.boardId||canonicalJson(JSON.parse(boards.rows[0].board_json))!==canonicalJson(result.verified.manifest.board))return {kind:'held',reason:'recovery-public-board-conflict'};
   for(const a of result.verified.manifest.allocations){const saved=allocations.rows.find(r=>r.token_id===a.tokenId&&r.day===a.day);
    if(!saved||saved.allocation_id!==await codec.allocationDigest(a)||canonicalJson(JSON.parse(saved.allocation_json))!==canonicalJson(a))return {kind:'held',reason:'recovery-public-allocation-conflict'};
    const [awards]=await driver.batch([sql('SELECT wallet,amount,vests_from_ms,vests_through_ms FROM earn_recovered_awards WHERE token_id=? AND day=? ORDER BY wallet',a.tokenId,a.day)]);
    const expected=[...a.awards].sort((a,b)=>a.wallet<b.wallet?-1:1).map(w=>({wallet:w.wallet,amount:w.amountUnits,vests_from_ms:a.vestsFromMs,vests_through_ms:a.vestsThroughMs}));
    if(canonicalJson(awards.rows)!==canonicalJson(expected))return {kind:'held',reason:'recovery-public-award-conflict'};
   }
  }
 }
 if(inventory.mode==='private'){
  const data=new Map();
  for(const table of inventory.tables){
   const original=[];for(let n=0;n<table.pages.length;n++){const page=await readRecoveryPage(artifacts,table.pages[n],table,n,crypto);if(page.kind!=='verified')return {kind:'held',reason:page.reason};original.push(...page.rows);}
   if(original.length!==table.rowCount||await hashJson(crypto,original)!==table.rowsDigest)return {kind:'held',reason:'recovery-table-page-incomplete',table:table.name};
   const expected=original.map(row=>fenceRow(table,row,{generation,createdMs:inventory.createdMs}));
   const [result]=await driver.batch([sql(`SELECT ${rowExpression(table)} row_json FROM ${quote(table.name)} ORDER BY ${rowOrder(table)} LIMIT ?`,RECOVERY_LIMITS.tableRows+1)]),actual=result.rows.map(r=>JSON.parse(r.row_json));
   if(canonicalJson(expected)!==canonicalJson(actual))return {kind:'held',reason:'recovery-table-conflict',table:table.name};
   data.set(table.name,actual.map(row=>objectRow(table,row)));
  }
  let previous=null,index=0;
  for(const row of data.get('ops_config_audit')){
   const digest=await crypto.sha256(utf8(orderedJson(['10x-local-config-audit-v1',row.seq,row.previous_hash,row.category,row.entity,row.change_key,row.recorded_ms,row.actor,row.evidence_ref,JSON.parse(row.payload)])));
   if(row.seq!==++index||row.previous_hash!==previous||digest!==row.event_hash)return {kind:'held',reason:'recovery-audit-chain-conflict'};previous=row.event_hash;
  }
  if(canonicalJson(data.get('ops_config_audit').at(-1)??null)!==canonicalJson(inventory.checkpoints.auditHead))return {kind:'held',reason:'recovery-audit-checkpoint-conflict'};
  for(const board of data.get('earn_boards')){
   const winners=JSON.parse(board.winners),allocations=[];
   for(const a of data.get('earn_allocations').filter(a=>a.epoch===board.epoch)){
    const campaign=data.get('earn_fixture_campaigns').find(c=>c.token_id===a.token_id),awards=data.get('earn_awards').filter(w=>w.token_id===a.token_id&&w.day===a.day);
    if(!campaign||awards.length!==winners.length)return {kind:'held',reason:'recovery-award-conservation'};
    allocations.push({tokenId:a.token_id,day:a.day,activationMs:campaign.activation_ms,originalUnits:campaign.original_units,startsAtMs:a.starts_ms,vestsFromMs:a.vests_from_ms,vestsThroughMs:a.vests_through_ms,budgetUnits:a.budget,burnUnits:a.burn,
     awards:winners.map(w=>({wallet:w.wallet,amountUnits:awards.find(a=>a.wallet===w.wallet)?.amount}))});
   }
   try{await codec.build({board:{epoch:board.epoch,finalizedAtMs:board.finalized_ms,snapshotId:board.snapshot_hash,winners},allocations});}catch{return {kind:'held',reason:'recovery-award-conservation'};}
  }
  const [foreignKeys]=await driver.batch([sql('SELECT * FROM pragma_foreign_key_check')]);if(foreignKeys.rows.length)return {kind:'held',reason:'recovery-foreign-key-conflict'};
 }
 return {kind:'verified',mode:inventory.mode,objects:inventory.objects.length,publications:inventory.publications.length,tables:inventory.tables.length,sessionsRevoked:true,leasesFenced:inventory.mode==='private',financialExecution:false,chainStatus:'unproven'};
}

export async function readPublicRecoveredClaims(driver,{wallet,nowMs,after=0}){
 demand(typeof wallet==='string'&&wallet.length>0&&wallet.length<=256&&Number.isSafeInteger(nowMs)&&nowMs>=0&&Number.isSafeInteger(after)&&after>=0,'Invalid recovered claims query.');
 const [{rows}]=await driver.batch([sql('SELECT rowid AS cursor,token_id AS tokenId,day,amount AS awardUnits,vests_from_ms AS vestsFromMs,vests_through_ms AS vestsThroughMs FROM earn_recovered_awards WHERE wallet=? AND rowid>? ORDER BY rowid LIMIT 51',wallet,after)]);
 return {source:'public-archive',executionEnabled:false,items:rows.slice(0,50).map(({cursor,...row})=>({...row,vestedUnits:String(claimableUnits({awardedUnits:BigInt(row.awardUnits),claimedUnits:0n,window:row,nowMs}))})),nextCursor:rows.length>50?rows[49].cursor:null};
}
