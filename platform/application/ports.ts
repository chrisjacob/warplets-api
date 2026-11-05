export type Principal = Readonly<{kind:'wallet';wallet:string}>;
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
export type SubmissionPage = Readonly<{mode:'local-fixture';items:readonly SubmissionStatus[];nextCursor:number|null}>;
export interface EarnRepository {
  admitSubmission(command:AdmissionCommand):Promise<AdmissionResult>;
  readLeaderboard(query:Readonly<{epoch:number}>):Promise<Leaderboard>;
  readWalletClaims(query:Readonly<{principal:Principal;nowMs:number;after:number}>):Promise<Claims>;
  readWalletSubmissions(query:Readonly<{principal:Principal;after:number}>):Promise<SubmissionPage>;
}
export interface CanonicalCrypto {
  sha256(bytes:Uint8Array):Promise<string>;
  verifyEd25519(input:{publicKey:string;signature:string;message:Uint8Array}):Promise<boolean>;
}
// These ports are deliberately unavailable in this extraction checkpoint.
// B02 supplies the concrete evidence/artifact/job contracts before consumers.
export type DeferredPort=Readonly<{availability:'not-implemented'}>;
export type ApplicationContext=Readonly<{
  clock:Readonly<{nowMs():number}>;ids:Readonly<{next():string}>;crypto:CanonicalCrypto;
  repositories:Readonly<{earn:EarnRepository}>;evidence:DeferredPort;artifacts:DeferredPort;jobs:DeferredPort;
  telemetry:Readonly<{record(event:string,fields:Readonly<Record<string,string|number|boolean>>):void}>;
  executionPolicy:Readonly<{mode:'local-validation';financialExecution:false}>;
}>;
