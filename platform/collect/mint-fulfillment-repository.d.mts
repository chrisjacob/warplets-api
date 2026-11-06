import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,AppTelemetry,RepositoryOutcome} from '../application/ports';
import type {ArtifactStore} from '../artifacts/store';
import type {PinnedBeaconVerifier} from '../beacon/portable.mjs';
import type {CollectionFulfillmentCommand} from './fulfillment-service.mjs';
import type {NormalizedMintFulfillmentPlan} from './mint-plan.mjs';
export type MintFulfillmentResult=NormalizedMintFulfillmentPlan['result']&{readonly evidenceReceiptId:string};
export interface MintFulfillmentRepository{fulfillMint(command:CollectionFulfillmentCommand):Promise<RepositoryOutcome<MintFulfillmentResult>>}
export function createMintFulfillmentRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};clock:{nowMs():number};artifacts:ArtifactStore;beaconVerifier?:PinnedBeaconVerifier;telemetry?:AppTelemetry}):MintFulfillmentRepository;
