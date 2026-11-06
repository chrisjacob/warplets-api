import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto} from '../application/ports';
import type {PinnedBeaconVerifier} from '../beacon/portable.mjs';
import type {CollectionFairnessProjection} from './fairness-projection.mjs';
export const FAIRNESS_READ_LIMITS:Readonly<{statements:16;rows:16;resultBytes:196608;workingBytes:1048576;traitBytes:131072;outputBytes:262144}>;
export type FairnessReadOutcome=Readonly<{kind:'ready';value:CollectionFairnessProjection}>|Readonly<{kind:'missing'}>|Readonly<{kind:'pending';reason:string}>;
export function createCollectionFairnessRepository(driver:AtomicDriver,ports:{crypto:Pick<CanonicalCrypto,'sha256'>;clock:{nowMs():number};beaconVerifier?:PinnedBeaconVerifier;onMeasure?:(value:{statements:number;maxBatchBytes:number;maxResultBytes:number;serializedWorkingBytes:number})=>void}):Readonly<{readOwnFairness(value:{principal:{kind:'wallet';wallet:string};operationId:string}):Promise<FairnessReadOutcome>}>;
