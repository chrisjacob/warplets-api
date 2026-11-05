export type Principal = Readonly<{kind:'wallet';wallet:string}>;
export type OperatorPrincipal = Readonly<{kind:'operator';id:string}>;
export type Revisions = Readonly<Record<string,string>>;
export type CommandIdentity = Readonly<{
  principal:Principal; operationKind:'earn.admit-submission.v1'; businessIdentity:string;
  requestKey:string; requestDigest:string; expectedRevisions:Revisions;
}>;
export type Submission = Readonly<{id:string;tokenId:string;epoch:number;url:string;submittedAtMs:number}>;
export type AdmissionCommand = CommandIdentity & Readonly<{
  input:Readonly<{tokenId:string;url:string}>; nowMs:number;
}>;
export type AdmissionResult = Readonly<{submission:Submission;replay:boolean}>;
export type Winner = Readonly<{rank:number;userId:string;wallet:string;submissionId:string;tokenId:string;
  submittedAtMs:number;contentScore:number;multiplierTenths:number;pointsTenths:number}>;
export type AllocationSummary = Readonly<{tokenId:string;day:number;budgetUnits:string;burnUnits:string;
  vestsFromMs:number;vestsThroughMs:number}>;
export type Leaderboard = Readonly<{mode:'local-fixture';source?:'public-archive';epoch:number;date:string;
  status:'pending'|'final';items:readonly Winner[];allocations:readonly AllocationSummary[];
  snapshotId:string|null;finalizedAtMs:number|null}>;
export type Claim = Readonly<{tokenId:string;day:number;awardUnits:string;vestedUnits:string;vestsFromMs:number;vestsThroughMs:number}>;
export type Claims = Readonly<{mode:'local-fixture';source?:'public-archive';executionEnabled:false;items:readonly Claim[];nextCursor:number|null}>;
export type SubmissionStatus = Submission & Readonly<{status:'pending'|'final';score:number|null;eligible:boolean|null;
  reason:string|null;components:null|Readonly<{actionTenths:number;streakDays:number;highestEligibleLevel:number;
  purchaseTokenDays:number;sourceRef:string}>;entryStakeMicroUsd:string;closingStakeMicroUsd:string|null}>;
export type SubmissionPage = Readonly<{mode:'local-fixture';items:readonly SubmissionStatus[];nextCursor:number|null;memberStatus?:import('../earn/member-projection.mjs').EarnMemberStatus}>;
export type FinalReviewCommand=Readonly<{
  principal:OperatorPrincipal;operationKind:'earn.final-review.v1';businessIdentity:string;requestKey:string;
  requestDigest:string;expectedRevisions:Revisions;nowMs:number;
  input:Readonly<{submissionId:string;score:number;reason:string;sourceRef:string}>;
}>;
export type FinalReviewResult=Readonly<{recorded:true;replayed:boolean}>;
export type BoardQuery=Readonly<{epoch:number;nowMs:number;sourceComplete:boolean;sourceRef:string}>;
export type AllocationQuery=Readonly<{tokenId:string;day:number;nowMs:number}>;
// Reference adapters use an entire-input digest rechecked under BEGIN IMMEDIATE.
// D1 adds monotonic SQL revisions and fenced durable receipts at the B02 boundary.
export type ReferenceReadVersion=Readonly<{snapshotDigest:string}>;
// Snake-case post fields are historical commitment inputs, intentionally fixed.
export type BoardPost=Readonly<{id:string;wallet:string;token_id:string;epoch:number;url:string;submitted_ms:number;
  entry_read_id:string;request_key:string;content_score:number|null;reviewed_ms:number|null;review_ref:string|null;
  reason:string|null;moderator:string|null;entry_micro_usd:string}>;
export type ComponentFact=Readonly<{status:'pending';reason:string}>|Readonly<{status:'ready';payload:string;sourceRef:string;
  components:Readonly<{actionTenths:number;highestEligibleLevel:number;purchaseTokenDays:number}>}>;
export type BoardInput=Readonly<{epoch:number;cutoff:number;nowMs:number;sourceRef:string;posts:readonly BoardPost[];
  closingStake:Readonly<Record<string,Readonly<{id:string;micro_usd:string}>|null>>;
  facts:Readonly<Record<string,ComponentFact>>;
  late:readonly Readonly<{wallet:string;reviewed_ms:number;qualified:number|null}>[];
  previousStreaks:Readonly<Record<string,Readonly<{epoch:number;days:number;lastApprovalMs:number}>|null>>;
  campaigns:readonly Readonly<{tokenId:string;activationMs:number}>[]}>;
export type BoardPlan=Readonly<{status:'ready';epoch:number;winners:readonly Winner[];
  decisions:readonly Readonly<{submissionId:string;qualified:boolean;cutoffEvidence:string|null}>[];
  factSources:readonly (readonly [wallet:string,sourceRef:string,payload:string])[];
  streaks:readonly Readonly<{wallet:string;days:number;lastApprovalMs:number}>[];
  sourceRef:string;commitmentInput:JsonValue}>;
export type AllocationInput=Readonly<{tokenId:string;day:number;nowMs:number;originalSupplyUnits:string;activationMs:number;
  board:Readonly<{epoch:number;status:'final';winners:readonly Winner[]}>|null}>;
export type AllocationPlan=Readonly<{status:'ready';tokenId:string;day:number;boardEpoch:number;startsAtMs:number;
  vestsFromMs:number;vestsThroughMs:number;budgetUnits:string;burnUnits:string;
  awards:readonly Readonly<{wallet:string;amountUnits:string}>[]}>;
export type Pending=Readonly<{mode:'local-fixture';status:'pending';epoch:number;reason:string}>;
export type RecordedAllocation=Readonly<{mode:'local-fixture';status:'recorded';allocation:Readonly<{
  token_id:string;day:number;epoch:number;starts_ms:number;vests_from_ms:number;vests_through_ms:number;budget:string;burn:string;
}>}>;
export type ReferenceOutcome<T>=Readonly<{kind:'committed'|'replayed';value:T}>
  |Readonly<{kind:'conflict';code:string}>|Readonly<{kind:'pending';reason:string;dependencyIds:readonly string[]}>;
export type ReferenceLoad<T,R>=Readonly<{input:T;versions:ReferenceReadVersion}>
  |Readonly<{result:R;versions:ReferenceReadVersion}>;
export interface EarnRepository {
  admitSubmission(command:AdmissionCommand):Promise<AdmissionResult>;
  recordFinalReview(command:FinalReviewCommand):Promise<FinalReviewResult>;
  loadBoardInput(query:BoardQuery):Promise<ReferenceLoad<BoardInput,Leaderboard|Pending>>;
  commitBoard(command:Readonly<{query:BoardQuery;versions:ReferenceReadVersion;plan:BoardPlan}>):Promise<ReferenceOutcome<Leaderboard>>;
  loadAllocationInput(query:AllocationQuery):Promise<ReferenceLoad<AllocationInput,RecordedAllocation>>;
  commitAllocation(command:Readonly<{query:AllocationQuery;versions:ReferenceReadVersion;plan:AllocationPlan}>):Promise<ReferenceOutcome<RecordedAllocation>>;
  readLeaderboard(query:Readonly<{epoch:number}>):Promise<Leaderboard>;
  readWalletClaims(query:Readonly<{principal:Principal;nowMs:number;after:number}>):Promise<Claims>;
  readWalletSubmissions(query:Readonly<{principal:Principal;after:number;nowMs:number}>):Promise<SubmissionPage>;
}
export interface CanonicalCrypto {
  sha256(bytes:Uint8Array):Promise<string>;
  verifyEd25519(input:{publicKey:string;signature:string;message:Uint8Array}):Promise<boolean>;
}
// Evidence and jobs remain unavailable until B04/B03 supply their services.
// Concrete B02 repositories and private artifacts are injected where supported.
export type DeferredPort=Readonly<{availability:'not-implemented'}>;
export type ApplicationContext=Readonly<{
  clock:Readonly<{nowMs():number}>;ids:Readonly<{next():string}>;crypto:CanonicalCrypto;
  repositories:Readonly<{earn:EarnRepository;guardedEarn?:GuardedAdmissionRepository;
    settlement?:import('../storage/atomic-settlement.mjs').AtomicSettlementRepository;
    operations?:import('../storage/atomic-operations.mjs').AtomicOperationsRepository;
    artifactReferences?:import('../storage/atomic-artifacts.mjs').ArtifactReferenceRepository}>;
  evidence:DeferredPort;artifacts:DeferredPort|import('../artifacts/store').ArtifactStore;jobs:DeferredPort;
  telemetry:Readonly<{record(event:string,fields:Readonly<Record<string,string|number|boolean>>):void}>;
  executionPolicy:Readonly<{mode:'local-validation';financialExecution:false}>;
}>;

// Guarded persistence contracts for B02 onward. Kept separate from reference
// results so a legacy result cannot masquerade as a durable fenced receipt.
export type JsonValue=null|boolean|string|number|readonly JsonValue[]|{readonly [key:string]:JsonValue};
export type CommandEnvelope<K extends string=string>=Readonly<{
  operationId:string;principal:Principal|OperatorPrincipal;operationKind:K;businessIdentity:string;
  requestKey:string;requestDigest:string;expectedRevisions:Revisions;nowMs:number;
}>;
export type CommandReceipt=Readonly<{
  operationId:string;principal:Principal|OperatorPrincipal;operationKind:string;businessIdentity:string;
  requestKey:string;requestDigest:string;expectedRevisions:Revisions;outputDigest:string;
  status:'committed';resultRef:string;
}>;
export type RepositoryOutcome<T>=Readonly<{kind:'committed'|'replayed';receipt:CommandReceipt;value:T}>
  |Readonly<{kind:'conflict';code:string;currentRevision?:string}>
  |Readonly<{kind:'pending';reason:string;dependencyIds:readonly string[]}>;
export type EpochReadVersion=Readonly<{
  epoch:number;epochRevision:string;policyRevision:string;sourceRevision:string;controlRevision:string;
  priorBoardDigest:string|null;manifestDigest:string;
}>;
export type EvidenceEnvelope=Readonly<{
  version:1;evidenceId:string;mode:'synthetic-fixture'|'recorded-public'|'runtime-read';
  chainGenesis:string|null;sourceId:string;sourceRevision:string;subject:Readonly<{kind:string;id:string}>;
  requestedCutoffMs:number|null;contextSlot:string|null;blockTimeMs:number|null;retrievedAtMs:number;
  ingestedAtMs:number;finality:'unverified'|'confirmed'|'finalized';decoderVersion:string;
  byteDigest:string;objectRef:string;supersedes:string|null;
}>;
export type EvidenceRequirement=Readonly<{id:string;subject:Readonly<{kind:string;id:string}>;
  cutoffMs:number;receiptDigest:string|null;sourceRevision:string;decoderVersion:string;gaps:readonly string[]}>;
export type BoardInputManifest=Readonly<{
  version:1;epoch:number;cutoffMs:number;mode:'synthetic-fixture'|'recorded-public'|'runtime-read';
  requirements:readonly EvidenceRequirement[];versions:EpochReadVersion;complete:boolean;
}>;
export type JobLease=Readonly<{jobId:string;businessKey:string;payloadDigest:string;token:string;
  expiresAtMs:number;revision:string;attempt:number}>;
export type ArtifactIdentity=Readonly<{key:string;byteDigest:string;size:number;semanticDigest:string|null;
  visibility:'private'|'public';contentType:'application/json'|'application/octet-stream'}>;
export type BoardCommitPlan=Readonly<{
  command:CommandEnvelope<'earn.commit-board.v1'>;versions:EpochReadVersion;lease:JobLease;
  manifest:BoardInputManifest;plan:BoardPlan;semanticDigest:string;outputDigest:string;
}>;
export type AllocationCommitPlan=Readonly<{
  command:CommandEnvelope<'earn.commit-allocation.v1'>;versions:EpochReadVersion;lease:JobLease;
  plan:AllocationPlan;semanticDigest:string;outputDigest:string;
}>;
export interface GuardedEarnSettlementRepository {
  loadBoardInput(epoch:number):Promise<RepositoryOutcome<Readonly<{input:BoardInput;manifest:BoardInputManifest;versions:EpochReadVersion}>>>;
  commitBoard(plan:BoardCommitPlan):Promise<RepositoryOutcome<Leaderboard>>;
  commitAllocation(plan:AllocationCommitPlan):Promise<RepositoryOutcome<RecordedAllocation>>;
}
export interface AppTelemetry {record(event:string,fields:Readonly<Record<string,string|number|boolean>>):void}

export interface GuardedAdmissionRepository {
  admitSubmission(command:AdmissionCommand):Promise<RepositoryOutcome<AdmissionResult>>;
  recordFinalReview(command:FinalReviewCommand):Promise<RepositoryOutcome<FinalReviewResult>>;
  getBookmark():string|null;
}
