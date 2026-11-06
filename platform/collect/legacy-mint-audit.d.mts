import type {CanonicalCrypto} from '../application/ports';
import type {RecoveryDigest} from '../recovery/v2-node-digest.mjs';
import type {PinnedBeaconVerifier} from '../beacon/portable.mjs';
export type LegacySourceRecord=Readonly<{id:string;size:number;bytes:Uint8Array}>;
export type OriginalPolicyPart=Readonly<{byteDigest:string;size:number}>;
export type OriginalTraitParts=Readonly<{count:number;pages:readonly OriginalPolicyPart[]}>;
export type LegacyMintPrefix=Readonly<{rootId:string;ordinal:number;pageIndex:number;entryIndex:number;remaining:readonly number[]}>;
export type LegacyMintFixture=Readonly<{operationId:string;assetId:string;proofId:string;at:number;ticket:number;commitment:string;traits:Readonly<{model:string;backdrop:string;symbol:string}>;finalized:true}>;
export type LegacyMintAuditInput=Readonly<{
 sourceRoot:LegacySourceRecord;admissionPage:LegacySourceRecord;asOfMs:number;prefix:LegacyMintPrefix;
 header:Readonly<{id:string;kind:'genesis'|'season';tranche:number|null;seasonStart:number|null;originDigest:string}>;
 operation:Readonly<{id:string;kind:'mint';inventory_id:string;owner:string;request_key:string;request_digest:string;commitment:string;created_ms:number;settled_ms:number;proof_id:string;evidence_digest:string;operation:string;receipt:string}>;
 originalFixture:LegacyMintFixture|null;
 collectBinding:Readonly<{id:string;inventory_id:string;bind_ms:number;slot:string}>;
 vaultBinding:Readonly<{id:string;slot_key:string;coords:string}>;
 vaultObservation:Readonly<{event_id:string;asset_id:string;kind:'bind';observed_ms:number;body:string}>;
 initialHistory:readonly Readonly<{asset_id:string;effective_ms:number;level:number;source_ref:string}>[];
 configured:null|Readonly<{
  policy:null|Readonly<{inventoryId:string;policyHash:string;registeredMs:number;assets:OriginalPolicyPart;traits:Readonly<{model:OriginalTraitParts;backdrop:OriginalTraitParts;symbol:OriginalTraitParts}>}>;
  request:null|Readonly<{operationId:string;targetRound:number;contextDigest:string}>;
  result:null|Readonly<{operationId:string;proofId:string;signedRoundJson:string;fixtureJson:string;settledMs:number}>;
 }>;
}>;
export interface LegacyMintAuditMeasurement {sourceBytes:number;contextBytes:number;partReads:number;partBytes:number;maxPartBytes:number;workingBytes:number;baseWorking:number;namesBytes:number;assetsBytes:number}
export type LegacyMintAuditResult=Readonly<{kind:'held';reason:'original-mint-preimage-missing'|'original-configured-result-missing'|'original-configured-request-missing'|'original-policy-preimage-missing'}>|Readonly<{kind:'audited';summary:Readonly<{rootId:string;admissionPageId:string;ordinal:number;inventoryId:string;operationId:string;assetId:string;originalWallet:string;initialLevel:number;initialExpiryMs:number|null;slot:Readonly<{kind:'genesis';tranche:number;level:number;ordinal:number}>|Readonly<{kind:'season';seasonId:string;slotIndex:number}>;legacyEvidenceDigest:string;provenance:'manual-fixture'|'configured-offline-beacon';source:'local-fixture';executable:false}>;nextPrefix:LegacyMintPrefix}>;
/** The prefix and retained fact mapping must be supplied by a private guarded
 * audit repository. This pure component has no source/adoption authority. */
export function auditLegacyMint(input:LegacyMintAuditInput,ports:{crypto:CanonicalCrypto;createDigest?:()=>RecoveryDigest;beaconVerifier?:PinnedBeaconVerifier;readOriginalPolicyPart?:(part:OriginalPolicyPart)=>Promise<Uint8Array|null>;onWorkingBytes?:(peakBytes:number)=>void;onMeasure?:(measurement:LegacyMintAuditMeasurement)=>void}):Promise<LegacyMintAuditResult>;
