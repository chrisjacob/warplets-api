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
