import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {period,pressureFromRows,decisionFromRows} from '../operations/portable-controls.mjs';
import {buildCollectionCutCommand,STAGE_COLLECTION_CUT_RECORD as STAGE,BEGIN_COLLECTION_FREE_CUT as BEGIN,VALIDATE_COLLECTION_CUT_PAGE as PAGE,SEAL_COLLECTION_FREE_CUT as SEAL} from './free-cut-service.mjs';
import {captureCollectionCutRecord,prepareCollectionCutRecord,collectionCutAttemptId,prepareCollectionCutPage,prepareCollectionCutSeal} from './free-cut-codec.mjs';
const clone=v=>JSON.parse(canonicalJson(v)),pending=reason=>({kind:'pending',reason,dependencyIds:[]}),conflict=code=>({kind:'conflict',code});
const grant="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='collection-evidence' AND enabled=1)";
const bounded=(column,n,alias=column.split('.').at(-1))=>`CASE WHEN length(CAST(${column} AS BLOB))<=${n} THEN ${column} ELSE NULL END ${alias}`;
const time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,79})$/.test(v);
const raw=r=>({id:r.id,size:r.size,bytes:utf8(r.body_json)});
function operating(scope,usage,spend,now){
 if(scope.length>1||scope.some(r=>![0,1].includes(r.paused)||!time(r.at_ms)||r.at_ms>now)||usage.some(r=>typeof r.provider!=='string'||!r.provider||!decimal(r.measured)||!time(r.at_ms)||r.at_ms>now||!['new-monthly-usd','daily-provider-units'].includes(r.metric)||(r.metric==='daily-provider-units'&&(!decimal(r.quota)||BigInt(r.quota)===0n)))||spend.some(r=>!['reserved','settled'].includes(r.status)||!time(r.at_ms)||r.at_ms>now||!decimal(r.limit_usd_micros)||(r.status==='settled'&&(!decimal(r.actual_usd_micros)||!time(r.settled_ms)||r.settled_ms>now))))return {allowed:false,reason:'operating-input-invalid'};
 return decisionFromRows('collection-mint',scope[0],pressureFromRows(usage,spend,now));
}
/** Private fixture source closure only. Each named operation independently
 * verifies stored inputs; no caller-prepared plan is an authority capability. */
export function createCollectionCutRepository(driver,ports){
 const {crypto,clock}=ports,{read,replay,execute}=createAtomicReceipts(driver,ports),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 async function run(value,recordValue){
  const c=clone(value),record=recordValue===undefined?null:captureCollectionCutRecord(recordValue);
  if(canonicalJson(c)!==canonicalJson(await buildCollectionCutCommand(c.operationKind,c.principal,{requestKey:c.requestKey,...c.input},crypto)))throw new TypeError('Cut command identity mismatch.');
  const prior=await replay(c);if(prior)return prior;const now=clock.nowMs();if(!time(now)||now>8640000000000000-30000)return pending('cut-clock-unavailable');
  const isRecord=c.operationKind===STAGE,isBegin=c.operationKind===BEGIN,isPage=c.operationKind===PAGE,isSeal=c.operationKind===SEAL;
  const rootSelector=isRecord||isBegin?'r.id=?':'r.id=(SELECT root_id FROM app_collection_cut_attempts WHERE id=?)',rootParameter=isRecord?c.input.id:isBegin?c.input.rootId:c.input.attemptId;
  const [rs,grants,scope,usage,spend,records,attempts]=await read([
   sql('SELECT name,CAST(revision AS TEXT) revision FROM app_revisions ORDER BY name'),
   sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='collection-evidence'",c.principal.id),
   sql("SELECT revision,paused,at_ms FROM ops_scope_log WHERE scope='collection-mint' ORDER BY at_ms DESC LIMIT 1"),
   sql(`SELECT ${bounded('provider',128)},metric,period,at_ms,${bounded('measured',80)},${bounded('quota',80)} FROM ops_usage u WHERE NOT EXISTS(SELECT 1 FROM ops_usage n WHERE n.provider=u.provider AND n.metric=u.metric AND (u.metric='new-monthly-usd' OR n.period=u.period) AND n.at_ms>u.at_ms) AND (u.metric='new-monthly-usd' OR u.period=?) ORDER BY u.provider LIMIT 101`,period(now)),
   sql(`SELECT at_ms,status,settled_ms,${bounded('limit_usd_micros',80)},${bounded('actual_usd_micros',80)} FROM ops_optional_spend WHERE status='reserved' OR COALESCE(settled_ms,at_ms)>=? LIMIT 101`,Date.parse(period(now,true)+'-01T00:00:00Z')),
   sql(`SELECT r.id,r.size,r.format,${bounded('r.body_json',65536)} FROM app_collection_cut_records r WHERE ${rootSelector}`,rootParameter),
   sql('SELECT id,root_id,CAST(source_revision AS TEXT) source_revision,created_ms FROM app_collection_cut_attempts WHERE id=?',isRecord||isBegin?null:c.input.attemptId),
  ]);
  if(grants[0]?.enabled!==1)return conflict('operator_scope_required');
  if(rs.length!==3||new Set(rs.map(r=>r.name)).size!==3||rs.some(r=>!['earn','source','control'].includes(r.name)||!decimal(r.revision)||!Number.isSafeInteger(Number(r.revision))))return pending('cut-revisions-unavailable');const version=revisions(rs);
  const decision=operating(scope,usage,spend,now);if(decision?.allowed!==true)return pending(decision?.reason??'operating-decision-unavailable');
  const authority=[grant,`${nowSql}>=? AND ${nowSql}<=?`,"COALESCE((SELECT paused FROM ops_scope_log WHERE scope='collection-mint' ORDER BY at_ms DESC LIMIT 1),0)=0"],values=[c.principal.id,now,now+30000];
  const commit=(result,resultRef,child,extra=[],extraValues=[])=>execute({...c,nowMs:now,expectedRevisions:version},{businessKey:c.businessIdentity,input:c.input,result,resultRef,version,authoritySql:[...authority,...extra].join(' AND '),authorityValues:[...values,...extraValues],child});
  if(isRecord){
   if(records.length)return conflict('cut_record_already_staged');if(!record||record.id!==c.input.id)throw new TypeError('Cut record binding mismatch.');
   const verified=await prepareCollectionCutRecord(record,crypto),result={id:verified.id,format:verified.format,size:verified.size,source:'local-fixture',executable:false};
   return commit(result,verified.id,(gate,p)=>[sql(`INSERT INTO app_collection_cut_records(id,format,size,body_json,operation_id) SELECT ?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,verified.id,verified.format,verified.size,verified.bodyJson,...p,...p)],['NOT EXISTS(SELECT 1 FROM app_collection_cut_records WHERE id=?)'],[verified.id]);
  }
  const r=records[0],a=attempts[0];if(!r||r.body_json===null)return pending('cut-root-missing-or-bound');
  let verified;try{verified=await prepareCollectionCutRecord(raw(r),crypto);}catch(e){return pending(e.code??'cut-root-invalid');}if(verified.format!=='collection-cut-root-v1'||verified.format!==r.format)return pending('cut-root-kind');const b=verified.body;
  if(!isBegin&&(!a||a.root_id!==r.id||!time(a.created_ms)||a.created_ms<b.atMs||a.created_ms>now))return pending('cut-attempt-missing');
  if(!isBegin&&a.source_revision!==version.source)return conflict('revision_conflict');
  const [stages,lists,existing,oldAttempts,pageRows,storedSummaries,inputClosure]=await read([
   sql('SELECT s.inventory_id,s.stage_id,s.stage_type,s.opens_ms,s.terms_digest,s.eligibility_kind,s.list_id,h.kind FROM app_collection_stages s JOIN collect_inventories h ON h.id=s.inventory_id WHERE s.inventory_id=? AND s.stage_id=?',b.inventoryId,b.stageId),
   sql(`SELECT id,member_count,${bounded('wallets_digest',64)},CASE WHEN length(CAST(page_ids_json AS BLOB))<=16384 THEN json_array_length(page_ids_json) ELSE NULL END page_count,
    (SELECT COUNT(*) FROM json_each(CASE WHEN length(CAST(l.page_ids_json AS BLOB))<=16384 THEN l.page_ids_json ELSE '[]' END) j JOIN app_collection_eligibility_pages p ON p.record_id=j.value) indexed_pages,
    (SELECT COALESCE(SUM(p.entry_count),0) FROM json_each(CASE WHEN length(CAST(l.page_ids_json AS BLOB))<=16384 THEN l.page_ids_json ELSE '[]' END) j JOIN app_collection_eligibility_pages p ON p.record_id=j.value) indexed_count FROM app_collection_list_seals l WHERE id=?`,b.eligibilityListId),
   sql('SELECT root_id,attempt_id FROM app_collection_free_cuts WHERE inventory_id=? AND stage_id=?',b.inventoryId,b.stageId),
   sql('SELECT id FROM app_collection_cut_attempts WHERE root_id=? AND source_revision=?',r.id,Number(version.source)),
   sql(`SELECT id,size,format,${bounded('body_json',65536)} FROM app_collection_cut_records WHERE id=?`,isPage?b.pages[c.input.pageIndex]?.id??null:null),
   sql(`SELECT page_index,page_id,holding_count,tracked_count,first_asset,last_asset,${bounded('eligible_wallets_json',8192)},closure_digest FROM app_collection_cut_pages WHERE attempt_id=? ORDER BY page_index LIMIT 101`,isSeal?c.input.attemptId:null),
   sql(`SELECT COUNT(p.id) available FROM app_collection_cut_records r,json_each(r.body_json,'$.pages') d JOIN app_collection_cut_records p ON p.id=json_extract(d.value,'$.id') AND p.format='collection-cut-page-v1' AND json_extract(p.body_json,'$.index')=d.key AND json_array_length(p.body_json,'$.holdings')=json_extract(d.value,'$.count') WHERE r.id=?`,r.id),
  ]);
  const s=stages[0],l=lists[0];if(!s||s.kind!=='season'||s.stage_type!=='free'||s.eligibility_kind!=='pending'||s.list_id!==null||s.opens_ms!==b.atMs||s.terms_digest!==b.termsDigest||now<b.atMs)return pending('cut-stage-binding');
  if(!l||l.page_count===null||l.page_count<1||l.page_count>100||l.indexed_pages!==l.page_count||l.indexed_count!==l.member_count||l.wallets_digest===null)return pending('cut-indexed-list-missing');
  if(existing.length)return conflict('free_cut_already_sealed');
  if(inputClosure[0]?.available!==b.pages.length)return pending('cut-input-pages-missing');
  authority.push('EXISTS(SELECT 1 FROM app_collection_cut_records WHERE id=? AND body_json=?)',"EXISTS(SELECT 1 FROM app_collection_stages WHERE inventory_id=? AND stage_id=? AND terms_digest=? AND opens_ms=? AND stage_type='free')",'NOT EXISTS(SELECT 1 FROM app_collection_free_cuts WHERE inventory_id=? AND stage_id=?)');values.push(r.id,r.body_json,b.inventoryId,b.stageId,b.termsDigest,b.atMs,b.inventoryId,b.stageId);
  if(isBegin){
   if(oldAttempts.length)return conflict('cut_attempt_already_exists');const attemptId=await collectionCutAttemptId(r.id,version.source,crypto),result={attemptId,rootId:r.id,sourceRevision:version.source,inventoryId:b.inventoryId,stageId:b.stageId,atMs:b.atMs,source:'local-fixture',executable:false};
   return commit(result,attemptId,(gate,p)=>[sql(`INSERT INTO app_collection_cut_attempts(id,root_id,source_revision,created_ms,operation_id) SELECT ?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,attemptId,r.id,Number(version.source),now,...p,...p)],['NOT EXISTS(SELECT 1 FROM app_collection_cut_attempts WHERE root_id=? AND source_revision=?)'],[r.id,Number(version.source)]);
  }
  const attempt={id:a.id,rootId:a.root_id,sourceRevision:a.source_revision};authority.push('EXISTS(SELECT 1 FROM app_collection_cut_attempts WHERE id=? AND root_id=? AND source_revision=?)');values.push(a.id,r.id,Number(version.source));
  if(isPage){
   const pr=pageRows[0];if(!pr||pr.body_json===null)return pending('cut-page-missing-or-bound');let page;try{page=await prepareCollectionCutRecord(raw(pr),crypto);}catch(e){return pending(e.code??'cut-page-invalid');}if(page.format!=='collection-cut-page-v1'||page.format!==pr.format||page.body.index!==c.input.pageIndex)return pending('cut-page-binding');
   const index=c.input.pageIndex,lower=index===0?null:b.pages[index-1].lastAsset,upper=index===b.pages.length-1?null:b.pages[index].lastAsset;
   const [trackedRows,known,oldPages]=await read([
    sql(`WITH tracked AS (SELECT a.id,a.bind_ms,a.reveal_ms,CASE WHEN length(CAST(a.asset AS BLOB))<=16384 AND json_valid(a.asset) THEN json_extract(a.asset,'$.level') ELSE NULL END level FROM collect_assets a JOIN collect_inventories i ON i.id=a.inventory_id WHERE i.kind='genesis' AND a.bind_ms<=? AND (? IS NULL OR a.id>?) AND (? IS NULL OR a.id<=?) ORDER BY a.id LIMIT 101)
     SELECT t.*,o.observed_ms,o.kind,
      CASE WHEN length(CAST(o.body AS BLOB))<=8192 AND json_valid(o.body) AND length(json_extract(o.body,'$.assetId'))<=128 THEN json_extract(o.body,'$.assetId') ELSE NULL END owner_asset_id,
      CASE WHEN length(CAST(o.body AS BLOB))<=8192 AND json_valid(o.body) AND length(json_extract(o.body,'$.kind'))<=16 THEN json_extract(o.body,'$.kind') ELSE NULL END owner_kind,
      CASE WHEN length(CAST(o.body AS BLOB))<=8192 AND json_valid(o.body) AND length(json_extract(o.body,'$.at'))<=32 THEN json_extract(o.body,'$.at') ELSE NULL END owner_at,
      CASE WHEN length(CAST(o.body AS BLOB))<=8192 AND json_valid(o.body) AND length(COALESCE(json_extract(o.body,'$.to'),json_extract(o.body,'$.owner')))<=44 THEN COALESCE(json_extract(o.body,'$.to'),json_extract(o.body,'$.owner')) ELSE NULL END owner_wallet
     FROM tracked t LEFT JOIN vault_observations o ON o.rowid=(SELECT v.rowid FROM vault_observations v WHERE v.asset_id=t.id AND v.observed_ms<=? AND v.kind IN ('bind','transfer') ORDER BY v.observed_ms DESC,v.rowid DESC LIMIT 1) ORDER BY t.id`,b.atMs,lower,lower,upper,upper,b.atMs),
    sql('SELECT a.id,i.kind,a.bind_ms FROM collect_assets a JOIN collect_inventories i ON i.id=a.inventory_id WHERE a.id IN(SELECT value FROM json_each(?)) ORDER BY a.id LIMIT 101',canonicalJson(page.body.holdings.map(h=>h.id))),
    sql('SELECT page_index FROM app_collection_cut_pages WHERE attempt_id=? AND page_index=?',a.id,index),
   ]);
   if(oldPages.length)return conflict('cut_page_already_validated');if(trackedRows.length>100||known.length>100||r.size+pr.size+utf8(canonicalJson([trackedRows,known])).length>262144)return pending('cut-read-bound');
   let summary;try{const tracked=trackedRows.map(k=>{if(k.owner_asset_id!==k.id||k.owner_kind!==k.kind||typeof k.owner_at!=='string'||Date.parse(k.owner_at)!==k.observed_ms||typeof k.owner_wallet!=='string')throw new TypeError('Owner observation binding.');return {id:k.id,owner:k.owner_wallet,bindMs:k.bind_ms,revealMs:k.reveal_ms,level:k.level,ownerObservedMs:k.observed_ms};});summary=await prepareCollectionCutPage({rootRecord:raw(r),pageRecord:raw(pr),attempt,nowMs:now,tracked,suppliedKnown:known.map(k=>({id:k.id,kind:k.kind,bindMs:k.bind_ms}))},crypto);}catch(e){return pending(e.code??'cut-observation-invalid');}
   const result={attemptId:a.id,pageIndex:index,pageId:pr.id,holdingCount:summary.holdingCount,trackedCount:summary.trackedCount,closureDigest:summary.closureDigest,source:'local-fixture',executable:false};
   return commit(result,summary.closureDigest,(gate,p)=>[sql(`INSERT INTO app_collection_cut_pages(attempt_id,page_index,page_id,holding_count,tracked_count,first_asset,last_asset,eligible_wallets_json,closure_digest,operation_id) SELECT ?,?,?,?,?,?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,a.id,index,pr.id,summary.holdingCount,summary.trackedCount,summary.firstAsset,summary.lastAsset,canonicalJson(summary.eligibleWallets),summary.closureDigest,...p,...p)],['EXISTS(SELECT 1 FROM app_collection_cut_records WHERE id=? AND body_json=?)','NOT EXISTS(SELECT 1 FROM app_collection_cut_pages WHERE attempt_id=? AND page_index=?)'],[pr.id,pr.body_json,a.id,index]);
  }
  if(!isSeal)throw new TypeError('Unknown collection cut command.');
  if(storedSummaries.length>100||storedSummaries.some(p=>p.eligible_wallets_json===null)||utf8(canonicalJson(storedSummaries)).length>1048576)return pending('cut-summary-bound');
  let plan;try{const pages=storedSummaries.map(p=>({attemptId:a.id,rootId:r.id,sourceRevision:a.source_revision,pageId:p.page_id,pageIndex:p.page_index,holdingCount:p.holding_count,trackedCount:p.tracked_count,firstAsset:p.first_asset,lastAsset:p.last_asset,eligibleWallets:JSON.parse(p.eligible_wallets_json),closureDigest:p.closure_digest}));plan=await prepareCollectionCutSeal({rootRecord:raw(r),attempt,pages,nowMs:now,stage:{inventoryId:s.inventory_id,stageId:s.stage_id,kind:s.kind,type:s.stage_type,opensAtMs:s.opens_ms,termsDigest:s.terms_digest},list:{id:l.id,count:l.member_count,walletsDigest:l.wallets_digest,indexedCount:l.indexed_count}},crypto);}catch(e){return pending(e.code??'cut-seal-invalid');}
  const {walletsDigest,sourceRef,sourceRevision,...result}=plan;
  return commit(result,r.id,(gate,p)=>[sql(`INSERT INTO app_collection_free_cuts(inventory_id,stage_id,attempt_id,root_id,list_id,cut_ms,source_ref,source_revision,wallets_digest,eligible_count,command_operation_id) SELECT ?,?,?,?,?,?,?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,b.inventoryId,b.stageId,a.id,r.id,l.id,b.atMs,sourceRef,Number(sourceRevision),walletsDigest,plan.eligibleWallets,...p,...p)]);
 }
 async function resolve(value,record){const c=clone(value),r=record===undefined?undefined:captureCollectionCutRecord(record),result=await run(c,r);return ['pending','conflict'].includes(result.kind)?await replay(c)??result:result;}
 return Object.freeze({stageRecord:(c,r)=>resolve(c,r),beginCut:c=>resolve(c),validatePage:c=>resolve(c),sealCut:c=>resolve(c)});
}
