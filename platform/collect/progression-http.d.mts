import type {Principal} from '../application/ports';
import type {ImmutableProgressionQuote} from '../application/collections';
import type {CollectionQuoteService} from './quote-service.mjs';
import type {ProgressionReservationResult,createProgressionReservationService} from './reservation-service.mjs';
export function storedProgressionQuoteView(quote:ImmutableProgressionQuote):Readonly<Record<string,unknown>>;
export function progressionReservationView(value:ProgressionReservationResult):Readonly<Record<string,unknown>>;
export function handleProgression(request:Request,ports:{quotes:CollectionQuoteService;reservations:ReturnType<typeof createProgressionReservationService>;authenticate(request:Request):Promise<Principal|null>;consumeQuota(bucket:string,limit:number):Promise<Response|null>}):Promise<Response|null>;
