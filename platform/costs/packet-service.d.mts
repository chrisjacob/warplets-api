import type {CanonicalCrypto} from '../application/ports';
import type {CostPacketInput,CostPacket} from './packet-types.mjs';
export type {CostPacketInput,CostPacket} from './packet-types.mjs';
export const COST_PACKET_SERVICE_LIMITS:Readonly<{inputBytes:262144;depth:32;entries:10000}>;
export function createCostPacketService(ports:{crypto:Pick<CanonicalCrypto,'sha256'>}):Readonly<{calculate(input:CostPacketInput):Promise<CostPacket>}>;
