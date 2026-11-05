import type {ArtifactIdentity,CanonicalCrypto,Winner} from '../application/ports';
export type PublicWinner=Pick<Winner,'userId'|'wallet'|'submissionId'|'tokenId'|'submittedAtMs'|'contentScore'|'multiplierTenths'|'pointsTenths'>;
export type PublicBoard=Readonly<{epoch:number;finalizedAtMs:number;snapshotId:string;winners:readonly PublicWinner[]}>;
export type PublicAward=Readonly<{wallet:string;amountUnits:string}>;
export type PublicAllocationInput=Readonly<{tokenId:string;day:number;activationMs:number;originalUnits:string;startsAtMs:number;vestsFromMs:number;vestsThroughMs:number;
 budgetUnits:string;burnUnits:string;awards:readonly PublicAward[]}>;
export type PublicAllocation=PublicAllocationInput&Readonly<{boardId:string;awardRoot:string}>;
export type PublicManifest=Readonly<{format:'10x.local.earn.public.v1';board:PublicBoard;boardId:string;allocations:readonly PublicAllocation[]}>;
export type PublicBundle=Readonly<{sha256:string;manifest:PublicManifest}>;
export type ManifestVerification=Readonly<{format:'10x.local.earn.public.v1';boardId:string;epoch:number;allocations:number;manifestDigest:string}>;
export type VerifiedManifestArtifact=Readonly<{bundle:PublicBundle;manifest:PublicManifest;semanticDigest:string;byteDigest:string;bytes:Uint8Array;
 identity:ArtifactIdentity;boardId:string;verification:ManifestVerification}>;
export type AwardProof=Readonly<{format:'10x.local.earn.public.v1';context:Readonly<{boardId:string;tokenId:string;day:number;vestsFromMs:number;vestsThroughMs:number}>;
 award:PublicAward;path:readonly Readonly<{side:'left'|'right';hash:string}>[];root:string}>;
export interface ManifestCodec {
 build(input:{board:PublicBoard;allocations:readonly PublicAllocationInput[]}):Promise<VerifiedManifestArtifact>;
 verify(bytes:Uint8Array,pinned:{semanticDigest:string;byteDigest?:string}):Promise<VerifiedManifestArtifact>;
 proof(allocation:PublicAllocation,wallet:string):Promise<AwardProof|null>;
 verifyProof(proof:AwardProof,expectedRoot:string):Promise<boolean>;
 allocationDigest(allocation:PublicAllocation):Promise<string>;
}
export function createManifestCodec(ports:{crypto:CanonicalCrypto}):ManifestCodec;
