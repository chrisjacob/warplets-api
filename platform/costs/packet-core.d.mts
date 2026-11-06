import type {CostContext,CostPacketInput,CostPacket} from './packet-types.mjs';
export function executionContextPreimage(context?:CostContext):string;
/** Internal arithmetic boundary. Use the Node wrapper or portable service. */
export function calculateCostPacket(input:CostPacketInput,computedContextId:string):CostPacket;
