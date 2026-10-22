import{afterEach,expect,it,vi}from"vitest";
import{z}from"zod";
import{fetchDiscoveryJson,DiscoveryResponseError,DISCOVERY_RESPONSE_LIMITS as L}from"./bounded-json";
import{getJson}from"./client";
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
const url="/api/10x/test",encoder=new TextEncoder();
it("decodes split UTF-8, validates the caller schema and keeps fetch cache-only",async()=>{
  const raw=encoder.encode('{"value":"🌶️"}'),fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(new ReadableStream({start(c){for(const b of raw)c.enqueue(Uint8Array.of(b));c.close();}})));
  expect(await getJson(url,z.object({value:z.string()}))).toEqual({value:"🌶️"});expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]![1]).toMatchObject({cache:"no-store",signal:expect.any(AbortSignal)});
});
it("admits an existing bounded response at the byte ceiling",async()=>{
  const value="x".repeat(L.bytes-2);vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify(value)));expect(await fetchDiscoveryJson(url)).toBe(value);
});
it.each(["advertised","streamed","fragmented"])("cancels an over-bound %s body without schema parsing",async(reason)=>{
  const cancel=vi.fn(),parse=vi.fn(),schema=z.unknown().transform(parse);
  const body=new ReadableStream<Uint8Array>({pull(c){c.enqueue(reason==="streamed"?new Uint8Array(L.bytes+1):new Uint8Array());},cancel},{highWaterMark:0});
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(body,{headers:reason==="advertised"?{"content-length":String(L.bytes+1)}:{"content-length":"0"}}));
  await expect(getJson(url,schema)).rejects.toThrow(reason==="fragmented"?"fragments":"too large");expect(cancel).toHaveBeenCalledOnce();expect(parse).not.toHaveBeenCalled();
});
it.each(["headers","body"])("times out stalled %s, aborts transport and does not retry",async(reason)=>{
  vi.useFakeTimers();const cancel=vi.fn(),fetcher=vi.spyOn(globalThis,"fetch").mockImplementation(()=>reason==="headers"?new Promise<Response>(()=>{}):Promise.resolve(new Response(new ReadableStream({pull(){return new Promise<void>(()=>{});},cancel}))));
  const pending=fetchDiscoveryJson(url),assertion=expect(pending).rejects.toThrow("timed out");await vi.advanceTimersByTimeAsync(L.timeout_ms);await assertion;
  expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);if(reason==="body")expect(cancel).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it("preserves caller cancellation and cancels a body arriving after its request was aborted",async()=>{
  const controller=new AbortController(),cancel=vi.fn();let resolve!:(response:Response)=>void;
  const fetcher=vi.spyOn(globalThis,"fetch").mockReturnValue(new Promise<Response>(r=>{resolve=r;})),pending=fetchDiscoveryJson(url,controller.signal),assertion=expect(pending).rejects.toMatchObject({name:"AbortError"});
  controller.abort();await assertion;resolve(new Response(new ReadableStream({cancel})));await Promise.resolve();await Promise.resolve();expect(cancel).toHaveBeenCalledOnce();expect(fetcher).toHaveBeenCalledOnce();
  await expect(fetchDiscoveryJson(url,controller.signal)).rejects.toMatchObject({name:"AbortError"});expect(fetcher).toHaveBeenCalledOnce();
});
it("withholds malformed JSON, bad UTF-8 and wrong schemas without exposing response text",async()=>{
  const marker="private response marker",fetcher=vi.spyOn(globalThis,"fetch");
  for(const body of[marker,Uint8Array.of(255),""]){fetcher.mockResolvedValueOnce(new Response(body));await expect(fetchDiscoveryJson(url)).rejects.toThrow("Discovery response is not valid JSON.");}
  fetcher.mockResolvedValueOnce(Response.json({value:marker}));await expect(getJson(url,z.object({value:z.number()}))).rejects.toThrow("Discovery data could not be verified");
});
it("preserves explicit operator method, body and headers without retrying or reading an error body",async()=>{
  const fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(Response.json({state:"held"})),init={method:"POST",headers:{authorization:"Bearer test-only-operator","content-type":"application/json"},body:JSON.stringify({request_id:"fixed-original-id"})};
  expect(await fetchDiscoveryJson(url,undefined,init)).toEqual({state:"held"});expect(fetcher.mock.calls[0]![1]).toMatchObject(init);
  const cancel=vi.fn();fetcher.mockResolvedValueOnce(new Response(new ReadableStream({cancel}),{status:401}));await expect(fetchDiscoveryJson(url)).rejects.toBeInstanceOf(DiscoveryResponseError);expect(cancel).toHaveBeenCalledOnce();expect(fetcher).toHaveBeenCalledTimes(2);
});
it("gives explicit operator POSTs a bounded minute without automatic resubmission",async()=>{
  vi.useFakeTimers();const fetcher=vi.spyOn(globalThis,"fetch").mockReturnValue(new Promise<Response>(()=>{})),pending=fetchDiscoveryJson(url,undefined,{method:"POST",body:"{}"}),assertion=expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(L.timeout_ms);expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(false);await vi.advanceTimersByTimeAsync(L.operation_timeout_ms-L.timeout_ms);await assertion;expect(fetcher).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it.each(["depth","nodes"])("rejects excessive JSON %s before running the caller schema",async(reason)=>{
  const parse=vi.fn(),schema=z.unknown().transform(parse);let value:unknown=Array(L.nodes).fill(0);if(reason==="depth"){value=0;for(let i=0;i<=L.depth;i++)value=[value];}
  vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json(value));await expect(getJson(url,schema)).rejects.toThrow("too complex");expect(parse).not.toHaveBeenCalled();
});
