import type {Principal} from '../application/ports';
import type {InventoryReadRepository} from './inventory-read-model.mjs';
export function handleInventoryReads(request:Request,ports:{reads:InventoryReadRepository;clock:{nowMs():number};authenticate(request:Request):Promise<Principal|null>;consumeQuota(bucket:string,limit:number):Promise<Response|null>}):Promise<Response|null>;
