import {sql,revisions} from './atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {DAY_MS,MIN_STAKE_MICRO_USD} from '../domain/earn/index.mjs';
import {verifyPositionChain} from '../earn/position-chain.mjs';
import {name,nat,requireValue} from '../earn/validation.mjs';
import {normalizePolicy,DAMM_V2_PROGRAM} from '../pricing/policy.mjs';
const clone=value=>JSON.parse(canonicalJson(value));
const pending=(reason,dependencyIds=[])=>({kind:'pending',reason,dependencyIds});
export const cutoffBindingKey=(kind,subject,cutoffMs)=>canonicalJson([kind,subject,cutoffMs]);
const priceFields=['status','microUsd','stakedUnits','priceNumerator','priceDenominator','expiresMs'];
const priceValue=row=>{if(!row)return null;const value=JSON.parse(row.decision);return Object.fromEntries(priceFields.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));};
function economicEvent(row){
 const e=JSON.parse(row.evidence),value={type:e.type,signature:e.signature,instructionIndex:e.instructionIndex,wallet:e.wallet,tokenId:e.tokenId,sequence:e.sequence,atMs:e.atMs,confirmed:e.confirmed};
 for(const key of ['swapIndex','netBoughtUnits','depositedUnits','withdrawnUnits','remainingStakeUnits'])if(Object.hasOwn(e,key))value[key]=e[key];return value;
}
// Frozen application facts are evidence about this application's records only.
// Complete external histories require separately registered current receipts.
export async function loadCutoffInventory(driver,crypto,options){
 const {epoch,nowMs,historyStartMs,sourceBindings=[]}=clone(options);nat(epoch,'epoch');nat(nowMs,'now');nat(historyStartMs,'history origin');
 const cutoff=(epoch+1)*DAY_MS-1;if(nowMs<=cutoff)return pending('board-open');
 requireValue(historyStartMs<=cutoff&&Array.isArray(sourceBindings)&&sourceBindings.length<=16384,'Invalid cutoff configuration.');
 const bindings=new Map();for(const b of sourceBindings){
  for(const key of ['sourceId','sourceRevision','decoderVersion'])name(b[key],key);
  const key=cutoffBindingKey(b.kind,b.subject,b.cutoffMs);requireValue(!bindings.has(key),'Duplicate cutoff source binding.');bindings.set(key,b);
 }
 let batches=0;const read=async statements=>{batches++;return (await driver.batch(statements)).map(x=>x.rows);};
 const [versionRows,freezes,posts,campaigns,collections,actions,issuers,revocations,history,previous,policies]=await read([
  sql('SELECT * FROM app_revisions ORDER BY name'),sql('SELECT * FROM app_epoch_freezes WHERE epoch=?',epoch),
  sql(`SELECT s.*,r.content_score,r.moderator,r.reason,r.reviewed_ms,r.source_ref AS review_ref,
    e.wallet AS entry_wallet,e.token_id AS entry_token,e.observed_ms,e.expires_ms,e.micro_usd,e.source_ref AS entry_source
    FROM earn_submissions s JOIN earn_stake_reads e ON e.id=s.entry_read_id LEFT JOIN earn_reviews r ON r.submission_id=s.id WHERE s.epoch=? ORDER BY s.id LIMIT 101`,epoch),
  sql(`SELECT token_id AS tokenId,activation_ms AS activationMs,original_units AS originalUnits FROM earn_fixture_campaigns c
    WHERE (activation_ms<=? AND activation_ms>?) OR EXISTS(SELECT 1 FROM earn_submissions s WHERE s.epoch=? AND s.token_id=c.token_id) ORDER BY token_id LIMIT 101`,cutoff,cutoff-10*DAY_MS,epoch),
  sql('SELECT collection_id AS collectionId,kind,season_start_ms AS seasonStartMs FROM earn_known_collections ORDER BY collection_id LIMIT 101'),
  sql(`SELECT a.id AS actionId,a.label,a.verifier,c.effective_epoch AS startEpoch FROM earn_action_catalog a JOIN earn_action_changes c ON c.action_id=a.id
    AND c.effective_epoch=(SELECT MAX(z.effective_epoch) FROM earn_action_changes z WHERE z.action_id=a.id AND z.effective_epoch<=?) WHERE c.enabled=1 ORDER BY a.id LIMIT 101`,epoch),
  sql('SELECT * FROM earn_issuer_grants WHERE recorded_ms<=? ORDER BY id LIMIT 101',cutoff),
  sql('SELECT * FROM earn_issuer_revocations WHERE revoked_ms<=? ORDER BY issuer_id LIMIT 101',cutoff),
  sql(`SELECT (SELECT MIN(epoch) FROM earn_submissions WHERE epoch<?) AS first_submission,
    (SELECT MIN(epoch) FROM earn_boards WHERE epoch<?) AS first_board,
    (SELECT MIN(s.epoch) FROM earn_submissions s WHERE s.epoch<? AND NOT EXISTS(SELECT 1 FROM earn_boards b WHERE b.epoch=s.epoch)) AS unresolved_epoch`,epoch,epoch,epoch),
  sql('SELECT epoch,snapshot_hash FROM earn_boards WHERE epoch=?',epoch-1),
  sql(`SELECT p.* FROM price_sources p WHERE EXISTS(SELECT 1 FROM earn_fixture_campaigns c WHERE c.token_id=p.token_id AND
    ((c.activation_ms<=? AND c.activation_ms>?) OR EXISTS(SELECT 1 FROM earn_submissions s WHERE s.epoch=? AND s.token_id=c.token_id))) ORDER BY p.token_id LIMIT 101`,cutoff,cutoff-10*DAY_MS,epoch),
 ]);
 if(!freezes[0])return pending('admission-freeze-required',[String(epoch)]);
 if([posts,campaigns,collections,actions,issuers,revocations,policies].some(rows=>rows.length>100))return pending('cutoff-inventory-bound');
 const freeze=freezes[0],admissions=posts.map(p=>({id:p.id,wallet:p.wallet,tokenId:p.token_id,epoch:p.epoch,url:p.url,submittedMs:p.submitted_ms,entryReadId:p.entry_read_id,requestKey:p.request_key}));
 const frozenRows=await Promise.all(admissions.map(async p=>({id:p.id,digest:await crypto.sha256(utf8(canonicalJson(p)))})));
 if(canonicalJson(frozenRows)!==freeze.inventory_json||posts.length!==freeze.admission_count)return pending('frozen-admissions-mismatch');
 let inventoryBytes=0,boundExceeded=false;
 const inputs=[],add=input=>{
  const size=utf8(canonicalJson(input)).length;
  if(size>256*1024||inventoryBytes+size>8*1024*1024){boundExceeded=true;return;}
  inventoryBytes+=size;inputs.push(input);
 },app=(kind,subject,value,available=true,pendingReason='fact-unavailable',at=cutoff)=>add({authority:'application',kind,subject,cutoffMs:at,value,available,pendingReason,coverage:{fromMs:at,toMs:at,required:'point'}});
 const evidence=(kind,subject,value,at=cutoff,from=at,available=true,pendingReason='fact-unavailable',expectedPolicy=null)=>{
  const binding=bindings.get(cutoffBindingKey(kind,subject,at));
  add({authority:'evidence',kind,subject,cutoffMs:at,value,available:available&&!!binding,pendingReason:binding?pendingReason:'source-binding-required',expectedPolicy,
   sourceId:binding?.sourceId??'unconfigured',sourceRevision:binding?.sourceRevision??'unconfigured',decoderVersion:binding?.decoderVersion??'unavailable',
   coverage:{fromMs:from,toMs:at,required:from===at?'point':'interval'}});
 };
 const boardSubject={kind:'epoch',id:String(epoch)};
 app('epoch-admissions',boardSubject,{epoch,admissionDigest:freeze.admission_digest,submissions:admissions});
 app('application-history',boardSubject,{historyStartMs,...history[0]});
 app('previous-board',boardSubject,{epoch:epoch-1,snapshotHash:previous[0]?.snapshot_hash??null,bootstrap:history[0].first_submission===null&&history[0].first_board===null},history[0].unresolved_epoch===null,'previous-board');
 app('collection-policy',boardSubject,{collections});app('action-policy',boardSubject,{epoch,actions});
 app('issuer-policy',boardSubject,{grants:issuers,revocations});app('price-policy',boardSubject,{campaigns,policies});
 const policyFor=tokenId=>{const row=policies.find(p=>p.token_id===tokenId);return row?JSON.parse(row.policy):null;};
 evidence('campaign-registry',{kind:'campaign-registry',id:'earn'}, {campaigns:campaigns.map(({tokenId,activationMs})=>({tokenId,activationMs}))},cutoff,historyStartMs);
 const priceQuery=points=>sql(`SELECT q.key AS request_index,o.*,r.wallet AS read_wallet,r.token_id AS read_token,r.micro_usd AS read_micro_usd,
  r.observed_ms AS read_observed_ms,r.expires_ms AS read_expires_ms,r.source_ref AS read_source_ref FROM json_each(?) q
  JOIN price_observations o ON o.wallet=json_extract(q.value,'$[0]') AND o.token_id=json_extract(q.value,'$[1]') AND o.as_of_ms=json_extract(q.value,'$[2]')
  LEFT JOIN earn_stake_reads r ON r.id=o.read_id WHERE NOT EXISTS(SELECT 1 FROM price_observations n WHERE n.wallet=o.wallet AND n.token_id=o.token_id
   AND n.as_of_ms=o.as_of_ms AND n.revision>o.revision) ORDER BY q.key`,JSON.stringify(points));
 const priceAvailable=(row,wallet,tokenId,at)=>row&&JSON.parse(row.decision).status==='verified'&&row.read_wallet===wallet&&row.read_token===tokenId&&row.read_observed_ms===at
  &&row.read_micro_usd===JSON.parse(row.decision).microUsd&&JSON.parse(row.decision).expiresMs>=at&&row.read_expires_ms===JSON.parse(row.decision).expiresMs
  &&row.read_id===row.receipt&&row.read_source_ref==='price:'+row.receipt&&row.policy_hash===policies.find(p=>p.token_id===tokenId)?.policy_hash;
 const qualified=new Set();let asOfMs=cutoff+1;
 for(let offset=0;offset<posts.length;offset+=10){
  const group=posts.slice(offset,offset+10),[rows]=await read([priceQuery(group.flatMap(p=>[[p.wallet,p.token_id,p.observed_ms],[p.wallet,p.token_id,cutoff]]))]);
  for(let index=0;index<group.length;index++){
   const p=group[index],[entry,closing]=[rows.find(r=>r.request_index===index*2),rows.find(r=>r.request_index===index*2+1)],subject={kind:'wallet-token',id:canonicalJson([p.wallet,p.token_id])};
   app('final-review',{kind:'submission',id:p.id},{submissionId:p.id,contentScore:p.content_score,moderator:p.moderator,reason:p.reason,reviewedMs:p.reviewed_ms,sourceRef:p.review_ref},p.content_score!==null&&p.reviewed_ms<=nowMs,'moderation');
   if(p.reviewed_ms!==null&&p.reviewed_ms<=nowMs)asOfMs=Math.max(asOfMs,p.reviewed_ms);
   app('entry-stake',{kind:'submission',id:p.id},{id:p.entry_read_id,wallet:p.entry_wallet,tokenId:p.entry_token,observedMs:p.observed_ms,expiresMs:p.expires_ms,microUsd:p.micro_usd,sourceRef:p.entry_source},
    p.entry_wallet===p.wallet&&p.entry_token===p.token_id&&p.observed_ms<=p.submitted_ms&&p.expires_ms>=p.submitted_ms&&BigInt(p.micro_usd)>=MIN_STAKE_MICRO_USD,'entry-read-identity',p.submitted_ms);
   evidence('entry-stake',subject,priceValue(entry),p.observed_ms,p.observed_ms,!!priceAvailable(entry,p.wallet,p.token_id,p.observed_ms)&&entry.read_id===p.entry_read_id,'entry-price',policyFor(p.token_id));
   if(p.content_score>0){
    const available=!!priceAvailable(closing,p.wallet,p.token_id,cutoff);evidence('closing-stake',subject,priceValue(closing),cutoff,cutoff,available,'closing-price',policyFor(p.token_id));
    if(!available||BigInt(JSON.parse(closing.decision).microUsd)>=MIN_STAKE_MICRO_USD)qualified.add(p.wallet);
   }
  }
 }
 const late=[];let page=[],cursor=null;
 do{
  [page]=await read([sql(`SELECT s.id AS submissionId,s.epoch,s.wallet,r.content_score,r.reviewed_ms,r.source_ref,r.reason,r.moderator,
   d.qualified,d.snapshot_read_id,r.rowid AS cursor_row FROM earn_reviews r JOIN earn_submissions s ON s.id=r.submission_id
   LEFT JOIN earn_decisions d ON d.submission_id=s.id WHERE r.reviewed_ms BETWEEN ? AND ? AND s.epoch<? AND r.content_score>0
   ${cursor?'AND (r.reviewed_ms>? OR (r.reviewed_ms=? AND r.rowid>?))':''} ORDER BY r.reviewed_ms,r.rowid LIMIT 100`,
   epoch*DAY_MS,cutoff,epoch,...(cursor?[cursor.reviewed_ms,cursor.reviewed_ms,cursor.cursor_row]:[]))]);
  late.push(...page);if(late.length>1000)return pending('late-approval-bound');cursor=page.at(-1);
 }while(page.length===100);
 app('late-approvals',boardSubject,late.map(({cursor_row,...row})=>row),late.every(row=>row.qualified!==null),'unsettled-approval');
 const lateOnly=[...new Set(late.map(row=>row.wallet))].filter(wallet=>!qualified.has(wallet)).sort();
 for(let offset=0;offset<lateOnly.length;offset+=99){
  const group=lateOnly.slice(offset,offset+99),[rows]=await read([sql(`SELECT * FROM earn_streaks WHERE epoch=? AND wallet IN (${group.map(()=>'?').join(',')})`,epoch-1,...group)]);
  for(const wallet of group)app('previous-board',{kind:'wallet',id:wallet},{epoch:epoch-1,streak:rows.find(row=>row.wallet===wallet)??null});
 }
 // Wallet components and all chronological purchase inputs are gathered below.
 const walletDetails=[],wallets=[...qualified].sort();
 for(let offset=0;offset<wallets.length;offset+=10){
  const group=wallets.slice(offset,offset+10),members=JSON.stringify(group),batch=await read([
   sql('SELECT wallet,CASE WHEN length(assets)<=262144 THEN assets ELSE NULL END AS assets,source_ref FROM earn_owner_snapshots WHERE epoch=? AND wallet IN (SELECT value FROM json_each(?))',epoch,members),
   sql(`SELECT * FROM (SELECT wallet,action_id AS actionId,verified_ms AS verifiedAtMs,verifier,source_ref AS sourceRef,
    ROW_NUMBER() OVER(PARTITION BY wallet ORDER BY action_id) AS ordinal FROM earn_action_completions WHERE wallet IN (SELECT value FROM json_each(?)) AND verified_ms<=?)
    WHERE ordinal<=101 ORDER BY wallet,actionId`,members,cutoff),
   sql(`SELECT * FROM (SELECT s.*,ROW_NUMBER() OVER(PARTITION BY wallet ORDER BY action_id) AS ordinal FROM earn_signed_completions s
    WHERE wallet IN (SELECT value FROM json_each(?)) AND accepted_ms<=?) WHERE ordinal<=101 ORDER BY wallet,action_id`,members,cutoff),
   sql(`SELECT * FROM (SELECT e.wallet,e.token_id AS tokenId,e.enrolled_ms AS enrolledMs,c.activation_ms AS activationMs,
    ROW_NUMBER() OVER(PARTITION BY e.wallet ORDER BY e.token_id) AS ordinal FROM earn_position_enrollments e JOIN earn_fixture_campaigns c ON c.token_id=e.token_id
    WHERE e.wallet IN (SELECT value FROM json_each(?)) AND e.enrolled_ms<=? AND c.activation_ms<=? AND c.activation_ms>?)
    WHERE ordinal<=11 ORDER BY wallet,tokenId`,members,cutoff,cutoff,cutoff-10*DAY_MS),
   sql('SELECT * FROM earn_streaks WHERE epoch=? AND wallet IN (SELECT value FROM json_each(?))',epoch-1,members),
  ]);
  // Bulk position reads still cap each independent wallet/token chain. The
  // original row shapes and ordering are retained in the frozen fact vector.
  const positionRows=new Map();
  for(let positionOffset=0;positionOffset<batch[3].length;positionOffset+=10){
   const positions=batch[3].slice(positionOffset,positionOffset+10),keys=JSON.stringify(positions.map(p=>[p.wallet,p.tokenId,Math.floor(p.enrolledMs/DAY_MS)]));
   const [checkpointRows,eventRows,dailyRows]=await read([
    sql(`SELECT * FROM (SELECT c.*,ROW_NUMBER() OVER(PARTITION BY c.wallet,c.token_id ORDER BY c.epoch) AS ordinal FROM earn_position_cutoffs c JOIN json_each(?) q
     ON c.wallet=json_extract(q.value,'$[0]') AND c.token_id=json_extract(q.value,'$[1]') WHERE c.epoch>=json_extract(q.value,'$[2]') AND c.epoch<=?)
     WHERE ordinal<=12 ORDER BY wallet,token_id,epoch`,keys,epoch),
    sql(`SELECT * FROM (SELECT e.wallet,e.token_id,CASE WHEN length(e.evidence)<=8192 THEN e.evidence ELSE NULL END AS evidence,
     ROW_NUMBER() OVER(PARTITION BY e.wallet,e.token_id ORDER BY e.seq) AS ordinal FROM earn_position_events e JOIN json_each(?) q
     ON e.wallet=json_extract(q.value,'$[0]') AND e.token_id=json_extract(q.value,'$[1]') WHERE e.at_ms<=?) WHERE ordinal<=1001 ORDER BY wallet,token_id,ordinal`,keys,cutoff),
    sql(`SELECT * FROM (SELECT o.*,r.wallet AS read_wallet,r.token_id AS read_token,r.micro_usd AS read_micro_usd,r.observed_ms AS read_observed_ms,
     r.expires_ms AS read_expires_ms,r.source_ref AS read_source_ref,ROW_NUMBER() OVER(PARTITION BY o.wallet,o.token_id ORDER BY o.as_of_ms) AS ordinal
     FROM price_observations o JOIN json_each(?) q ON o.wallet=json_extract(q.value,'$[0]') AND o.token_id=json_extract(q.value,'$[1]') LEFT JOIN earn_stake_reads r ON r.id=o.read_id
     WHERE o.as_of_ms>=(json_extract(q.value,'$[2]')+1)*86400000-1 AND o.as_of_ms<=? AND o.as_of_ms%86400000=86399999
      AND NOT EXISTS(SELECT 1 FROM price_observations n WHERE n.wallet=o.wallet AND n.token_id=o.token_id AND n.as_of_ms=o.as_of_ms AND n.revision>o.revision))
     WHERE ordinal<=12 ORDER BY wallet,token_id,as_of_ms`,keys,cutoff),
   ]);
   for(const p of positions)positionRows.set(canonicalJson([p.wallet,p.tokenId]),[checkpointRows,eventRows,dailyRows].map(rows=>rows.filter(r=>r.wallet===p.wallet&&r.token_id===p.tokenId)));
  }
  for(const wallet of group){
  if(boundExceeded)return pending('cutoff-inventory-byte-bound');
  const [owners,completions,signed,positions,streaks]=batch.map((rows,index)=>rows.filter(r=>r.wallet===wallet).map(({ordinal,...row})=>{
   if([0,1,3].includes(index)){const {wallet:_,...value}=row;return value;}return row;
  }));
  if(completions.length>100||signed.length>100||positions.length>10)return pending('wallet-component-bound',[wallet]);
  if(owners[0]?.assets===null)return pending('ownership-byte-bound',[wallet]);
  let assets=null;try{assets=owners[0]?JSON.parse(owners[0].assets):null;}catch{}
  if(assets&&(!Array.isArray(assets)||assets.length>1000))return pending('ownership-bound',[wallet]);
  const subject={kind:'wallet',id:wallet};evidence('ownership',subject,assets?{wallet,assets}:null,cutoff,cutoff,assets!==null,'ownership');
  evidence('position-inventory',subject,{wallet,positions},cutoff,historyStartMs);
  const signedValid=completions.filter(c=>c.sourceRef.startsWith('signed:')).every(c=>{
   const s=signed.find(s=>s.action_id===c.actionId),grant=issuers.find(g=>g.id===s?.issuer_id),revoked=revocations.find(r=>r.issuer_id===s?.issuer_id);
   return !!s&&!!grant&&s.proof_digest===c.sourceRef.slice(7)&&s.accepted_ms===c.verifiedAtMs&&grant.action_id===c.actionId&&grant.verifier===c.verifier&&
    grant.recorded_ms<=s.accepted_ms&&Math.floor(s.accepted_ms/DAY_MS)>=grant.from_epoch&&Math.floor(s.accepted_ms/DAY_MS)<grant.until_epoch&&(!revoked||s.accepted_ms<revoked.revoked_ms);
  });
  app('action-completions',subject,{wallet,completions,signed},signedValid,'signed-completion-provenance');
  evidence('action-completions',subject,{wallet,completions},cutoff,historyStartMs);
  app('previous-board',subject,{epoch:epoch-1,streak:streaks[0]??null});
  const chains=[];
  for(const position of positions){
   if(boundExceeded)return pending('cutoff-inventory-byte-bound');
   const firstEpoch=Math.floor(position.enrolledMs/DAY_MS),[checkpointRows,eventRows,dailyRows]=positionRows.get(canonicalJson([wallet,position.tokenId]));
   if(checkpointRows.length>11||eventRows.length>1000||dailyRows.length>11||eventRows.some(r=>r.evidence===null))return pending('position-history-bound',[wallet,position.tokenId]);
   const events=eventRows.map(economicEvent),checkpoints=checkpointRows.map(r=>({epoch:r.epoch,sequence:r.sequence,credited:r.credited,stake:r.stake,numerator:r.numerator,denominator:r.denominator,flags:JSON.parse(r.flags),tokenDays:r.token_days,sourceRef:r.source_ref}));
   const valuations=dailyRows.map(r=>({epoch:Math.floor(r.as_of_ms/DAY_MS),asOfMs:r.as_of_ms,...JSON.parse(r.decision),receipt:r.receipt,readId:r.read_id}));
   const chain=verifyPositionChain({wallet,...position,throughEpoch:epoch,events,checkpoints,valuations});chains.push({tokenId:position.tokenId,chain});
   const positionSubject={kind:'wallet-token',id:canonicalJson([wallet,position.tokenId])};
   app('position-checkpoints',positionSubject,{wallet,...position,checkpoints,journal:eventRows.map(r=>JSON.parse(r.evidence))},chain.status==='ready',chain.status==='ready'?'fact-unavailable':chain.dependencies.map(d=>d.epoch+':'+d.reason).join(',').slice(0,256));
   const terminal=checkpoints.at(-1),policy=policyFor(position.tokenId);
   evidence('position-history',positionSubject,{wallet,tokenId:position.tokenId,sequence:events.at(-1)?.sequence??0,creditedUnits:terminal?.credited??'0',events},cutoff,position.enrolledMs,chain.status==='ready','position-chain',
    policy?{wallet,tokenId:position.tokenId,enrolledAtMs:position.enrolledMs,farmProgram:policy.farmProgram,swapProgram:DAMM_V2_PROGRAM}:null);
   for(let day=firstEpoch;day<=epoch;day++){
    const at=(day+1)*DAY_MS-1,row=dailyRows.find(r=>r.as_of_ms===at);
    // Reuse the already-enumerated current closing-price requirement.
    if(at===cutoff&&posts.some(p=>p.wallet===wallet&&p.token_id===position.tokenId&&p.content_score>0))continue;
    evidence('closing-stake',positionSubject,priceValue(row),at,at,!!priceAvailable(row,wallet,position.tokenId,at),'daily-position-price',policy);
   }
  }
  walletDetails.push({wallet,chains});
  }
 }
 if(boundExceeded)return pending('cutoff-inventory-byte-bound');
 const sourceIds=[...new Map(inputs.filter(i=>i.authority==='evidence'&&i.sourceId!=='unconfigured').map(i=>[canonicalJson([i.sourceId,i.sourceRevision]),i])).values()];
 const sourceConfigs=new Map();
 for(let offset=0;offset<sourceIds.length;offset+=50){
  const group=sourceIds.slice(offset,offset+50),[rows]=await read([sql(`SELECT s.source_id,s.source_revision,s.config_json FROM app_evidence_sources s JOIN json_each(?) q
   ON s.source_id=json_extract(q.value,'$[0]') AND s.source_revision=json_extract(q.value,'$[1]')`,JSON.stringify(group.map(i=>[i.sourceId,i.sourceRevision])))]);
  for(const row of rows)sourceConfigs.set(canonicalJson([row.source_id,row.source_revision]),JSON.parse(row.config_json));
 }
 for(const i of inputs.filter(i=>i.authority==='evidence'&&i.sourceId!=='unconfigured')){
  const source=sourceConfigs.get(canonicalJson([i.sourceId,i.sourceRevision]));let valid=!!source&&source.mode==='synthetic-fixture'&&source.decoderVersion===i.decoderVersion&&canonicalJson(source.subject)===canonicalJson(i.subject);
  if(valid){
   try{
    if(['entry-stake','closing-stake'].includes(i.kind))valid=!!i.expectedPolicy&&canonicalJson(normalizePolicy(source.policy))===canonicalJson(normalizePolicy(i.expectedPolicy));
    else if(i.kind==='position-history')valid=!!i.expectedPolicy&&Object.entries(i.expectedPolicy).every(([key,value])=>source.policy[key]===value);
    else valid=source.policy.kind===i.kind&&source.policy.fromMs===i.coverage.fromMs;
   }catch{valid=false;}
  }
  if(!valid){i.available=false;i.pendingReason=source?'source-policy-mismatch':'source-registration-required';}
 }
 for(const i of inputs)delete i.expectedPolicy;
 const current=revisions((await read([sql('SELECT * FROM app_revisions ORDER BY name')]))[0]),versions=revisions(versionRows);
 if(canonicalJson(current)!==canonicalJson(versions))return {kind:'conflict',code:'revision_conflict'};
 return {kind:'loaded',epoch,cutoff,asOfMs,freeze,versions,inputs,walletDetails,measurements:{readBatches:batches,requirements:inputs.length,participants:qualified.size,inventoryBytes}};
}
