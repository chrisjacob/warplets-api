import {createGateIndex} from './gates.mjs';

export const PROTOCOL_STATUS_SOURCE=Object.freeze({
 path:'platform/validation/protocol-status.md',
 commit:'51c0741c757453bdd9f1bcdd9ef9d18f066ab920',
 digest:'44a4632b33f564baa39ceb3b202af7b9a7dd3867e62d97506cce5faab99f2b27',
});

/** Verifies the retained report bytes, not provider truth or review authority.
 * Observation slots in the report concern binary reads, not these simulations. */
export async function createRecordedGateIndex({readSource,crypto}){
 const bytes=await readSource(PROTOCOL_STATUS_SOURCE.path);
 if(!(bytes instanceof Uint8Array)||bytes.byteLength>65536)throw new TypeError('Recorded gates: bounded source bytes required');
 const captured=Uint8Array.from(bytes);
 if(await crypto.sha256(captured)!==PROTOCOL_STATUS_SOURCE.digest)throw new Error('Recorded gates: source digest mismatch');
 const base={status:'incompatible',evidenceKind:'recorded-fixture',source:PROTOCOL_STATUS_SOURCE,network:null,slot:null,observedAtMs:null,reviewOwner:null,acceptedScope:null};
 return createGateIndex([
  {...base,id:'kamino.unrestricted-admin-principal',requirementId:'custody.principal',program:'Kamino Farms',configuration:'Recorded unrestricted administrative custody simulation',
   applicability:['The recorded administrator removed 10 of 100 staked principal units, leaving 90 for the staker.'],
   limitations:['Applies to the tested unrestricted administration configuration; other custody designs remain unevaluated.','The report is retained evidence, not a fresh replay or authenticated provider configuration. Exact simulation slot and time are not supplied.']},
  {...base,id:'rewards.wallet-leaf-nft-transfer',requirementId:'claims.current-nft-owner',program:'Foundation Rewards',configuration:'Recorded directly wallet-bound claim leaf used for NFT ownership',
   applicability:['After NFT transfer the buyer failed to claim and the seller retained the directly wallet-bound claim.'],
   limitations:['Applies to direct wallet-bound leaves; the separately recorded Core asset-signer composition is outside this finding.','The report is retained evidence, not a fresh replay or authenticated provider configuration. Exact simulation slot and time are not supplied.']},
  {...base,id:'core.oracle-removal',requirementId:'custody.external-burn-protection',program:'Core',configuration:'Recorded removable Oracle adapter with retained asset update authority',
   applicability:['The asset update authority removed the Oracle adapter and then burned the asset despite the adapter authority being None.'],
   limitations:['Applies to the tested removable adapter configuration. A UI without a burn button cannot enforce external burn protection.']},
  {...base,id:'core.permanent-burn-delegate',requirementId:'custody.external-burn-protection',program:'Core',configuration:'Recorded permanent burn delegate with experimental frozen Oracle veto',
   applicability:['The permanent burn delegate forced a burn despite the Oracle veto.'],
   limitations:['Actual asset and collection plugin allowlists remain unresolved; this is not evidence about every marketplace custody combination.']},
  {...base,id:'core.owner-transfer-composition',requirementId:'claims.current-nft-owner',status:'fixture-proven',program:'Core asset signer + Foundation Rewards',configuration:'Recorded 100-unit reserve and atomic temporary-recipient payout',
   applicability:['The original owner claimed 30 units, transferred the asset, and the buyer claimed 70; the former owner was rejected.'],
   limitations:['Controlled future asset identity does not prove fair mint assignment.','Burn policy, metadata changes, proof availability, complete costs and physical-wallet compatibility remain unresolved.']},
  {...base,id:'kamino.fractional-precision',requirementId:'farm.fractional-precision',status:'review-required',program:'Kamino Farms',configuration:'Recorded whole-unit rate of 1000000 reward base units per second',
   applicability:['The whole-unit curve executed; arbitrary decimal supplies, fractional rounding and refresh frequency remain unproven.'],
   limitations:['No fractional precision parity is established by this fixture. Exactly 5% gross funding cannot be supplemented from other budgets.']},
  {...base,id:'core.immutable-metadata-policy',requirementId:'custody.metadata-progression',status:'review-required',program:'Core',configuration:'Experimental frozen Oracle record and unreachable asset update authority',
   applicability:['The experimental configuration rejected tested owner burns and adapter removal while permitting transfer.'],
   limitations:['Relinquished update authority restricts metadata changes, Level progression and collection administration. No production policy is selected.']},
  {...base,id:'claims.permanent-proof-availability',requirementId:'claims.permanent-availability',status:'review-required',program:'Foundation Rewards',configuration:'Recorded maximum signed 64-bit clawback timestamp',
   applicability:['The recorded claim remained available at day 800 and administrative revoke and early close attempts failed.'],
   limitations:['A finite maximum timestamp is not a native permanent flag. Independently available proofs and exact funded roots remain required.']},
  {...base,id:'costs.complete-operation',requirementId:'costs.complete-operation',status:'review-required',program:null,configuration:null,
   applicability:['Recorded Core Execute charges and dated Kamino account rents are partial observations only.'],
   limitations:['Network, signature, priority, lookup-table, claimant and recipient-account costs plus retries and current conversion rates remain unresolved. No complete launch quote is inferred.']},
 ],{crypto});
}
