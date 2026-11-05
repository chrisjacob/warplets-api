import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decodeRecorded} from './decoders.mjs';
import {samplePolicy,sampleObservation} from '../pricing/fixtures.mjs';
import {inspectCapture,captureSha256} from '../lab/capture.mjs';
import {evidenceFixture} from './fixtures.mjs';
import {buildRequirementSpecs,normalizeRequirementValue} from './requirements.mjs';
const crypto=createNodeCrypto(),now=100000;
function decode(source,payload,changes={}){return decodeRecorded(source,{bytes:utf8(canonicalJson(payload))},{contextSlot:'100',blockTimeMs:now,requestedCutoffMs:now,finality:'finalized',chainGenesis:null,...changes});}
test('synthetic pricing reuses pinned integer policy and retains legacy network without rewriting observation clocks',()=>{
 const policy=samplePolicy('ATT'),source={mode:'synthetic-fixture',decoderVersion:'synthetic-pricing-v1',policy,subject:{kind:'stake-valuation',id:'alice'},maxBytes:262144,maxAgeMs:300000};
 const payload=sampleObservation(policy,{wallet:'alice',asOfMs:now,stakedUnits:'10000000'});
 const verified=decode(source,payload);assert.equal(verified.status,'verified');assert.equal(verified.decoded.microUsd,'10000000');assert.equal(verified.decoded.legacyNetwork,'local-solana');
 assert.equal(payload.reference.observedMs,now-policy.minLookbackMs);
 assert.equal(decode(source,payload,{contextSlot:'101'}).reason,'valuation-recording-context');
 assert.equal(decode(source,payload,{requestedCutoffMs:now-1}).reason,'future-cutoff-observation');
 assert.equal(decode(source,payload,{requestedCutoffMs:now+300001}).reason,'stale-cutoff-observation');
 assert.equal(decode(source,{...payload,farm:null}).status,'pending');
 assert.equal(decode({...source,mode:'recorded-public'},payload,{chainGenesis:'synthetic-test-chain'}).status,'incompatible');
 const subject={kind:'wallet-token',id:canonicalJson(['alice','ATT'])},composite={...source,subject};
 assert.equal(decode(composite,payload,{subject}).status,'verified');
 assert.equal(decode({...composite,subject:{kind:'wallet-token',id:canonicalJson(['bob','ATT'])}},payload).reason,'valuation-subject');
 assert.equal(decode({...composite,subject:{kind:'wallet-token',id:canonicalJson(['alice','OTHER'])}},payload).reason,'valuation-subject');
 assert.equal(decode(composite,payload,{subject:{kind:'wallet-token',id:canonicalJson(['alice','OTHER'])}}).reason,'valuation-subject');
});
test('gap-free synthetic external activity preserves linked purchases and withdrawals; incomplete/confirmed/missing times hold',()=>{
 const policy={wallet:'alice',tokenId:'ATT',farmProgram:'fixture-farm',swapProgram:'fixture-swap',enrolledAtMs:now-1000};
 const source={mode:'synthetic-fixture',decoderVersion:'synthetic-position-history-v1',policy,maxBytes:262144,maxAgeMs:300000};
 const common={wallet:'alice',tokenId:'ATT',program:policy.farmProgram,finality:'finalized'};
 const buy={...common,type:'verified-buy-and-stake',sequence:1,atMs:now-500,signature:'buy',instructionIndex:2,netBoughtUnits:'20',depositedUnits:'12',
  swap:{program:policy.swapProgram,wallet:'alice',tokenId:'ATT',signature:'buy',instructionIndex:1,netBoughtUnits:'20'},
  deposit:{wallet:'alice',tokenId:'ATT',signature:'buy',instructionIndex:2,depositedUnits:'12'}};
 const withdrawal={...common,type:'withdrawal',sequence:2,atMs:now-100,signature:'external-withdrawal',instructionIndex:0,withdrawnUnits:'5',remainingStakeUnits:'7'};
 const payload={network:'solana-local',wallet:'alice',tokenId:'ATT',enrolledAtMs:policy.enrolledAtMs,throughMs:now,complete:true,
  pages:[{cursor:null,nextCursor:'p2',events:[buy]},{cursor:'p2',nextCursor:null,events:[withdrawal]}]};
 const good=decode(source,payload);assert.equal(good.status,'verified');assert.equal(good.decoded.creditedUnits,'7');assert.equal(good.decoded.legacyNetwork,'solana-local');assert.equal(good.coverage.complete,true);
 const variants=[{...payload,pages:[payload.pages[0]]},{...payload,complete:false},{...payload,pages:[{cursor:null,nextCursor:null,events:[]}]},
  {...payload,pages:[{cursor:null,nextCursor:null,events:[{...buy,atMs:null}]}]},
  {...payload,pages:[{cursor:null,nextCursor:null,events:[{...buy,finality:'confirmed'}]}]},
  {...payload,pages:[{cursor:null,nextCursor:null,events:[{...buy,sequence:2}]}]}];
 assert.equal(decode(source,variants[0]).status,'pending');assert.equal(decode(source,variants[1]).status,'pending');
 assert.equal(decode(source,variants[2]).status,'verified','explicit complete empty synthetic transcript is distinct from absent pages');
 for(const v of variants.slice(3))assert.equal(decode(source,v).status,'pending');
 assert.equal(decode(source,{...payload,pages:[]}).status,'pending');
 assert.equal(decode(source,{...payload,pages:[{cursor:null,nextCursor:null,events:[{...buy,deposit:{...buy.deposit,depositedUnits:'99'}}]}]}).status,'incompatible');
});
test('repeated empty history page cursors cannot assert complete coverage',()=>{
 const policy={wallet:'alice',tokenId:'ATT',farmProgram:'fixture-farm',swapProgram:'fixture-swap',enrolledAtMs:now-1000};
 const source={mode:'synthetic-fixture',decoderVersion:'synthetic-position-history-v1',policy,maxBytes:262144,maxAgeMs:300000};
 const page=(cursor,nextCursor)=>({cursor,nextCursor,events:[]});
 const payload={network:'solana-local',wallet:'alice',tokenId:'ATT',enrolledAtMs:policy.enrolledAtMs,throughMs:now,complete:true};
 for(const pages of [[page(null,'x'),page('x','x'),page('x',null)],
  [page(null,'x'),page('x','y'),page('y','x'),page('x',null)]]){
  const result=decode(source,{...payload,pages});
  assert.equal(result.status,'invalid');assert.equal(result.reason,'history-cursor-cycle');assert.equal(result.coverage.complete,false);
 }
 const complete=decode(source,{...payload,pages:[page(null,'x'),page('x','y'),page('y',null)]});
 assert.equal(complete.status,'verified');assert.equal(complete.coverage.complete,true);
 assert.equal(decode(source,{...payload,pages:[page(null,'x')]}).status,'pending');
});
test('history v2 preserves the economic journal so an exit and repurchase cannot hide behind the same terminal credit',async()=>{
 const policy={wallet:'alice',tokenId:'ATT',farmProgram:'fixture-farm',swapProgram:'fixture-swap',enrolledAtMs:now-1000};
 const source={mode:'synthetic-fixture',decoderVersion:'synthetic-position-history-v2',policy,maxBytes:262144,maxAgeMs:300000};
 const event=(sequence,type)=>({wallet:'alice',tokenId:'ATT',program:policy.farmProgram,finality:'finalized',type,sequence,atMs:now-1000+sequence*100,
  signature:'tx'+sequence,instructionIndex:2,sourceRef:'untrusted-label'});
 const buy=sequence=>({...event(sequence,'verified-buy-and-stake'),netBoughtUnits:'12',depositedUnits:'12',
  swap:{program:policy.swapProgram,wallet:'alice',tokenId:'ATT',signature:'tx'+sequence,instructionIndex:1,netBoughtUnits:'12'},
  deposit:{wallet:'alice',tokenId:'ATT',signature:'tx'+sequence,instructionIndex:2,depositedUnits:'12'}});
 const payload=events=>({network:'solana-local',wallet:'alice',tokenId:'ATT',enrolledAtMs:policy.enrolledAtMs,throughMs:now,complete:true,
  pages:[{cursor:null,nextCursor:null,events}]});
 const withdrawn=decode(source,payload([buy(1),{...event(2,'withdrawal'),withdrawnUnits:'12',remainingStakeUnits:'0'},buy(3)]));
 const retained=decode(source,payload([buy(1),event(2,'deposit'),event(3,'reward')]));
 assert.equal(withdrawn.status,'verified');assert.equal(retained.status,'verified');
 assert.equal(withdrawn.decoded.sequence,retained.decoded.sequence);assert.equal(withdrawn.decoded.creditedUnits,retained.decoded.creditedUnits);
 const value=d=>normalizeRequirementValue('position-history',source.decoderVersion,d.decoded);
 const input=decoded=>({authority:'evidence',kind:'position-history',subject:{kind:'position',id:'alice:ATT'},cutoffMs:now,sourceId:'history',sourceRevision:'1',
  decoderVersion:source.decoderVersion,value:value(decoded),coverage:{required:'interval',fromMs:policy.enrolledAtMs,toMs:now}});
 const [a]=await buildRequirementSpecs([input(withdrawn)],crypto),[b]=await buildRequirementSpecs([input(retained)],crypto);
 assert.notEqual(a.expectedValueDigest,b.expectedValueDigest);
 assert.deepEqual(withdrawn.decoded.events[1],{type:'withdrawal',signature:'tx2',instructionIndex:2,wallet:'alice',tokenId:'ATT',sequence:2,atMs:now-800,
  confirmed:true,withdrawnUnits:'12',remainingStakeUnits:'0'});
 assert.equal(withdrawn.decoded.events[0].swapIndex,1);assert.equal(Object.hasOwn(withdrawn.decoded.events[0],'sourceRef'),false);
 assert.equal(Object.hasOwn(withdrawn.decoded.events[0],'program'),false);
 const v1=decode({...source,decoderVersion:'synthetic-position-history-v1'},payload([buy(1)]));
 assert.equal(Object.hasOwn(v1.decoded,'events'),false,'v1 output shape stays unchanged');
 const subject={kind:'wallet-token',id:canonicalJson(['alice','ATT'])},composite={...source,subject};
 assert.equal(decode(composite,payload([buy(1)]),{subject}).status,'verified');
 assert.equal(decode({...composite,subject:{kind:'wallet-token',id:canonicalJson(['alice','OTHER'])}},payload([buy(1)])).reason,'position-subject');
 assert.equal(decode(composite,payload([buy(1)]),{subject:{kind:'wallet-token',id:canonicalJson(['bob','ATT'])}}).reason,'position-subject');
 assert.equal(decode(source,{...payload([]),throughMs:policy.enrolledAtMs-1}).reason,'history-time');
});
test('genuine pinned public account capture remains a decoder-only vector with absent genesis/block time',async()=>{
 const archive=readFileSync(new URL('../lab/fixtures/programs-mainnet.json.gz',import.meta.url)),pin=JSON.parse(readFileSync(new URL('../lab/fixtures/programs.json',import.meta.url)));
 const inspected=inspectCapture(archive,pin);assert.equal(inspected.length,2);assert.equal(await crypto.sha256(archive),captureSha256);
 const capture=JSON.parse(gunzipSync(archive,{maxOutputLength:16*1024*1024})),account=capture.accounts[0];
 const retrievedAtMs=Date.parse(capture.capturedAt),subject={kind:'program',id:account.address};
 const f=await evidenceFixture({crypto,payload:account,subject,mode:'recorded-public',chainGenesis:null,now:retrievedAtMs,
  policy:{ownerProgram:account.owner},records:[{id:'program-account',subject,contextSlot:String(capture.context),blockTimeMs:null,retrievedAtMs,finality:'finalized',archiveByteDigest:captureSha256,bytes:utf8(canonicalJson(account))}]});
 const record=await f.reader.read('program-account');const result=decodeRecorded(f.source,record,{contextSlot:String(capture.context),blockTimeMs:null,requestedCutoffMs:retrievedAtMs,finality:'finalized',chainGenesis:null});
 assert.equal(result.status,'pending');assert.equal(result.coverage.complete,false);assert.equal(f.reader.mode,'recorded-public');
 assert.equal(account.sha256,await crypto.sha256(Buffer.from(account.data,'base64')));
});
