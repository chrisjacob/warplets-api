import type {Principal} from '../application/ports';
import type {createMintReservationService} from './mint-service.mjs';
export function handleMintReservation(request:Request,ports:{reservations:ReturnType<typeof createMintReservationService>;authenticate(request:Request):Promise<Principal|null>;consumeQuota(bucket:string,limit:number):Promise<Response|null>}):Promise<Response|null>;
