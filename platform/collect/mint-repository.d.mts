import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,AppTelemetry,RepositoryOutcome} from '../application/ports';
import type {MintReservationCommand,MintReservationResult} from './mint-service.mjs';
export interface MintReservationRepository{reserveMint(command:MintReservationCommand):Promise<RepositoryOutcome<MintReservationResult>>}
export function createMintReservationRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};clock:{nowMs():number};telemetry?:AppTelemetry}):MintReservationRepository;
