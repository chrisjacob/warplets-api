import type {CanonicalCrypto,Principal,RepositoryOutcome} from '../application/ports';
import type {ProgressionReservationInput} from '../application/collections';
export const RESERVE_COLLECTION_PROGRESSION:'collection.reserve-operation.v1';
export interface ProgressionReservationCommand {readonly operationKind:typeof RESERVE_COLLECTION_PROGRESSION;readonly principal:Principal;readonly requestKey:string;readonly input:ProgressionReservationInput;readonly businessIdentity:string;readonly requestDigest:string}
export interface ProgressionReservationResult {readonly operationId:string;readonly inventoryId:string;readonly wallet:string;readonly kind:'upgrade'|'visual';readonly targetId:string;readonly materialId:string|null;readonly quoteId:string;readonly bindingDigest:string;readonly feeLamports:string;readonly maxTotalLamports:string;readonly createdMs:number;readonly status:'awaiting-evidence';readonly fairness:'configured-offline-beacon'|'manual-fixture';readonly source:'local-fixture';readonly executable:false}
export interface ProgressionReservationRepository {reserve(command:ProgressionReservationCommand):Promise<RepositoryOutcome<ProgressionReservationResult>>}
export function normalizeProgressionReservation(input:ProgressionReservationInput):ProgressionReservationInput;
export function progressionReservationBytes(command:Omit<ProgressionReservationCommand,'requestDigest'>):Uint8Array;
export function buildProgressionReservationCommand(principal:Principal,input:ProgressionReservationInput&{requestKey:string},crypto:CanonicalCrypto):Promise<ProgressionReservationCommand>;
export function createProgressionReservationService(ports:{repository:ProgressionReservationRepository;crypto:CanonicalCrypto}):{reserve(principal:Principal,input:ProgressionReservationInput&{requestKey:string}):Promise<RepositoryOutcome<ProgressionReservationResult>>};
