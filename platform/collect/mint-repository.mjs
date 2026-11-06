import {readImportedCollectionContext,importedCollectionSnapshotMatches,importedCollectionRuntimeSql,importedCollectionClaim} from './imported-context.mjs';
import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {period,pressureFromRows,decisionFromRows} from '../operations/portable-controls.mjs';
import {CHAIN,leadMs,genesisMs,roundTime} from '../randomness/request-plan.mjs';
import {validateTraitChoices} from '../randomness/draw-protocol.mjs';
import {LEVEL_QUOTAS} from '../domain/collections/policy.mjs';
import {buildMintReservationCommand,RESERVE_COLLECTION_MINT} from './mint-service.mjs';
import {prepareNormalizedMintAdmission} from './mint-plan.mjs';
const clone=v=>JSON.parse(canonicalJson(v));
const pending=reason=>({kind:'pending',reason,dependencyIds:[]}),conflict=code=>({kind:'conflict',code});
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,79})$/.test(v);
const units=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=(1n<<64n)-1n;
function control(scope,usage,spend,now){
 if(scope.length>1||scope.some(r=>![0,1].includes(r.paused)||!time(r.at_ms)||r.at_ms>now)
  ||usage.some(r=>typeof r.provider!=='string'||r.provider.length===0||!decimal(r.measured)||!time(r.at_ms)||r.at_ms>now||!['new-monthly-usd','daily-provider-units'].includes(r.metric)||(r.metric==='daily-provider-units'&&(!decimal(r.quota)||BigInt(r.quota)===0n)))
  ||spend.some(r=>!['reserved','settled'].includes(r.status)||!time(r.at_ms)||r.at_ms>now||!decimal(r.limit_usd_micros)||(r.status==='settled'&&(!decimal(r.actual_usd_micros)||!time(r.settled_ms)||r.settled_ms>now))))return {allowed:false,reason:'operating-input-invalid'};
 const pressure=pressureFromRows(usage,spend,now);if(!['ready','pending'].includes(pressure.status))return {allowed:false,reason:'operating-decision-unavailable'};
 const decision=decisionFromRows('collection-mint',scope[0],pressure);return decision?.allowed===true?decision:{allowed:false,reason:decision?.reason??'operating-decision-unavailable'};
}
/** Named local admission only. Snapshot facts are private; no SQL or claimed
 * policy/eligibility booleans are accepted from the application request. */
export function createMintReservationRepository(driver,ports){
 const {crypto,clock,ids}=ports,{read,replay,execute}=createAtomicReceipts(driver,ports),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 return Object.freeze({async reserveMint(value){
  const c=clone(value),request={requestKey:c.requestKey,...c.input};delete request.kind;
  if(c.operationKind!==RESERVE_COLLECTION_MINT||canonicalJson(c)!==canonicalJson(await buildMintReservationCommand(c.principal,request,crypto)))throw new TypeError('Mint command identity mismatch.');
  const prior=await replay(c);if(prior)return prior;
  const i=c.input,owner=c.principal.kind==='wallet'?c.principal.wallet:i.wallet,imported=await readImportedCollectionContext(driver,crypto,{inventoryId:i.inventoryId,stageId:i.stageId,wallet:owner});if(imported.kind==='pending')return imported;const now=clock.nowMs();if(!time(now)||now>8640000000000000-30000)return pending('mint-clock-unavailable');
  const operationId=ids.next(),commitment=ids.next();if(!id(operationId)||!id('collect:'+operationId)||!id(commitment))throw new TypeError('Server mint identities unavailable.');
  const captured=await read([
   sql('SELECT name,CAST(revision AS TEXT) revision FROM app_revisions ORDER BY name'),
   sql(importedCollectionRuntimeSql),
   sql(`SELECT h.id,h.kind,h.tranche,h.season_start,h.season_month,h.origin_digest,h.revision header_revision,a.origin_kind,a.initial_revision,a.initial_state_digest,a.activation_command_id,a.revision,a.admitted,a.fulfilled,CASE WHEN length(CAST(a.remaining_json AS BLOB))<=512 THEN a.remaining_json ELSE NULL END remaining_json FROM collect_inventories h JOIN app_collection_authorities a ON a.inventory_id=h.id WHERE h.id=?`,i.inventoryId),
   sql('SELECT stage_id,ordinal,stage_type,published_ms,opens_ms,closes_ms,terms_digest,CASE WHEN length(CAST(terms_json AS BLOB))<=8192 THEN terms_json ELSE NULL END terms_json,eligibility_kind,list_id,eligible_count FROM app_collection_stages WHERE inventory_id=? AND (stage_id=? OR ordinal=0) ORDER BY ordinal LIMIT 2',i.inventoryId,i.stageId),
   sql(`SELECT COUNT(*) admitted,COALESCE(SUM(CASE WHEN stage_id=? THEN 1 ELSE 0 END),0) stage_count,COALESCE(SUM(CASE WHEN stage_id=? AND wallet=? THEN 1 ELSE 0 END),0) wallet_count FROM app_collection_mint_admissions WHERE inventory_id=?`,i.stageId,i.stageId,owner,i.inventoryId),
   sql(`SELECT cost_lamports FROM app_collection_mint_admissions WHERE inventory_id=? AND stage_id=? AND EXISTS(SELECT 1 FROM app_collection_stages WHERE inventory_id=? AND stage_id=? AND stage_type='founder') ORDER BY ordinal LIMIT 1001`,i.inventoryId,i.stageId,i.inventoryId,i.stageId),
   sql(`SELECT l.id,l.member_count,json_array_length(l.page_ids_json) page_count,
    (SELECT COUNT(*) FROM json_each(l.page_ids_json) j JOIN app_collection_eligibility_pages p ON p.record_id=j.value) indexed_pages,
    (SELECT COALESCE(SUM(p.entry_count),0) FROM json_each(l.page_ids_json) j JOIN app_collection_eligibility_pages p ON p.record_id=j.value) indexed_members,
    (SELECT COUNT(*) FROM json_each(l.page_ids_json) j JOIN app_collection_eligibility_pages p ON p.record_id=j.value JOIN json_each(p.entries_json) e WHERE e.value=?) wallet_count
    FROM app_collection_stages s LEFT JOIN app_collection_free_cuts c ON c.inventory_id=s.inventory_id AND c.stage_id=s.stage_id JOIN app_collection_list_seals l ON l.id=CASE WHEN s.stage_type='free' THEN c.list_id ELSE s.list_id END WHERE s.inventory_id=? AND s.stage_id=? AND length(CAST(l.page_ids_json AS BLOB))<=16384`,owner,i.inventoryId,i.stageId),
   sql("SELECT revision,paused,at_ms FROM ops_scope_log WHERE scope='collection-mint' ORDER BY at_ms DESC LIMIT 1"),
   sql(`SELECT CASE WHEN length(provider)<=128 THEN provider ELSE NULL END provider,metric,period,at_ms,CASE WHEN length(measured)<=80 THEN measured ELSE NULL END measured,CASE WHEN length(quota)<=80 THEN quota ELSE NULL END quota FROM ops_usage u WHERE NOT EXISTS(SELECT 1 FROM ops_usage n WHERE n.provider=u.provider AND n.metric=u.metric AND (u.metric='new-monthly-usd' OR n.period=u.period) AND n.at_ms>u.at_ms) AND (u.metric='new-monthly-usd' OR u.period=?) ORDER BY u.provider LIMIT 101`,period(now)),
   sql("SELECT at_ms,status,settled_ms,CASE WHEN length(limit_usd_micros)<=80 THEN limit_usd_micros ELSE NULL END limit_usd_micros,CASE WHEN length(actual_usd_micros)<=80 THEN actual_usd_micros ELSE NULL END actual_usd_micros FROM ops_optional_spend WHERE status='reserved' OR COALESCE(settled_ms,at_ms)>=? LIMIT 101",Date.parse(period(now,true)+'-01T00:00:00Z')),
   sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='collection-founder'",c.principal.kind==='operator'?c.principal.id:''),
   sql('SELECT CASE WHEN length(policy_hash)=64 THEN policy_hash ELSE NULL END policy_hash,registered_ms,CASE WHEN length(CAST(traits AS BLOB))<=524288 THEN traits ELSE NULL END traits FROM fair_inventories WHERE inventory_id=?',i.inventoryId),
   sql('SELECT slot_index,CASE WHEN length(asset_id)<=44 THEN asset_id ELSE NULL END asset_id FROM fair_reserved_assets WHERE inventory_id=? ORDER BY slot_index LIMIT 1001',i.inventoryId),
   sql('SELECT id,owner,request_key,commitment FROM collect_operations WHERE (owner=? AND request_key=?) OR commitment=? LIMIT 2',owner,c.requestKey,commitment),
   sql(`SELECT p.tranche,CASE WHEN a.inventory_id IS NOT NULL THEN a.admitted ELSE CASE WHEN length(CAST(p.state AS BLOB))<=33554432 AND json_valid(p.state) THEN json_array_length(p.state,'$.admissions') ELSE NULL END END admitted FROM collect_inventories p LEFT JOIN app_collection_authorities a ON a.inventory_id=p.id WHERE p.tranche=(SELECT tranche-1 FROM collect_inventories WHERE id=?)`,i.inventoryId),
   sql(`SELECT d.ballot_id,d.earliest_ms FROM genesis_decisions d JOIN app_collection_stages s ON d.ballot_id=json_extract(s.terms_json,'$.ballotId') WHERE s.inventory_id=? AND s.ordinal=0`,i.inventoryId),
   sql(`SELECT c.root_id,c.list_id,c.cut_ms,c.eligible_count,json_extract(r.body_json,'$.inventoryId') inventory_id,json_extract(r.body_json,'$.stageId') stage_id,json_extract(r.body_json,'$.termsDigest') terms_digest,json_extract(r.body_json,'$.atMs') at_ms,json_extract(r.body_json,'$.eligibilityListId') eligibility_list_id FROM app_collection_free_cuts c JOIN app_collection_cut_records r ON r.id=c.root_id AND r.format='collection-cut-root-v1' WHERE c.inventory_id=? AND c.stage_id=?`,i.inventoryId,i.stageId),
  ]);
  if(utf8(canonicalJson(captured)).length>1048576)return pending('mint-context-byte-bound');
  const [rs,watermarks,headers,stages,counts,costs,memberships,scope,usage,spend,grants,policies,reserved,old,previous,decisions,cuts]=captured,h=headers[0],s=stages.find(row=>row.stage_id===i.stageId),count=imported.kind==='ready'?{admitted:imported.authority.admitted,stage_count:imported.stage.admitted,wallet_count:imported.stage.walletAdmitted}:counts[0],wm=watermarks[0]?.revision;
  if(c.principal.kind==='operator'&&!grants.some(r=>r.enabled===1))return conflict('operator_scope_required');
  if(old.some(o=>o.owner===owner&&o.request_key===c.requestKey))return conflict('legacy_operation_key');
  if(!h||!s)return pending('mint-normalized-stage-missing');
  if(rs.length!==3||rs.some(r=>!['earn','source','control'].includes(r.name)||typeof r.revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(r.revision)||!Number.isSafeInteger(Number(r.revision)))||watermarks.length!==1||!Number.isSafeInteger(wm)||wm<0)return pending('mint-revisions-unavailable');
  const version=revisions(rs),decision=control(scope,usage,spend,now);if(!decision.allowed)return pending(decision.reason);
  if(!['empty-reference','verified-source-import'].includes(h.origin_kind)||h.initial_revision!==h.header_revision||!digest(h.initial_state_digest)||h.remaining_json===null||!count||count.admitted!==h.admitted||costs.length>1000||costs.some(r=>!units(r.cost_lamports)))return pending('mint-authority-conflict');
  if(h.origin_kind==='verified-source-import'?!importedCollectionSnapshotMatches(imported,{revision:version.source,watermark:wm,generation:watermarks[0]?.generation,authority:h}):imported.kind!=='absent')return pending('mint-imported-authority-changed');
  let terms,first,remaining;try{
   terms=JSON.parse(s.terms_json);first=JSON.parse(stages.find(row=>row.ordinal===0)?.terms_json??'null');remaining=JSON.parse(h.remaining_json);
   if(!first||canonicalJson(terms)!==s.terms_json||terms.id!==s.stage_id||terms.type!==s.stage_type||terms.termsDigest!==s.terms_digest||terms.publishedAt!==s.published_ms||terms.opensAt!==s.opens_ms||terms.closesAt!==s.closes_ms||terms.publishedAt>now||canonicalJson(remaining)!==h.remaining_json)return pending('mint-stage-binding-conflict');
   if(h.origin_digest!==await crypto.sha256(utf8(JSON.stringify([h.id,h.kind,h.tranche,h.season_start]))))return pending('mint-origin-conflict');
   if(h.kind==='season'?h.season_month!==new Date(h.season_start).toISOString().slice(0,7):h.season_start!==null||h.season_month!==null)return pending('mint-header-conflict');
  }catch{return pending('mint-stage-invalid');}
  let membership,freeCut=null,listId=s.list_id,eligibleCount=s.eligible_count;
  if(s.stage_type==='free'){const cut=cuts[0];if(cuts.length!==1||!cut||h.kind!=='season'||s.eligibility_kind!=='pending'||s.list_id!==null||cut.inventory_id!==h.id||cut.stage_id!==s.stage_id||cut.terms_digest!==s.terms_digest||cut.cut_ms!==s.opens_ms||cut.at_ms!==s.opens_ms||cut.eligibility_list_id!==cut.list_id||!digest(cut.root_id)||!digest(cut.list_id))return pending('mint-free-cut-pending');listId=cut.list_id;eligibleCount=cut.eligible_count;freeCut={inventoryId:h.id,stageId:s.stage_id,atMs:cut.cut_ms,termsDigest:s.terms_digest,listId};}
  if(s.stage_type==='public'){if(s.eligibility_kind!=='unrestricted'||s.list_id!==null||s.eligible_count!==null)return pending('mint-membership-conflict');membership={wallet:owner,stageId:s.stage_id,eligible:true,sourceId:null};}
  else{const m=memberships[0];if((s.stage_type!=='free'&&s.eligibility_kind!=='list')||!m||memberships.length!==1||m.id!==listId||m.member_count!==eligibleCount||!Number.isSafeInteger(m.page_count)||m.page_count<1||m.page_count>100||m.indexed_pages!==m.page_count||m.indexed_members!==m.member_count||![0,1].includes(m.wallet_count))return pending('mint-membership-index-unavailable');membership={wallet:owner,stageId:s.stage_id,eligible:m.wallet_count===1,sourceId:listId};}
  let fairPolicy=null;const policy=policies[0]??null;
  if(policy){
   if(policies.length!==1||!digest(policy.policy_hash)||!time(policy.registered_ms)||policy.registered_ms<genesisMs||policy.registered_ms>now||policy.traits===null||reserved.length!==1000||reserved.some((r,n)=>r.slot_index!==n)||new Set(reserved.map(r=>r.asset_id)).size!==1000)return pending('mint-fair-policy-unavailable');
   try{reserved.forEach(r=>decode58(r.asset_id,32));const choices=validateTraitChoices(JSON.parse(policy.traits));if(canonicalJson(choices)!==policy.traits||await crypto.sha256(utf8(canonicalJson(['10x-lab-draw-1',h.id,CHAIN,leadMs,policy.registered_ms,reserved.map(r=>r.asset_id),LEVEL_QUOTAS,choices])))!==policy.policy_hash)return pending('mint-fair-policy-conflict');}catch{return pending('mint-fair-policy-invalid');}
   fairPolicy={policy_hash:policy.policy_hash,registered_ms:policy.registered_ms};
  }else if(reserved.length)return pending('mint-orphan-fair-assets');
  const authority={inventoryId:h.id,kind:h.kind,tranche:h.tranche,seasonStart:h.season_start,revision:h.revision,admitted:h.admitted,fulfilled:h.fulfilled,remaining},stage={id:s.stage_id,type:s.stage_type,opensAt:s.opens_ms,closesAt:s.closes_ms,allocation:terms.allocation,walletLimit:terms.walletLimit,priceLamports:terms.priceLamports?.$lamports,costLamports:terms.costLamports?.$lamports,approvedSpendLamports:terms.approvedSpendLamports?.$lamports??null,termsDigest:s.terms_digest};
  const opening=h.kind==='genesis'&&h.tranche>1&&h.admitted===0?{firstStage:{ballotId:first.ballotId,inventoryOverrideReason:first.inventoryOverrideReason},decision:decisions[0]?{ballotId:decisions[0].ballot_id,earliestMs:decisions[0].earliest_ms}:null,previous:previous[0]??null}:null;
  let plan;try{plan=await prepareNormalizedMintAdmission({command:{...c,nowMs:now},facts:{authority,stage,sourceKind:'synthetic-local-operator-fixture',stageAdmissionCount:count.stage_count,walletAdmissionCount:count.wallet_count,founderSpentLamports:imported.kind==='ready'?(imported.stage.founderSpentLamports??'0'):costs.reduce((sum,r)=>sum+BigInt(r.cost_lamports),0n).toString(),membership,freeCut,opening,commitmentUsed:old.some(o=>o.commitment===commitment),fairPolicy},operationId,commitment},crypto);}catch(error){return pending(typeof error.code==='string'?error.code:'mint-policy-invalid');}
  const row=plan.admission,fair=row.fairPolicyHash!==null,result={operationId,inventoryId:h.id,wallet:owner,kind:'mint',stageId:s.stage_id,termsDigest:s.terms_digest,priceLamports:row.priceLamports,costLamports:row.costLamports,createdMs:now,status:'awaiting-evidence',fairness:fair?'configured-offline-beacon':'manual-fixture',source:'local-fixture',executable:false};
  const before={revision:h.revision,admitted:h.admitted,fulfilled:h.fulfilled,remainingJson:h.remaining_json},effect={authorityBefore:before,authorityAfter:{...before,revision:plan.effects.revision,admitted:plan.effects.admitted},operationJson:plan.operationJson};
  if(clock.nowMs()<now||clock.nowMs()>now+30000||clock.nowMs()>=s.closes_ms)return pending('mint-window-expired');if(fair&&clock.nowMs()>=roundTime(row.targetRound))return pending('fairness-window-expired');
  const conditions=[`${nowSql}>=? AND ${nowSql}<=? AND ${nowSql}<?`,`strftime('%Y-%m-%d',${nowSql}/1000.0,'unixepoch')=?`,
   '(SELECT revision FROM app_recovery_watermark WHERE id=1)=?',
   'EXISTS(SELECT 1 FROM app_collection_authorities WHERE inventory_id=? AND revision=? AND admitted=? AND fulfilled=? AND remaining_json=?)',
   'EXISTS(SELECT 1 FROM app_collection_stages WHERE inventory_id=? AND stage_id=? AND terms_digest=? AND terms_json=?)',
   'NOT EXISTS(SELECT 1 FROM collect_operations WHERE owner=? AND request_key=?)',
   `COALESCE((SELECT paused FROM ops_scope_log WHERE scope='collection-mint' ORDER BY at_ms DESC LIMIT 1),0)=0`,
   `NOT EXISTS(SELECT 1 FROM ops_scope_log WHERE scope='collection-mint' AND at_ms>? AND at_ms<=${nowSql})`,
   `NOT EXISTS(SELECT 1 FROM ops_usage WHERE at_ms>? AND at_ms<=${nowSql})`,
   `NOT EXISTS(SELECT 1 FROM ops_optional_spend WHERE (at_ms>? AND at_ms<=${nowSql}) OR (settled_ms>? AND settled_ms<=${nowSql}))`,
   ...(c.principal.kind==='operator'?["EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='collection-founder' AND enabled=1)"]:[]),...(fair?[`${nowSql}<?`]:[])];
  const values=[now,now+30000,s.closes_ms,period(now),wm,h.id,h.revision,h.admitted,h.fulfilled,h.remaining_json,h.id,s.stage_id,s.terms_digest,s.terms_json,owner,c.requestKey,now,now,now,now,...(c.principal.kind==='operator'?[c.principal.id]:[]),...(fair?[roundTime(row.targetRound)]:[])];
  if(imported.kind==='ready'&&now<imported.acceptedAtMs)return pending('imported-authority-not-yet-created');
  if(imported.kind==='ready'){const bound=importedCollectionClaim(imported,h.id);conditions.push(bound.text);values.push(...bound.values);}
  const resultJson=canonicalJson(result),effectJson=canonicalJson(effect);if(utf8(effectJson).length>16384)return pending('mint-effect-bound');
  const outcome=await execute({...c,nowMs:now,expectedRevisions:version},{businessKey:c.businessIdentity,input:i,result,resultRef:operationId,version,authoritySql:conditions.join(' AND '),authorityValues:values,child:(gate,p)=>[
   sql(`INSERT INTO collect_operations(id,kind,inventory_id,owner,request_key,request_digest,commitment,created_ms,operation) SELECT ?,'mint',?,?,?,?,?,?,? WHERE ${gate}`,operationId,h.id,owner,c.requestKey,c.requestDigest,commitment,now,plan.operationJson,...p),
   ...(fair?[sql(`INSERT INTO fair_requests(operation_id,target_round,context_digest) SELECT ?,?,? WHERE ${gate}`,operationId,row.targetRound,row.contextDigest,...p)]:[]),
   sql(`UPDATE app_collection_authorities SET revision=?,admitted=? WHERE inventory_id=? AND revision=? AND admitted=? AND fulfilled=? AND remaining_json=? AND ${gate}`,plan.effects.revision,plan.effects.admitted,h.id,h.revision,h.admitted,h.fulfilled,h.remaining_json,...p),
   sql(`INSERT INTO app_collection_mint_admissions(operation_id,inventory_id,stage_id,ordinal,wallet,commitment,admitted_ms,terms_digest,price_lamports,cost_lamports,membership_source_id,fair_policy_hash,fair_registered_ms,target_round,context_digest,command_operation_id,result_json,effect_json) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,operation_id,?,? FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,operationId,h.id,s.stage_id,row.ordinal,owner,commitment,now,row.termsDigest,row.priceLamports,row.costLamports,row.membershipSourceId,row.fairPolicyHash,row.fairRegisteredMs,row.targetRound,row.contextDigest,resultJson,effectJson,...p,...p),
  ]});
  if(outcome.kind==='conflict'&&(clock.nowMs()<now||clock.nowMs()>now+30000||clock.nowMs()>=s.closes_ms))return pending('mint-window-expired');if(outcome.kind==='conflict'&&fair&&clock.nowMs()>=roundTime(row.targetRound))return pending('fairness-window-expired');return outcome;
 }});
}
