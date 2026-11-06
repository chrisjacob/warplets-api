import {createRecoveryV2RecordedOutcomeReconciler,recordedOutcomeCountsSql} from './v2-reconcile-recorded-outcomes.mjs';
import {parseRecoveryV2Checkpoint} from './v2-checkpoint.mjs';
import {createRecoveryV2EconomicPlanReconciler,economicPreparationCountsSql} from './v2-reconcile-economic-plans.mjs';
import {createRecoveryV2ActionPolicyReconciler} from './v2-reconcile-action-policies.mjs';
import {createRecoveryV2LegacyMintReconciler} from './v2-reconcile-legacy-mints.mjs';
import {createRecoveryV2LegacyEconomicsReconciler} from './v2-reconcile-legacy-economics.mjs';
import {createRecoveryV2LegacyCurrentReconciler} from './v2-reconcile-legacy-current.mjs';
import {createRecoveryV2LegacyObjectReconciler} from './v2-reconcile-legacy-objects.mjs';
import {createRecoveryV2LegacyAggregateReconciler} from './v2-reconcile-legacy-aggregate.mjs';
import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,orderedJson,utf8} from '../security/canonical.mjs';
import {AUTH_TABLES,quote,objectRow} from './schema.mjs';
import {hashJson,verifyObject} from './inventory.mjs';
import {createRecoveryV2IndexReader} from './v2-traversal.mjs';
import {fenceRow,readPinnedPublication} from './reconcile.mjs';
import {createRecoveryV2FreeCutReconciler} from './v2-reconcile-free-cuts.mjs';
import {createRecoveryV2CollectionReconciler} from './v2-reconcile-collections.mjs';
import {createRecoveryV2LegacyAdoptionReconciler} from './v2-reconcile-legacy-adoptions.mjs';
import {createRecoveryV2FragmentCodec} from './v2-fragments.mjs';
import {createRecoveryV2FragmentRestore} from './v2-fragment-restore.mjs';
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
function need(c,message){if(!c)throw new TypeError(message);}
class MissingObject extends Error {}
/** One original page or bounded semantic unit per invocation. Every check is
 * committed only against the target watermark pinned after all imports/fences.
 * No source artifacts or live provider reads participate in reconciliation. */
export function createRecoveryV2Reconciler({driver,artifacts,crypto,v2Codec,codec,repository,beaconVerifier,createDigest}){
 const legacyPorts={driver,artifacts,crypto,repository,createDigest,beaconVerifier},legacyAdoptions=createRecoveryV2LegacyAdoptionReconciler({...legacyPorts,nextStagePhase:'reconcile-legacy-adoption-mints'}),legacyMints=createRecoveryV2LegacyMintReconciler({...legacyPorts,nextPhase:'reconcile-legacy-adoption-economics'}),legacyEconomics=createRecoveryV2LegacyEconomicsReconciler(legacyPorts),legacyCurrent=createRecoveryV2LegacyCurrentReconciler(legacyPorts),legacyObjects=createRecoveryV2LegacyObjectReconciler(legacyPorts),legacyAggregate=createRecoveryV2LegacyAggregateReconciler(legacyPorts);
 const collection=createRecoveryV2CollectionReconciler({driver,artifacts,crypto,beaconVerifier,repository,nextPhase:'reconcile-free-cut-records'});
 const recordedOutcomes=createRecoveryV2RecordedOutcomeReconciler({driver,artifacts,crypto,repository});
 const economicPlans=createRecoveryV2EconomicPlanReconciler({driver,artifacts,crypto,repository});
 const actionPolicies=createRecoveryV2ActionPolicyReconciler({driver,crypto,repository});
 const freeCuts=createRecoveryV2FreeCutReconciler({driver,crypto,repository,createDigest});
 const fragmentCodec=createRecoveryV2FragmentCodec({crypto}),fragments=createRecoveryV2FragmentRestore({driver,artifacts,crypto,repository});
 const reader=createRecoveryV2IndexReader({artifacts,crypto,v2Codec}),read=async statements=>(await driver.batch(statements)).map(r=>r.rows);
 async function walk(kind,pointer,cursor){const r=await reader.step({kind,pointer,cursor});if(r.kind==='pending')throw new MissingObject(r.reason);return r;}
 const checked=(loaded,c,delta,check=null)=>repository.advance(loaded,{delta,targetWatermark:c.targetWatermark,...(check?{check:{...check,targetWatermark:c.targetWatermark}}:{})});
 async function objectCheck(identity){return {phase:'objects',scope:identity.key,ordinal:0,resultDigest:await hashJson(crypto,['v2-reconciled-object',identity]),itemCount:identity.size};}
 async function object(loaded,c){
  if(c.pendingObject){const verified=await verifyObject(artifacts,c.pendingObject,crypto);if(verified.kind!=='verified')throw new MissingObject(verified.reason);return checked(loaded,c,{pendingObject:null},await objectCheck(c.pendingObject));}
  const result=await walk('objects',c.root.objects,c.objectCursor),delta={objectCursor:result.cursor};if(result.kind==='entry')delta.pendingObject=result.value;if(result.kind==='done')Object.assign(delta,{phase:'reconcile-table-metadata',tableCursor:null,checkedTableDescriptors:0});return checked(loaded,c,delta,result.metadata?await objectCheck(result.metadata.identity):null);
 }
 async function metadata(loaded,c){
  const result=await walk('tables',c.root.tables,c.tableCursor),delta={tableCursor:result.cursor};if(result.kind==='entry'){await v2Codec.verifyTableDescriptor(result.value);need(same(result.value,c.tables[c.checkedTableDescriptors]),'Reconciled table descriptor mismatch.');delta.checkedTableDescriptors=c.checkedTableDescriptors+1;}
  if(result.kind==='done'){need(c.checkedTableDescriptors===c.tables.length,'Reconciled table descriptor count mismatch.');Object.assign(delta,{phase:'reconcile-tables',objectCursor:null,publicationCursor:null,tableCursor:null,tableIndex:0,pageCursor:null,pageIndex:0,lastCursor:null,reconciledRows:0,activePage:null,checkedTables:0,auditSequence:0,auditHash:null});}
  return checked(loaded,c,delta,result.metadata?await objectCheck(result.metadata.identity):null);
 }
 function targetRows(table,entry){
  const keys=table.hasRowid?['rowid']:table.primaryKey.map(quote),fields=[...(table.hasRowid?['rowid']:[]),...table.columns.map(quote)],expr=`json_array(${fields.join(',')})`,rawBytes=fields.map(f=>`COALESCE(length(CAST(${f} AS BLOB)),0)`).join('+'),tuple=keys.length===1?keys[0]:'('+keys.join(',')+')',marks=keys.length===1?'?':'('+keys.map(()=>'?').join(',')+')',where=(entry.after===null?'':`${tuple}>${marks} AND `)+`${tuple}<=${marks}`,order=keys.map((_,n)=>'k'+n).join(',');
  return sql(`WITH candidates AS (SELECT ${keys.map((k,n)=>`${k} k${n}`).join(',')},CASE WHEN (${rawBytes})<=262144 THEN ${expr} ELSE NULL END raw_json FROM ${quote(table.name)} WHERE ${where} ORDER BY ${keys.join(',')} LIMIT 101),sized AS (SELECT *,SUM(COALESCE(length(CAST(raw_json AS BLOB)),262145)+1) OVER(ORDER BY ${order}) total_bytes FROM candidates) SELECT CASE WHEN total_bytes<=262144 THEN raw_json ELSE NULL END row_json FROM sized ORDER BY ${order}`,...(entry.after??[]),...entry.last);
 }
 async function retireTables(loaded,c,phase){
  const count=c.root.tables.count;
  need(Array.isArray(c.tables)&&c.tables.length===count&&c.checkedTableDescriptors===count&&c.checkedTables===count&&c.tableIndex===count,'Recovery table retirement count mismatch.');
  const [proofs]=await read([sql("SELECT CASE WHEN length(CAST(scope AS BLOB))<=128 THEN scope END scope,ordinal,item_count,CASE WHEN length(result_digest)=64 THEN result_digest END result_digest FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='table-counts' AND target_watermark=? ORDER BY scope LIMIT ?",loaded.run.id,c.targetWatermark,count+1)]);
  need(proofs.length===count&&new Set(proofs.map(p=>p.scope)).size===count,'Recovery complete table proofs missing.');
  let rows=0;for(const descriptor of c.tables){const proof=proofs.find(p=>p.scope===descriptor.name);need(proof&&proof.ordinal===0&&proof.item_count===descriptor.rowCount&&proof.result_digest===await hashJson(crypto,['v2-reconciled-table',descriptor.tableDigest,descriptor.rowCount]),'Recovery table proof binding mismatch.');rows+=descriptor.rowCount;}
  need(rows===c.root.totals.rows,'Recovery table retirement row mismatch.');
  return checked(loaded,c,{phase,tables:null},{phase:'table-inventory',scope:'complete',ordinal:0,resultDigest:await hashJson(crypto,['v2-reconciled-table-inventory',c.root.tables,c.root.totals.rows]),itemCount:count});
 }
 async function table(loaded,c){
  const descriptor=c.tables[c.tableIndex];if(!descriptor)return retireTables(loaded,c,'reconcile-audit');
  if(c.activePage){
   const entry=c.activePage,object=await verifyObject(artifacts,entry.identity,crypto);if(object.kind!=='verified')throw new MissingObject(object.reason);
   if(JSON.parse(new TextDecoder().decode(object.bytes)).format==='10x.local.recovery.fragmented-row.v2')return fragments.reconcilePage(loaded,c,descriptor,await fragmentCodec.verifyRowDescriptor(object.bytes,entry.identity));
   const page=await v2Codec.verifyRows(object.bytes,entry.identity);
   need(page.table===descriptor.name&&page.index===c.pageIndex&&same(page.columns,descriptor.columns)&&page.hasRowid===descriptor.hasRowid&&same(page.after,c.lastCursor)&&page.rows.length===entry.rowCount,'Reconciliation page identity mismatch.');
   const [rows]=await read([targetRows(descriptor,entry)]);need(rows.length===page.rows.length&&rows.every(r=>typeof r.row_json==='string'),'Reconciliation target page missing, extra or oversized.');const actual=rows.map(r=>JSON.parse(r.row_json)),expected=page.rows.map(row=>fenceRow(descriptor,row,{generation:loaded.state.generation,createdMs:c.root.createdMs}));need(same(actual,expected),'Reconciliation target rows differ from exact fenced source.');
   const delta={activePage:null,pageIndex:c.pageIndex+1,lastCursor:entry.last,reconciledRows:c.reconciledRows+actual.length};
   if(descriptor.name==='ops_config_audit'){
    let sequence=c.auditSequence,previous=c.auditHash;for(const values of actual){const row=objectRow(descriptor,values),digest=await crypto.sha256(utf8(orderedJson(['10x-local-config-audit-v1',row.seq,row.previous_hash,row.category,row.entity,row.change_key,row.recorded_ms,row.actor,row.evidence_ref,JSON.parse(row.payload)])));need(row.seq===++sequence&&row.previous_hash===previous&&digest===row.event_hash,'Recovery audit chain conflict.');previous=row.event_hash;}delta.auditSequence=sequence;delta.auditHash=previous;
   }
   return checked(loaded,c,delta,{phase:'table-pages',scope:descriptor.name,ordinal:c.pageIndex,resultDigest:await hashJson(crypto,['v2-reconciled-page',descriptor.tableDigest,c.pageIndex,actual]),itemCount:actual.length});
  }
  const result=await walk('table-pages',descriptor.pages,c.pageCursor),delta={pageCursor:result.cursor};
  if(result.kind==='entry'){need(result.value.index===c.pageIndex&&same(result.value.after,c.lastCursor),'Reconciliation page sequence mismatch.');delta.activePage=result.value;}
  if(result.kind==='done'){
   const [rows]=await read([sql('SELECT COUNT(*) n FROM '+quote(descriptor.name))]);need(rows[0]?.n===descriptor.rowCount&&c.reconciledRows===descriptor.rowCount&&c.pageIndex===descriptor.pages.count,'Reconciliation exact table count mismatch.');
   Object.assign(delta,{tableIndex:c.tableIndex+1,pageCursor:null,pageIndex:0,lastCursor:null,reconciledRows:0,activePage:null,checkedTables:c.checkedTables+1});return checked(loaded,c,delta,{phase:'table-counts',scope:descriptor.name,ordinal:0,resultDigest:await hashJson(crypto,['v2-reconciled-table',descriptor.tableDigest,descriptor.rowCount]),itemCount:descriptor.rowCount});
  }
  return checked(loaded,c,delta,result.metadata?await objectCheck(result.metadata.identity):null);
 }
 async function publications(loaded,c){
  if(c.pendingPublication){const verified=await readPinnedPublication(artifacts,c.pendingPublication,codec,crypto);if(verified.kind!=='verified')throw new MissingObject(verified.reason);const [rows]=await read([sql('SELECT * FROM manifest_catalog WHERE byte_digest=?',c.pendingPublication.identity.byteDigest)]),catalog=rows[0];need(catalog?.kind==='earn-archive-v1'&&catalog.object_key===c.pendingPublication.identity.key&&catalog.size_bytes===c.pendingPublication.identity.size,'Recovery public catalog identity mismatch.');return checked(loaded,c,{pendingPublication:null,checkedPublications:c.checkedPublications+1},{phase:'publications',scope:c.pendingPublication.identity.key,ordinal:0,resultDigest:await hashJson(crypto,['v2-reconciled-publication',c.pendingPublication]),itemCount:1});}
  const result=await walk('publications',c.root.publications,c.publicationCursor),delta={publicationCursor:result.cursor};if(result.kind==='entry')delta.pendingPublication=result.value;if(result.kind==='done'){need(c.checkedPublications===c.root.publications.count,'Recovery publication count mismatch.');delta.phase='reconcile-checkpoints';}return checked(loaded,c,delta,result.metadata?await objectCheck(result.metadata.identity):null);
 }
 async function economics(loaded,c){
  const active=c.economicBoardRowid!==undefined&&c.economicBoardRowid!==null;
  const [rows]=await read([sql(`SELECT rowid recovery_cursor,epoch,finalized_ms,snapshot_hash,CASE WHEN length(CAST(winners AS BLOB))<=131072 THEN winners ELSE NULL END winners FROM earn_boards WHERE rowid${active?'=':'>'}? ORDER BY rowid LIMIT 1`,active?c.economicBoardRowid:c.boardCursor??-9007199254740991)]);
  if(!rows.length){need(!active,'Recovery active board disappeared.');const [count]=await read([sql('SELECT COUNT(*) n FROM earn_boards')]);need(count[0].n===c.checkedBoards,'Recovery board count mismatch.');return checked(loaded,c,{phase:'reconcile-legacy-adoptions',legacyAdoptionCursor:-9007199254740991,checkedLegacyAdoptions:0},{phase:'economics-count',scope:'boards',ordinal:0,resultDigest:await hashJson(crypto,['v2-reconciled-board-count',c.checkedBoards]),itemCount:c.checkedBoards});}
  const board=rows[0];need(typeof board.winners==='string','Recovery board exceeds reconciliation bound.');const winners=JSON.parse(board.winners);need(Array.isArray(winners)&&winners.length<=100,'Recovery winner bound.');const publicBoard={epoch:board.epoch,finalizedAtMs:board.finalized_ms,snapshotId:board.snapshot_hash,winners};
  if(!active){const [counts]=await read([sql('SELECT COUNT(*) n FROM earn_allocations WHERE epoch=?',board.epoch)]);need(counts[0].n<=32,'Recovery allocation count bound.');const bundle=await codec.build({board:publicBoard,allocations:[]});return checked(loaded,c,{economicBoardRowid:board.recovery_cursor,allocationCursor:-9007199254740991,checkedAllocations:0,expectedAllocations:counts[0].n},{phase:'economic-boards',scope:String(board.epoch),ordinal:0,resultDigest:bundle.semanticDigest,itemCount:1});}
  const [allocations]=await read([sql(`SELECT a.rowid recovery_cursor,CASE WHEN length(CAST(a.token_id AS BLOB))<=256 THEN a.token_id ELSE NULL END token_id,a.day,a.starts_ms,a.vests_from_ms,a.vests_through_ms,
   CASE WHEN length(a.budget)<=80 THEN a.budget ELSE NULL END budget,CASE WHEN length(a.burn)<=80 THEN a.burn ELSE NULL END burn,c.activation_ms campaign_activation,
   CASE WHEN length(c.original_units)<=20 THEN c.original_units ELSE NULL END campaign_units FROM earn_allocations a LEFT JOIN earn_fixture_campaigns c ON c.token_id=a.token_id WHERE a.epoch=? AND a.rowid>? ORDER BY a.rowid LIMIT 1`,board.epoch,c.allocationCursor)]);
  if(!allocations.length){need(c.checkedAllocations===c.expectedAllocations,'Recovery allocation count mismatch.');return checked(loaded,c,{boardCursor:board.recovery_cursor,economicBoardRowid:null,checkedBoards:c.checkedBoards+1},{phase:'allocation-counts',scope:String(board.epoch),ordinal:0,resultDigest:await hashJson(crypto,['v2-reconciled-allocation-count',board.epoch,c.checkedAllocations]),itemCount:c.checkedAllocations});}
  const a=allocations[0];need(typeof a.token_id==='string'&&typeof a.campaign_units==='string'&&typeof a.budget==='string'&&typeof a.burn==='string','Recovery allocation input bound.');
  const [awards]=await read([sql('SELECT CASE WHEN length(CAST(wallet AS BLOB))<=256 THEN wallet ELSE NULL END wallet,CASE WHEN length(amount)<=80 THEN amount ELSE NULL END amount FROM earn_awards WHERE token_id=? AND day=? ORDER BY wallet LIMIT 101',a.token_id,a.day)]);
  need(awards.length===winners.length&&awards.every(w=>typeof w.wallet==='string'&&typeof w.amount==='string'),'Recovery award conservation.');
  const allocation={tokenId:a.token_id,day:a.day,activationMs:a.campaign_activation,originalUnits:a.campaign_units,startsAtMs:a.starts_ms,vestsFromMs:a.vests_from_ms,vestsThroughMs:a.vests_through_ms,budgetUnits:a.budget,burnUnits:a.burn,awards:winners.map(w=>({wallet:w.wallet,amountUnits:awards.find(a=>a.wallet===w.wallet)?.amount}))},input={board:publicBoard,allocations:[allocation]};
  need(utf8(canonicalJson({board,allocation:a,awards})).length<=262144&&utf8(canonicalJson(input)).length<=262144,'Recovery economic serialized input bound.');const bundle=await codec.build(input);
  return checked(loaded,c,{allocationCursor:a.recovery_cursor,checkedAllocations:c.checkedAllocations+1},{phase:'economics',scope:canonicalJson([a.token_id,a.day]),ordinal:0,resultDigest:bundle.semanticDigest,itemCount:awards.length});
 }
 async function final(loaded,c){
  const [foreignKeys,auth,objects,tables,publications,copied,retired]=await read([sql('SELECT * FROM pragma_foreign_key_check LIMIT 1'),sql('SELECT '+AUTH_TABLES.map((name,n)=>`(SELECT COUNT(*) FROM ${quote(name)}) n${n}`).join(',')),sql("SELECT COUNT(*) n,COALESCE(SUM(item_count),0) bytes FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='objects' AND target_watermark=?",loaded.run.id,c.targetWatermark),sql("SELECT COUNT(*) n,COALESCE(SUM(item_count),0) rows FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='table-counts' AND target_watermark=?",loaded.run.id,c.targetWatermark),sql("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='publications' AND target_watermark=?",loaded.run.id,c.targetWatermark),sql("SELECT COUNT(*) n FROM app_recovery_pages WHERE restore_id=? AND table_name='object'",loaded.run.id),sql("SELECT item_count,result_digest FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='table-inventory' AND scope='complete' AND ordinal=0 AND target_watermark=?",loaded.run.id,c.targetWatermark)]);
  need(foreignKeys.length===0,'Recovery foreign-key conflict.');need(Object.values(auth[0]).every(n=>n===0),'Recovery authentication not revoked.');need(objects[0].n===c.root.totals.objects&&objects[0].bytes===c.root.totals.bytes&&copied[0].n===c.root.totals.objects,'Recovery exact object graph totals mismatch.');need(c.tables===null&&c.checkedTableDescriptors===c.root.tables.count&&tables[0].n===c.root.tables.count&&tables[0].rows===c.root.totals.rows&&c.checkedTables===c.root.tables.count&&retired.length===1&&retired[0].item_count===c.root.tables.count&&retired[0].result_digest===await hashJson(crypto,['v2-reconciled-table-inventory',c.root.tables,c.root.totals.rows]),'Recovery complete table reconciliation missing.');need(publications[0].n===c.root.publications.count&&c.checkedPublications===c.root.publications.count,'Recovery complete publication checks missing.');
  const [actionPolicyProofs]=await read([sql("SELECT (SELECT COUNT(*) FROM app_command_receipts WHERE operation_kind='earn.configure-action.v1') expected,COUNT(*) checked,COALESCE(SUM(item_count),0) items FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='action-policy' AND target_watermark=?",loaded.run.id,c.targetWatermark)]);
  need(actionPolicyProofs[0].expected===actionPolicyProofs[0].checked&&actionPolicyProofs[0].expected===actionPolicyProofs[0].items,'Recovery action policy proofs incomplete.');
  const [economicCounts,economicProofs,economicComplete]=await read([economicPreparationCountsSql(),sql("SELECT COUNT(*) n,COALESCE(SUM(item_count),0) items FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='economic-preparation' AND target_watermark=?",loaded.run.id,c.targetWatermark),sql("SELECT result_digest,item_count FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='economic-preparation-count' AND scope='complete' AND ordinal=0 AND target_watermark=?",loaded.run.id,c.targetWatermark)]);
  const n=economicCounts[0];need(c.economicPreparationsComplete===true&&c.checkedEconomicPreparations===n.receipts&&n.preparations===n.preparation_origins&&n.intents===n.intent_origins&&economicProofs[0].n===n.receipts&&economicProofs[0].items===n.receipts&&economicComplete.length===1&&economicComplete[0].item_count===n.receipts&&economicComplete[0].result_digest===await hashJson(crypto,['v2-economic-preparation-count',n]),'Recovery economic preparation proofs incomplete.');
  const [outcomeCounts,outcomeProofs,outcomeComplete]=await read([recordedOutcomeCountsSql(),sql("SELECT phase,COUNT(*) n,COALESCE(SUM(item_count),0) items FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase IN ('recorded-outcome-history','recorded-outcome','recorded-outcome-intent') AND target_watermark=? GROUP BY phase",loaded.run.id,c.targetWatermark),sql("SELECT result_digest,item_count FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='recorded-outcome-count' AND scope='complete' AND ordinal=0 AND target_watermark=?",loaded.run.id,c.targetWatermark)]);
  const oc=outcomeCounts[0],op=phase=>outcomeProofs.find(r=>r.phase===phase)??{n:0,items:0};need(c.recordedOutcomesComplete===true&&oc.receipts===oc.outcomes&&op('recorded-outcome').n===oc.outcomes&&op('recorded-outcome').items===oc.outcomes&&op('recorded-outcome-history').n===oc.intents&&op('recorded-outcome-intent').n===oc.intents&&op('recorded-outcome-intent').items===oc.outcomes&&outcomeComplete.length===1&&outcomeComplete[0].item_count===oc.outcomes&&outcomeComplete[0].result_digest===await hashJson(crypto,['v2-recorded-outcome-count',oc]),'Recovery recorded outcome proofs incomplete.');
  const report={kind:'verified',mode:'private',objects:c.root.totals.objects,publications:c.root.publications.count,tables:c.root.tables.count,sessionsRevoked:true,leasesFenced:true,financialExecution:false,chainStatus:'unproven'},digest=await hashJson(crypto,['v2-reconciled-target',loaded.run.id,loaded.state.generation,c.targetWatermark,report]);
  return checked(loaded,c,{phase:'final-ready',finalDigest:digest,finalReport:report},{phase:'final',scope:'target',ordinal:0,resultDigest:digest,itemCount:c.root.totals.rows});
 }
 async function step(loaded){const c=parseRecoveryV2Checkpoint(loaded.run.checkpoint_json);try{
  // Resume old post-table checkpoints by proving completion before retirement.
  if(Array.isArray(c.tables)&&!['reconcile-objects','reconcile-table-metadata','reconcile-tables'].includes(c.phase))return await retireTables(loaded,c,c.phase);
  // These traversals are complete before table reconciliation. Their immutable
  // object/descriptor proofs remain retained; later publication replay starts anew.
  if(c.phase==='reconcile-objects'&&[c.publicationCursor,c.tableCursor].some(v=>v!=null))return await checked(loaded,c,{publicationCursor:null,tableCursor:null});
  if(c.phase==='reconcile-tables'&&[c.objectCursor,c.publicationCursor,c.tableCursor].some(v=>v!=null))return await checked(loaded,c,{objectCursor:null,publicationCursor:null,tableCursor:null});
  if(c.phase==='reconcile-legacy-adoption-mints')return await legacyMints.step(loaded,c);
   if(c.phase==='reconcile-legacy-adoption-economics')return await legacyEconomics.step(loaded,c);
   if(c.phase==='reconcile-legacy-adoption-current')return await legacyCurrent.step(loaded,c);
   if(c.phase==='reconcile-legacy-adoption-closure')return await legacyObjects.step(loaded,c);
   if(c.phase==='reconcile-legacy-adoption-aggregate')return await legacyAggregate.step(loaded,c);
   if(c.phase.startsWith('reconcile-legacy-adoption'))return await legacyAdoptions.step(loaded,c);
  if(c.phase.startsWith('reconcile-free-cut-'))return await freeCuts.step(loaded,c);
  if(c.phase.startsWith('reconcile-collection-'))return await collection.step(loaded,c);
  if(c.phase==='reconcile-objects')return await object(loaded,c);if(c.phase==='reconcile-table-metadata')return await metadata(loaded,c);if(c.phase==='reconcile-tables')return await table(loaded,c);
  if(c.phase==='reconcile-action-policies')return await actionPolicies.step(loaded,c);
  if(c.phase==='reconcile-audit')return await checked(loaded,c,{phase:'reconcile-action-policies',actionPolicyCursor:-9007199254740991,checkedActionPolicies:0},{phase:'audit',scope:'config',ordinal:0,resultDigest:await hashJson(crypto,['v2-reconciled-audit',c.auditSequence,c.auditHash]),itemCount:c.auditSequence});
  if(c.phase==='reconcile-checkpoints'){const object=await verifyObject(artifacts,c.root.checkpoints,crypto);if(object.kind!=='verified')throw new MissingObject(object.reason);const text=new TextDecoder('utf-8',{fatal:true}).decode(object.bytes),checkpoint=JSON.parse(text);need(canonicalJson(checkpoint)===text&&Object.keys(checkpoint).length===6&&checkpoint.format==='10x.local.recovery.checkpoints.v2'&&checkpoint.sourceGeneration===c.root.snapshot.generation&&same(checkpoint.tables,c.root.tables)&&checkpoint.sessionsRevoked===true&&checkpoint.financialExecution===false&&checkpoint.sourceRecovery&&Object.keys(checkpoint.sourceRecovery).length===3&&['live','private'].includes(checkpoint.sourceRecovery.mode)&&['live','ready'].includes(checkpoint.sourceRecovery.status),'Recovery source checkpoint binding mismatch.');return await checked(loaded,c,{phase:'reconcile-final'},await objectCheck(c.root.checkpoints));}
  if(c.phase==='reconcile-economic-preparations')return await economicPlans.step(loaded,c);
  if(c.phase==='reconcile-economics'&&!c.economicPreparationsComplete)return await checked(loaded,c,{phase:'reconcile-economic-preparations',economicPreparationCursor:-9007199254740991,checkedEconomicPreparations:0});
  if(c.phase==='reconcile-recorded-outcomes')return await recordedOutcomes.step(loaded,c);
  if(c.phase==='reconcile-economics'&&!c.recordedOutcomesComplete)return await checked(loaded,c,{phase:'reconcile-recorded-outcomes',recordedOutcomeIntent:null,recordedOutcomeHistory:null});
  if(c.phase==='reconcile-economics')return await economics(loaded,c);if(c.phase==='reconcile-publications')return await publications(loaded,c);if(c.phase==='reconcile-final')return await final(loaded,c);return {kind:'conflict',code:'recovery-not-reconciling'};
 }catch(error){return error instanceof MissingObject?{kind:'conflict',code:error.message}:repository.hold(loaded,'recovery-reconciliation-invalid:'+error.message);}}
 return Object.freeze({step});
}
