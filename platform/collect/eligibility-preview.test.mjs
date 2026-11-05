import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createCollectionEdgeFixture} from '../application/fixtures/collection-edges.mjs';
import {previewSeasonEligibility} from './eligibility-preview.mjs';
import {openDatabase} from '../storage/database.mjs';
import {createCollection,publishCollectionStage,readInventory,reserveMint} from './store.mjs';
import {stageReservationStatus} from './projections.mjs';
const packet=f=>({...structuredClone(f.snapshot),source:{id:f.snapshot.sourceRef,chain:'solana',collection:'solana-genesis',slot:'123',blockTimeMs:f.cut,ownerRef:'synthetic-owner-cut',revealRef:'synthetic-reveal-cut'},coverage:{status:'complete',expectedCount:f.snapshot.holdings.length,pages:[{cursor:null,nextCursor:null,ids:f.snapshot.holdings.map(row=>row.id)}]}});
const state=db=>JSON.stringify({inventories:db.prepare('SELECT * FROM collect_inventories ORDER BY id').all(),snapshots:db.prepare('SELECT * FROM collect_snapshots ORDER BY id').all(),operations:db.prepare('SELECT * FROM collect_operations ORDER BY id').all()});
test('operator preview preserves exact opening, historical ownership, canonical freeze digest and immutable publication',async t=>{
 const f=await createCollectionEdgeFixture({assetCount:2});t.after(()=>f.close());const p=packet(f),before=state(f.db),input=JSON.stringify(p);
 const result=previewSeasonEligibility(f.db,p,f.nowMs);assert.equal(result.ready,true);assert.equal(result.counts.eligibleWallets,1);assert.equal(result.counts.lateRevealHoldings,1);
 assert.equal(result.cutoffAt,new Date(f.cut).toISOString());assert.equal(result.chainCompleteness,'unverified');assert.equal(result.executable,false);assert.equal(result.publication.status,'ready-local-fixture');
 assert.equal(result.wallets.find(row=>row.wallet===f.accounts.original.wallet).status,'eligible');assert.equal(result.wallets.find(row=>row.wallet===f.accounts.late.wallet).status,'ineligible');assert.equal(result.wallets.find(row=>row.wallet===f.accounts.seasonOnly.wallet).status,'ineligible');
 assert.equal(result.wallets.some(row=>row.wallet===f.accounts.buyer.wallet),false);assert.equal(state(f.db),before);assert.equal(JSON.stringify(p),input);
 const accepted=f.acceptSnapshot();assert.equal(accepted.digest,result.snapshotDigest);const published=state(f.db),replay=previewSeasonEligibility(f.db,p,f.nowMs+10000);
 assert.equal(replay.publication.status,'already-published');assert.equal(replay.snapshotDigest,result.snapshotDigest);assert.equal(replay.sourceDigest,result.sourceDigest);assert.equal(replay.inputDigest,result.inputDigest);assert.ok(replay.publication.snapshotId);
 const corrected={...p,sourceRef:'synthetic-other',source:{...p.source,id:'synthetic-other'}};assert.equal(previewSeasonEligibility(f.db,corrected,f.nowMs).publication.status,'conflict');assert.equal(state(f.db),published);
});
test('missing pages, duplicated cursors, missing tracked assets, late cuts and contradictory owners hold every wallet',async t=>{
 const f=await createCollectionEdgeFixture({assetCount:2});t.after(()=>f.close());const p=packet(f),before=state(f.db);
 const scenarios=[
  ['snapshot-incomplete',q=>{q.coverage.pages=[];}],
  ['snapshot-incomplete',q=>{q.coverage.status='incomplete';}],
  ['snapshot-incomplete',q=>{q.coverage.pages[0].nextCursor='missing-page';}],
  ['snapshot-incomplete',q=>{q.coverage.pages.push({...q.coverage.pages[0]});}],
  ['missing-tracked-holding',q=>{q.holdings.shift();q.coverage.expectedCount--;q.coverage.pages[0].ids.shift();}],
  ['conflicting-local-cut',q=>{q.holdings[0].owner=f.accounts.buyer.wallet;}],
  ['wrong-opening-cut',q=>{q.at=f.nowMs;q.source.blockTimeMs=f.nowMs;}],
  ['source-anchor-incomplete',q=>{delete q.source.ownerRef;}],
  ['snapshot-not-final',q=>{q.finalized=false;}],
  ['wrong-local-collection',q=>{q.holdings[2].collection='solana-genesis';}],
 ];
 for(const [code,mutate] of scenarios){const q=structuredClone(p);mutate(q);const result=previewSeasonEligibility(f.db,q,f.nowMs);assert.equal(result.ready,false,code);assert.ok(result.issues.some(row=>row.code===code),code);assert.equal(result.counts.eligibleWallets,0);assert.ok(result.wallets.every(row=>row.status==='unknown'));assert.equal(state(f.db),before);}
});
test('canonical wallet issues and duplicate/conflicting IDs are explicit; explicit empty complete coverage differs from absent pages',async t=>{
 const f=await createCollectionEdgeFixture({assetCount:2});t.after(()=>f.close());const p=packet(f);
 for(const owner of [' '+f.accounts.original.wallet,'bad',17]){const q=structuredClone(p);q.holdings[0].owner=owner;const result=previewSeasonEligibility(f.db,q,f.nowMs);assert.equal(result.ready,false);assert.equal(result.counts.normalizationIssues,1);}
 for(const conflicting of [false,true]){const q=structuredClone(p);q.holdings.push({...q.holdings[0],...(conflicting?{owner:f.accounts.buyer.wallet}:{})});q.coverage.expectedCount++;q.coverage.pages[0].ids.push(q.holdings[0].id);const result=previewSeasonEligibility(f.db,q,f.nowMs);assert.ok(result.issues.some(row=>row.code===(conflicting?'conflicting-holding':'duplicate-holding')));assert.equal(result.ready,false);}
 const emptyDb=openDatabase();t.after(()=>emptyDb.close());createCollection(emptyDb,{id:f.seasonId,kind:'season',seasonStart:f.start});
 const base={type:'whitelist',publishedAt:f.start,allocation:1000,priceLamports:'100000000',costLamports:'5000',wallets:[f.accounts.original.wallet],walletLimit:1};
 for(const stage of [{...base,id:'first',opensAt:f.start,closesAt:f.start+86400000},{...base,id:'second',opensAt:f.start+86400000,closesAt:f.cut},{...base,id:'synthetic-free',type:'free',priceLamports:'0',opensAt:f.cut,closesAt:f.nowMs+86400000}])publishCollectionStage(emptyDb,{inventoryId:f.seasonId,stage},f.nowMs);
 const empty={...p,holdings:[],coverage:{status:'complete',expectedCount:0,pages:[{cursor:null,nextCursor:null,ids:[]}]}};
 assert.equal(previewSeasonEligibility(emptyDb,empty,f.nowMs).ready,true);empty.coverage.pages=[];assert.equal(previewSeasonEligibility(emptyDb,empty,f.nowMs).ready,false);
});
test('current reservation reasons preserve fixed membership through wallet limits, closure and pending cut',async t=>{
 const f=await createCollectionEdgeFixture({assetCount:2});t.after(()=>f.close());const get=(wallet=f.accounts.original.wallet,now=f.nowMs)=>readInventory(f.db,f.seasonId,now,wallet).stages.find(row=>row.id==='synthetic-free');
 assert.equal(get().reservationStatus.reason,'snapshot-pending');assert.equal(get().reservationStatus.status,'unknown');assert.equal(get().reservationStatus.snapshotId,null);
 assert.equal(get(null).reservationStatus.reason,'not-signed-in');assert.equal(get(null).reservationStatus.used,null);
 const accepted=f.acceptSnapshot();assert.equal(get().eligible,true);assert.equal(get().reservationStatus.reason,'eligible');assert.equal(get().reservationStatus.snapshotId,accepted.digest);
 assert.equal(get(f.accounts.buyer.wallet).reservationStatus.reason,'not-on-list');
 reserveMint(f.db,{inventoryId:f.seasonId,stageId:'synthetic-free',wallet:f.accounts.original.wallet,requestKey:'synthetic-preview-free',now:f.nowMs});
 assert.equal(get().reservationStatus.reason,'wallet-limit');assert.equal(get().reservationStatus.remaining,0);assert.equal(get().eligibility.status,'eligible');
 assert.equal(get(f.accounts.original.wallet,f.nowMs+86400000).reservationStatus.reason,'stage-closed');assert.equal(get(f.accounts.original.wallet,f.nowMs+86400000).eligibility.status,'eligible');
 const stage={type:'free',opensAt:f.cut,wallets:[f.accounts.original.wallet],walletLimit:1};
 for(const [status,openingHold,reason] of [['scheduled',null,'stage-scheduled'],['sold-out',null,'sold-out'],['postponed','founder-decision','opening-hold']]){
  const result=stageReservationStatus(stage,f.accounts.original.wallet,{now:f.nowMs,status,used:0,openingHold});assert.equal(result.reason,reason);assert.equal(result.status,'unavailable');
 }
});
test('standalone operator CLI opens an existing database read-only and exports the diagnostic without writes',async t=>{
 const f=await createCollectionEdgeFixture({assetCount:2});t.after(()=>f.close());const dir=mkdtempSync(join(tmpdir(),'tenx-eligibility-preview-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const database=join(dir,'fixture.sqlite'),filename=join(dir,'fixture.json');f.db.prepare('VACUUM INTO ?').run(database);writeFileSync(filename,JSON.stringify(packet(f)));const before=readFileSync(database);
 const output=spawnSync(process.execPath,[fileURLToPath(new URL('./eligibility-preview-cli.mjs',import.meta.url)),database,filename],{encoding:'utf8',windowsHide:true});
 assert.equal(output.status,0,output.stderr);const result=JSON.parse(output.stdout);assert.equal(result.ready,true);assert.equal(result.readOnly,true);assert.deepEqual(readFileSync(database),before);
});
test('maximum local transcript covers 10000 distinct holdings in 100 linked pages without dropping rows',async t=>{
 const f=await createCollectionEdgeFixture({assetCount:2});t.after(()=>f.close());const p=packet(f);
 while(p.holdings.length<10000)p.holdings.push({id:'synthetic-external-'+String(p.holdings.length).padStart(5,'0'),owner:f.accounts.original.wallet,collection:'solana-genesis',level:1,revealedAt:f.cut-1000});
 p.coverage={status:'complete',expectedCount:10000,pages:Array.from({length:100},(_,index)=>({cursor:index===0?null:'page-'+index,nextCursor:index===99?null:'page-'+(index+1),ids:p.holdings.slice(index*100,index*100+100).map(row=>row.id)}))};
 const result=previewSeasonEligibility(f.db,p,f.nowMs);assert.equal(result.ready,true);assert.equal(result.holdings.length,10000);assert.equal(result.coverage.pages,100);assert.equal(result.counts.eligibleWallets,1);
 const repeated=structuredClone(p);repeated.coverage.pages[99].cursor='page-98';assert.equal(previewSeasonEligibility(f.db,repeated,f.nowMs).ready,false);
 p.holdings.push({...p.holdings[0],id:'synthetic-over-limit'});assert.throws(()=>previewSeasonEligibility(f.db,p,f.nowMs),/at most 10000/);
});
