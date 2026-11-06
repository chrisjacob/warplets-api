import test from 'node:test';
import assert from 'node:assert/strict';
import {assessFarmReadiness} from './readiness.mjs';
const input=()=>({originalUnits:'20000',grossFundedUnits:'1000',principalUnits:'100',earnedUnclaimedUnits:'300',idleUnits:'700',vaultBalanceUnits:'1100',requestedRecoveryUnits:'700',harvestFeeBps:0,authorityModel:'unrestricted-admin',precisionEvidence:'whole-rate-only'});
test('whole-rate fixture and zero fee never clear unrestricted principal custody',()=>{
 const r=assessFarmReadiness(input());assert.equal(r.grossFundingMatches,true);assert.equal(r.idleRecoveryArithmeticCompatible,true);assert.equal(r.status,'incompatible');assert.equal(r.fractionalPrecisionVerified,false);assert.equal(r.financialExecution,false);assert.equal(r.completeCostQuote,null);assert.ok(r.reasons.includes('recorded-principal-withdrawal-incompatible'));
});
test('fees reduce hypothetical net receipts without topping up gross funding',()=>{
 const r=assessFarmReadiness({...input(),harvestFeeBps:500});assert.equal(r.hypotheticalFeeUnits,'15');assert.equal(r.hypotheticalNetEarnedUnits,'285');assert.equal(r.expectedGrossUnits,'1000');assert.equal(r.crossBudgetTopUpAllowed,false);
 const topped=assessFarmReadiness({...input(),grossFundedUnits:'1015'});assert.equal(topped.grossFundingMatches,false);assert.ok(topped.reasons.includes('gross-funding-must-equal-five-percent'));
 const unknown=assessFarmReadiness({...input(),harvestFeeBps:null,authorityModel:'unselected'});assert.equal(unknown.hypotheticalNetEarnedUnits,null);assert.equal(unknown.status,'review-required');assert.equal(unknown.isAuthorization,false);
});
test('idle recovery cannot consume principal or earned unclaimed units',()=>{
 for(const patch of [{requestedRecoveryUnits:'701'},{idleUnits:'801',requestedRecoveryUnits:'801'},{vaultBalanceUnits:'399'},{vaultBalanceUnits:'3000',idleUnits:'2000',requestedRecoveryUnits:'2000'}])assert.equal(assessFarmReadiness({...input(),...patch}).idleRecoveryArithmeticCompatible,false);
 assert.throws(()=>assessFarmReadiness({...input(),precisionEvidence:'verified'}));assert.throws(()=>assessFarmReadiness({...input(),harvestFeeBps:-1}));assert.throws(()=>assessFarmReadiness({...input(),originalUnits:'201'}));
 let reads=0;const bad=input();Object.defineProperty(bad,'originalUnits',{get(){reads++;return '20000';},enumerable:true});assert.throws(()=>assessFarmReadiness(bad));assert.equal(reads,0);
});
