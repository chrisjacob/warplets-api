import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createCollectionContextRepository,createCollectionContextService} from '../storage/collection-context.mjs';
import {createCollectionQuotePlanning} from '../application/collection-quotes.mjs';
import {ISSUE_COLLECTION_QUOTE,COLLECTION_QUOTE_POLICY,COLLECTION_QUOTE_TTL_MS,buildCollectionQuoteCommand,quotePrincipal} from './quote-service.mjs';
const clone=v=>JSON.parse(canonicalJson(v));
const frozen=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))frozen(child);Object.freeze(v);}return v;};
const pending=reason=>({kind:'pending',reason,dependencyIds:[]});
const requireValue=(condition,message)=>{if(!condition)throw new TypeError(message);};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const nowValid=n=>Number.isSafeInteger(n)&&n>=0&&n<=8640000000000000;
const bytes=v=>utf8(canonicalJson(v));
export function createCollectionQuoteRepository(driver,ports){
 const {crypto,clock,ids}=ports,{read,replay,execute}=createAtomicReceipts(driver,ports),planning=createCollectionQuotePlanning({crypto});
 const context=createCollectionContextService({repository:createCollectionContextRepository(driver),clock});
 const nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 async function command(input){
  const c=clone(input);requireValue(c&&Object.keys(c).length===6&&c.operationKind===ISSUE_COLLECTION_QUOTE,'Invalid stored quote command.');
  const expected=await buildCollectionQuoteCommand(c.principal,{requestKey:c.requestKey,...c.input},crypto);
  requireValue(canonicalJson(c)===canonicalJson(expected),'Stored quote request digest or identity mismatch.');return c;
 }
 return Object.freeze({
  async issueQuote(input){
   const c=await command(input),prior=await replay(c);if(prior)return prior;
   const request={kind:c.input.kind,targetId:c.input.targetId,materialId:c.input.materialId,expectedTargetVersion:c.input.expectedTargetVersion,expectedMaterialVersion:c.input.expectedMaterialVersion};
   const facts=await context.read(c.principal,{inventoryId:c.input.inventoryId,request});if(facts.kind!=='ready')return pending(facts.reason);
   const asOfMs=facts.observedAtMs;if(!nowValid(asOfMs)||!nowValid(asOfMs+COLLECTION_QUOTE_TTL_MS))return pending('quote-clock-unavailable');
   const quoteId=ids.next();requireValue(id(quoteId),'Server quote identity unavailable.');let quote;
   try{quote=await planning.derive({quoteId,principal:c.principal,inventoryId:c.input.inventoryId,request,context:facts.context,policyVersion:COLLECTION_QUOTE_POLICY,nowMs:asOfMs,expiresMs:asOfMs+COLLECTION_QUOTE_TTL_MS,...(c.input.maxTotalLamports===null?{}:{maxTotalLamports:c.input.maxTotalLamports})});}
   catch(error){if(typeof error.code==='string')return pending(error.code);throw error;}
   const body=canonicalJson(quote);requireValue(utf8(body).length<=32768,'Stored quote byte bound exceeded.');
   if(clock.nowMs()<asOfMs||clock.nowMs()>=quote.expiresMs)return pending('quote-expired-before-storage');
   const atClock=`${nowSql}>=? AND ${nowSql}<?`;
   const participant=`EXISTS(SELECT 1 FROM collect_assets a WHERE a.id=? AND a.inventory_id=? AND a.owner=? AND a.reveal_ms IS NOT NULL AND a.reveal_ms<=${nowSql} AND a.observed_ms<=${nowSql} AND json_valid(a.asset) AND json_extract(a.asset,'$.version')=? AND json_extract(a.asset,'$.pending') IS NULL)`;
   const authority=[atClock,...facts.context.assets.map(()=>participant),"EXISTS(SELECT 1 FROM collect_inventories WHERE id=? AND kind='season' AND season_start=? AND revision=?)"].join(' AND ');
   const values=[quote.asOfMs,quote.expiresMs,...facts.context.assets.flatMap(a=>[a.id,c.input.inventoryId,c.principal.wallet,a.version]),c.input.inventoryId,facts.context.start,Number(facts.inventoryRevision)];
   const issued={...c,nowMs:asOfMs,expectedRevisions:facts.revisions};
   const result=await execute(issued,{businessKey:c.businessIdentity,input:c.input,result:quote,resultRef:quote.id,version:facts.revisions,authoritySql:authority,authorityValues:values,
    child:(gate,v)=>sql(`INSERT INTO app_collection_quotes
      (id,wallet,inventory_id,kind,target_id,material_id,target_version,material_version,policy_version,as_of_ms,expires_ms,fee_lamports,max_total_lamports,source_digest,binding_digest,source_revisions_json,body_json,operation_id)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,
      quote.id,quote.wallet,quote.inventoryId,quote.kind,quote.targetId,quote.materialId,quote.targetVersion,quote.materialVersion,quote.policyVersion,quote.asOfMs,quote.expiresMs,quote.feeLamports,quote.maxTotalLamports,quote.sourceDigest,quote.bindingDigest,canonicalJson(facts.revisions),body,...v,...v)});
   if(result.kind==='conflict'&&(clock.nowMs()<asOfMs||clock.nowMs()>=quote.expiresMs))return pending('quote-expired-before-storage');return result;
  },
  async readQuote(principal,quoteId){
   const p=quotePrincipal(principal);requireValue(id(quoteId),'Invalid quote identity.');
   const [rows]=await read([sql('SELECT q.*,r.state receipt_state,r.principal_key,r.result_json receipt_json,r.output_digest,r.expected_revisions receipt_revisions FROM app_collection_quotes q JOIN app_command_receipts r ON r.operation_id=q.operation_id WHERE q.id=? AND q.wallet=?',quoteId,p.wallet)]);
   if(!rows.length)return {kind:'missing'};requireValue(rows.length===1,'Duplicate stored quote identity.');const row=clone(rows[0]);
   if(utf8(row.body_json).length>32768||row.receipt_state!=='committed'||row.principal_key!=='wallet:'+p.wallet||row.body_json!==row.receipt_json||row.source_revisions_json!==row.receipt_revisions)return pending('quote-storage-conflict');
   let quote;try{quote=JSON.parse(row.body_json);}catch{return pending('quote-storage-conflict');}
   if(quote.format!=='collection-progression-quote-v1'||quote.id!==quoteId||quote.wallet!==p.wallet||quote.executable!==false||quote.costStatus!=='local-preview-only'||quote.ceilingScope!=='disclosed-local-components-only'||quote.networkCost!=='unknown'||quote.totalCost!=='unknown'||quote.costQuote?.network?.status!=='unknown'||quote.costQuote.network.amountLamports!==null)return pending('quote-storage-conflict');
   const {bindingDigest,...bound}=quote;
   if(await crypto.sha256(bytes(bound))!==bindingDigest||await crypto.sha256(bytes(quote.outcomes))!==quote.outcomesDigest||await crypto.sha256(bytes(quote))!==row.output_digest)return pending('quote-storage-conflict');
   const match={id:quote.id,wallet:quote.wallet,inventory_id:quote.inventoryId,kind:quote.kind,target_id:quote.targetId,material_id:quote.materialId,target_version:quote.targetVersion,material_version:quote.materialVersion,policy_version:quote.policyVersion,as_of_ms:quote.asOfMs,expires_ms:quote.expiresMs,fee_lamports:quote.feeLamports,max_total_lamports:quote.maxTotalLamports,source_digest:quote.sourceDigest,binding_digest:bindingDigest};
   if(Object.entries(match).some(([key,value])=>row[key]!==value)||quote.expiresMs!==quote.asOfMs+COLLECTION_QUOTE_TTL_MS)return pending('quote-storage-conflict');
   const now=clock.nowMs();requireValue(nowValid(now),'Invalid quote retrieval clock.');return frozen({kind:'found',quote,lifetime:now<quote.asOfMs?'not-yet-valid':now>=quote.expiresMs?'expired':'within-window',currentStateVerified:false,executable:false});
  },
 });
}
