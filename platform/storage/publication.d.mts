import type {AtomicDriver} from './atomic-earn.mjs';
import type {CanonicalCrypto,OperatorPrincipal,ArtifactIdentity,Revisions,RepositoryOutcome,JobLease,AppTelemetry} from '../application/ports';
import type {PublicBoard,PublicAllocationInput} from '../artifacts/manifest-codec.mjs';
export const PLAN_PUBLICATION:'artifacts.plan-publication.v1',PUBLISH_PUBLICATION:'artifacts.publish-publication.v1',HOLD_PUBLICATION:'artifacts.hold-publication.v1';
export type PublicationKind=typeof PLAN_PUBLICATION|typeof PUBLISH_PUBLICATION|typeof HOLD_PUBLICATION;
export type PublicationSelection=Readonly<{tokenId:string;day:number}>;
export type PublicationRecord=Readonly<{id:string;jobKey:string;epoch:number;identity:ArtifactIdentity;sourceDigest:string;
 selections:readonly PublicationSelection[];sourceRevisions:Revisions;staging:readonly ArtifactIdentity[];state:'planned'|'verified'|'published'|'held';
 createdMs:number;verifiedMs:number|null;publishedMs:number|null;heldReason:string|null}>;
export type PublicationInputs={
 'artifacts.plan-publication.v1':{id:string;jobKey:string;epoch:number;identity:ArtifactIdentity;sourceDigest:string;selectionsJson:string;stagingJson:string};
 'artifacts.publish-publication.v1':{id:string;verifiedIdentity:ArtifactIdentity};
 'artifacts.hold-publication.v1':{id:string;reason:string};
};
export type PublicationCommand<K extends PublicationKind>=Readonly<{operationKind:K;principal:OperatorPrincipal;requestKey:string;requestDigest:string;
 nowMs:number;expectedRevisions:Revisions;businessIdentity:string;input:PublicationInputs[K]}>;
export function createPublicationCommand<K extends PublicationKind>(kind:K,args:{principal:OperatorPrincipal;requestKey:string;input:PublicationInputs[K];nowMs:number;expectedRevisions?:Revisions},crypto:CanonicalCrypto):Promise<PublicationCommand<K>>;
export type PublicationSourceRead={kind:'loaded';source:{board:PublicBoard;allocations:readonly PublicAllocationInput[]};versions:Revisions;sourceDigest:string;selections:readonly PublicationSelection[]}
 |{kind:'pending';reason:string;dependencyIds:readonly string[]}|{kind:'conflict';code:string};
export interface PublicationRepository {
 loadSource(query:{epoch:number;selections?:readonly PublicationSelection[]}):Promise<PublicationSourceRead>;
 readJob(jobKey:string):Promise<PublicationRecord|null>;
 get(id:string):Promise<PublicationRecord|null>;
 canPublish(principal:OperatorPrincipal):Promise<boolean>;
 hasPrivateObject(identity:ArtifactIdentity):Promise<boolean>;
 plan(command:PublicationCommand<'artifacts.plan-publication.v1'>,lease:JobLease):Promise<RepositoryOutcome<unknown>>;
 publish(command:PublicationCommand<'artifacts.publish-publication.v1'>,lease:JobLease):Promise<RepositoryOutcome<unknown>|{kind:'replayed';value:PublicationRecord}>;
 hold(command:PublicationCommand<'artifacts.hold-publication.v1'>,lease:JobLease):Promise<RepositoryOutcome<unknown>>;
}
export function createPublicationRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};clock:{nowMs():number};telemetry?:AppTelemetry}):PublicationRepository;
