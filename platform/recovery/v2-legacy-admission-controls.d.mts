import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {LegacyAdoptionCertificateBody} from '../collect/legacy-adoption-authority.mjs';
import type {LegacyMintAnchorBody} from '../collect/legacy-adoption-preparation-plan.mjs';
import type {LegacyAdmissionControlFact} from '../collect/legacy-admission-audit.mjs';
import type {LegacyControlSourcePin} from '../collect/legacy-control-audit.mjs';
export interface RetainedLegacyControlInput {
 readonly certificate:LegacyAdoptionCertificateBody;
 readonly anchor:LegacyMintAnchorBody;
 readonly pin:Readonly<{generation:string;watermark:number}>;
 /** Live outer-checkpoint bytes, including its copies. */
 readonly retainedBytes?:number;
}
export interface RetainedLegacyControlMetrics {sql:number;objectReads:number;maxBatchBytes:number;maxReturnedBytes:number;workingBytes:number}
export type RetainedLegacyControlResult=
 |Readonly<{kind:'held';reason:string;metrics:RetainedLegacyControlMetrics}>
 |Readonly<{kind:'verified';controlFact:LegacyAdmissionControlFact;sourcePin:LegacyControlSourcePin;verification:'retained-control-selection-and-history';readiness:false;metrics:RetainedLegacyControlMetrics}>;
export function createRetainedLegacyControlVerifier(ports:{driver:AtomicDriver;crypto:CanonicalCrypto;artifacts:Pick<ArtifactStore,'getVerified'>}):Readonly<{verify(input:RetainedLegacyControlInput):Promise<RetainedLegacyControlResult>}>;
