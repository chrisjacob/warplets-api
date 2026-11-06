import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCollectionStateCodec} from './state-codec.mjs';
import {prepareCollectionRecord,prepareCollectionList,prepareCollectionSource,createCollectionSourceIntake,collectionIntakeCommandBytes} from './source-intake.mjs';
import {createInventory,publishStage,admitMint,applyVerifiedMintDraw} from '../domain/collections/inventory.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {encode58} from '../server/base58.mjs';
const crypto={sha256:async bytes=>createHash('sha256').update(bytes).digest('hex')},codec=createCollectionStateCodec({crypto});
const wallets=(count,offset=0)=>Array.from({length:count},(_,n)=>{const bytes=Buffer.alloc(32,127);bytes.writeUInt32BE(offset+n,28);return encode58(bytes);}).sort();
async function record(body){const bytes=utf8(canonicalJson(body));return {id:await crypto.sha256(bytes),size:bytes.length,bytes};}
async function altered(value,fn){const body=JSON.parse(new TextDecoder().decode(value.bytes));fn(body);return record(body);}
function state({count=101,admissions=101,stages=2}={}){
 const members=wallets(count);let value=createInventory({id:'synthetic-intake',kind:'genesis',tranche:1});
 for(let n=0;n<stages;n++)value=publishStage(value,{id:'stage-'+n,type:'whitelist',publishedAt:0,opensAt:172800000,closesAt:200000000,priceLamports:100000000n,allocation:1000,wallets:members,walletLimit:1});
 for(let n=0;n<admissions;n++)value=admitMint(value,{operationId:'op-'+n,wallet:members[n],stageId:'stage-0',at:180000000,drawCommitment:'commit-'+n,costLamports:5000n});return value;
}
async function parts(bundle){
 const root=await codec.verifyRecord(bundle.root),byId=new Map(bundle.pages.map(p=>[p.id,p])),lists=[];
 for(const manifest of bundle.listManifests){const body=await codec.verifyRecord(manifest);lists.push(await prepareCollectionList({manifest,pages:body.pageIds.map(id=>byId.get(id))},crypto));}
 return {root:bundle.root,lists,admissionPages:root.admissions.pageIds.map(id=>byId.get(id))};
}
async function listParts(bundle){const manifest=bundle.listManifests[0],body=await codec.verifyRecord(manifest);return {manifest,pages:body.pageIds.map(id=>bundle.pages.find(p=>p.id===id))};}

test('bounded list and source seals verify closure while explicitly withholding semantic, economic and provenance authority',async()=>{
 const bundle=await codec.encodeReferenceInventory(state()),input=await parts(bundle),seal=await prepareCollectionSource(input,crypto);
 assert.equal(seal.stageCount,2);assert.equal(seal.admissionCount,101);assert.equal(seal.listIds.length,1);assert.equal(seal.verification,'record-closure-only');
 for(const key of ['semanticStateDigestVerified','economicsVerified','provenanceVerified'])assert.equal(seal[key],false);
 assert.ok(Object.isFrozen(seal.stageBindings[0]));assert.equal(input.lists[0].count,101);assert.equal(input.lists[0].pageIds.length,2);
 const changedRoot=await altered(input.root,body=>{body.source.stateDigest='f'.repeat(64);body.stages[0].terms.priceLamports={$lamports:'999999999999999999999999'};});
 const declared=await prepareCollectionSource({...input,root:changedRoot},crypto);assert.equal(declared.declaredStateDigest,'f'.repeat(64));assert.equal(declared.economicsVerified,false);
 const a=await prepareCollectionRecord(bundle.root,crypto);assert.equal(a.id,bundle.root.id);assert.deepEqual(Uint8Array.from(atob(a.bodyBase64),c=>c.charCodeAt(0)),bundle.root.bytes);
});

test('eligibility closure rejects missing, extra, reordered, cross-kind, changed and duplicate-boundary pages',async()=>{
 const bundle=await codec.encodeReferenceInventory(state()),input=await listParts(bundle),admissions=(await parts(bundle)).admissionPages;
 await assert.rejects(prepareCollectionList({...input,pages:input.pages.slice(0,1)},crypto),/Missing/);
 await assert.rejects(prepareCollectionList({...input,pages:[...input.pages,admissions[0]]},crypto),/extra/);
 await assert.rejects(prepareCollectionList({...input,pages:[input.pages[0],input.pages[0]]},crypto),/duplicate/);
 const changed=structuredClone(input);changed.pages[0].bytes[20]^=1;await assert.rejects(prepareCollectionList(changed,crypto),/digest mismatch/);
 await assert.rejects(prepareCollectionList({...input,manifest:await altered(input.manifest,m=>m.pageIds.reverse())},crypto),/reordered/);
 const cross=await altered(input.manifest,m=>m.pageIds[1]=admissions[1].id);await assert.rejects(prepareCollectionList({manifest:cross,pages:[input.pages[0],admissions[1]]},crypto),/cross-kind/);
 const first=await codec.verifyRecord(input.pages[0]),duplicate=await altered(input.pages[1],p=>p.entries=[first.entries.at(-1)]),manifest=await altered(input.manifest,m=>m.pageIds[1]=duplicate.id);
 await assert.rejects(prepareCollectionList({manifest,pages:[input.pages[0],duplicate]},crypto),/globally sorted/);
 const wrongCount=await altered(input.manifest,m=>m.count=102);await assert.rejects(prepareCollectionList({...input,manifest:wrongCount},crypto),/partition/);
 const extra=await altered(input.pages[0],p=>p.extra='forbidden');await assert.rejects(prepareCollectionRecord(extra,crypto),/Unexpected/);
});

test('source closure requires exact sealed lists, ordered admission pages and consistent outcomes without duplicate identities',async()=>{
 const bundle=await codec.encodeReferenceInventory(state()),input=await parts(bundle);
 await assert.rejects(prepareCollectionSource({...input,lists:[]},crypto),/Missing/);
 await assert.rejects(prepareCollectionSource({...input,lists:[...input.lists,input.lists[0]]},crypto),/extra/);
 const alteredSeal=structuredClone(input);alteredSeal.lists[0].count++;await assert.rejects(prepareCollectionSource(alteredSeal,crypto),/Changed list/);
 await assert.rejects(prepareCollectionSource({...input,admissionPages:input.admissionPages.slice(1)},crypto),/Missing/);
 const reversed=await altered(input.root,r=>r.admissions.pageIds.reverse());await assert.rejects(prepareCollectionSource({...input,root:reversed},crypto),/reordered/);
 const original=await codec.verifyRecord(input.admissionPages[0]),second=await altered(input.admissionPages[1],p=>p.entries[0].operationId=original.entries[0].operationId),root=await altered(input.root,r=>r.admissions.pageIds[1]=second.id);
 await assert.rejects(prepareCollectionSource({...input,root,admissionPages:[input.admissionPages[0],second]},crypto),/duplicate identity/);
 const missingStage=await altered(input.admissionPages[1],p=>p.entries[0].stageId='missing'),root2=await altered(input.root,r=>r.admissions.pageIds[1]=missingStage.id);
 await assert.rejects(prepareCollectionSource({...input,root:root2,admissionPages:[input.admissionPages[0],missingStage]},crypto),/stage/);
 const invalidCount=await altered(input.root,r=>{r.inventory.fulfilled=1;r.inventory.remaining[0]--;});await assert.rejects(prepareCollectionSource({...input,root:invalidCount},crypto),/outcome mismatch/);
 const cross=(await listParts(bundle)).pages[0],root3=await altered(input.root,r=>r.admissions.pageIds[0]=cross.id);await assert.rejects(prepareCollectionSource({...input,root:root3,admissionPages:[cross,input.admissionPages[1]]},crypto),/cross-kind/);
});

test('all inputs and named-record responses are captured before asynchronous verification; commands bind immutable request identity',async()=>{
 const bundle=await codec.encodeReferenceInventory(state()),input=structuredClone(await parts(bundle)),listInput=structuredClone(await listParts(bundle));let first=true;
 const mutation={sha256:async bytes=>{if(first){first=false;input.root.bytes[10]^=1;input.lists[0].count=999;input.admissionPages[0].bytes[10]^=1;}return crypto.sha256(bytes);}};
 const result=await prepareCollectionSource(input,mutation);assert.equal(result.admissionCount,101);assert.equal(result.stageCount,2);
 let once=true;await prepareCollectionList(listInput,{sha256:async bytes=>{if(once){once=false;listInput.pages[0].bytes[4]^=1;}return crypto.sha256(bytes);}});
 const principal={kind:'operator',id:'synthetic-importer'},request={record:structuredClone(bundle.root),requestKey:'stable',expectedRevisions:{source:'2'}},calls=[];
 const repository={stageRecord:async(command,raw)=>{calls.push({command,raw});assert.equal(command.requestDigest,await crypto.sha256(collectionIntakeCommandBytes(command)));return {kind:'committed',value:{id:raw.id}};}};
 let changed=false,now=200000001;const service=createCollectionSourceIntake({repository,clock:{nowMs:()=>now},crypto:{sha256:async bytes=>{if(!changed){changed=true;principal.id='changed';request.requestKey='changed';request.expectedRevisions.source='3';request.record.bytes[3]^=1;}return crypto.sha256(bytes);}}});
 await service.stageRecord(principal,request);assert.equal(calls[0].command.principal.id,'synthetic-importer');assert.equal(calls[0].command.requestKey,'stable');assert.equal(calls[0].command.expectedRevisions.source,'2');assert.equal(calls[0].raw.id,bundle.root.id);await prepareCollectionRecord(calls[0].raw,crypto);
 const fresh=createCollectionSourceIntake({repository,crypto,clock:{nowMs:()=>++now}});await fresh.stageRecord({kind:'operator',id:'synthetic-importer'},{record:bundle.root,requestKey:'stable',expectedRevisions:{source:'2'}});assert.equal(calls[0].command.requestDigest,calls[1].command.requestDigest);
 assert.ok(Object.isFrozen(calls[0].command));
});

test('service reads only named partitions and changed staged bytes cannot reach a sealing write',async()=>{
 const bundle=await codec.encodeReferenceInventory(state()),records=new Map([bundle.root,...bundle.pages,...bundle.listManifests].map(r=>[r.id,structuredClone(r)])),seals=new Map(),calls=[];let writes=0;
 const repository={readRecords:async ids=>{calls.push({kind:'records',count:ids.length});return ids.map(id=>records.get(id)).filter(Boolean);},readListSeals:async ids=>{calls.push({kind:'lists',count:ids.length});return ids.map(id=>seals.get(id)).filter(Boolean);},
  sealList:async(_command,seal)=>{seals.set(seal.id,seal);writes++;return {kind:'committed',value:{id:seal.id}};},sealSource:async(_command,seal)=>{writes++;return {kind:'committed',value:{id:seal.id}};}};
 const service=createCollectionSourceIntake({repository,crypto,clock:{nowMs:()=>200000001}}),p={kind:'operator',id:'synthetic-importer'};
 await service.sealList(p,{id:bundle.listManifests[0].id,requestKey:'list'});await service.sealSource(p,{id:bundle.root.id,requestKey:'source'});assert.equal(writes,2);
 assert.deepEqual(calls.map(c=>c.count),[1,2,1,1,2]);
 records.get((await codec.verifyRecord(bundle.root)).admissions.pageIds[0]).bytes[0]^=1;
 await assert.rejects(service.sealSource(p,{id:bundle.root.id,requestKey:'source-new'}),/digest mismatch/);assert.equal(writes,2);
});

test('valid empty eligibility and empty source are explicit; oversized inputs fail before hashing',async()=>{
 const bundle=await codec.encodeReferenceInventory(state({count:0,admissions:0,stages:1})),input=await parts(bundle),seal=await prepareCollectionSource(input,crypto);
 assert.equal(input.lists[0].count,0);assert.equal(input.lists[0].pageIds.length,1);assert.equal(input.lists[0].firstWallet,null);assert.equal(seal.admissionCount,0);
 const empty=await codec.encodeReferenceInventory(createInventory({id:'empty',kind:'genesis',tranche:1}));assert.equal((await prepareCollectionSource(await parts(empty),crypto)).stageCount,0);
 let calls=0;const unavailable={sha256:async()=>{calls++;throw Error('must not hash');}},bytes=new Uint8Array(131073);
 await assert.rejects(prepareCollectionRecord({id:'a'.repeat(64),size:bytes.length,bytes},unavailable),/byte bound/);assert.equal(calls,0);
});

test('maximum Unicode root and maximum-length finalized admissions retain bounded bytes and exact remaining inventory',async()=>{
 let value=structuredClone(state({count:1000,admissions:1000,stages:32}));value.stages=value.stages.map((s,n)=>({...s,id:String(n).padStart(3,'0')+'s'.repeat(125),inventoryOverrideReason:'漢'.repeat(500),ballotId:'b'.repeat(128),termsDigest:'a'.repeat(64)}));
 value.admissions=value.admissions.map((r,n)=>({...r,stageId:value.stages[0].id,operationId:String(n).padStart(4,'0')+'o'.repeat(124),drawCommitment:String(n).padStart(4,'0')+'c'.repeat(124),costLamports:(1n<<64n)-1n}));
 for(const [n,row] of value.admissions.entries())value=applyVerifiedMintDraw(value,{operationId:row.operationId,drawCommitment:row.drawCommitment,proofId:String(n).padStart(4,'0')+'p'.repeat(124),ticket:0});
 const bundle=await codec.encodeReferenceInventory(value),verified=await prepareCollectionRecord(bundle.root,crypto),input=await parts(bundle),seal=await prepareCollectionSource(input,crypto);
 assert.ok(bundle.root.size>65536);assert.ok(verified.bodyBase64.length<175000);assert.equal(seal.admissionCount,1000);assert.ok(input.admissionPages.length>10);assert.ok(utf8(canonicalJson(seal)).length<32768);
});

test('32 distinct full10000-wallet lists and1000 finalized admissions seal independently without a full-state runtime load',async t=>{
 let value=structuredClone(state({count:1000,admissions:1000,stages:32}));value.stages=value.stages.map((s,n)=>({...s,id:String(n).padStart(3,'0')+'s'.repeat(125),wallets:wallets(10000,n*10000),inventoryOverrideReason:'漢'.repeat(500),ballotId:'b'.repeat(128),termsDigest:'a'.repeat(64)}));
 value.admissions=value.admissions.map((r,n)=>({...r,stageId:value.stages[0].id,operationId:String(n).padStart(4,'0')+'o'.repeat(124),drawCommitment:String(n).padStart(4,'0')+'c'.repeat(124),costLamports:(1n<<64n)-1n}));
 for(const [n,row] of value.admissions.entries())value=applyVerifiedMintDraw(value,{operationId:row.operationId,drawCommitment:row.drawCommitment,proofId:String(n).padStart(4,'0')+'p'.repeat(124),ticket:0});
 const bundle=await codec.encodeReferenceInventory(value),records=new Map([...bundle.pages,...bundle.listManifests,bundle.root].map(r=>[r.id,r])),listSeals=[];let maxReadBytes=0,maxReadRecords=0;
 for(const manifest of bundle.listManifests){const body=await codec.verifyRecord(manifest),pages=body.pageIds.map(id=>records.get(id));maxReadBytes=Math.max(maxReadBytes,manifest.size+pages.reduce((n,p)=>n+p.size,0));maxReadRecords=Math.max(maxReadRecords,pages.length+1);listSeals.push(await prepareCollectionList({manifest,pages},crypto));}
 const root=await codec.verifyRecord(bundle.root),admissionPages=root.admissions.pageIds.map(id=>records.get(id)),seal=await prepareCollectionSource({root:bundle.root,lists:listSeals,admissionPages},crypto),totalBytes=[...records.values()].reduce((n,r)=>n+r.size,0);
 assert.equal(bundle.listManifests.length,32);assert.ok(bundle.pages.length>3210);assert.ok(bundle.pages.length<=3216);assert.equal(seal.listIds.length,32);assert.equal(seal.admissionCount,1000);assert.ok(totalBytes>16000000);assert.ok(maxReadBytes<524288);assert.equal(maxReadRecords,101);
 const sourceReadBytes=bundle.root.size+admissionPages.reduce((n,p)=>n+p.size,0)+utf8(canonicalJson(listSeals)).length;assert.ok(sourceReadBytes<2097152);
 t.diagnostic(JSON.stringify({records:records.size,totalRawBytes:totalBytes,maxListReadBytes:maxReadBytes,maxListReadRecords:maxReadRecords,sourceReadBytes,rootSealBytes:utf8(canonicalJson(seal)).length,rootMetadataRecords:33+admissionPages.length,admissionPages:admissionPages.length}));
});
