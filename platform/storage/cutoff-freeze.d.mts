import type {AtomicDriver} from './atomic-earn.mjs';
import type {CanonicalCrypto,OperatorPrincipal,Revisions,RepositoryOutcome,AppTelemetry} from '../application/ports';
export type FreezeCommand={operationKind:'earn.freeze-epoch.v1';principal:OperatorPrincipal;epoch:number;nowMs:number;expectedRevisions:Revisions;
 requestKey:string;businessIdentity:string;requestDigest:string};
export function createFreezeCommand(args:{principal:OperatorPrincipal;epoch:number;nowMs:number;expectedRevisions?:Revisions},crypto:CanonicalCrypto):Promise<FreezeCommand>;
export interface CutoffFreezeRepository {
 readFreeze(epoch:number):Promise<{epoch:number;admission_digest:string;admission_count:number;inventory_json:string;closed_ms:number;operation_id:string}|null>;
 freezeEpoch(command:FreezeCommand):Promise<RepositoryOutcome<{epoch:number;admissionDigest:string;admissionCount:number}>>;
}
export function createCutoffFreezeRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};telemetry?:AppTelemetry}):CutoffFreezeRepository;
