import type {CanonicalCrypto,OperatorPrincipal} from '../application/ports';
import type {CollectionFulfillmentInput} from './fulfillment-service.mjs';
import type {MintFulfillmentRepository} from './mint-fulfillment-repository.mjs';
export function createMintFulfillmentService(ports:{repository:MintFulfillmentRepository;crypto:CanonicalCrypto}):Readonly<{fulfillMint(principal:OperatorPrincipal,input:CollectionFulfillmentInput&{requestKey:string}):ReturnType<MintFulfillmentRepository['fulfillMint']>}>;
