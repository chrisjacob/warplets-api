import type {Principal} from '../application/ports';
import type {CollectionReadRepository} from './read-model.mjs';
export function handleCollectionReads(request:Request,ports:{reads:CollectionReadRepository;clock:{nowMs():number};authenticate(request:Request):Promise<Principal|null>;consumeQuota(bucket:string,limit:number):Promise<Response|null>}):Promise<Response|null>;
