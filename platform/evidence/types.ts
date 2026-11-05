import type {EvidenceEnvelope,OperatorPrincipal,RepositoryOutcome,CanonicalCrypto,AppTelemetry} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {ArtifactReferenceRepository} from '../storage/atomic-artifacts.mjs';
export type EvidenceSource=Readonly<{version:1;sourceId:string;sourceRevision:string;mode:'synthetic-fixture'|'recorded-public';chainGenesis:string|null;
 decoderVersion:string;subject:Readonly<{kind:string;id:string}>;policy:Readonly<Record<string,unknown>>;recordingDigest:string;maxBytes:number;maxAgeMs:number}>;
export type Recording=Readonly<{id:string;subject:Readonly<{kind:string;id:string}>;contextSlot:string|null;blockTimeMs:number|null;
 retrievedAtMs:number;finality:'unverified'|'confirmed'|'finalized';bytes:Uint8Array;archiveByteDigest?:string}>;
export type RecordedResult=Recording&Readonly<{byteDigest:string}>;
export interface RecordedReader {readonly mode:'synthetic-fixture'|'recorded-public';readonly chainGenesis:string|null;readonly recordingDigest:string;
 read(id:string):Promise<RecordedResult|null>;counters():{localReads:number;providerAttempts:0};}
export type EvidenceDecision=Readonly<{status:'verified'|'pending'|'incompatible'|'invalid';reason:string;scope:'decoder-only'|'synthetic-transcript';
 coverage:Readonly<{complete:boolean;gaps:readonly string[];fromMs?:number;toMs?:number}>;decoded:unknown}>;
export type EvidenceResult=Readonly<{receiptDigest:string;envelope:EvidenceEnvelope;decision:EvidenceDecision}>;
export interface EvidenceRepository {
 readSource(id:string,revision:string):Promise<EvidenceSource|null>;
 hasPrivateObject(identity:{key:string;byteDigest:string;size:number;contentType:string}):Promise<boolean>;
 findEvidence(principal:OperatorPrincipal,evidenceId:string):Promise<RepositoryOutcome<EvidenceResult>|null>;
 selectHead(key:string):Promise<EvidenceResult|null>;
 registerSource(command:EvidenceCommand):Promise<RepositoryOutcome<EvidenceSource>>;
 recordReceipt(command:EvidenceCommand):Promise<RepositoryOutcome<EvidenceResult>>;
}
export type EvidenceCommand=Readonly<{operationKind:'evidence.register-source.v1'|'evidence.record-receipt.v1';principal:OperatorPrincipal;
 input:Readonly<Record<string,unknown>>;businessIdentity:string;requestKey:string;nowMs:number;requestDigest:string;expectedRevisions:Readonly<Record<string,string>>}>;
export type EvidencePorts={crypto:CanonicalCrypto;ids:{next():string};telemetry?:AppTelemetry};
export type EvidenceServicePorts={repository:EvidenceRepository;artifactRepository:ArtifactReferenceRepository;store:ArtifactStore;crypto:CanonicalCrypto;clock:{nowMs():number};readers:ReadonlyMap<string,RecordedReader>};
export interface EvidenceService {registerSource(principal:OperatorPrincipal,source:EvidenceSource):Promise<RepositoryOutcome<EvidenceSource>>;
 ingest(principal:OperatorPrincipal,input:{sourceId:string;sourceRevision:string;recordId:string;requestedCutoffMs:number|null;supersedes?:string|null}):Promise<RepositoryOutcome<EvidenceResult>>;}
export type {AtomicDriver};
