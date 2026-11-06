import {launchAllocations} from '../domain/economics/launch.mjs';
const need=(ok,why)=>{if(!ok)throw new TypeError('Farm readiness: '+why);};
const units=s=>{need(typeof s==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(s),'canonical units');const n=BigInt(s);need(n<(1n<<64n),'u64');return n;};
const keys=['originalUnits','grossFundedUnits','principalUnits','earnedUnclaimedUnits','idleUnits','vaultBalanceUnits','requestedRecoveryUnits','harvestFeeBps','authorityModel','precisionEvidence'];
/** Arithmetic on caller assertions, not a provider-state verifier. */
export function assessFarmReadiness(input){
 need(input&&Object.getPrototypeOf(input)===Object.prototype&&Reflect.ownKeys(input).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(input,k);return d?.enumerable&&Object.hasOwn(d,'value');}),'exact data input');
 const values=Object.fromEntries(keys.filter(k=>k.endsWith('Units')).map(k=>[k,units(input[k])]));
 need(input.harvestFeeBps===null||Number.isInteger(input.harvestFeeBps)&&input.harvestFeeBps>=0&&input.harvestFeeBps<=10000,'fee basis points');
 need(['unrestricted-admin','unselected'].includes(input.authorityModel),'recorded or unselected authority model');
 need(['whole-rate-only','missing'].includes(input.precisionEvidence),'recorded precision scope');
 const expected=launchAllocations({supply:values.originalUnits,activeSeasonWeight:0n}).stake,protectedUnits=values.principalUnits+values.earnedUnclaimedUnits;
 const balanceConsistent=values.vaultBalanceUnits>=protectedUnits&&values.idleUnits<=values.vaultBalanceUnits-protectedUnits&&values.earnedUnclaimedUnits+values.idleUnits<=values.grossFundedUnits;
 const recoveryCompatible=balanceConsistent&&values.requestedRecoveryUnits<=values.idleUnits;
 const fee=input.harvestFeeBps===null?null:values.earnedUnclaimedUnits*BigInt(input.harvestFeeBps)/10000n,reasons=[];
 if(values.grossFundedUnits!==expected)reasons.push('gross-funding-must-equal-five-percent');
 if(!balanceConsistent)reasons.push('principal-or-earned-liability-not-backed');
 if(!recoveryCompatible)reasons.push('recovery-exceeds-isolated-idle');
 if(input.harvestFeeBps===null)reasons.push('selected-global-fee-unverified');
 reasons.push(input.authorityModel==='unrestricted-admin'?'recorded-principal-withdrawal-incompatible':'constrained-authority-unselected');
 reasons.push('fractional-precision-parity-unproven','complete-cost-quote-missing','funded-emission-upkeep-policy-unverified');
 return Object.freeze({format:'10x.local.farm-readiness.v1',sourceAuthority:'caller-assertions-unverified',status:input.authorityModel==='unrestricted-admin'?'incompatible':'review-required',
  expectedGrossUnits:String(expected),actualGrossUnits:input.grossFundedUnits,grossFundingMatches:values.grossFundedUnits===expected,crossBudgetTopUpAllowed:false,
  protectedPrincipalUnits:input.principalUnits,protectedEarnedUnits:input.earnedUnclaimedUnits,idleRecoveryArithmeticCompatible:recoveryCompatible,
  harvestFeeBps:input.harvestFeeBps,hypotheticalFeeUnits:fee===null?null:String(fee),hypotheticalNetEarnedUnits:fee===null?null:String(values.earnedUnclaimedUnits-fee),
  netBasis:'illustrative cumulative floor; prior charged fees and selected configuration require reconciliation',precisionEvidence:input.precisionEvidence,fractionalPrecisionVerified:false,
  completeCostQuote:null,reasons:Object.freeze(reasons),financialExecution:false,isAuthorization:false});
}
