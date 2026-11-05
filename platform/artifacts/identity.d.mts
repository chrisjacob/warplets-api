import type { ArtifactIdentity } from '../application/ports';
import type { ArtifactReadResult } from './store';
export const MAX_PRIVATE_ARTIFACT_BYTES:number;
export const MAX_PUBLIC_ARTIFACT_BYTES:number;
export class ArtifactConflictError extends Error {readonly code:'artifact_conflict';constructor(reason:string)}
export function privateIdentity(value:ArtifactIdentity):ArtifactIdentity;
export function artifactIdentity(value:ArtifactIdentity):ArtifactIdentity;
export function sha256(bytes:Uint8Array):Promise<string>;
export function preparePrivateArtifact(identity:ArtifactIdentity,input:Uint8Array):Promise<{identity:ArtifactIdentity;bytes:Uint8Array}>;
export function prepareArtifact(identity:ArtifactIdentity,input:Uint8Array):Promise<{identity:ArtifactIdentity;bytes:Uint8Array}>;
export function verifiedBytes(identity:ArtifactIdentity,bytes:Uint8Array):Promise<ArtifactReadResult>;
