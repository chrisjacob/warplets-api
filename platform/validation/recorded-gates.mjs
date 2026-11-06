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
 ],{crypto});
}
