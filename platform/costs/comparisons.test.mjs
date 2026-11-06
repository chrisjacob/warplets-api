import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateCostComparisons} from './packet-core.mjs';
import {executionContextId} from './packet.mjs';
import {costPacketFixtures} from './packet.fixtures.mjs';
const options=kind=>({firstBoard:kind==='pending'?{kind}:{kind,evidenceDigest:'a'.repeat(64)},boardQuotes:{}});
const run=(input,o=options('pending'))=>calculateCostComparisons(input,executionContextId(input.context),o);
test('first ATT includes all reserve setup before lazy mint and holds an unresolved first board',()=>{
 const input=costPacketFixtures().complete,r=run(input),first=r.firstAtt;
 assert.equal(first.selected,null);assert.equal(first.status,'incomplete');assert.deepEqual(first.unresolved,['first-board-evidence-pending']);
 for(const profile of Object.values(first.alternatives)){
  const ids=profile.lines.map(l=>l.id);assert.equal(new Set(ids).size,ids.length);
  for(const id of ['collectionSetup','collectionNetwork','reserveSetupRent','farmStateRent','vaultCheckpointRent'])assert.ok(ids.includes(id),id);
  assert.ok(!ids.includes('coreProtocol'));assert.ok(!ids.includes('firstWhitelistPrice'));
 }
 assert.equal(first.supplyAccounting.genesisIncludesUnminted,true);assert.equal(first.supplyAccounting.tokenSupplyIsFounderCashCost,false);
 assert.equal(r.financialExecution,false);assert.equal(r.isAuthorization,false);assert.equal(r.assumptions,'caller-supplied-unverified');
});
test('recorded empty branch prices burn and retention, never a recipient root, and keeps later roots visible',()=>{
 const input=costPacketFixtures().complete,o=options('empty-recorded');let r=run(input,o);
 assert.equal(r.firstAtt.selected.status,'incomplete');assert.ok(r.firstAtt.selected.lines.find(l=>l.id==='earnBurnNetwork').problems.includes('missing-quote'));
 for(const id of ['earnBurnNetwork','earnBurnRetry'])o.boardQuotes[id]={...input.quotes.earnRootNetwork};
 r=run(input,o);const ids=r.firstAtt.selected.lines.map(l=>l.id);assert.ok(!ids.includes('earnRootRent'));assert.ok(!ids.includes('earnRootNetwork'));assert.ok(ids.includes('earnManifestHost'));
 assert.equal(r.firstAtt.selected.status,'quoted');assert.ok(r.firstAtt.laterMandatoryRoot.lines.some(l=>l.id==='earnRootRent'));
 const recipient=run(input,options('recipients-recorded'));assert.ok(recipient.firstAtt.selected.lines.some(l=>l.id==='earnRootRent'));assert.ok(!recipient.firstAtt.selected.lines.some(l=>l.id==='earnBurnNetwork'));
});
test('one claimant and one mint preserve missing claimant costs and policy price is not fulfillment',()=>{
 const input=costPacketFixtures().complete;input.parameters.freshAtasPerUser=1;input.parameters.vaultClaimsPerUser=1;delete input.quotes.claimStateRent;
 delete input.quotes.mintRandomness;const r=run(input);
 assert.equal(r.oneClaim.lines.find(l=>l.id==='classicAtaRent').quantity,1);assert.equal(r.oneClaim.lines.find(l=>l.id==='temporaryVaultTokenAccount').quantity,1);
 assert.equal(r.oneClaim.byPayer.claimant.complete,false);assert.equal(r.oneMint.lines.find(l=>l.id==='firstWhitelistPrice').status,'product-policy');assert.equal(r.oneMint.status,'incomplete');
 assert.ok(r.monthly.lines.some(l=>l.id==='recurringStorage'));assert.ok(r.monthly.lines.some(l=>l.id==='realizedMintReceipts'));
});
test('references, expired conversion, changed context and invalid board declarations cannot become complete',()=>{
 for(const input of [costPacketFixtures().reference,costPacketFixtures().stale,costPacketFixtures().changed])assert.equal(run(input,options('recipients-recorded')).firstAtt.selected.status,'incomplete');
 const input=costPacketFixtures().complete;
 for(const firstBoard of [{kind:'empty-recorded'},{kind:'pending',evidenceDigest:'a'.repeat(64)},{kind:'paid',evidenceDigest:'a'.repeat(64)}])assert.throws(()=>run(input,{firstBoard,boardQuotes:{}}));
 assert.throws(()=>run(input,{...options('pending'),boardQuotes:{earnRootRent:{}}}));
});
