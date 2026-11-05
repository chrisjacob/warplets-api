import type { createClient } from '../../contracts/client.mjs';
type CapabilityInventory = Awaited<ReturnType<ReturnType<typeof createClient>['getCapabilities']>>['data'];
export function capabilityTransport(options?: {
 fetchImpl?:typeof fetch; baseUrl?:string; now?:()=>number; ttlMs?:number; timeoutMs?:number;
}): {fetch:typeof fetch;discover:()=>Promise<CapabilityInventory>;clear:()=>void};
