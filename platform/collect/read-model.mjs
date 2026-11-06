import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
export const COLLECTION_READ_LIMITS=Object.freeze({page:25,recordBytes:16384,responseBytes:262144});
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const time=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const iso=value=>new Date(value).toISOString();
const pending=reason=>({kind:'pending',reason});
class Unavailable extends Error{}
function check(condition,reason){if(!condition)throw new Unavailable(reason);}
function input(value,owner=false){
 const q=JSON.parse(canonicalJson(value));
 if(!time(q.nowMs)||q.assetId!==undefined&&!identifier(q.assetId)||q.operationId!==undefined&&!identifier(q.operationId)||q.after!==undefined&&q.after!==''&&!identifier(q.after))throw new TypeError('Invalid collection read query.');
 if(owner){if(q.principal?.kind!=='wallet'||Object.keys(q.principal).length!==2)throw new TypeError('Wallet principal required.');decode58(q.principal.wallet,32);}
 return q;
}
const revisionSql="SELECT CAST(revision AS TEXT) revision FROM app_revisions WHERE name='source'";
const scalar=(table,key)=>`CASE WHEN length(CAST(${table}.${key} AS BLOB))<=128 THEN ${table}.${key} ELSE NULL END ${key}`;
const assetColumns=`${['id','inventory_id','owner'].map(key=>scalar('a',key)).join(',')},a.bind_ms,a.observed_ms,a.reveal_ms,
 CASE WHEN a.reveal_ms IS NOT NULL AND a.reveal_ms<=? AND length(CAST(a.asset AS BLOB))<=16384 THEN a.asset ELSE NULL END asset_json,
 v.observed_ms owner_observed_ms,
 CASE WHEN length(CAST(v.body AS BLOB))<=4096 AND json_valid(v.body) THEN json_object('kind',json_extract(v.body,'$.kind'),'assetId',json_extract(v.body,'$.assetId'),'at',json_extract(v.body,'$.at'),'owner',CASE WHEN v.kind='bind' THEN json_extract(v.body,'$.owner') ELSE json_extract(v.body,'$.to') END) ELSE NULL END owner_json,
 CASE WHEN length(CAST(vault.owner AS BLOB))<=128 THEN vault.owner ELSE NULL END vault_owner,vault.latest_ms vault_latest_ms`;
const assetJoins=`LEFT JOIN vault_assets vault ON vault.id=a.id LEFT JOIN vault_observations v ON v.rowid=(SELECT o.rowid FROM vault_observations o WHERE o.asset_id=a.id AND o.kind IN ('bind','transfer') ORDER BY o.observed_ms DESC,o.rowid DESC LIMIT 1)`;
const operationColumns=`${['id','kind','inventory_id','owner'].map(key=>scalar('op',key)).join(',')},op.created_ms,op.settled_ms,
 CASE WHEN length(CAST(op.operation AS BLOB))<=16384 AND json_valid(op.operation) THEN json_object('stageId',json_extract(op.operation,'$.stageId'),'targetId',json_extract(op.operation,'$.targetId'),'materialId',json_extract(op.operation,'$.materialId'),'priceLamports',json_extract(op.operation,'$.priceLamports'),'costLamports',json_extract(op.operation,'$.costLamports'),'feeLamports',json_extract(op.operation,'$.feeLamports')) ELSE NULL END operation_json,
 CASE WHEN length(CAST(op.receipt AS BLOB))<=16384 AND json_valid(op.receipt) THEN json_object('assetId',json_extract(op.receipt,'$.assetId'),'materialId',json_extract(op.receipt,'$.materialId'),'operationId',json_extract(op.receipt,'$.operationId'),'at',json_extract(op.receipt,'$.at')) ELSE NULL END receipt_json,
 op.receipt IS NOT NULL has_receipt,r.operation_id IS NOT NULL has_quote_link,r.fair_policy_hash IS NOT NULL has_fair_policy,${['quote_id','quote_binding_digest','fair_policy_hash'].map(key=>scalar('r',key)).join(',')},
 (SELECT MIN(c.observed_ms) FROM app_collection_operation_conflicts c WHERE c.operation_id=op.id AND c.status='held') hold_ms`;
function parse(value,reason){check(typeof value==='string',reason);let body;try{body=JSON.parse(value);}catch{throw new Unavailable(reason);}check(body&&typeof body==='object'&&!Array.isArray(body),reason);return body;}
function amount(value){if(value==null)return null;check(value&&typeof value==='object'&&Object.keys(value).length===1&&typeof value.$lamports==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value.$lamports)&&BigInt(value.$lamports)<(1n<<64n),'operation-amount-invalid');return value.$lamports;}
function assetView(row,nowMs){
 check(identifier(row.id)&&identifier(row.inventory_id)&&typeof row.owner==='string'&&time(row.bind_ms)&&time(row.observed_ms)&&row.bind_ms<=row.observed_ms&&row.observed_ms<=nowMs,'asset-observation-unavailable');
 check(time(row.owner_observed_ms)&&row.owner_observed_ms>=row.bind_ms&&row.owner_observed_ms<=row.observed_ms&&time(row.vault_latest_ms)&&row.vault_latest_ms>=row.owner_observed_ms&&row.vault_latest_ms<=nowMs&&row.vault_owner===row.owner,'owner-observation-unavailable');
 const owner=parse(row.owner_json,'owner-observation-unavailable');check(owner.assetId===row.id&&['bind','transfer'].includes(owner.kind)&&owner.owner===row.owner&&owner.at===iso(row.owner_observed_ms),'owner-observation-conflict');
 check(row.reveal_ms===null||time(row.reveal_ms)&&row.reveal_ms>=row.bind_ms&&row.reveal_ms<=row.observed_ms,'asset-reveal-unavailable');
 const view={id:row.id,inventoryId:row.inventory_id,owner:row.owner,revealStatus:row.reveal_ms===null?'unrevealed':'revealed',revealedAt:row.reveal_ms===null?null:iso(row.reveal_ms),ownerObservedAt:row.owner_observed_ms===null?null:iso(row.owner_observed_ms),evidenceStatus:'local-fixture',source:'local-fixture',executable:false};
 if(row.reveal_ms===null)return view;
 check(time(row.reveal_ms)&&row.reveal_ms>=row.bind_ms&&row.reveal_ms<=row.observed_ms,'asset-reveal-unavailable');
 const body=parse(row.asset_json,'asset-body-unavailable');
 check(body.id===row.id&&body.owner===row.owner&&Number.isInteger(body.level)&&body.level>=1&&body.level<=10&&natural(body.version)&&natural(body.rerolls)&&time(body.eligibleAt)&&(body.expiresAt===null||time(body.expiresAt))&&(body.pending===null||identifier(body.pending)),'asset-body-invalid');
 check(body.traits&&Object.keys(body.traits).length===3&&['model','backdrop','symbol'].every(key=>typeof body.traits[key]==='string'&&body.traits[key].length>0&&body.traits[key].length<=256&&body.traits[key].trim()===body.traits[key]),'asset-traits-invalid');
 return {...view,level:body.level,traits:body.traits,version:body.version,rerolls:body.rerolls,nextRerollAt:body.eligibleAt?iso(body.eligibleAt):null,expiresAt:body.expiresAt?iso(body.expiresAt):null,operationPending:body.pending!==null};
}
function operationView(row,nowMs){
 check(identifier(row.id)&&identifier(row.inventory_id)&&['mint','upgrade','visual'].includes(row.kind)&&time(row.created_ms)&&row.created_ms<=nowMs&&(row.settled_ms===null||time(row.settled_ms)&&row.settled_ms>=row.created_ms&&row.settled_ms<=nowMs),'operation-observation-unavailable');
 const body=parse(row.operation_json,'operation-body-unavailable'),receipt=row.has_receipt?parse(row.receipt_json,'operation-receipt-unavailable'):null;
 for(const key of ['stageId','targetId','materialId'])check(body[key]==null||identifier(body[key]),'operation-participant-invalid');
 check(receipt?.assetId==null||identifier(receipt.assetId),'operation-receipt-invalid');
 const view={id:row.id,kind:row.kind,inventoryId:row.inventory_id,owner:row.owner,stageId:body.stageId??null,targetId:body.targetId??null,materialId:body.materialId??null,status:row.settled_ms===null?'awaiting-evidence':'fulfilled',createdAt:iso(row.created_ms),priceLamports:amount(body.priceLamports),costLamports:amount(body.costLamports),feeLamports:amount(body.feeLamports),assetId:receipt?.assetId??null,source:'local-fixture',executable:false};
 check(typeof row.owner==='string'&&(row.kind==='mint'?view.stageId!==null&&view.targetId===null&&view.materialId===null&&view.priceLamports!==null&&view.costLamports!==null&&view.feeLamports===null:view.stageId===null&&view.targetId!==null&&view.feeLamports!==null&&view.priceLamports===null&&view.costLamports===null&&(row.kind==='visual'?view.materialId===null:view.materialId!==null&&view.materialId!==view.targetId)),'operation-shape-invalid');
 check(row.settled_ms===null?receipt===null:receipt!==null&&receipt.operationId===row.id&&receipt.at===row.settled_ms&&(row.kind==='mint'?view.assetId!==null:view.assetId===view.targetId&&receipt.materialId===view.materialId),'operation-settlement-inconsistent');
 if(row.has_quote_link){check(identifier(row.quote_id)&&/^[a-f0-9]{64}$/.test(row.quote_binding_digest)&&(!row.has_fair_policy||/^[a-f0-9]{64}$/.test(row.fair_policy_hash)),'operation-quote-invalid');Object.assign(view,{quoteId:row.quote_id,bindingDigest:row.quote_binding_digest,fairness:row.has_fair_policy?'configured-offline-beacon':'manual-fixture'});}
 if(row.hold_ms!==null){check(time(row.hold_ms)&&row.hold_ms<=nowMs&&row.settled_ms===null,'operation-hold-incompatible');view.reconciliation={status:'held',reason:'external-transfer',observedAt:iso(row.hold_ms)};}
 return view;
}
/** Bounded display reads only. No aggregate inventory state, concealed metadata,
 * commitment, source receipt, or other wallet's operation is projected. */
export function createCollectionReadRepository(driver){
 async function read(statement,project){
  const result=await driver.batch([sql(revisionSql),statement,sql(revisionSql)]),before=result[0].rows,rows=result[1].rows,after=result[2].rows;
  if(before.length!==1||after.length!==1||typeof before[0].revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(before[0].revision))return pending('collection-read-revision-unavailable');
  if(before[0].revision!==after[0].revision)return pending('collection-read-revision-changed');
  try{const value=project(rows);if(utf8(canonicalJson(value)).length>COLLECTION_READ_LIMITS.responseBytes)return pending('collection-read-response-bound');return value===null?{kind:'missing'}:{kind:'ready',value};}catch(error){if(error instanceof Unavailable)return pending(error.message);throw error;}
 }
 const page=(rows,view)=>({items:rows.slice(0,25).map(view),nextCursor:rows.length>25?rows[24].id:null});
 return Object.freeze({
  readAsset(value){const q=input(value);if(!identifier(q.assetId))throw new TypeError('Asset ID required.');return read(sql(`SELECT ${assetColumns} FROM collect_assets a ${assetJoins} WHERE a.id=? LIMIT 1`,q.nowMs,q.assetId),rows=>rows.length?assetView(rows[0],q.nowMs):null);},
  listOwnedAssets(value){const q=input(value,true);return read(sql(`SELECT ${assetColumns} FROM collect_assets a ${assetJoins} WHERE a.owner=? AND a.id>? ORDER BY a.id LIMIT 26`,q.nowMs,q.principal.wallet,q.after??''),rows=>page(rows,row=>assetView(row,q.nowMs)));},
  listOwnOperations(value){const q=input(value,true);return read(sql(`SELECT ${operationColumns} FROM collect_operations op LEFT JOIN app_collection_reservations r ON r.operation_id=op.id WHERE op.owner=? AND op.id>? ORDER BY op.id LIMIT 26`,q.principal.wallet,q.after??''),rows=>page(rows,row=>operationView(row,q.nowMs)));},
  readOwnOperation(value){const q=input(value,true);if(!identifier(q.operationId))throw new TypeError('Operation ID required.');return read(sql(`SELECT ${operationColumns} FROM collect_operations op LEFT JOIN app_collection_reservations r ON r.operation_id=op.id WHERE op.owner=? AND op.id=? LIMIT 1`,q.principal.wallet,q.operationId),rows=>rows.length?operationView(rows[0],q.nowMs):null);},
 });
}
