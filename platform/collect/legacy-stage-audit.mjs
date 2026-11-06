import {publishStage} from '../domain/collections/inventory.mjs';
import {LEVEL_QUOTAS,checkTimestamp,CollectionPolicyError} from '../domain/collections/policy.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {collectionListClosureDigest} from './source-intake.mjs';
export const LEGACY_STAGE_AUDIT_LIMITS=Object.freeze({wallets:10000,chunkWallets:1000,chunkReads:10,contextBytes:65536,workingBytes:1048576});
const fields=['format','inventoryId','stageId','type','publishedAt','opensAt','closesAt','priceLamports','costLamports','allocation','walletLimit','founderApproved','approvedSpendLamports','ballotId','inventoryOverrideReason','walletListId'];
const scalarFields=['id','type','publishedAt','opensAt','closesAt','priceLamports','allocation','walletLimit','approvedSpendLamports','costLamports','termsDigest','ballotId','inventoryOverrideReason'];
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const kind=v=>['whitelist','public','founder','free'].includes(v);
const money=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<(1n<<64n);
const nat=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const encode=v=>JSON.stringify(v,(_k,x)=>typeof x==='bigint'?{$lamports:x.toString()}:x);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
class Hold extends Error{constructor(reason){super(reason);this.reason=reason;}}
const need=(c,reason='legacy-stage-input-invalid')=>{if(!c)throw new Hold(reason);};
function capture(value){
 need(value?.original,'legacy-stage-original-preimage-missing');need(value.originalList,'legacy-stage-original-list-missing');
 const p=value.original,h=value.header,s=value.stored,l=value.originalList;
 need(exact(p,fields)&&p.format==='legacy-stage-publication-preimage-v1'&&id(p.inventoryId)&&id(p.stageId)&&kind(p.type)&&digest(p.walletListId));
 need(money(p.priceLamports)&&money(p.costLamports)&&(p.approvedSpendLamports===null||money(p.approvedSpendLamports))&&nat(p.allocation,1000)&&p.allocation>0);
 need((p.walletLimit===null||nat(p.walletLimit))&&typeof p.founderApproved==='boolean'&&(p.ballotId===null||id(p.ballotId))&&(p.inventoryOverrideReason===null||typeof p.inventoryOverrideReason==='string'&&p.inventoryOverrideReason.trim().length>0&&p.inventoryOverrideReason.length<=500));
 [p.publishedAt,p.opensAt,p.closesAt].forEach(checkTimestamp);
 need(exact(h,['id','kind','tranche','seasonStart'])&&h.id===p.inventoryId&&['genesis','season'].includes(h.kind));
 if(h.kind==='genesis')need(nat(h.tranche,10)&&h.tranche>=1&&h.seasonStart===null);else{checkTimestamp(h.seasonStart);need(h.tranche===null&&p.opensAt>=h.seasonStart);}
 need(Array.isArray(value.priorStages)&&value.priorStages.length<=31);
 for(const prior of value.priorStages){need(exact(prior,['id','type','closesAt'])&&id(prior.id)&&kind(prior.type));checkTimestamp(prior.closesAt);}
 need(new Set(value.priorStages.map(x=>x.id)).size===value.priorStages.length);
 need(exact(s,['terms','membership'])&&s.terms&&Object.keys(s.terms).every(k=>scalarFields.includes(k))&&scalarFields.filter(k=>k!=='approvedSpendLamports').every(k=>Object.hasOwn(s.terms,k)));
 const t=s.terms;need(id(t.id)&&kind(t.type)&&digest(t.termsDigest));
 for(const k of ['priceLamports','costLamports'])need(exact(t[k],['$lamports'])&&money(t[k].$lamports));
 if(t.approvedSpendLamports!==undefined)need(exact(t.approvedSpendLamports,['$lamports'])&&money(t.approvedSpendLamports.$lamports));
 [t.publishedAt,t.opensAt,t.closesAt].forEach(checkTimestamp);need(nat(t.allocation,1000)&&nat(t.walletLimit,1000)&&(t.ballotId===null||id(t.ballotId))&&(t.inventoryOverrideReason===null||typeof t.inventoryOverrideReason==='string'&&t.inventoryOverrideReason.length<=500));
 const m=s.membership;need(m&&['list','unrestricted','pending','free-cut'].includes(m.kind));
 if(m.kind==='list'||m.kind==='free-cut')need(exact(m,['kind','listId','count','walletsDigest'])&&digest(m.listId)&&nat(m.count,10000)&&digest(m.walletsDigest));else need(exact(m,['kind']));
 need(exact(l,['id','count','pageIds','walletsDigest','closureDigest','firstWallet','lastWallet'])&&l.id===p.walletListId&&digest(l.id)&&nat(l.count,10000)&&Array.isArray(l.pageIds)&&l.pageIds.length===Math.max(1,Math.ceil(l.count/100))&&l.pageIds.every(digest)&&new Set(l.pageIds).size===l.pageIds.length&&digest(l.walletsDigest)&&digest(l.closureDigest));
 need(l.count===0?l.firstWallet===null&&l.lastWallet===null:typeof l.firstWallet==='string'&&l.firstWallet.length<=44&&typeof l.lastWallet==='string'&&l.lastWallet.length<=44&&l.firstWallet<=l.lastWallet);
 let previousTranche=null;
 if(h.kind==='genesis'&&h.tranche>1&&value.priorStages.length===0){
  const previous=value.previousTranche;need(exact(previous,['tranche','openingMs','ballotId','ballotTrancheOpeningMs'])&&previous.tranche===h.tranche-1&&previous.ballotId===p.ballotId&&p.ballotId!==null&&previous.openingMs===previous.ballotTrancheOpeningMs,'legacy-stage-previous-tranche-unavailable');checkTimestamp(previous.openingMs);previousTranche=previous;
 }
 const result={original:p,header:h,priorStages:value.priorStages,stored:s,originalList:l,previousTranche},text=encode(result);need(utf8(text).length<=65536,'legacy-stage-bounds');return JSON.parse(text);
}
/** Pure bounded proof over caller-supplied frozen facts. No SQL, receipt,
 * publication, source-completeness, ownership or activation authority is implied. */
export async function auditLegacyStagePublication(value,{createDigest,readWalletChunk}={}){
 const streams=[],metrics={chunkReads:0,wallets:0,hashedBytes:0,maxWorkingBytes:0};let contextBytes=0;
 const stream=()=>{need(typeof createDigest==='function','legacy-stage-digest-unavailable');const s=createDigest();need(s&&typeof s.write==='function'&&typeof s.finish==='function'&&typeof s.abort==='function','legacy-stage-digest-unavailable');streams.push(s);return s;};
 const write=async(s,bytes)=>{metrics.hashedBytes+=bytes.length;await s.write(bytes);};
 const hash=async bytes=>{const s=stream();await write(s,bytes);const d=await s.finish();need(digest(d),'legacy-stage-digest-unavailable');return d;};
 try{
  // Capture bounded header/projection synchronously before any injected await.
  const captured=capture(value),{original:p,header:h,priorStages,stored,originalList:l}=captured;contextBytes=utf8(canonicalJson(captured)).length;metrics.maxWorkingBytes=contextBytes*3+16384;
  const domainInput={id:p.stageId,type:p.type,publishedAt:p.publishedAt,opensAt:p.opensAt,closesAt:p.closesAt,priceLamports:BigInt(p.priceLamports),allocation:p.allocation,walletLimit:p.walletLimit,founderApproved:p.founderApproved,approvedSpendLamports:p.approvedSpendLamports===null?undefined:BigInt(p.approvedSpendLamports),wallets:[]};
  // Membership cannot affect any scalar reducer branch. The empty sentinel is
  // confined to this call; its wallets output is discarded, never certified.
  const derived=publishStage({id:h.id,kind:h.kind,tranche:h.tranche,version:0,slots:1000,stages:priorStages,admissions:[],remaining:LEVEL_QUOTAS,fulfilled:0},domainInput).stages.at(-1),{wallets:ignored,...scalar}=derived;
  const expected=JSON.parse(encode({...scalar,costLamports:BigInt(p.costLamports),termsDigest:stored.terms.termsDigest,ballotId:p.ballotId,inventoryOverrideReason:p.inventoryOverrideReason}));
  need(canonicalJson(expected)===canonicalJson(stored.terms),'legacy-stage-normalized-projection-mismatch');
  const m=stored.membership;
  if(['whitelist','founder'].includes(p.type))need(m.kind==='list'&&m.listId===l.id&&m.count===l.count&&m.walletsDigest===l.walletsDigest,'legacy-stage-stored-membership-mismatch');
  else need(p.type==='public'?m.kind==='unrestricted':['pending','free-cut'].includes(m.kind),'legacy-stage-stored-membership-mismatch');
  const crypto={sha256:hash};
  need(await collectionListClosureDigest(l,crypto)===l.closureDigest,'legacy-stage-list-seal-mismatch');
  const manifest={format:'collection-list-v1',count:l.count,pageCount:l.pageIds.length,pageIds:l.pageIds,walletsDigest:l.walletsDigest};
  need(await hash(utf8(canonicalJson(manifest)))===l.id,'legacy-stage-list-seal-mismatch');
  const terms=stream(),wallets=stream(),prefix=encode([p.inventoryId,p.stageId,p.type,p.publishedAt,p.opensAt,p.closesAt,BigInt(p.priceLamports),BigInt(p.costLamports),p.allocation,p.walletLimit,p.founderApproved,p.approvedSpendLamports===null?null:BigInt(p.approvedSpendLamports),p.ballotId,p.inventoryOverrideReason]);
  await write(terms,utf8(prefix.slice(0,-1)+',['));await write(wallets,utf8('['));let last=null,first=null;
  for(let offset=0;offset<l.count;offset+=1000){
   need(typeof readWalletChunk==='function','legacy-stage-original-list-missing');
   const chunk=await readWalletChunk({listId:l.id,offset,limit:1000});metrics.chunkReads++;need(metrics.chunkReads<=10,'legacy-stage-bounds');
   need(exact(chunk,['listId','offset','wallets','done'])&&chunk.listId===l.id&&chunk.offset===offset&&Array.isArray(chunk.wallets)&&chunk.wallets.length===Math.min(1000,l.count-offset)&&chunk.done===(offset+chunk.wallets.length===l.count),'legacy-stage-list-chunk-invalid');
   // Snapshot the bounded chunk before hashing can yield to its producer.
   const rows=chunk.wallets.slice();for(const wallet of rows){need(typeof wallet==='string'&&wallet.length<=44,'legacy-stage-list-chunk-invalid');try{decode58(wallet,32);}catch{throw new Hold('legacy-stage-list-chunk-invalid');}need(last===null||last<wallet,'legacy-stage-list-order');first??=wallet;last=wallet;}
   const text=(offset?',':'')+JSON.stringify(rows).slice(1,-1),bytes=utf8(text),working=contextBytes*3+utf8(JSON.stringify(chunk)).length*2+bytes.length*3+utf8(prefix).length+16384;
   metrics.maxWorkingBytes=Math.max(metrics.maxWorkingBytes,working);need(working<=1048576,'legacy-stage-bounds');
   await write(terms,bytes);await write(wallets,bytes);metrics.wallets+=rows.length;
  }
  await write(wallets,utf8(']'));await write(terms,utf8(']]'));
  const walletsDigest=await wallets.finish(),termsDigest=await terms.finish();
  need(metrics.wallets===l.count&&first===l.firstWallet&&last===l.lastWallet&&walletsDigest===l.walletsDigest,'legacy-stage-list-digest-mismatch');
  need(termsDigest===stored.terms.termsDigest,'legacy-stage-terms-digest-mismatch');
  return freeze({kind:'verified',inventoryId:p.inventoryId,stageId:p.stageId,termsDigest,originalHeaderDigest:await hash(utf8(canonicalJson(p))),originalListId:l.id,walletsDigest,walletCount:l.count,normalizedProjectionDigest:await hash(utf8(canonicalJson(expected))),membership:p.type==='free'?'separate-free-cut-audit-required':p.type==='public'?'unrestricted':'exact-original-list',verification:'publication-preimage-and-scalar-reducer-only',source:'local-reference-fixture',executable:false,metrics});
 }catch(error){await Promise.allSettled(streams.map(async s=>s.abort(error)));return freeze({kind:'held',reason:error instanceof Hold?error.reason:error instanceof CollectionPolicyError?'legacy-stage-rule:'+error.code:'legacy-stage-audit-unavailable',metrics});}
}
