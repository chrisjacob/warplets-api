import type {GovernanceService} from '../application/governance-service.mjs';
import type {Principal} from '../application/ports';
export function handleInteractiveGovernance(request:Request,ports:{service:GovernanceService;authenticate(request:Request):Promise<Principal|null>;consumeQuota(bucket:string,limit:number):Promise<Response|null>;peer:string}):Promise<Response|null>;
