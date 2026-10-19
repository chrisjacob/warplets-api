import {afterEach,it,expect,vi} from 'vitest';
import {cachedNetworkResponse} from './cache';
afterEach(()=>vi.unstubAllGlobals());
it('retries transient read failures without repeating persistent failures',async()=>{
 vi.stubGlobal('caches',{open:async()=>({match:async()=>undefined,put:async()=>{}})});
 const context={request:new Request('https://network-local.10x.meme/api/network/members'),waitUntil:()=>{}};
 const load=vi.fn().mockRejectedValueOnce(Error('D1_ERROR: Failed to parse body as JSON, got: Error: internal error')).mockResolvedValueOnce(new Response('{}',{status:200}));
 expect((await cachedNetworkResponse(context,'members',{},load)).status).toBe(200);expect(load).toHaveBeenCalledTimes(2);
 const permanent=vi.fn().mockRejectedValue(Error('D1_ERROR: no such table'));
 expect((await cachedNetworkResponse(context,'members',{},permanent)).status).toBe(503);expect(permanent).toHaveBeenCalledTimes(1);
 const exhausted=vi.fn().mockRejectedValue(Error('D1_ERROR: internal error'));
 expect((await cachedNetworkResponse(context,'members',{},exhausted)).status).toBe(503);expect(exhausted).toHaveBeenCalledTimes(3);
});
