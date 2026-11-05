import type {AtomicDriver} from './atomic-earn.mjs';
export class FinancialVaultReadBoundError extends RangeError {readonly code:'read_byte_bound';readonly status:503;}
export type VaultReadAsset=Readonly<{id:string;coords:string|null;owner:string;latestMs:number;collectionTracked:boolean;revealMs:number|null}>;
export type VaultReadManifest=Readonly<{id:string;activated_ms:number;genesis_units:string;season_units:string;original_units:string;seasons:string;digest:string}>;
export type VaultOwnerPageRow=Readonly<{id:string;ownerObservedMs:number|null}>;
export type VaultClaimRow=Readonly<{assetId:string;launchId:string;claimed:string}>;
export type MemberVaultSnapshot=Readonly<{kind:'member';wallet:string;after:string;evaluatedAtMs:number;sourceRevision:string;page:readonly VaultOwnerPageRow[];
 assets:readonly VaultReadAsset[];manifests:readonly VaultReadManifest[];claims:readonly VaultClaimRow[]}>;
export type AssetVaultSnapshot=Readonly<{kind:'asset';assetId:string;after:string;evaluatedAtMs:number;sourceRevision:string;asset:VaultReadAsset|null;
 ownerObservedMs:number|null;manifests:readonly (VaultReadManifest&Readonly<{claimed:string}>)[]}>;
export interface FinancialVaultRepository {
 readMemberVault(query:{wallet:string;after:string;evaluatedAtMs:number}):Promise<MemberVaultSnapshot>;
 readAssetVault(query:{assetId:string;after:string;evaluatedAtMs:number}):Promise<AssetVaultSnapshot>;
}
export function createFinancialVaultRepository(driver:AtomicDriver):FinancialVaultRepository;
