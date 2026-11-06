import type {CanonicalCrypto,Principal,Revisions} from './ports';
import type {MintReservationInput,MintReservationCommand,MintAdmissionFacts,MintAdmissionPlan} from './collections';
export function createMintReservationCommand(input:{principal:Principal;requestKey:string;nowMs:number;expectedRevisions:Revisions;input:MintReservationInput},ports:{crypto:CanonicalCrypto}):Promise<MintReservationCommand>;
export function planMintReservation(command:MintReservationCommand,facts:MintAdmissionFacts,ids:{operationId:string;commitment:string}):MintAdmissionPlan;
