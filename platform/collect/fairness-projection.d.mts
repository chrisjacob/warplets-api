import type {CanonicalCrypto} from '../application/ports';
import type {PinnedBeaconVerifier} from '../beacon/portable.mjs';
export const FAIRNESS_PROJECTION_FORMAT:'10x.local.fairness.v1';
export const FAIRNESS_PROJECTION_LIMITS:Readonly<{inputBytes:262144;transcriptBytes:262144}>;
type Json=null|string|number|boolean|readonly Json[]|{readonly [key:string]:Json};
export interface FairnessProjectionFacts {
 readonly operation:Readonly<{id:string;kind:'mint'|'upgrade'|'visual';inventoryId:string;owner:string;rawCommitment:string;createdMs:number;settledMs:number|null;proofId:string|null}>;
 readonly policy:Readonly<{policyHash:string;registeredMs:number;traitChoices:Readonly<Record<'model'|'backdrop'|'symbol',readonly Readonly<{name:string;weight:number}>[]>>|null}>|null;
 readonly request:Readonly<{targetRound:number;contextDigest:string}>|null;
 readonly result:Readonly<{proofId:string;proof:Readonly<{chain:string;round:number;signature:string;randomness:string}>;fixture:Readonly<Record<string,Json>>}>|null;
 readonly assignment:Readonly<{irreversible:boolean;assetId:string;level:number|null}>|null;
 readonly disclosure:Readonly<{selectedRevealed:boolean;participantsRevealed:boolean;mintPrefixRevealed:boolean}>;
 readonly remainingQuotas:readonly number[]|null;readonly waiting:'prior-admission'|'entropy'|'fulfillment'|'conflict';
}
export interface CollectionFairnessProjection {
 readonly format:typeof FAIRNESS_PROJECTION_FORMAT;readonly source:'local-fixture';readonly providerStatus:'candidate-unselected';readonly requiresVerifiedRepository:true;
 readonly requestState:'waiting'|'assigned'|'held';readonly evidenceState:'manual-fixture'|'retained-unverified'|'conflicted'|'verified'|'waiting-prior-admission'|'waiting-entropy'|'waiting-fulfillment';readonly financialState:'not-applicable-local';readonly commitment:string;
 readonly disclosure:'sealed'|'revealed';readonly transcript:Readonly<Record<string,Json>>|null;
 readonly financialExecution:false;readonly serverSigning:false;readonly broadcast:false;
}
/** Trusted repository facts required; caller booleans confer no reveal authority. */
export function projectCollectionFairness(facts:FairnessProjectionFacts,ports:{crypto:Pick<CanonicalCrypto,'sha256'>;beaconVerifier?:PinnedBeaconVerifier}):Promise<CollectionFairnessProjection>;
