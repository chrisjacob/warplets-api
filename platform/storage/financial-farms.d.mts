import type {AtomicDriver} from './atomic-earn.mjs';
export type FarmRow=Readonly<{market_id:string;activation_ms:number;original_units:string;funded_units:string;treasury_fee_bps:number}>;
export type FarmEvent=Readonly<{seq:number;id:string;market_id:string;kind:'deposit'|'withdraw'|'harvest';wallet:string;at_ms:number;amount:string|null}>;
export type FarmSnapshot=Readonly<{sourceRevision:string;marketId:string;evaluatedAtMs:number;farm:FarmRow|null;events:readonly FarmEvent[]}>;
export type PositionSnapshot=Readonly<{sourceRevision:string;wallet:string;after:string;evaluatedAtMs:number;farms:readonly FarmRow[];events:readonly FarmEvent[]}>;
export interface FinancialFarmRepository {
 sourceRevision():Promise<string>;
 readFarm(query:{marketId:string;evaluatedAtMs:number}):Promise<FarmSnapshot>;
 readPositions(query:{wallet:string;after:string;evaluatedAtMs:number}):Promise<PositionSnapshot>;
}
export function createFinancialFarmRepository(driver:AtomicDriver):FinancialFarmRepository;
