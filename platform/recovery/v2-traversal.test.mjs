import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {createRecoveryV2Codec,recoveryV2IndexSummary} from './v2-codec.mjs';
import {createRecoveryV2IndexReader} from './v2-traversal.mjs';
async function setup(){
 const crypto=createNodeCrypto(),store=memoryArtifacts(),v2Codec=createRecoveryV2Codec({crypto}),children=[];
 for(let n=0;n<3;n++){const entries=[];for(let j=0;j<3;j++){const byteDigest=String(n*3+j).padStart(64,'0'),identity={key:'private/'+byteDigest+'.json',byteDigest,semanticDigest:null,size:1,visibility:'private',contentType:'application/json'};entries.push({key:identity.key,value:identity});}const child=await v2Codec.encodeIndex({format:'10x.local.recovery.index.v2',kind:'objects',level:0,entries});await store.putIfAbsent(child.identity,child.bytes);children.push(child);}
 const root=await v2Codec.encodeIndex({format:'10x.local.recovery.index.v2',kind:'objects',level:1,entries:children.map(c=>recoveryV2IndexSummary(c.value,c.identity))});await store.putIfAbsent(root.identity,root.bytes);let reads=0;const reader=createRecoveryV2IndexReader({crypto,v2Codec,artifacts:{async getVerified(i){reads++;return store.getVerified(i);}}});return {crypto,store,v2Codec,children,root,reader,reads:()=>reads,pointer:{identity:root.identity,count:9}};
}
test('bounded cursor traverses exactly one verified node per continuation and replays the same leaf',async()=>{
 const f=await setup(),values=[];let cursor=null;
 for(let n=0;n<50;n++){const before=f.reads(),input={kind:'objects',pointer:f.pointer,cursor},r=await f.reader.step(input);assert.ok(f.reads()-before<=1);if(r.kind==='done'){assert.equal(values.length,9);return;}if(r.kind==='entry'){values.push(r.key);const replay=await f.reader.step(input);assert.deepEqual(replay,r);}cursor=r.cursor;}assert.fail('Traversal did not finish.');
});
test('missing children, wrong range/count and cursor mutation cannot skip verified traversal edges',async()=>{
 const f=await setup(),start=await f.reader.step({kind:'objects',pointer:f.pointer});f.store.objects.delete(f.children[0].identity.key);assert.equal((await f.reader.step({kind:'objects',pointer:f.pointer,cursor:start.cursor})).reason,'recovery-object-missing');await f.store.putIfAbsent(f.children[0].identity,f.children[0].bytes);
 const altered=structuredClone(start.cursor);altered.stack.at(-1).summary.count++;await assert.rejects(f.reader.step({kind:'objects',pointer:f.pointer,cursor:altered}),/range or count/);
 const cursor=structuredClone(start.cursor),request={kind:'objects',pointer:f.pointer,cursor},promise=f.reader.step(request);cursor.stack.length=0;assert.equal((await promise).kind,'entry');
});
