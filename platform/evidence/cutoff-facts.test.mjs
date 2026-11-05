import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeRecorded} from './decoders.mjs';
import {validateSource} from './envelope.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
const now=86400000-1;
function fixture(kind,items=[],fromMs=0){
 const subject={kind,id:kind==='campaign-registry'?'registry':'alice'},source={version:1,sourceId:'fixture:'+kind,sourceRevision:'1',mode:'synthetic-fixture',
  chainGenesis:null,decoderVersion:'synthetic-cutoff-facts-v1',subject,policy:{kind,fromMs},recordingDigest:'a'.repeat(64),maxBytes:262144,maxAgeMs:300000};
 const payload={version:1,network:'solana-local',kind,subject:{...subject},fromMs,toMs:now,complete:true,pages:[{cursor:null,nextCursor:null,items}]};
 const envelope={subject:{...subject},contextSlot:'100',blockTimeMs:now,retrievedAtMs:now,ingestedAtMs:now,requestedCutoffMs:now,finality:'finalized',chainGenesis:null};
 return {source,payload,envelope};
}
const decode=({source,payload,envelope})=>decodeRecorded(source,{bytes:utf8(canonicalJson(payload))},envelope);
test('complete synthetic inventories normalize known facts and distinguish positive empty coverage from missing pages',()=>{
 const cases=[['campaign-registry',[{tokenId:'ATT',activationMs:100}],{campaigns:[{tokenId:'ATT',activationMs:100}]}],
  ['ownership',[{assetId:'nft',collectionId:'genesis',owner:'alice',chain:'solana',level:2}],{wallet:'alice',assets:[{assetId:'nft',collectionId:'genesis',owner:'alice',chain:'solana',level:2}]}],
  ['position-inventory',[{tokenId:'ATT',activationMs:100,enrolledMs:200}],{wallet:'alice',positions:[{tokenId:'ATT',activationMs:100,enrolledMs:200}]}],
  ['action-completions',[{actionId:'join',verifiedAtMs:100,verifier:'fixture-verifier',sourceRef:'fixture-source'}],{wallet:'alice',completions:[{actionId:'join',verifiedAtMs:100,verifier:'fixture-verifier',sourceRef:'fixture-source'}]}]];
 for(const [kind,items,value] of cases){
  const f=fixture(kind,items),result=decode(f);validateSource(f.source);assert.equal(result.status,'verified');assert.deepEqual(result.decoded.value,value);
  assert.deepEqual(result.coverage,{complete:true,fromMs:0,toMs:now,gaps:[]});
  assert.equal(decode(fixture(kind)).status,'verified');f.payload.pages=[];assert.equal(decode(f).status,'pending');
 }
});
test('interval, identity, page gaps, cycles, duplicates and current-only public reads cannot claim complete inventory',()=>{
 const asset={assetId:'nft',collectionId:'genesis',owner:'alice',chain:'solana',level:2};
 for(const [change,status] of [[f=>f.payload.toMs--,'pending'],[f=>f.payload.fromMs++,'invalid'],[f=>f.payload.subject.id='bob','incompatible'],
  [f=>f.source.mode='recorded-public','pending'],[f=>f.payload.pages[0].nextCursor='missing','pending'],[f=>f.payload.complete=false,'pending'],
  [f=>f.payload.pages[0].items.push({...asset}),'invalid'],[f=>f.payload.pages[0].items[0].owner='bob','invalid'],
  [f=>f.payload.pages=[{cursor:null,nextCursor:'x',items:[]},{cursor:'x',nextCursor:'x',items:[]},{cursor:'x',nextCursor:null,items:[]}],'invalid']]){
  const f=fixture('ownership',[{...asset}]);change(f);assert.equal(decode(f).status,status);
 }
 const source=fixture('ownership').source;delete source.policy.fromMs;assert.throws(()=>validateSource(source),/source-cutoff-policy/);
});
test('ownership retains the full 1000-asset bound across pages and never truncates over-bound inventories',()=>{
 const f=fixture('ownership');
 f.payload.pages=Array.from({length:10},(_,p)=>({cursor:p?'p'+p:null,nextCursor:p===9?null:'p'+(p+1),items:Array.from({length:100},(_,i)=>({
  assetId:'nft-'+(p*100+i),collectionId:'genesis',owner:'alice',chain:'solana',level:1}))}));
 const result=decode(f);assert.equal(result.status,'verified');assert.equal(result.decoded.value.assets.length,1000);
 f.payload.pages[9].nextCursor='p10';f.payload.pages.push({cursor:'p10',nextCursor:null,items:[{assetId:'overflow',collectionId:'genesis',owner:'alice',chain:'solana',level:1}]});
 assert.equal(decode(f).reason,'cutoff-item-bound');
 const overPage=fixture('ownership',Array.from({length:101},(_,i)=>({assetId:'n'+i,collectionId:'genesis',owner:'alice',chain:'solana',level:1})));
 assert.equal(decode(overPage).reason,'cutoff-page-item-bound');
});
