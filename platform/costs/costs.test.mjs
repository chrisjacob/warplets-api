import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPilotBudget, assessRecurring } from './budget.mjs';
import { costPacket, executionContextId } from './packet.mjs';
import { referenceScenarioInput } from './reference.mjs';

const now=Date.UTC(2026,10,6,12);
const context={network:'local-test',slot:'101',instructionSetHash:'compiled-test',fundingStateHash:'funding-A',
  programSetHash:'local-program-A',blockhash:'block-A',simulationRef:'simulation-A',validUntilMs:now+60_000,ogMint:'OG-A'};
const ref={kind:'quoted',sourceRef:'synthetic-test-evidence',observedMs:now-100,expiresMs:now+1000,
  slot:'101',network:context.network,contextId:executionContextId(context)};
function scenario(input,id) {return costPacket(input).scenarios.find(s=>s.id===id);}
function q(unit,amount,more={}) {return {...ref,unit,amount,accountLayoutRef:'verified-size-and-existence-fixture',
  accounts:[{role:'test',bytes:165,exists:false,additionalLamports:amount}],expectedRefundableUnits:'0',...more};}
function fullTestInput() {
  const reference=referenceScenarioInput(now);
  const sample={asOfMs:now,context,parameters:reference.parameters,availableCashUsdMicros:'30000000',
    fx:{sol:{...ref,microUsdPerWhole:'100000000'},og:{...ref,mint:'OG-A',decimals:6,microUsdPerWhole:'2000000'}},
    quotes:{}};
  const packet=costPacket(sample);
  // Explicitly hypothetical tests of a complete quote; no default is shipped for these costs.
  for(const s of packet.scenarios)for(const item of s.lines) {
    if(item.status!=='product-policy')sample.quotes[item.id]=q(item.unit,'10',item.unit==='ogRaw'?{mint:'OG-A'}:{});
  }
  return sample;
}
test('complete fourteen-scenario catalog preserves open terms and separate payer denominations',()=>{
  const packet=costPacket(referenceScenarioInput(now));
  assert.deepEqual(packet.scenarios.map(s=>s.id),Array.from({length:14},(_,i)=>i+1));
  assert.equal(packet.firstAtt.status,'incomplete');
  assert.equal(packet.firstAtt.pilotBudget,null);
  for(const [id,total] of [[6,'148844000'],[7,'1488440000'],[8,'14884400000']]) {
    const s=packet.scenarios.find(s=>s.id===id);
    assert.equal(s.byPayer.claimant.pricedByUnit.lamport,total);
    assert.equal(s.byPayer.claimant.complete,false);
  }
  const tranche=packet.scenarios[9];
  assert.equal(tranche.byPayer.minter.pricedByUnit.lamport,'1500000000');
  assert.equal(packet.scenarios[12].backstopStatus,'unused');
  assert.equal(packet.scenarios[13].outcomes.breakEvenTradingVolumeUsdMicros,null);
});
test('base unit arithmetic preserves cents, OG decimals and conservative conversion rounding',()=>{
  const input=fullTestInput();
  input.quotes.ogSeed=q('ogRaw','1',{mint:'OG-A'});
  input.quotes.mintRent=q('lamport','1');
  const result=scenario(input,1);
  assert.equal(result.status,'quoted');
  assert.equal(result.lines.find(l=>l.id==='ogSeed').usdMicros,'2');
  assert.equal(result.lines.find(l=>l.id==='mintRent').usdMicros,'1');
  assert.equal(result.pilotBudget.status,'pass');
  input.fx.og.mint='other';assert.equal(scenario(input,1).status,'incomplete');
});
test('expiration, missing quantity and changed funding/program/blockhash invalidate the packet',()=>{
  const input=fullTestInput();
  assert.equal(costPacket(input).firstAtt.status,'quoted');
  for(const field of ['blockhash','fundingStateHash','programSetHash','instructionSetHash']) {
    const changed={...input,context:{...input.context,[field]:'changed'}};
    assert.equal(costPacket(changed).firstAtt.status,'incomplete');
    assert.equal(costPacket(changed).firstAtt.pilotBudget,null);
  }
  assert.equal(costPacket({...input,asOfMs:now+2000}).firstAtt.status,'incomplete');
  assert.equal(costPacket({...input,parameters:{}}).scenarios[5].lines[0].total,null);
  const zero={...input,parameters:{...input.parameters,freshAtasPerUser:0}};
  delete zero.quotes.classicAtaRent;assert.equal(scenario(zero,6).lines[0].status,'zero-count');
});
test('twenty percent target, strict under $10 aim, $30 exception cap and monthly policy',()=>{
  const usd=n=>BigInt(n)*1_000_000n;
  assert.equal(assessPilotBudget(usd(6),usd(30)).status,'pass');
  assert.equal(assessPilotBudget(usd(6)+1n,usd(30)).status,'review');
  assert.equal(assessPilotBudget(usd(10),usd(100)).status,'review');
  const exception=assessPilotBudget(usd(30),usd(45));assert.equal(exception.reserveGuidelineMet,false);
  assert.equal(exception.status,'review');
  assert.equal(assessPilotBudget(usd(30)+1n,usd(100)).status,'blocked');
  assert.equal(assessPilotBudget(usd(9),usd(8)).status,'blocked');
  assert.equal(assessRecurring(usd(4)).status,'warning');assert.equal(assessRecurring(usd(5)).status,'at-limit');
  assert.equal(assessRecurring(usd(5)+1n).status,'over-limit');
});
test('monthly outcomes keep realized receipts separate and require a measured fee rate for break-even',()=>{
  const input=fullTestInput();
  input.quotes.realizedMintReceipts=q('microUSD','1000');input.quotes.realizedFeeReceipts=q('microUSD','800');
  const base=scenario(input,14);assert.equal(base.status,'quoted');
  assert.equal(base.outcomes.breakEvenTradingVolumeUsdMicros,null);
  const cost=BigInt(base.byPayer.founder.pricedUsdMicros);
  assert.equal(base.outcomes.zeroTradingNetUsdMicros,String(1000n-cost));
  assert.equal(base.outcomes.zeroDemandNetUsdMicros,String(-cost));
  assert.equal(base.outcomes.realizedNetUsdMicros,String(1800n-cost));
  input.parameters.netCompanyFeeBps=80;
  const expect=(cost-1000n)*10000n;
  assert.equal(scenario(input,14).outcomes.breakEvenTradingVolumeUsdMicros,String((expect+79n)/80n));
});
test('founder backstop needs separately approved headroom and cannot imply paid mint receipts',()=>{
  const input=fullTestInput();input.parameters.unsoldFounderMints=2;
  assert.equal(scenario(input,13).backstopStatus,'spend-approval-required');
  input.founderBackstopApprovedUsdMicros='0';assert.equal(scenario(input,13).backstopStatus,'over-approved-amount');
  assert.throws(()=>costPacket({...input,parameters:{seasonPaid:501,seasonFree:500}}),/1,000/);
});
