import {packRecoveryV2Checkpoint} from './v2-checkpoint.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {prepareRefreshCommand,REFRESH_COMMAND} from '../nfts/refresh-repository.mjs';
import {createRefreshCheckpoints} from '../nfts/refresh-checkpoint.mjs';
import {createRefreshWorkflow} from '../nfts/refresh-workflow.mjs';
import {createRefreshEvidenceReader} from '../nfts/refresh-evidence-reader.mjs';
const START=-9007199254740991,need=(ok,reason)=>{if(!ok)throw new TypeError('Recovery NFT refresh '+reason);};
const bytes=v=>utf8(canonicalJson(v)).length,same=(a,b)=>canonicalJson(a)===canonicalJson(b),hash=(crypto,v)=>crypto.sha256(utf8(canonicalJson(v)));
const bound=(field,size,alias=field)=>`CASE WHEN length(CAST(${field} AS BLOB))<=${size} THEN ${field} ELSE NULL END ${alias}`;
const receiptFields=['operation_id','principal_key','operation_kind','business_key','request_key','request_digest','expected_revisions','input_json','result_json','output_digest','result_ref','state'].map(k=>bound(k,k==='input_json'?8192:k==='result_json'?2048:1024)).join(',')+',created_ms';
export const nftRefreshCountsSql=()=>sql(`SELECT
 (SELECT COUNT(*) FROM app_command_receipts WHERE operation_kind='${REFRESH_COMMAND}') receipts,
 (SELECT COUNT(*) FROM app_nft_refresh_revisions) revisions,
 (SELECT COUNT(*) FROM app_nft_refresh_revisions n JOIN app_command_receipts r ON r.operation_id=n.operation_id WHERE r.operation_kind='${REFRESH_COMMAND}' AND r.state='committed' AND r.result_ref=n.state_digest AND r.created_ms=n.created_ms) revisionOrigins,
 (SELECT COUNT(*) FROM app_nft_refresh_revisions n JOIN app_private_artifacts a ON a.object_key=n.object_key WHERE a.operation_id=n.operation_id AND a.recorded_ms=n.created_ms AND a.semantic_digest=n.state_digest) checkpointOrigins,
 (SELECT COUNT(*) FROM app_nft_refresh_revisions WHERE revision=0 AND prior_state_digest IS NULL) roots,
 (SELECT COUNT(*) FROM app_nft_refresh_revisions n JOIN app_nft_refresh_revisions p ON p.request_id=n.request_id AND p.revision=n.revision-1 AND p.state_digest=n.prior_state_digest AND p.owner=n.owner AND p.asset_id=n.asset_id AND p.request_digest=n.request_digest WHERE n.revision>0) predecessors`);
const revisionSql=(where,...values)=>sql(`SELECT ${['request_id','owner','asset_id','request_digest','state_digest','prior_state_digest','object_key','operation_id'].map(k=>bound('n.'+k,k==='object_key'?256:128,k)).join(',')},n.revision,n.created_ms,
 ${bound('a.byte_digest',64,'byte_digest')},a.size,${bound('a.semantic_digest',64,'semantic_digest')},${bound('a.content_type',64,'content_type')},${bound('a.operation_id',128,'artifact_operation')},a.recorded_ms
 FROM app_nft_refresh_revisions n JOIN app_private_artifacts a ON a.object_key=n.object_key WHERE ${where} LIMIT 2`,...values);
/** Historical, private verification. Retained actor authentication is established by
 * committed receipt linkage; original fixture provider authenticity stays unverified. */
export async function verifyRecoveredNftRefresh(receipt,{read,artifacts,crypto,onWorking=(_n)=>{}}){
 need(bytes(receipt)<=16384,'receipt bound.');const r=structuredClone(receipt);need(Object.values(r).every(v=>v!==null)&&r.operation_kind===REFRESH_COMMAND&&r.state==='committed','committed receipt.');
 const input=JSON.parse(r.input_json),result=JSON.parse(r.result_json),versions=JSON.parse(r.expected_revisions);
 need(canonicalJson(input)===r.input_json&&canonicalJson(result)===r.result_json,'canonical receipt.');
 need(Object.keys(versions).sort().join(',')==='control,earn,source'&&Object.values(versions).every(v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&Number.isSafeInteger(Number(v))),'historical revisions.');
 need(typeof r.principal_key==='string'&&(r.principal_key.startsWith('wallet:')||r.principal_key.startsWith('operator:')),'principal.');
 const who=r.principal_key.startsWith('wallet:')?{kind:'wallet',wallet:r.principal_key.slice(7)}:{kind:'operator',id:r.principal_key.slice(9)},command=await prepareRefreshCommand(who,{requestKey:r.request_key,input},crypto,{nowMs:()=>r.created_ms});
 need(command.requestDigest===r.request_digest&&command.businessIdentity===r.business_key,'command identity.');
 let retained=bytes(r)*3;const store={async getVerified(identity){const got=await artifacts.getVerified(identity);onWorking(retained+(got.status==='verified'?got.bytes.byteLength*4:0));return got;}},checkpoints=createRefreshCheckpoints({crypto,store});
 async function restoreRow(n){need(n&&Number.isInteger(n.revision)&&n.revision>=0&&n.revision<=16&&Number.isSafeInteger(n.created_ms)&&n.created_ms>=0,'revision row.');need(Object.entries(n).every(([k,v])=>v!==null||k==='prior_state_digest'&&n.revision===0),'bounded revision.');
  const identity={key:n.object_key,byteDigest:n.byte_digest,size:n.size,semanticDigest:n.semantic_digest,visibility:'private',contentType:n.content_type};
  need(n.artifact_operation===n.operation_id&&n.recorded_ms===n.created_ms&&n.semantic_digest===n.state_digest,'checkpoint catalog.');
  const pin={identity,requestDigest:n.request_digest,stateDigest:n.state_digest},restored=await checkpoints.restore(pin);need(restored.kind==='restored','checkpoint unavailable.');const s=restored.state;
  need(s.request.requestId===n.request_id&&s.request.owner===n.owner&&s.request.assetId===n.asset_id&&s.revision===n.revision&&(n.revision===0?s.request.createdMs:s.history.at(-1).event.atMs)===n.created_ms,'checkpoint revision identity.');
  return {identity,state:s};
 }
 const [rows]=await read([revisionSql('n.operation_id=?',r.operation_id)]);need(rows.length===1,'exact revision child.');const n=rows[0];retained+=bytes(n)*3;
 const current=await restoreRow(n),s=current.state;retained+=bytes(s)*4;onWorking(retained);
 // A self-consistent checkpoint is not a second asset ledger. Bind only the
 // immutable original identity; current owner/version may legitimately change.
 const [assets,bindings]=await read([sql(`SELECT ${bound('a.id',128,'id')},${bound('a.inventory_id',128,'inventory_id')},a.bind_ms,${bound('a.slot',4096,'slot')},
 CASE WHEN length(CAST(a.asset AS BLOB))<=16384 AND json_valid(a.asset) THEN json_extract(a.asset,'$.level') END level,
 ${bound('h.kind',16,'inventory_kind')},h.tranche,h.season_start,${bound('v.slot_key',4096,'vault_slot')},${bound('v.coords',4096,'vault_coords')}
 FROM collect_assets a JOIN collect_inventories h ON h.id=a.inventory_id JOIN vault_assets v ON v.id=a.id WHERE a.id=?`,n.asset_id),
 sql(`SELECT ${bound('event_id',128)},observed_ms,${bound('body',4096)} FROM vault_observations WHERE asset_id=? AND kind='bind' ORDER BY rowid LIMIT 2`,n.asset_id)]);
 need(assets.length===1&&bindings.length===1,'immutable asset/bind coverage.');const a=assets[0],b=bindings[0],m=s.metadata;
 need(typeof a.slot==='string'&&typeof a.vault_slot==='string'&&typeof a.vault_coords==='string'&&typeof b.body==='string','immutable identity bounds.');const event=JSON.parse(b.body);
 need(a.id===m.asset.id&&same({id:a.inventory_id,kind:a.inventory_kind,tranche:a.tranche,season_start:a.season_start},m.inventory)&&a.inventory_kind==='genesis'&&a.bind_ms===m.bindMs&&a.level===m.asset.level&&same(JSON.parse(a.slot),m.slot)&&same(JSON.parse(a.vault_slot),m.slot)&&same(JSON.parse(a.vault_coords),m.slot),'immutable Collect/Vault metadata binding.');
 need(Object.keys(event).sort().join(',')==='assetId,at,eventId,kind,owner,slot'&&event.assetId===a.id&&event.eventId===b.event_id&&event.kind==='bind'&&b.observed_ms===m.bindMs&&event.at===new Date(m.bindMs).toISOString()&&same(event.slot,m.slot),'immutable Vault bind observation.');
 retained+=bytes(assets)+bytes(bindings);onWorking(retained);
 const expected={requestId:n.request_id,revision:n.revision,owner:n.owner,assetId:n.asset_id,requestDigest:n.request_digest,stateDigest:n.state_digest,priorStateDigest:n.prior_state_digest,identity:current.identity};
 need(r.created_ms===n.created_ms&&r.result_ref===n.state_digest&&same(result,expected)&&await hash(crypto,expected)===r.output_digest,'exact result.');
 const evidence=createRefreshEvidenceReader({read,artifacts:store,crypto,historicalNowMs:r.created_ms,onWorking:n=>onWorking(retained+n)});let prior=null;
 if(n.revision===0){need(n.prior_state_digest===null&&input.action==='create'&&input.assetId===s.request.assetId&&input.expectedAssetVersion===s.request.expectedVersion&&input.referenceIdentity.byteDigest===s.request.referenceDigest&&input.quoteIdentity.byteDigest===s.request.quoteDigest&&who.kind==='wallet'&&who.wallet===n.owner,'create binding.');
  need(s.request.requestId===JSON.parse(command.businessIdentity)[0]&&s.history.length===0,'create request identity.');
 }else{
  need(input.action==='advance'&&input.requestId===n.request_id&&input.expectedRevision===n.revision-1&&input.expectedStateDigest===n.prior_state_digest,'advance binding.');
  const [previous,previousReceipts]=await read([revisionSql('n.request_id=? AND n.revision=?',n.request_id,n.revision-1),sql(`SELECT ${receiptFields} FROM app_command_receipts WHERE operation_id=(SELECT operation_id FROM app_nft_refresh_revisions WHERE request_id=? AND revision=?)`,n.request_id,n.revision-1)]);
  need(previous.length===1&&previousReceipts.length===1,'predecessor exists.');const p=previous[0],pr=previousReceipts[0];need(p.state_digest===n.prior_state_digest&&p.request_digest===n.request_digest&&p.owner===n.owner&&p.asset_id===n.asset_id&&p.created_ms<=n.created_ms&&pr.state==='committed'&&pr.operation_kind===REFRESH_COMMAND&&pr.result_ref===p.state_digest&&pr.created_ms===p.created_ms,'predecessor continuity.');
  const restored=await restoreRow(p);prior=restored.state;retained+=(bytes(prior)+bytes(pr)+bytes(p))*4;onWorking(retained);
  const priorResult={requestId:p.request_id,revision:p.revision,owner:p.owner,assetId:p.asset_id,requestDigest:p.request_digest,stateDigest:p.state_digest,priorStateDigest:p.prior_state_digest,identity:restored.identity};need(pr.result_json===canonicalJson(priorResult)&&pr.output_digest===await hash(crypto,priorResult),'predecessor result.');
  const last=s.history.at(-1),event={eventId:r.request_key,kind:input.event.kind,input:input.event.input,principal:who,atMs:r.created_ms};need(same(last.event,event)&&same(s.history.slice(0,-1),prior.history)&&same(s.metadata,prior.metadata)&&same(s.request,prior.request),'history prefix or current event.');
  const metadata={...prior.metadata,asset:{...prior.metadata.asset,owner:last.context.owner,version:last.context.version},observedMs:last.context.observedMs},derived=await createRefreshWorkflow({crypto}).advance(prior,event,metadata);need(same(derived.state,s),'exact predecessor transition.');
 }
 const ref=n.revision===0?input.referenceIdentity:await evidence.byDigest(s.request.referenceDigest),quoteIdentity=n.revision===0?input.quoteIdentity:await evidence.byDigest(s.request.quoteDigest),quote=await evidence.originals(prior??s,ref,quoteIdentity);
 need(quote.expiresMs>s.request.createdMs,'original quote expiry.');
 if(prior){const last=s.history.at(-1);await evidence.evidence(prior,last.event,quote);if(['approve','request-fulfillment','fulfill-recording'].includes(last.event.kind)&&last.context.owner===s.request.owner&&last.context.version===s.request.expectedVersion)need(quote.expiresMs>r.created_ms,'historical quote expiry.');}
 return {operationId:r.operation_id,requestId:n.request_id,revision:n.revision,stateDigest:n.state_digest,resultDigest:await hash(crypto,['v2-nft-refresh',r.operation_id,r.request_digest,r.output_digest,n.prior_state_digest,n.state_digest]),rehearsalOnly:true,metadataApplied:false,financialExecution:false};
}
export function createRecoveryV2NftRefreshReconciler({driver,artifacts,crypto,repository,onMeasure=(_value)=>{}}){return {async step(loaded,c){
 const retained=bytes(loaded)+bytes(c);need(typeof loaded.run.checkpoint_json==='string'&&utf8(loaded.run.checkpoint_json).length<=131072&&bytes(packRecoveryV2Checkpoint(c))<=131072&&retained<=393216,'checkpoint bound.');let operations=0,readBytes=0,workingBytes=retained*2,maxBatchBytes=0,objectReads=0;
 const work=n=>{workingBytes=Math.max(workingBytes,retained*2+n);need(workingBytes<=1048576,'working byte bound.');};
 const read=async statements=>{operations+=statements.length;const measured=measureBatch(statements);maxBatchBytes=Math.max(maxBatchBytes,measured.batchBytes);need(operations<=56&&measured.batchBytes<=262144,'SQL/operation bound.');const out=(await driver.batch(statements)).map(v=>v.rows),size=bytes(out);need(size<=196608,'read bound.');readBytes+=size;work(size*4);return out;};
 const store={async getVerified(identity){need(++operations<=56,'object operation bound.');objectReads++;return artifacts.getVerified(identity);}};
 const [rows]=await read([sql(`SELECT rowid recovery_cursor,${receiptFields} FROM app_command_receipts WHERE operation_kind=? AND rowid>? ORDER BY rowid LIMIT 1`,REFRESH_COMMAND,c.nftRefreshCursor??START)]);let delta,check;
 if(rows.length){const r=rows[0],proof=await verifyRecoveredNftRefresh(r,{read,artifacts:store,crypto,onWorking:work});delta={nftRefreshCursor:r.recovery_cursor,checkedNftRefresh:(c.checkedNftRefresh??0)+1};check={phase:'nft-refresh',scope:r.operation_id,ordinal:0,resultDigest:proof.resultDigest,itemCount:1};}
 else{const [counts,proofs]=await read([nftRefreshCountsSql(),sql("SELECT COUNT(*) n,COALESCE(SUM(p.item_count),0) items FROM app_recovery_reconcile_checks p JOIN app_command_receipts r ON r.operation_id=p.scope AND r.operation_kind=? WHERE p.restore_id=? AND p.phase='nft-refresh' AND p.ordinal=0 AND p.target_watermark=?",REFRESH_COMMAND,loaded.run.id,c.targetWatermark)]),n=counts[0];need(n.receipts===(c.checkedNftRefresh??0)&&n.receipts===n.revisions&&n.revisionOrigins===n.revisions&&n.checkpointOrigins===n.revisions&&n.roots+n.predecessors===n.revisions&&proofs[0].n===n.receipts&&proofs[0].items===n.receipts,'complete revision/receipt/catalog/predecessor coverage.');delta={phase:'reconcile-economics',nftRefreshComplete:true,nftRefreshCursor:null};check={phase:'nft-refresh-count',scope:'complete',ordinal:0,resultDigest:await hash(crypto,['v2-nft-refresh-count',n]),itemCount:n.receipts};}
 onMeasure({operations,objectReads,readBytes,workingBytes,maxBatchBytes});return repository.advance(loaded,{delta,targetWatermark:c.targetWatermark,check:{...check,targetWatermark:c.targetWatermark}});
 }};}
