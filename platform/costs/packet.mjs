import {createHash} from 'node:crypto';
import {executionContextPreimage,calculateCostPacket} from './packet-core.mjs';

// Synchronous compatibility API; exact historical ordered-array preimage.
export function executionContextId(context={}){return createHash('sha256').update(executionContextPreimage(context)).digest('hex');}
export function costPacket(input){return calculateCostPacket(input,executionContextId(input?.context));}
