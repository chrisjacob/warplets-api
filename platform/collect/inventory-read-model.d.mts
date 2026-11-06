import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {Principal} from '../application/ports';
import type {Inventory} from '../contracts/client.mjs';
export type InventoryReadOutcome<T>={kind:'ready';value:T}|{kind:'missing'}|{kind:'pending';reason:string};
export interface InventoryReadRepository {
 readInventory(query:{inventoryId:string;nowMs:number;principal?:Principal|null}):Promise<InventoryReadOutcome<Inventory>>;
 listInventories(query:{nowMs:number;principal?:Principal|null;after?:string}):Promise<InventoryReadOutcome<{items:Inventory[];nextCursor:string|null;source:'local-fixture'}>>;
}
export const INVENTORY_READ_LIMITS:Readonly<{page:25;stages:32;legacyBytes:524288;contextBytes:2097152}>;
export function createInventoryReadRepository(driver:AtomicDriver,options?:{normalizedAdmissionAvailable?:boolean;legacyAdmissionAvailable?:boolean}):InventoryReadRepository;
