import test from 'node:test';import assert from 'node:assert/strict';
import {scenarioCashflow} from './scenario-cashflow.mjs';
import {costPacket,executionContextId} from './packet.mjs';
import {calculateCostComparisons} from './packet-core.mjs';
import {costPacketFixtures} from './packet.fixtures.mjs';
test('all fourteen computed scenarios project disjoint costs and keep company receipts outside funding',()=>{
 const input=costPacketFixtures().complete,p=costPacket(input);
 for(const s of p.scenarios){const c=scenarioCashflow(s);assert.equal(c.result.assumptions,'caller-supplied-unverified');assert.equal(c.graph.charges.length+c.receipts.length,s.lines.length);assert.ok(c.graph.charges.every(x=>x.sharedAccount===null));}
 const monthly=scenarioCashflow(p.scenarios[13]);assert.equal(monthly.receipts.length,2);assert.ok(!monthly.graph.charges.some(c=>c.id.startsWith('realized')));
 const modified=structuredClone(p.scenarios[13]);for(const l of modified.lines)if(l.kind==='receipt')l.total='999999999999999999999';assert.deepEqual(scenarioCashflow(modified).result,monthly.result);
});
test('Vault rent is prepared before payout and quoting a possible refund never establishes closure',()=>{
 const input=costPacketFixtures().complete;input.parameters.vaultClaimsPerUser=1;input.parameters.freshAtasPerUser=1;input.quotes.temporaryVaultTokenAccount.expectedRefundableUnits='10';
 const comparisons=calculateCostComparisons(input,executionContextId(input.context));const c=scenarioCashflow(comparisons.oneClaim),rent=c.graph.charges.find(x=>x.id.startsWith('temporaryVaultTokenAccount'));
 assert.equal(rent.operationId,'prepare');assert.deepEqual(rent.closure,{operationId:'execute',status:'unknown'});assert.deepEqual(c.graph.operations[1].dependsOn,['prepare']);
 const total=c.result.totals.find(t=>t.payer==='claimant');assert.equal(total.peakUpfront,null);assert.equal(total.expectedRefundable,null);assert.notEqual(total.peakUpfrontUpperBound,null);
 assert.ok(c.result.unresolved.some(t=>t.chargeId===rent.id&&t.reasons.includes('closure-not-established')));
});
test('unknown quantity or fee remains unknown; repeated identity cannot silently deduplicate rent',()=>{
 const input=costPacketFixtures().unknown,s=costPacket(input).scenarios[5],c=scenarioCashflow(s);assert.ok(c.result.totals.some(t=>t.status==='incomplete'));
 const copy=structuredClone(s);copy.lines.push({...copy.lines[0]});assert.throws(()=>scenarioCashflow(copy),/Ambiguous/);
});
