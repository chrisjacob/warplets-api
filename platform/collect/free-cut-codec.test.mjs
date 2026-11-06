import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {encode58} from '../server/base58.mjs';
import {snapshotSeasonFreeWallets} from '../domain/collections/policy.mjs';
import {createCollectionStateCodec} from './state-codec.mjs';
import {prepareCollectionList} from './source-intake.mjs';
import {encodeCollectionCut,prepareCollectionCutRecord,prepareCollectionCutPage,prepareCollectionCutSeal,collectionCutAttemptId} from './free-cut-codec.mjs';
import {createCollectionCutService,buildCollectionCutCommand,BEGIN_COLLECTION_FREE_CUT,SEAL_COLLECTION_FREE_CUT,VALIDATE_COLLECTION_CUT_PAGE} from './free-cut-service.mjs';
const crypto=createNodeCrypto(),at=1900000000000,principal={kind:'operator',id:'synthetic-cut-operator'};
const wallet=n=>encode58(Uint8Array.from({length:32},(_,i)=>(n>>((i%4)*8))&255));
const row=(n,extra={})=>({id:'synthetic-genesis-'+String(n).padStart(5,'0'),owner:wallet(n+1),collection:'solana-genesis',level:1,revealedAt:at-1,...extra});
const body=r=>JSON.parse(new TextDecoder().decode(r.bytes));
const code=expected=>e=>e.code===expected;
async function record(b){const bytes=utf8(canonicalJson(b));return {id:await crypto.sha256(bytes),size:bytes.length,bytes};}
async function fixture(holdings=[row(0)],sourceRevision='7'){
 const wallets=[...snapshotSeasonFreeWallets({at,holdings}).wallets],listBundle=await createCollectionStateCodec({crypto}).encodeWalletList(wallets),listSeal=await prepareCollectionList(listBundle,crypto),bundle=await encodeCollectionCut({inventoryId:'synthetic-season',stageId:'free',termsDigest:'a'.repeat(64),atMs:at,sourceRef:'synthetic-retained-cut',eligibilityListId:listBundle.manifest.id,holdings},crypto),attempt={id:await collectionCutAttemptId(bundle.root.id,sourceRevision,crypto),rootId:bundle.root.id,sourceRevision},stage={inventoryId:'synthetic-season',stageId:'free',kind:'season',type:'free',opensAtMs:at,termsDigest:'a'.repeat(64)},list={id:listSeal.id,count:listSeal.count,walletsDigest:listSeal.walletsDigest,indexedCount:listSeal.count};
 const input=(n=0)=>{const page=body(bundle.pages[n]);return {rootRecord:bundle.root,pageRecord:bundle.pages[n],attempt,nowMs:at,tracked:page.holdings.filter(h=>h.collection==='solana-genesis').map(h=>({id:h.id,owner:h.owner,bindMs:at-1000,revealMs:h.revealedAt,level:h.level??1,ownerObservedMs:at-500})),suppliedKnown:page.holdings.map(h=>({id:h.id,kind:h.collection==='solana-genesis'?'genesis':'season',bindMs:at-1000}))};};
 return {...bundle,attempt,stage,list,holdings,wallets,input,seal:pages=>({rootRecord:bundle.root,attempt,stage,list,nowMs:at,pages})};
}

test('paged cut closes ten thousand holdings while matching legacy eligibility and bounding the final summary',async t=>{
 const holdings=Array.from({length:10000},(_,n)=>row(n,{id:'s'.repeat(110)+String(n).padStart(5,'0')})),f=await fixture(holdings),pages=[];
 for(let n=0;n<f.pages.length;n++)pages.push(await prepareCollectionCutPage(f.input(n),crypto));
 const sealed=await prepareCollectionCutSeal(f.seal(pages),crypto);assert.equal(sealed.eligibleWallets,10000);assert.equal(sealed.walletsDigest,await crypto.sha256(utf8(canonicalJson(f.wallets))));assert.equal(sealed.commitmentKind,'paged-fixed-cut-v1');assert.equal(sealed.executable,false);assert.equal(f.pages.length,100);
 const legacyPreimage=[f.stage.inventoryId,f.stage.stageId,at,'synthetic-retained-cut',holdings];assert.notEqual(sealed.rootId,await crypto.sha256(utf8(JSON.stringify(legacyPreimage))));
 const summaryBytes=utf8(canonicalJson(pages)).length;assert.ok(summaryBytes<=1048576);assert.ok(f.pages.every(p=>p.size<=65536));t.diagnostic(JSON.stringify({holdings:10000,pages:100,maxPageBytes:Math.max(...f.pages.map(p=>p.size)),rootBytes:f.root.size,finalSummaryBytes:summaryBytes,legacyEligibilityMatched:true,legacyFlatDigestClaimed:false}));
});

test('record identities reject noncanonical, changed, reordered, duplicate and cross-kind input',async()=>{
 const f=await fixture(Array.from({length:101},(_,n)=>row(n)));
 await assert.rejects(prepareCollectionCutRecord({...f.pages[0],id:'0'.repeat(64)},crypto),code('cut-record-digest'));
 const noncanonical=utf8(JSON.stringify(body(f.pages[0]),null,2));await assert.rejects(prepareCollectionCutRecord({bytes:noncanonical,size:noncanonical.length,id:await crypto.sha256(noncanonical)},crypto),code('cut-record-canonical'));
 const changed=body(f.root);changed.pages.reverse();await assert.rejects(prepareCollectionCutRecord(await record(changed),crypto),code('cut-page-descriptor'));
 const duplicate=body(f.pages[0]);duplicate.holdings[1]=duplicate.holdings[0];await assert.rejects(prepareCollectionCutRecord(await record(duplicate),crypto),code('cut-holding-order'));
 await assert.rejects(prepareCollectionCutPage({...f.input(),pageRecord:f.root},crypto),code('cut-record-kind'));
 await assert.rejects(prepareCollectionCutPage({...f.input(),pageRecord:f.pages[1]},crypto),code('cut-tracked-observation'));
 const extra=body(f.pages[0]);extra.complete=true;await assert.rejects(prepareCollectionCutRecord(await record(extra),crypto),code('cut-page'));
});

test('cut range closure checks omissions before first, between pages, after tail and for empty transcript',async()=>{
 const f=await fixture(Array.from({length:101},(_,n)=>row(n*2)));
 const omitted=(id)=>({id,owner:wallet(900),bindMs:at-1000,revealMs:at-1,level:1,ownerObservedMs:at-500});
 for(const [index,id] of [[0,'aaa'],[1,'synthetic-genesis-00199'],[1,'zzzz']]){const i=f.input(index);if(index===0)i.tracked=i.tracked.slice(1);i.tracked.push(omitted(id));await assert.rejects(prepareCollectionCutPage(i,crypto),code('conflicting-ownership-cut'));}
 const empty=await fixture([]),zero=await prepareCollectionCutPage(empty.input(),crypto);assert.equal((await prepareCollectionCutSeal(empty.seal([zero]),crypto)).eligibleWallets,0);
 await assert.rejects(prepareCollectionCutPage({...empty.input(),tracked:[omitted('aaa')]},crypto),code('conflicting-ownership-cut'));
 const overflow=f.input();overflow.tracked.push(omitted('aaa'));await assert.rejects(prepareCollectionCutPage(overflow,crypto),code('cut-read-bound'));
});

test('exact cut owner, reveal, Level and local identity remain authoritative across later observations',async()=>{
 const f=await fixture([row(0),row(1,{revealedAt:at+1,level:null}),row(2,{revealedAt:null,level:null})]),input=f.input();
 const valid=await prepareCollectionCutPage(input,crypto);assert.deepEqual(valid.eligibleWallets,[wallet(1)]);
 for(const change of [i=>i.tracked[0].owner=wallet(77),i=>i.tracked[0].level=2,i=>i.tracked[0].revealMs=at-2,i=>i.tracked[0].ownerObservedMs=at+1,i=>i.suppliedKnown[0].kind='season',i=>i.suppliedKnown[0].bindMs=at+1]){const i=structuredClone(input);change(i);await assert.rejects(prepareCollectionCutPage(i,crypto));}
 const ready=f.seal([valid]);for(const change of [v=>v.stage.opensAtMs++,v=>v.stage.termsDigest='b'.repeat(64),v=>v.nowMs=at-1,v=>v.list.indexedCount--,v=>v.list.walletsDigest='b'.repeat(64),v=>v.pages[0].eligibleWallets.push(wallet(9)),v=>v.pages[0].sourceRevision='8']){const v=structuredClone(ready);change(v);await assert.rejects(prepareCollectionCutSeal(v,crypto));}
 assert.equal((await prepareCollectionCutSeal(ready,crypto)).eligibleWallets,1);
});

test('record and command inputs are captured before every asynchronous digest',async()=>{
 const f=await fixture(),r=structuredClone(f.root);let called=false;const mutating={...crypto,async sha256(bytes){if(!called){called=true;r.id='0'.repeat(64);r.bytes.fill(0);}return crypto.sha256(bytes);}};
 const prepared=await prepareCollectionCutRecord(r,mutating);assert.equal(prepared.id,f.root.id);
 const input=f.input(),saved=structuredClone(input);called=false;const m={...crypto,async sha256(bytes){if(!called){called=true;input.attempt.sourceRevision='999';input.tracked[0].owner=wallet(20);input.pageRecord.bytes.fill(0);}return crypto.sha256(bytes);}};
 assert.deepEqual(await prepareCollectionCutPage(input,m),await prepareCollectionCutPage(saved,crypto));
 const p={...principal},request={requestKey:'synthetic-begin',rootId:f.root.id};called=false;const c=await buildCollectionCutCommand(BEGIN_COLLECTION_FREE_CUT,p,request,{...crypto,async sha256(bytes){if(!called){called=true;p.id='changed';request.rootId='0'.repeat(64);}return crypto.sha256(bytes);}});assert.equal(c.principal.id,principal.id);assert.equal(c.input.rootId,f.root.id);assert.equal(c.businessIdentity,canonicalJson([f.root.id,'synthetic-begin']));
});

test('private cut service forwards only named commands and captured immutable record bytes',async()=>{
 const f=await fixture(),seen=[],repository=Object.fromEntries(['stageRecord','beginCut','validatePage','sealCut'].map(method=>[method,async(...args)=>{seen.push({method,args});return {kind:'pending',reason:'fixture-only',dependencyIds:[]};}])),service=createCollectionCutService({repository,crypto});
 await service.stageRecord(principal,{requestKey:'record',record:f.root});await service.beginCut(principal,{requestKey:'begin',rootId:f.root.id});await service.validatePage(principal,{requestKey:'page',attemptId:f.attempt.id,pageIndex:0});await service.sealCut(principal,{requestKey:'seal',attemptId:f.attempt.id});
 assert.deepEqual(seen.map(s=>s.method),['stageRecord','beginCut','validatePage','sealCut']);assert.deepEqual(seen[0].args[0].input,{id:f.root.id});assert.notEqual(seen[0].args[1].bytes,f.root.bytes);assert.deepEqual(seen[0].args[1].bytes,f.root.bytes);
 await assert.rejects(buildCollectionCutCommand(SEAL_COLLECTION_FREE_CUT,principal,{requestKey:'seal',attemptId:f.attempt.id,complete:true},crypto));await assert.rejects(buildCollectionCutCommand(VALIDATE_COLLECTION_CUT_PAGE,principal,{requestKey:'page',attemptId:f.attempt.id,pageIndex:100},crypto));
});
