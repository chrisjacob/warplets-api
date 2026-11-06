import type {CanonicalCrypto,ArtifactIdentity} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {LegacyAdmissionSourcePin} from './legacy-admission-source.mjs';
import type {LegacyMintPrefix,LegacyMintAuditResult,LegacyMintAuditInput} from './legacy-mint-audit.mjs';
import type {RecoveryDigest} from '../recovery/v2-node-digest.mjs';
import type {PinnedBeaconVerifier} from '../beacon/portable.mjs';
export type LegacyMintOriginalPolicyDescriptor=Readonly<NonNullable<NonNullable<LegacyMintAuditInput['configured']>['policy']>&{format:'legacy-mint-original-policy-v1'}>;
export type LegacyMintOriginalReference=Readonly<{kind:'manual';fixture:ArtifactIdentity}>|Readonly<{kind:'configured';policy:ArtifactIdentity}>;
export interface LegacyMintSourceAuditInput {readonly rootId:string;readonly source:LegacyAdmissionSourcePin;readonly prefix:LegacyMintPrefix;readonly asOfMs:number;readonly original:LegacyMintOriginalReference|null}
export interface LegacyMintSourceAuditMetrics {readonly sql:number;readonly objectReads:number;readonly operations:number;readonly maxBatchBytes:number;readonly maxReturnedBytes:number;readonly maxWorkingBytes:number;readonly maxObjectBytes:number;readonly sourceWorkingBytes:number;readonly auditWorkingBytes:number}
export type LegacyMintSourceAuditResult=Readonly<{kind:'held';reason:string;metrics:LegacyMintSourceAuditMetrics}>|Readonly<Extract<LegacyMintAuditResult,{kind:'audited'}>&{sourceDigest:string;sourcePin:LegacyAdmissionSourcePin;original:LegacyMintOriginalReference;summaryDigest:string;provenance:'retained-original-mint-database-and-private-artifacts';prefixAuthority:false;economics:false;adoption:false;metrics:LegacyMintSourceAuditMetrics}>;
export function createLegacyMintSourceAudit(ports:{driver:{batch(statements:readonly {sql:string;values:readonly (string|number|null)[]}[]):Promise<{rows:Record<string,unknown>[];changes:number}[]>};crypto:CanonicalCrypto;artifacts:Pick<ArtifactStore,'getVerified'>;createDigest?:()=>RecoveryDigest;beaconVerifier?:PinnedBeaconVerifier}):Readonly<{audit(input:LegacyMintSourceAuditInput):Promise<LegacyMintSourceAuditResult>}>;
