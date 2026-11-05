import type {Principal as WalletPrincipal,CanonicalCrypto} from './ports';
import type {FinancialVaultRepository} from '../storage/financial-vault.mjs';
import type {FinancialFarmRepository} from '../storage/financial-farms.mjs';
import type {VaultMemberRead,VaultAssetRead,VaultLocalAccounting} from '../vault/read-projection.mjs';
export type FinancialReadIdentity=Readonly<{sourceRevision:string;snapshotId:string}>;
export type FinancialFarmDto=Readonly<{marketId:string;fundedUnits:string;treasuryFeeBps:number;activationTime:string;emissionEnd:string;asOf:string;source:'local-fixture';
 status?:'scheduled'|'active'|'ended';totalStakedUnits?:string;earnedGrossUnits?:string;unusedRecoverableUnits?:string;roundingReserveUnits?:string;
 principalUnits?:string;claimableGrossUnits?:string;harvestedGrossUnits?:string}>&VaultLocalAccounting;
export interface FinancialReadService {
 readMemberVault(principal:WalletPrincipal,query?:{cursor?:string}):Promise<VaultMemberRead&FinancialReadIdentity>;
 readAssetVault(assetId:string,query?:{cursor?:string}):Promise<VaultAssetRead&FinancialReadIdentity>;
 readFarm(marketId:string):Promise<FinancialFarmDto&FinancialReadIdentity>;
 readPositions(principal:WalletPrincipal,query?:{cursor?:string}):Promise<Readonly<{items:readonly FinancialFarmDto[];nextCursor:string|null;asOf:string;source:'local-fixture'}>&VaultLocalAccounting&FinancialReadIdentity>;
}
export type FinancialReadPorts={vaultRepository:FinancialVaultRepository;farmRepository:FinancialFarmRepository;crypto:CanonicalCrypto;clock:{nowMs():number}};
