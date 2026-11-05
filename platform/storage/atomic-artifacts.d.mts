import type { AtomicDriver } from './atomic-earn.mjs';
import type { ArtifactIdentity,OperatorPrincipal,Revisions,CanonicalCrypto,AppTelemetry,RepositoryOutcome } from '../application/ports';
export type PrivateReferenceCommand=Readonly<{principal:OperatorPrincipal;operationKind:'evidence.private-reference.v1';businessIdentity:string;
 requestKey:string;requestDigest:string;expectedRevisions:Revisions;nowMs:number;input:ArtifactIdentity}>;
export interface ArtifactReferenceRepository {
 recordVerifiedReference(command:PrivateReferenceCommand):Promise<RepositoryOutcome<ArtifactIdentity&{verification:'exact-bytes'}>>;
}
export function createArtifactReferenceRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};telemetry?:AppTelemetry}):ArtifactReferenceRepository;
