import type {AtomicDriver} from './atomic-earn.mjs';
import type {CanonicalCrypto} from '../application/ports';
import type {RequirementInput,RequirementKind} from '../evidence/requirements.mjs';
import type {PositionChainResult} from '../earn/position-chain.mjs';
export type CutoffSourceBinding={kind:RequirementKind;subject:{kind:string;id:string};cutoffMs:number;sourceId:string;sourceRevision:string;decoderVersion:string};
export type CutoffInventoryQuery={epoch:number;nowMs:number;historyStartMs:number;sourceBindings?:readonly CutoffSourceBinding[]};
export type CutoffInventoryResult={kind:'pending';reason:string;dependencyIds:string[]}|{kind:'conflict';code:'revision_conflict'}|{
 kind:'loaded';epoch:number;cutoff:number;asOfMs:number;freeze:{epoch:number;admission_digest:string;admission_count:number;inventory_json:string;closed_ms:number;operation_id:string};
 versions:Record<string,string>;inputs:RequirementInput[];walletDetails:{wallet:string;chains:{tokenId:string;chain:PositionChainResult}[]}[];
 measurements:{readBatches:number;requirements:number;participants:number;inventoryBytes:number}};
export function cutoffBindingKey(kind:RequirementKind,subject:{kind:string;id:string},cutoffMs:number):string;
export function loadCutoffInventory(driver:AtomicDriver,crypto:CanonicalCrypto,options:CutoffInventoryQuery):Promise<CutoffInventoryResult>;
