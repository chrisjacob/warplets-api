import type {MemberVaultSnapshot,AssetVaultSnapshot} from '../storage/financial-vault.mjs';
import type {VaultAllocationProjection} from './member-projection.mjs';
export type VaultLocalAccounting=Readonly<{sourceStatus:'local-accounting';chainAuthority:'unverified';unit:'base-units';executable:false}>;
export type VaultReadUnavailableReason='asset-bound'|'manifest-bound'|'concealed-metadata'|'claim-bound'|'future-accounting'|'invalid-accounting';
export type VaultReadAllocation=VaultAllocationProjection&VaultLocalAccounting;
export type VaultReadSummary=Readonly<{source:'local-fixture';asOf:string}>&VaultLocalAccounting&(
 Readonly<{status:'complete';reason:null;assetCount:number;items:readonly VaultReadAllocation[]}>|
 Readonly<{status:'unavailable';reason:VaultReadUnavailableReason;assetCount:null;items:readonly []}>);
export type VaultMemberRead=Readonly<{summary:VaultReadSummary;items:readonly Readonly<{id:string;ownerObservedAt:string|null;detail:string}>[];nextCursor:string|null;source:'local-fixture';asOf:string}>&VaultLocalAccounting;
export type VaultAssetRead=Readonly<{assetId:string;ownerObservedAt:string|null;slot:unknown;items:readonly VaultReadAllocation[];nextCursor:string|null;source:'local-fixture';asOf:string}>&VaultLocalAccounting;
export type VaultAssetReadResult=Readonly<{kind:'missing'}>|Readonly<{kind:'hidden'}>|Readonly<{kind:'unavailable';reason:'future-accounting'|'invalid-accounting'}>|Readonly<{kind:'ready';value:VaultAssetRead}>;
export function projectMemberVaultSnapshot(snapshot:MemberVaultSnapshot):VaultMemberRead;
export function projectVaultAssetSnapshot(snapshot:AssetVaultSnapshot):VaultAssetReadResult;
