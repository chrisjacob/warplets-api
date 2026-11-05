import type {GuardedEarnService} from './guarded-service.mjs';
import type {Principal} from '../application/ports';
export function handleInteractiveEarn(request:Request,ports:{service:GuardedEarnService;peer:string;
 authenticate(request:Request):Promise<Principal|null>;consumeQuota(bucket:string,limit:number):Promise<Response|null>}):Promise<Response|null>;
