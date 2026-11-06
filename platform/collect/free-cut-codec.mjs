import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {snapshotSeasonFreeWallets} from '../domain/collections/policy.mjs';
export const COLLECTION_CUT_BOUNDS=Object.freeze({recordBytes:65536,pageHoldings:100,pages:100,holdings:10000,summaryReadBytes:1048576});
const fail=(ok,code)=>{if(!ok){const e=new TypeError(code);e.code=code;throw e;}};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const nat=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const time=v=>nat(v,8640000000000000);
const revision=v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&Number.isSafeInteger(Number(v));
const copy=v=>JSON.parse(canonicalJson(v));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const hash=(crypto,v)=>crypto.sha256(utf8(canonicalJson(v)));
function wallet(v){fail(typeof v==='string'&&v.length<=44,'cut-wallet');try{decode58(v,32);}catch{fail(false,'cut-wallet');}return v;}
function holding(h){fail(exact(h,['id','owner','collection','level','revealedAt'])&&id(h.id)&&id(h.collection)&&(h.level===null||nat(h.level,10)&&h.level>0)&&(h.revealedAt===null||time(h.revealedAt)),'cut-holding');wallet(h.owner);return h;}
function shape(b){
 if(b?.format==='collection-cut-page-v1'){
  fail(exact(b,['format','index','holdings'])&&nat(b.index,99)&&Array.isArray(b.holdings)&&b.holdings.length<=100,'cut-page');
  b.holdings.forEach((h,i)=>{holding(h);fail(i===0||b.holdings[i-1].id<h.id,'cut-holding-order');});return b;
 }
 fail(exact(b,['format','inventoryId','stageId','termsDigest','atMs','sourceRef','sourceKind','eligibilityListId','holdingCount','pages'])&&b.format==='collection-cut-root-v1'&&id(b.inventoryId)&&id(b.stageId)&&digest(b.termsDigest)&&time(b.atMs)&&id(b.sourceRef)&&b.sourceKind==='synthetic-local-operator-fixture'&&digest(b.eligibilityListId)&&nat(b.holdingCount,10000)&&Array.isArray(b.pages)&&b.pages.length===Math.max(1,Math.ceil(b.holdingCount/100)),'cut-root');
 let count=0;const ids=new Set();b.pages.forEach((p,index)=>{
  fail(exact(p,['index','id','count','firstAsset','lastAsset'])&&p.index===index&&digest(p.id)&&!ids.has(p.id)&&nat(p.count,100)&&(index===b.pages.length-1||p.count===100),'cut-page-descriptor');ids.add(p.id);count+=p.count;
  fail(p.count===0?b.holdingCount===0&&p.firstAsset===null&&p.lastAsset===null:id(p.firstAsset)&&id(p.lastAsset)&&p.firstAsset<=p.lastAsset,'cut-page-range');
  fail(index===0||b.pages[index-1].lastAsset<p.firstAsset,'cut-range-order');
 });fail(count===b.holdingCount,'cut-holding-count');return b;
}
export function captureCollectionCutRecord(v){fail(exact(v,['id','size','bytes'])&&digest(v.id)&&nat(v.size,65536)&&v.size>0&&v.bytes instanceof Uint8Array&&v.bytes.length===v.size,'cut-record-bound');return {id:v.id,size:v.size,bytes:v.bytes.slice()};}
export async function prepareCollectionCutRecord(value,crypto){
 const r=captureCollectionCutRecord(value),text=new TextDecoder('utf-8',{fatal:true}).decode(r.bytes);let body;try{body=shape(JSON.parse(text));}catch(e){if(e.code)throw e;fail(false,'cut-record-json');}
 fail(canonicalJson(body)===text,'cut-record-canonical');fail(await crypto.sha256(r.bytes)===r.id,'cut-record-digest');
 return freeze({id:r.id,size:r.size,format:body.format,bodyJson:text,body});
}
/** Full transcript encoding is an explicit offline fixture/import helper. Runtime
 * commands verify one immutable page and never hydrate this entire graph. */
export async function encodeCollectionCut(value,crypto){
 fail(Array.isArray(value?.holdings)&&value.holdings.length<=10000,'cut-input');const v=copy(value);fail(exact(v,['inventoryId','stageId','termsDigest','atMs','sourceRef','eligibilityListId','holdings'])&&Array.isArray(v.holdings)&&v.holdings.length<=10000,'cut-input');
 v.holdings.forEach(holding);v.holdings.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const record=async body=>{shape(body);const bytes=utf8(canonicalJson(body));fail(bytes.length<=65536,'cut-record-bound');return {id:await crypto.sha256(bytes),size:bytes.length,bytes};};
 const pages=[];for(let offset=0;offset<Math.max(1,v.holdings.length);offset+=100)pages.push(await record({format:'collection-cut-page-v1',index:pages.length,holdings:v.holdings.slice(offset,offset+100)}));
 const {holdings,...header}=v,root=await record({...header,format:'collection-cut-root-v1',sourceKind:'synthetic-local-operator-fixture',holdingCount:holdings.length,pages:pages.map((p,index)=>({index,id:p.id,count:holdings.slice(index*100,index*100+100).length,firstAsset:holdings[index*100]?.id??null,lastAsset:holdings[Math.min(holdings.length,(index+1)*100)-1]?.id??null}))});
 return {root,pages};
}
function attempt(a,rootId){fail(exact(a,['id','rootId','sourceRevision'])&&digest(a.id)&&a.rootId===rootId&&revision(a.sourceRevision),'cut-attempt');}
export async function collectionCutAttemptId(rootId,sourceRevision,crypto){fail(digest(rootId)&&revision(sourceRevision),'cut-attempt');return hash(crypto,['collection-cut-attempt-v1',rootId,sourceRevision]);}
const summaryPreimage=s=>['collection-cut-page-closure-v1',s.attemptId,s.rootId,s.sourceRevision,s.pageId,s.pageIndex,s.holdingCount,s.trackedCount,s.firstAsset,s.lastAsset,s.eligibleWallets];
/** Exact retained commitment only; callers still verify the complete summary. */
export function collectionCutPageClosureDigest(value,crypto){return hash(crypto,summaryPreimage(copy(value)));}
/** Named repository reads must supply every tracked Genesis in this interval,
 * plus each locally known supplied ID. Bounds and closure are checked here;
 * repository source-revision CAS proves those reads still describe the cut. */
export async function prepareCollectionCutPage(value,crypto){
 fail(Array.isArray(value?.tracked)&&value.tracked.length<=100&&Array.isArray(value?.suppliedKnown)&&value.suppliedKnown.length<=100,'cut-read-bound');
 const rootRecord=captureCollectionCutRecord(value.rootRecord),pageRecord=captureCollectionCutRecord(value.pageRecord),v=copy({attempt:value.attempt,tracked:value.tracked,suppliedKnown:value.suppliedKnown,nowMs:value.nowMs});
 fail(Array.isArray(v.tracked)&&v.tracked.length<=100&&Array.isArray(v.suppliedKnown)&&v.suppliedKnown.length<=100,'cut-read-bound');
 const root=await prepareCollectionCutRecord(rootRecord,crypto),page=await prepareCollectionCutRecord(pageRecord,crypto);fail(root.format==='collection-cut-root-v1'&&page.format==='collection-cut-page-v1','cut-record-kind');attempt(v.attempt,root.id);fail(v.attempt.id===await collectionCutAttemptId(root.id,v.attempt.sourceRevision,crypto),'cut-attempt-digest');
 fail(time(v.nowMs)&&v.nowMs>=root.body.atMs,'cut-before-opening');const descriptor=root.body.pages[page.body.index],holdings=page.body.holdings;
 fail(descriptor?.id===page.id&&descriptor.count===holdings.length&&descriptor.firstAsset===(holdings[0]?.id??null)&&descriptor.lastAsset===(holdings.at(-1)?.id??null),'cut-page-binding');
 const lower=page.body.index===0?null:root.body.pages[page.body.index-1].lastAsset,upper=page.body.index===root.body.pages.length-1?null:descriptor.lastAsset,known=new Map(),supplied=new Map(holdings.map(h=>[h.id,h]));
 for(const row of v.tracked){
  fail(exact(row,['id','owner','bindMs','revealMs','level','ownerObservedMs'])&&id(row.id)&&!known.has(row.id)&&time(row.bindMs)&&row.bindMs<=root.body.atMs&&(lower===null||row.id>lower)&&(upper===null||row.id<=upper)&&(row.revealMs===null||time(row.revealMs)&&row.revealMs>=row.bindMs)&&nat(row.level,10)&&row.level>0&&time(row.ownerObservedMs)&&row.ownerObservedMs>=row.bindMs&&row.ownerObservedMs<=root.body.atMs,'cut-tracked-observation');wallet(row.owner);known.set(row.id,row);
  const h=supplied.get(row.id),revealed=row.revealMs!==null&&row.revealMs<=root.body.atMs;
  fail(h?.collection==='solana-genesis'&&h.owner===row.owner&&(revealed?h.revealedAt===row.revealMs&&h.level===row.level:h.revealedAt===null||h.revealedAt>root.body.atMs),'conflicting-ownership-cut');
 }
 const seen=new Set();for(const row of v.suppliedKnown){fail(exact(row,['id','kind','bindMs'])&&id(row.id)&&['genesis','season'].includes(row.kind)&&time(row.bindMs)&&supplied.has(row.id)&&!seen.has(row.id),'cut-known-identity');seen.add(row.id);if(supplied.get(row.id).collection==='solana-genesis')fail(row.kind==='genesis'&&row.bindMs<=root.body.atMs&&known.has(row.id),'conflicting-ownership-cut');}
 for(const row of v.tracked)fail(seen.has(row.id),'cut-known-closure');
 const eligibleWallets=[...snapshotSeasonFreeWallets({at:root.body.atMs,holdings}).wallets];eligibleWallets.forEach(wallet);
 const summary={attemptId:v.attempt.id,rootId:root.id,sourceRevision:v.attempt.sourceRevision,pageId:page.id,pageIndex:page.body.index,holdingCount:holdings.length,trackedCount:v.tracked.length,firstAsset:descriptor.firstAsset,lastAsset:descriptor.lastAsset,eligibleWallets};
 return freeze({...summary,closureDigest:await collectionCutPageClosureDigest(summary,crypto)});
}
export async function prepareCollectionCutSeal(value,crypto){
 const rootRecord=captureCollectionCutRecord(value.rootRecord);
 fail(Array.isArray(value.pages)&&value.pages.length<=100&&value.pages.every(p=>Array.isArray(p?.eligibleWallets)&&p.eligibleWallets.length<=100)&&utf8(canonicalJson(value.pages)).length<=1048576,'cut-summary-bound');
 const v=copy({attempt:value.attempt,pages:value.pages,list:value.list,stage:value.stage,nowMs:value.nowMs}),root=await prepareCollectionCutRecord(rootRecord,crypto);fail(root.format==='collection-cut-root-v1','cut-root');attempt(v.attempt,root.id);fail(v.attempt.id===await collectionCutAttemptId(root.id,v.attempt.sourceRevision,crypto),'cut-attempt-digest');
 const b=root.body,s=v.stage;fail(exact(s,['inventoryId','stageId','kind','type','opensAtMs','termsDigest'])&&s.kind==='season'&&s.type==='free'&&s.inventoryId===b.inventoryId&&s.stageId===b.stageId&&s.opensAtMs===b.atMs&&s.termsDigest===b.termsDigest&&time(v.nowMs)&&v.nowMs>=b.atMs,'cut-stage-binding');
 fail(v.pages.length===b.pages.length,'cut-page-closure');const all=[];
 for(let n=0;n<v.pages.length;n++){const p=v.pages[n],d=b.pages[n];fail(exact(p,['attemptId','rootId','sourceRevision','pageId','pageIndex','holdingCount','trackedCount','firstAsset','lastAsset','eligibleWallets','closureDigest'])&&p.attemptId===v.attempt.id&&p.rootId===root.id&&p.sourceRevision===v.attempt.sourceRevision&&p.pageId===d.id&&p.pageIndex===n&&p.holdingCount===d.count&&p.firstAsset===d.firstAsset&&p.lastAsset===d.lastAsset&&nat(p.trackedCount,p.holdingCount)&&Array.isArray(p.eligibleWallets)&&p.eligibleWallets.length<=p.holdingCount&&digest(p.closureDigest),'cut-summary-binding');
  p.eligibleWallets.forEach((w,i)=>{wallet(w);fail(i===0||p.eligibleWallets[i-1]<w,'cut-wallet-order');});fail(p.closureDigest===await collectionCutPageClosureDigest(p,crypto),'cut-summary-digest');all.push(...p.eligibleWallets);
 }
 const wallets=[...new Set(all)].sort(),walletsDigest=await hash(crypto,wallets),l=v.list;fail(exact(l,['id','count','walletsDigest','indexedCount'])&&l.id===b.eligibilityListId&&l.count===wallets.length&&l.indexedCount===l.count&&l.walletsDigest===walletsDigest,'cut-eligibility-list');
 return freeze({inventoryId:b.inventoryId,stageId:b.stageId,atMs:b.atMs,rootId:root.id,attemptId:v.attempt.id,eligibilityListId:b.eligibilityListId,eligibleWallets:wallets.length,walletsDigest,sourceRef:b.sourceRef,sourceRevision:v.attempt.sourceRevision,commitmentKind:'paged-fixed-cut-v1',source:'local-fixture',executable:false});
}
