import type { ArtifactIdentity } from '../application/ports';

export type ArtifactPutResult=Readonly<{status:'created'|'exists'|'unknown';identity:ArtifactIdentity}>;
export type ArtifactReadResult=Readonly<{status:'verified';identity:ArtifactIdentity;bytes:Uint8Array}>
  |Readonly<{status:'missing';identity:ArtifactIdentity}>
  |Readonly<{status:'conflict';identity:ArtifactIdentity;reason:string}>;
/** Transport read errors remain exceptions. An unknown write is never permission
 * to publish its reference; reconcile the same identity with getVerified/retry. */
export interface ArtifactStore {
  putIfAbsent(identity:ArtifactIdentity,bytes:Uint8Array):Promise<ArtifactPutResult>;
  getVerified(identity:ArtifactIdentity):Promise<ArtifactReadResult>;
}
