import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {buildRequirementSpecs,selectRequirementReceipts,normalizeRequirementValue} from './requirements.mjs';
const crypto=createNodeCrypto(),cutoff=86400000-1;
const fact=(kind,value,id=kind)=>({authority:'evidence',kind,subject:{kind,id},cutoffMs:cutoff,value,sourceId:'fixture:'+id,sourceRevision:'1',
 decoderVersion:'synthetic-cutoff-facts-v1',coverage:{required:'interval',fromMs:0,toMs:cutoff}});
const application=(value,available=true)=>({authority:'application',kind:'epoch-admissions',subject:{kind:'epoch',id:'0'},cutoffMs:cutoff,value,available,
 coverage:{required:'interval',fromMs:0,toMs:cutoff}});
function head(spec,value){return {receiptDigest:'a'.repeat(64),envelope:{sourceId:spec.sourceId,sourceRevision:spec.sourceRevision,decoderVersion:spec.decoderVersion,
 subject:spec.subject,requestedCutoffMs:spec.cutoffMs,mode:'synthetic-fixture',finality:'finalized'},decision:{status:'verified',scope:'synthetic-transcript',
 coverage:{complete:true,fromMs:spec.coverage.fromMs,toMs:spec.coverage.toMs,gaps:[]},decoded:{kind:spec.kind,value,legacyNetwork:'solana-local'}}};}
test('selection binds every current receipt and reports only the removed dependency; application values have no fictitious receipt',async()=>{
 const inputs=[application({submissions:[]}),fact('campaign-registry',{campaigns:[]}),fact('ownership',{wallet:'alice',assets:[]},'alice'),
  fact('position-inventory',{wallet:'alice',positions:[]},'alice-positions'),fact('action-completions',{wallet:'alice',completions:[]},'alice-actions')];
 const specs=await buildRequirementSpecs(inputs,crypto),heads=new Map(specs.filter(s=>s.authority==='evidence').map(s=>[s.id,head(s,inputs.find(i=>i.kind===s.kind).value)]));
 const ready=await selectRequirementReceipts(specs,heads,crypto);assert.equal(ready.kind,'ready');assert.equal(ready.dependencies.length,0);
 assert.equal(ready.requirements.find(r=>r.authority==='application').receiptDigest,null);
 for(const id of heads.keys()){
  const missing=new Map(heads);missing.delete(id);const held=await selectRequirementReceipts(specs,missing,crypto);
  assert.deepEqual(held.dependencies,[{id,reasons:['receipt-missing']}]);
 }
 const repeated=await selectRequirementReceipts([...specs].reverse(),new Map([...heads].reverse()),crypto);
 assert.equal(repeated.requirementsDigest,ready.requirementsDigest);assert.equal(repeated.evidenceDigest,ready.evidenceDigest);
});
test('wrong cutoff/source/value and a current negative head never select a previous verified receipt',async()=>{
 const input=fact('ownership',{wallet:'alice',assets:[]},'alice'),[spec]=await buildRequirementSpecs([input],crypto);
 for(const [change,reason] of [[h=>h.envelope.requestedCutoffMs--,'receipt-cutoff'],[h=>h.envelope.sourceRevision='2','receipt-source'],
  [h=>h.envelope.subject.id='bob','receipt-subject'],[h=>h.envelope.mode='recorded-public','receipt-mode-or-finality'],
  [h=>h.decision.decoded.value.assets.push({assetId:'different'}),'receipt-value'],[h=>h.decision.coverage.fromMs++,'receipt-coverage'],
  [h=>h.decision.status='pending','receipt-incomplete'],[h=>h.decision.scope='decoder-only','receipt-incomplete']]){
  const h=structuredClone(head(spec,input.value));change(h);const held=await selectRequirementReceipts([spec],new Map([[spec.id,h]]),crypto);
  assert.equal(held.kind,'pending');assert.ok(held.dependencies[0].reasons.includes(reason),reason);
 }
});
test('application missing state remains pending; changed frozen value changes digest but preserves logical dependency id',async()=>{
 const [first]=await buildRequirementSpecs([application({submissions:[]})],crypto);
 const [changed]=await buildRequirementSpecs([application({submissions:['post']})],crypto);
 assert.equal(first.id,changed.id);assert.notEqual(first.expectedValueDigest,changed.expectedValueDigest);
 const a=await selectRequirementReceipts([first],new Map(),crypto),b=await selectRequirementReceipts([changed],new Map(),crypto);
 assert.notEqual(a.requirementsDigest,b.requirementsDigest);assert.notEqual(a.evidenceDigest,b.evidenceDigest);
 const missing=await buildRequirementSpecs([{...application(null,false),pendingReason:'review-missing'}],crypto);
 assert.deepEqual((await selectRequirementReceipts(missing,new Map(),crypto)).dependencies,[{id:missing[0].id,reasons:['review-missing']}]);
 await assert.rejects(buildRequirementSpecs([application(null),application(null)],crypto),/duplicate-requirement/);
 await assert.rejects(buildRequirementSpecs([{...application(null),kind:'invented'}],crypto),/requirement-kind/);
});
test('pricing and history v2 normalize exact economic values and reject the history v1 shortcut',async()=>{
 const price={status:'verified',microUsd:'10000000',stakedUnits:'10',priceNumerator:'1000000',priceDenominator:'1',expiresMs:cutoff+1000};
 const input={...fact('closing-stake',price),decoderVersion:'synthetic-pricing-v1',coverage:{required:'point',fromMs:cutoff,toMs:cutoff}};
 const [spec]=await buildRequirementSpecs([input],crypto),h=head(spec,price);
 h.decision.decoded={...price,legacyNetwork:'local-solana',reason:'fixture'};h.decision.coverage={complete:true,gaps:[]};
 assert.equal((await selectRequirementReceipts([spec],new Map([[spec.id,h]]),crypto)).kind,'ready');
 const history={wallet:'alice',tokenId:'ATT',sequence:1,creditedUnits:'0',events:[{type:'exit'}]};
 assert.deepEqual(normalizeRequirementValue('position-history','synthetic-position-history-v2',{...history,flags:[],legacyNetwork:'local-solana'}),history);
 assert.throws(()=>normalizeRequirementValue('position-history','synthetic-position-history-v1',history),/unsupported-complete-decoder/);
});
test('caller mutation during hashing cannot alter frozen inputs or receipt heads',async()=>{
 const input=fact('ownership',{wallet:'alice',assets:[]},'alice');let mutate=()=>{input.value.wallet='mallory';input.subject.id='mallory';};
 const mutating={...crypto,sha256:async bytes=>{const action=mutate;mutate=()=>{};action();return crypto.sha256(bytes);}};
 const specs=await buildRequirementSpecs([input],mutating);assert.equal(specs[0].subject.id,'alice');
 const h=head(specs[0],{wallet:'alice',assets:[]});mutate=()=>{h.envelope.subject.id='mallory';h.decision.decoded.value.wallet='mallory';};
 assert.equal((await selectRequirementReceipts(specs,new Map([[specs[0].id,h]]),mutating)).kind,'ready');
});
