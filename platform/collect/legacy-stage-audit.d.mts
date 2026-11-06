import type {CollectionListSeal} from './source-intake.mjs';
import type {RecoveryDigest} from '../recovery/v2-node-digest.mjs';
export type LegacyStageType='whitelist'|'public'|'founder'|'free';
export interface LegacyStagePreimage {
 readonly format:'legacy-stage-publication-preimage-v1';readonly inventoryId:string;readonly stageId:string;readonly type:LegacyStageType;
 readonly publishedAt:number;readonly opensAt:number;readonly closesAt:number;readonly priceLamports:string;readonly costLamports:string;readonly allocation:number;
 /** Original committed value before Genesis/free normalization to one. Null is
  * the legacy nullish default; never infer it from normalized walletLimit. */
 readonly walletLimit:number|null;readonly founderApproved:boolean;readonly approvedSpendLamports:string|null;readonly ballotId:string|null;readonly inventoryOverrideReason:string|null;
 /** Sorted, deduplicated list committed by the historical hash, including lists
  * discarded by public/free reducer output. Raw input order is not committed. */
 readonly walletListId:string;
}
export interface LegacyStageTerms {readonly id:string;readonly type:LegacyStageType;readonly publishedAt:number;readonly opensAt:number;readonly closesAt:number;readonly priceLamports:{$lamports:string};readonly costLamports:{$lamports:string};readonly allocation:number;readonly walletLimit:number;readonly approvedSpendLamports?:{$lamports:string};readonly termsDigest:string;readonly ballotId:string|null;readonly inventoryOverrideReason:string|null}
export type LegacyStageMembership=Readonly<{kind:'unrestricted'|'pending'}>|Readonly<{kind:'list'|'free-cut';listId:string;count:number;walletsDigest:string}>;
export interface LegacyStageAuditInput {
 readonly original:LegacyStagePreimage|null;readonly originalList:CollectionListSeal|null;
 readonly header:Readonly<{id:string;kind:'genesis'|'season';tranche:number|null;seasonStart:number|null}>;
 readonly priorStages:readonly Readonly<{id:string;type:LegacyStageType;closesAt:number}>[];
 readonly stored:Readonly<{terms:LegacyStageTerms;membership:LegacyStageMembership}>;
 readonly previousTranche?:Readonly<{tranche:number;openingMs:number;ballotId:string;ballotTrancheOpeningMs:number}>;
}
export interface LegacyStageAuditMetrics {readonly chunkReads:number;readonly wallets:number;readonly hashedBytes:number;readonly maxWorkingBytes:number}
export type LegacyStageAuditResult=Readonly<{kind:'held';reason:string;metrics:LegacyStageAuditMetrics}>|Readonly<{kind:'verified';inventoryId:string;stageId:string;termsDigest:string;originalHeaderDigest:string;originalListId:string;walletsDigest:string;walletCount:number;normalizedProjectionDigest:string;membership:'separate-free-cut-audit-required'|'unrestricted'|'exact-original-list';verification:'publication-preimage-and-scalar-reducer-only';source:'local-reference-fixture';executable:false;metrics:LegacyStageAuditMetrics}>;
export const LEGACY_STAGE_AUDIT_LIMITS:Readonly<{wallets:10000;chunkWallets:1000;chunkReads:10;contextBytes:65536;workingBytes:1048576}>;
export function auditLegacyStagePublication(input:LegacyStageAuditInput,ports:{createDigest():RecoveryDigest;readWalletChunk(request:Readonly<{listId:string;offset:number;limit:1000}>):Promise<Readonly<{listId:string;offset:number;wallets:readonly string[];done:boolean}>>}):Promise<LegacyStageAuditResult>;
