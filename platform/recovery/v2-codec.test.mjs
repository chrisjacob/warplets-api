import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryV2Codec,RECOVERY_V2_LIMITS,recoveryV2IndexSummary,verifyRecoveryV2IndexChild} from './v2-codec.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {schemaDescriptor} from './inventory.mjs';
const crypto=createNodeCrypto(),codec=createRecoveryV2Codec({crypto});
const rows=()=>({format:'10x.local.recovery.rows.v2',table:'genesis_voters',index:0,columns:['ballot_id','wallet'],hasRowid:true,after:null,rows:[[1,'synthetic-ballot','synthetic-wallet']]});
const dataId=n=>{const byteDigest=n.toString(16).padStart(64,'0');return {key:'private/'+byteDigest+'.json',byteDigest,semanticDigest:null,size:1,visibility:'private',contentType:'application/json'};};
test('v2 row pages retain exact bounded scalar bytes and reject hidden overflow/order/continuation errors',async()=>{
 const input=rows(),encoded=await codec.encodeRows(input);assert.deepEqual(await codec.verifyRows(encoded.bytes,encoded.identity),input);assert.equal(encoded.identity.byteDigest,await crypto.sha256(utf8(canonicalJson(input))));assert.equal(encoded.identity.semanticDigest,null);
 for(const value of [{...input,rows:Array.from({length:101},(_,n)=>[n+1,'b','w'])},{...input,rows:[[1,'b',{}]]},{...input,index:1},{...input,rows:[[2,'b','w'],[1,'b','w']]},{...input,rows:[[1,'b','x'.repeat(131072)]]}])await assert.rejects(codec.encodeRows(value),/v2|V2/);
 const large={...input,table:'app_collection_records',rows:[[1,'b','x'.repeat(150000)]]};assert.ok((await codec.encodeRows(large)).bytes.length>RECOVERY_V2_LIMITS.pageBytes);
 const corrupt=new Uint8Array(encoded.bytes);corrupt[0]^=1;await assert.rejects(codec.verifyRows(corrupt,encoded.identity),/identity mismatch/);
});
test('v2 encoding captures caller input and verification bytes before asynchronous hashing',async()=>{
 const input=rows();let resume,started;const entered=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>resume=resolve),slow=createRecoveryV2Codec({crypto:{async sha256(bytes){started();await gate;return crypto.sha256(bytes);}}});
 const operation=slow.encodeRows(input);await entered;input.rows[0][2]='changed';resume();const encoded=await operation;assert.equal(encoded.value.rows[0][2],'synthetic-wallet');
 let release;const waiting=new Promise(resolve=>release=resolve),verifier=createRecoveryV2Codec({crypto:{async sha256(bytes){await waiting;return crypto.sha256(bytes);}}}),bytes=new Uint8Array(encoded.bytes),identity={...encoded.identity},verified=verifier.verifyRows(bytes,identity);bytes.fill(0);identity.byteDigest='f'.repeat(64);release();assert.equal((await verified).rows[0][2],'synthetic-wallet');
});
test('10000 object identities form bounded index nodes with exact child range/count commitments',async()=>{
 const children=[];for(let offset=0;offset<10000;offset+=100){const value={format:'10x.local.recovery.index.v2',kind:'objects',level:0,entries:Array.from({length:100},(_,n)=>{const value=dataId(offset+n);return {key:value.key,value};})};children.push(await codec.encodeIndex(value));}
 const parent=await codec.encodeIndex({format:'10x.local.recovery.index.v2',kind:'objects',level:1,entries:children.map(c=>recoveryV2IndexSummary(c.value,c.identity))});assert.ok(parent.bytes.length<131072);assert.equal(recoveryV2IndexSummary(parent.value,parent.identity).count,10000);
 for(const [n,child]of children.entries())assert.equal(verifyRecoveryV2IndexChild(parent.value,parent.value.entries[n],await codec.verifyIndex(child.bytes,child.identity),child.identity),true);
 const wrong=structuredClone(parent.value);wrong.entries[0].count++;assert.throws(()=>verifyRecoveryV2IndexChild(wrong,wrong.entries[0],children[0].value,children[0].identity),/count mismatch/);
 await assert.rejects(codec.encodeIndex({...parent.value,entries:[parent.value.entries[0],parent.value.entries[0]]}),/overlapping|unordered/i);
 await assert.rejects(codec.encodeIndex({...children[0].value,entries:[...children[0].value.entries,children[1].value.entries[0]]}),/fanout/);
 const octet={...dataId(20000),key:'private/'+dataId(20000).byteDigest+'.bin',contentType:'application/octet-stream',semanticDigest:'f'.repeat(64)};await codec.encodeIndex({format:'10x.local.recovery.index.v2',kind:'objects',level:0,entries:[{key:octet.key,value:octet}]});
});
test('v2 table digest binds columns/count/index root and root verification requires independent pin and installed schema digest',async()=>{
 const page=await codec.encodeRows(rows()),pages=await codec.encodeIndex({format:'10x.local.recovery.index.v2',kind:'table-pages',level:0,entries:[{key:'0000000000',value:{identity:page.identity,index:0,rowCount:1,after:null,last:[1]}}]});
 const table=await codec.tableDescriptor({name:'genesis_voters',columns:['ballot_id','wallet'],primaryKey:['ballot_id','wallet'],hasRowid:true,rowCount:1,pages:{identity:pages.identity,count:1}});assert.deepEqual(await codec.verifyTableDescriptor(table),table);await assert.rejects(codec.verifyTableDescriptor({...table,rowCount:2}),/digest mismatch/);
 const tableIndex=await codec.encodeIndex({format:'10x.local.recovery.index.v2',kind:'tables',level:0,entries:[{key:table.name,value:table}]}),schema=await schemaDescriptor([{file:'001-synthetic.sql',digest:'a'.repeat(64)}],crypto),root={format:'10x.local.recovery.v2',mode:'private',createdMs:1,sourceCommit:'b'.repeat(40),schema,snapshot:{generation:'synthetic-generation',watermark:'0'},tables:{identity:tableIndex.identity,count:1},objects:{identity:null,count:0},publications:{identity:null,count:0},checkpoints:page.identity,totals:{rows:1,objects:3,bytes:page.bytes.length+pages.bytes.length+tableIndex.bytes.length},authPolicy:'revoke-sessions-and-fence-leases'};
 const pinned=await codec.encodeRoot(root);assert.deepEqual(await codec.verifyRoot(pinned.bytes,pinned.digest),root);await assert.rejects(codec.verifyRoot(pinned.bytes,'f'.repeat(64)),/pinned root mismatch/);await assert.rejects(codec.encodeRoot({...root,totals:{...root.totals,bytes:134217729}}),/aggregate/);await assert.rejects(codec.encodeRoot({...root,schema:{...schema,fingerprint:'f'.repeat(64)}}),/fingerprint/);
 // Structural root verification intentionally does not certify graph closure.
 // The continued service must verify checkpoints' schema and every referenced
 // object before any root can be marked ready or a target become writable.
});
