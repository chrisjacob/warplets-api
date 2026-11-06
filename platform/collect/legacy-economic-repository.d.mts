import type {CanonicalCrypto,ArtifactIdentity} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {RecoveryDigest} from '../recovery/v2-node-digest.mjs';
import type {PinnedBeaconVerifier} from '../beacon/portable.mjs';
import type {LegacyMintOriginalReference} from './legacy-mint-source-audit.mjs';
import type {finishLegacyAdmissions} from './legacy-admission-audit.mjs';
export type LegacyEconomicPhase='stage'|'initialize'|'select'|'prepare'|'control'|'mint'|'membership'|'advance'|'closure'|'finish';
export type LegacyEconomicResult=Readonly<Awaited<ReturnType<typeof finishLegacyAdmissions>>&{historicalEconomics:true;originalOperatorAuthentication:false;paymentVerified:false;adoptionAuthorized:false}>;
export type LegacyEconomicOutcome=Readonly<{kind:'conflict';code:string}>|Readonly<{kind:'held';auditId:string;revision:number;phase:LegacyEconomicPhase;reason:string}>|Readonly<{kind:'started'|'progress'|'replayed'|'awaiting-original';auditId:string;revision:number;phase:LegacyEconomicPhase;stageIndex:number;ordinal:number}>|Readonly<{kind:'economic-ready';auditId:string;revision:number;relationAuditId:string;chainDigest:string;result:LegacyEconomicResult}>;
export interface LegacyEconomicMeasurement {readonly sql:number;readonly objectReads:number;readonly operations:number;readonly maxBatchBytes:number;readonly maxReturnedBytes:number;readonly controlBytes:number;readonly coreWorkingBytes:number;readonly workingBytes:number}
export function createLegacyEconomicRepository(ports:{driver:{batch(statements:readonly {sql:string;values:readonly (string|number|null)[]}[]):Promise<{rows:Record<string,unknown>[];changes:number}[]>};crypto:CanonicalCrypto;clock:{nowMs():number};ids:{next():string};artifacts:Pick<ArtifactStore,'getVerified'>;createDigest():RecoveryDigest;beaconVerifier?:PinnedBeaconVerifier;onMeasure?:(measurement:LegacyEconomicMeasurement)=>void}):Readonly<{
 start(principal:Readonly<{kind:'operator';id:string}>,input:Readonly<{auditId:string;relationAuditId:string;asOfMs:number;stageOriginals:readonly (ArtifactIdentity|null)[]}>):Promise<LegacyEconomicOutcome>;
 step(principal:Readonly<{kind:'operator';id:string}>,input:Readonly<{auditId:string;expectedRevision:number}>):Promise<LegacyEconomicOutcome>;
 selectOriginal(principal:Readonly<{kind:'operator';id:string}>,input:Readonly<{auditId:string;expectedRevision:number;original:LegacyMintOriginalReference|null}>):Promise<LegacyEconomicOutcome>;
}>;
