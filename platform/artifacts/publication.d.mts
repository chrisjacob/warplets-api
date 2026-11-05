import type {PublicationRepository,PublicationRecord} from '../storage/publication.mjs';
import type {ArtifactStore} from './store';
import type {ManifestCodec} from './manifest-codec.mjs';
import type {PrivateSnapshotReferences} from '../earn/snapshot.mjs';
import type {CanonicalCrypto,OperatorPrincipal,JobLease,RepositoryOutcome} from '../application/ports';
import type {Job} from '../jobs/repository.mjs';
export type PublicationOutcome={kind:'published';publication:PublicationRecord}|RepositoryOutcome<unknown>|{kind:'replayed';value:PublicationRecord};
export interface PublicationService {run(input:{job:Job;lease:JobLease;signal?:AbortSignal}):Promise<PublicationOutcome>;}
export function createPublicationService(ports:{repository:PublicationRepository;store:ArtifactStore;privateReferences:PrivateSnapshotReferences;codec:ManifestCodec;
 crypto:CanonicalCrypto;clock:{nowMs():number};principal:OperatorPrincipal}):PublicationService;
