// SQL clock below is pinned solely to this synthetic fixture's existing clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeRecoveryDigest} from '../recovery/v2-node-digest.mjs';
import {createCollection,publishCollectionStage,freezeSeasonSnapshot} from './store.mjs';
import {createCollectionStateCodec} from './state-codec.mjs';
import {prepareCollectionList,createCollectionSourceIntake} from './source-intake.mjs';
import {createEligibilityIndexService} from './eligibility-index-service.mjs';
import {createEligibilityIndexRepository} from './eligibility-index-repository.mjs';
import {createCollectionSourceRepository} from './source-repository.mjs';
import {encode58} from '../server/base58.mjs';
import {auditLegacyStagePublication} from './legacy-stage-audit.mjs';
const DAY=86400000,START=20000*DAY,crypto=createNodeCrypto(),codec=createCollectionStateCodec({crypto});
const wallets=n=>Array.from({length:n},(_,index)=>{const b=Buffer.alloc(32,91);b.writeUInt32BE(index,28);return encode58(b);}).sort();
function scene(t,kind='genesis'){const db=openDatabase();t.after(()=>db.close());const header={id:'synthetic-legacy-stage',kind,tranche:kind==='genesis'?1:null,seasonStart:kind==='season'?START:null};createCollection(db,header);return {db,header};}
function stage(id,type='whitelist',changes={}){return {id,type,publishedAt:START,opensAt:START+2*DAY,closesAt:START+3*DAY,priceLamports:['free','founder'].includes(type)?'0':'100000000',costLamports:'5000',allocation:1000,wallets:wallets(3),walletLimit:2,founderApproved:['public','founder'].includes(type),...(type==='founder'?{approvedSpendLamports:'5000000'}:{}),...changes};}
async function inputFor(f,input,{publish=true}={}){
 if(publish)publishCollectionStage(f.db,{inventoryId:f.header.id,stage:input},START+10*DAY);
 const state=JSON.parse(f.db.prepare('SELECT state FROM collect_inventories WHERE id=?').get(f.header.id).state),index=state.stages.findIndex(s=>s.id===input.id),stored=state.stages[index],listWallets=[...new Set(input.wallets??[])].sort(),bundle=await codec.encodeWalletList(listWallets),seal=await prepareCollectionList(bundle,crypto),{wallets:members,...terms}=stored;
 const original={format:'legacy-stage-publication-preimage-v1',inventoryId:f.header.id,stageId:input.id,type:input.type,publishedAt:input.publishedAt,opensAt:input.opensAt,closesAt:input.closesAt,priceLamports:input.priceLamports,costLamports:input.costLamports,allocation:input.allocation,walletLimit:input.walletLimit??null,founderApproved:input.founderApproved??false,approvedSpendLamports:input.approvedSpendLamports??null,ballotId:input.ballotId??null,inventoryOverrideReason:input.inventoryOverrideReason??null,walletListId:seal.id};
 let membership={kind:input.type==='public'?'unrestricted':'pending'};
 if(members!==null){const actual=input.type==='free'?await prepareCollectionList(await codec.encodeWalletList(members),crypto):seal;membership={kind:input.type==='free'?'free-cut':'list',listId:actual.id,count:actual.count,walletsDigest:actual.walletsDigest};}
 return {input:{original,originalList:seal,header:f.header,priorStages:state.stages.slice(0,index).map(({id,type,closesAt})=>({id,type,closesAt})),stored:{terms,membership}},bundle,listWallets};
}
function ports(data){return {createDigest:createNodeRecoveryDigest,async readWalletChunk({listId,offset,limit}){return {listId,offset,wallets:data.listWallets.slice(offset,offset+limit),done:offset+limit>=data.listWallets.length};}};}
test('real reference Genesis whitelist/public/founder and ordered Season stages preserve exact scalar reducer and legacy terms hash',async t=>{
 for(const kind of ['genesis','season']){
  const f=scene(t,kind),inputs=kind==='genesis'?[stage('first','whitelist',{walletLimit:null}),stage('public','public'),stage('founder','founder')]:[
   stage('paid-one','whitelist',{opensAt:START,closesAt:START+DAY}),stage('paid-two','whitelist',{opensAt:START+DAY,closesAt:START+2*DAY}),stage('free','free'),stage('public','public',{opensAt:START+3*DAY,closesAt:START+4*DAY}),stage('founder','founder',{opensAt:START+4*DAY,closesAt:START+5*DAY})];
  for(const published of inputs){const data=await inputFor(f,published),before=f.db.prepare('SELECT state FROM collect_inventories').get().state,result=await auditLegacyStagePublication(data.input,ports(data));assert.equal(result.kind,'verified',JSON.stringify(result));assert.equal(result.termsDigest,data.input.stored.terms.termsDigest);assert.equal(result.walletCount,3);assert.equal(result.executable,false);assert.equal(f.db.prepare('SELECT state FROM collect_inventories').get().state,before);}
 }
});
test('missing original preimages hold; null/default wallet limit and discarded approval cannot be inferred from identical normalized fields',async t=>{
 const f=scene(t),data=await inputFor(f,stage('first','whitelist',{walletLimit:null,founderApproved:false}));assert.equal(data.input.stored.terms.walletLimit,1);
 assert.equal((await auditLegacyStagePublication({...data.input,original:null},ports(data))).reason,'legacy-stage-original-preimage-missing');assert.equal((await auditLegacyStagePublication({...data.input,originalList:null},ports(data))).reason,'legacy-stage-original-list-missing');
 for(const patch of [{walletLimit:1},{walletLimit:0},{walletLimit:999999},{founderApproved:true}])assert.equal((await auditLegacyStagePublication({...data.input,original:{...data.input.original,...patch}},ports(data))).reason,'legacy-stage-terms-digest-mismatch');
 const malformed=structuredClone(data.input);malformed.stored.terms.priceLamports.$lamports='99';assert.equal((await auditLegacyStagePublication(malformed,ports(data))).reason,'legacy-stage-normalized-projection-mismatch');
 const absent=stage('equivalent','whitelist');delete absent.walletLimit;delete absent.founderApproved;const exact=await inputFor(f,absent);assert.equal(exact.input.original.walletLimit,null);assert.equal(exact.input.original.founderApproved,false);assert.equal((await auditLegacyStagePublication(exact.input,ports(exact))).kind,'verified');
});
test('the old hash commits sorted unique membership, not raw order or duplicate presentation; malformed streamed membership holds',async t=>{
 const f=scene(t),raw=wallets(3),published=stage('first','whitelist',{wallets:[raw[2],raw[0],raw[2],raw[1]]}),data=await inputFor(f,published);
 assert.equal((await auditLegacyStagePublication(data.input,ports(data))).kind,'verified');assert.equal(publishCollectionStage(f.db,{inventoryId:f.header.id,stage:{...published,wallets:raw}},START+10*DAY).replayed,true);
 for(const members of [[raw[1],raw[0],raw[2]],[raw[0],raw[0],raw[2]]])assert.equal((await auditLegacyStagePublication(data.input,ports({...data,listWallets:members}))).reason,'legacy-stage-list-order');
 const changed=wallets(4).slice(1);assert.equal((await auditLegacyStagePublication(data.input,ports({...data,listWallets:changed}))).reason,'legacy-stage-list-digest-mismatch');
 const bad=structuredClone(data.input);bad.stored.membership.walletsDigest='f'.repeat(64);assert.equal((await auditLegacyStagePublication(bad,ports(data))).reason,'legacy-stage-stored-membership-mismatch');
});
test('free stage original publication list stays separate from current fixed-cut membership before and after freeze',async t=>{
 const f=scene(t,'season');await inputFor(f,stage('one','whitelist',{opensAt:START,closesAt:START+DAY}));await inputFor(f,stage('two','whitelist',{opensAt:START+DAY,closesAt:START+2*DAY}));const published=stage('free','free',{walletLimit:77}),before=await inputFor(f,published),original=await auditLegacyStagePublication(before.input,ports(before));assert.equal(original.kind,'verified');assert.equal(original.membership,'separate-free-cut-audit-required');
 freezeSeasonSnapshot(f.db,{inventoryId:f.header.id,stageId:'free',sourceRef:'synthetic-original-cut',at:published.opensAt,finalized:true,holdings:[{id:'synthetic-external-genesis',owner:wallets(4)[3],collection:'solana-genesis',level:1,revealedAt:START}]},START+10*DAY);
 const after=await inputFor(f,published,{publish:false}),result=await auditLegacyStagePublication(after.input,ports(after));assert.equal(result.kind,'verified');assert.equal(result.termsDigest,original.termsDigest);assert.equal(result.originalListId,original.originalListId);assert.notEqual(after.input.stored.membership.listId,result.originalListId);assert.equal(result.membership,'separate-free-cut-audit-required');
 const substitution=structuredClone(after.input);substitution.original.walletListId=substitution.stored.membership.listId;assert.equal((await auditLegacyStagePublication(substitution,ports(after))).kind,'held');
});
test('maximum10000 original wallets hash exactly through ten indexed SQL chunks without cloning a full runtime list',async t=>{
 const f=scene(t),data=await inputFor(f,stage('maximum','whitelist',{wallets:wallets(10000),walletLimit:null})),principal={kind:'operator',id:'synthetic-stage-audit'},driver={...createNodeAtomicDriver(f.db),leaseNowSql:String(START+10*DAY)},p={crypto,clock:{nowMs:()=>START+10*DAY},ids:{next:randomUUID}};
 f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-import');const intake=createCollectionSourceIntake({...p,repository:createCollectionSourceRepository(driver,p)}),indexer=createEligibilityIndexService({...p,repository:createEligibilityIndexRepository(driver,p)});
 for(const record of [data.bundle.manifest,...data.bundle.pages])assert.equal((await intake.stageRecord(principal,{record,requestKey:record.id})).kind,'committed');assert.equal((await intake.sealList(principal,{id:data.bundle.manifest.id,requestKey:'seal'})).kind,'committed');for(const page of data.bundle.pages)assert.equal((await indexer.materializePage(principal,{id:page.id,requestKey:page.id})).kind,'committed');
 let operations=0,maxRows=0;const result=await auditLegacyStagePublication(data.input,{createDigest:createNodeRecoveryDigest,async readWalletChunk({listId,offset,limit}){operations++;const rows=f.db.prepare("SELECT w.value wallet FROM app_collection_list_seals l,json_each(l.page_ids_json) p JOIN app_collection_eligibility_pages i ON i.record_id=p.value,json_each(i.entries_json) w WHERE l.id=? ORDER BY p.key,w.key LIMIT ? OFFSET ?").all(listId,limit,offset);maxRows=Math.max(maxRows,rows.length);return {listId,offset,wallets:rows.map(r=>r.wallet),done:offset+rows.length===10000};}});
 assert.equal(result.kind,'verified',JSON.stringify(result));assert.equal(result.walletCount,10000);assert.equal(operations,10);assert.equal(maxRows,1000);assert.equal(result.metrics.chunkReads,10);assert.ok(result.metrics.maxWorkingBytes<=1048576);console.log(JSON.stringify({legacyStageAudit:{classification:'synthetic reference publication + actual sealed/indexed035 list; no activation',operations,maxRows,...result.metrics}}));
});
test('partial reader/hash failures abort both native streams and never return a successful audit',async t=>{
 const f=scene(t),data=await inputFor(f,stage('many','whitelist',{wallets:wallets(1001)}));let aborted=0;
 const failing={...ports(data),createDigest(){const native=createNodeRecoveryDigest();return {...native,async abort(reason){aborted++;await native.abort(reason);}};},async readWalletChunk(req){if(req.offset)throw Error('Synthetic interrupted page');return ports(data).readWalletChunk(req);}};
 const held=await auditLegacyStagePublication(data.input,failing);assert.equal(held.kind,'held');assert.equal(held.reason,'legacy-stage-audit-unavailable');assert.ok(aborted>=2);assert.equal((await auditLegacyStagePublication(data.input,ports(data))).kind,'verified');
 const short=await auditLegacyStagePublication(data.input,{...ports(data),async readWalletChunk(req){const r=await ports(data).readWalletChunk(req);return {...r,wallets:r.wallets.slice(1)};}});assert.equal(short.reason,'legacy-stage-list-chunk-invalid');
});
test('header, list metadata and bounded wallet chunks are defensively captured before asynchronous hashing',async t=>{
 const f=scene(t),data=await inputFor(f,stage('first')),value=structuredClone(data.input);let once=false,lastRows;
 const result=await auditLegacyStagePublication(value,{...ports(data),createDigest(){const native=createNodeRecoveryDigest();return {...native,async write(bytes){if(!once){once=true;value.original.walletLimit=999;value.stored.terms.walletLimit=999;value.originalList.count=0;}if(lastRows)lastRows[0]='invalid';await native.write(bytes);}};},async readWalletChunk(req){const c=await ports(data).readWalletChunk(req);lastRows=c.wallets;return c;}});
 assert.equal(result.kind,'verified',JSON.stringify(result));assert.equal(result.termsDigest,data.input.stored.terms.termsDigest);assert.ok(Object.isFrozen(result.metrics));
});
test('explicit sealed empty list is valid, absent list is not, and contradictory historical policy is held',async t=>{
 const f=scene(t),data=await inputFor(f,stage('public','public',{wallets:[],inventoryOverrideReason:'Synthetic retained rationale 雪'}));let calls=0;
 const result=await auditLegacyStagePublication(data.input,{createDigest:createNodeRecoveryDigest,async readWalletChunk(){calls++;throw Error('Empty list must not read');}});assert.equal(result.kind,'verified');assert.equal(result.walletCount,0);assert.equal(calls,0);assert.equal(result.membership,'unrestricted');
 assert.equal((await auditLegacyStagePublication(data.input,{readWalletChunk:ports(data).readWalletChunk})).reason,'legacy-stage-digest-unavailable');
 assert.equal((await auditLegacyStagePublication({...data.input,original:{...data.input.original,founderApproved:false}},ports(data))).reason,'legacy-stage-rule:public_stage_requires_approval');
 const previous={...data.input,header:{...data.input.header,tranche:2}};assert.equal((await auditLegacyStagePublication(previous,ports(data))).reason,'legacy-stage-previous-tranche-unavailable');
 const corrupt=structuredClone(data.input);corrupt.originalList.closureDigest='f'.repeat(64);assert.equal((await auditLegacyStagePublication(corrupt,ports(data))).reason,'legacy-stage-list-seal-mismatch');
});
test('a partial native write failure aborts both active streams even if an abort itself throws synchronously',async t=>{
 const f=scene(t),data=await inputFor(f,stage('first')),aborts=new Set();let index=0;
 const result=await auditLegacyStagePublication(data.input,{...ports(data),createDigest(){const n=index++,native=createNodeRecoveryDigest();return {...native,async write(bytes){if(n===3&&bytes.length>1)throw Error('Synthetic wallet stream failure');return native.write(bytes);},abort(reason){aborts.add(n);if(n===2){void native.abort(reason);throw Error('Synthetic abort failure');}return native.abort(reason);}};}});
 assert.equal(result.kind,'held');assert.equal(result.reason,'legacy-stage-audit-unavailable');assert.ok(aborts.has(2)&&aborts.has(3));
});
