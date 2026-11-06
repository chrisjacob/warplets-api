import type {CanonicalCrypto} from '../application/ports';
import type {Principal} from '../application/ports';
export const RESERVE_COLLECTION_MINT:'collection.reserve-operation.v1';
export interface MintReservationRequest{readonly requestKey:string;readonly inventoryId:string;readonly stageId:string;readonly expectedTermsDigest:string;readonly wallet?:string}
export interface MintReservationCommand{readonly operationKind:typeof RESERVE_COLLECTION_MINT;readonly principal:Principal;readonly businessIdentity:string;readonly requestKey:string;readonly input:Readonly<{kind:'mint';inventoryId:string;stageId:string;expectedTermsDigest:string;wallet?:string}>;readonly requestDigest:string}
export interface MintReservationResult{readonly operationId:string;readonly inventoryId:string;readonly wallet:string;readonly kind:'mint';readonly stageId:string;readonly termsDigest:string;readonly priceLamports:string;readonly costLamports:string;readonly createdMs:number;readonly status:'awaiting-evidence';readonly fairness:'configured-offline-beacon'|'manual-fixture';readonly source:'local-fixture';readonly executable:false}
export function buildMintReservationCommand(principal:Principal,request:MintReservationRequest,crypto:CanonicalCrypto):Promise<MintReservationCommand>;
export function createMintReservationService(ports:{repository:import('./mint-repository.mjs').MintReservationRepository;crypto:CanonicalCrypto}):Readonly<{reserveMint(principal:Principal,request:MintReservationRequest):ReturnType<import('./mint-repository.mjs').MintReservationRepository['reserveMint']>}>;
