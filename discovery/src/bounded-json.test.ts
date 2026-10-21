import {afterEach,expect,it,vi} from "vitest";
import {boundedJson,JSON_STREAM_LIMITS as L} from "./rpc";
import {adminJson} from "./request-security";

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function pieces(bytes:Uint8Array,width:number,cancel=vi.fn()){
  let offset=0,pulls=0;
  const stream=new ReadableStream<Uint8Array>({pull(c){pulls++;if(offset>=bytes.length){c.close();return;}c.enqueue(bytes.subarray(offset,offset+width));offset+=width;},cancel},{highWaterMark:0});
  return {response:new Response(stream),cancel,pulls:()=>pulls};
}
const encode=(s:string)=>new TextEncoder().encode(s);
it("preserves exact JSON values, multibyte split boundaries, BOM handling and limits",async()=>{
  const source='\ufeff'+JSON.stringify({text:"漢字😀\u0000",zero:0,flag:false,empty:"",nested:[null,{key:"value"}]}),bytes=encode(source);
  for(const width of [1,2,3,7,8192])expect(await boundedJson(pieces(bytes,width).response,bytes.length)).toEqual(JSON.parse(source.slice(1)));
  const large={text:"x".repeat(300000)},saved=encode(JSON.stringify(large));expect(await boundedJson(pieces(saved,1000).response,saved.length)).toEqual(large);
  await expect(boundedJson(pieces(saved,1000).response,saved.length-1)).rejects.toThrow("response_too_large");
});
it("accepts the exact fragment ceiling and rejects one extra fragment even below the byte ceiling",async()=>{
  const bytes=encode('"'+"x".repeat(L.chunks-2)+'"');expect(await boundedJson(pieces(bytes,1).response,10000)).toBe("x".repeat(L.chunks-2));
  const fragmented=pieces(encode('"'+"x".repeat(L.chunks)+'"'),1);await expect(boundedJson(fragmented.response,10000)).rejects.toThrow("response_fragment_limit");expect(fragmented.pulls()).toBe(L.chunks+1);expect(fragmented.cancel).toHaveBeenCalledOnce();
});
it("bounds empty fragments and does not await an uncooperative source cancellation",async()=>{
  let reads=0;const cancelled=vi.fn(()=>new Promise<void>(()=>{})),stream=new ReadableStream({pull(c){reads++;c.enqueue(new Uint8Array());},cancel:cancelled},{highWaterMark:0});
  await expect(boundedJson(new Response(stream),32000)).rejects.toThrow("response_fragment_limit");expect(reads).toBe(L.chunks+1);expect(cancelled).toHaveBeenCalledOnce();expect(stream.locked).toBe(false);
});
it("times out a stalled body, releases its lock and clears the timer despite hanging cancellation",async()=>{
  vi.useFakeTimers();const cancelled=vi.fn(()=>new Promise<void>(()=>{})),stream=new ReadableStream({pull(){return new Promise<void>(()=>{});},cancel:cancelled});
  const result=expect(boundedJson(new Response(stream),32000)).rejects.toThrow("response_timeout");await vi.advanceTimersByTimeAsync(L.timeout_ms);await result;expect(cancelled).toHaveBeenCalledOnce();expect(stream.locked).toBe(false);expect(vi.getTimerCount()).toBe(0);
});
it("enforces monotonic elapsed time even when immediate fragment reads starve the timer",async()=>{
  let now=0;vi.spyOn(performance,"now").mockImplementation(()=>now++?L.timeout_ms:0);const source=pieces(encode("{}"),1);
  await expect(boundedJson(source.response,32000)).rejects.toThrow("response_timeout");expect(source.cancel).toHaveBeenCalledOnce();
});
it("cleans up successful, malformed, oversized and failed streams without leaking pending timers",async()=>{
  vi.useFakeTimers();for(const source of [pieces(encode("{}"),1),pieces(encode("{"),1),pieces(encode("long"),1)]){await boundedJson(source.response,2).catch(()=>null);expect(vi.getTimerCount()).toBe(0);}
  const failure=new ReadableStream({pull(c){c.error(new Error("synthetic_read_failure"));}});await expect(boundedJson(new Response(failure))).rejects.toThrow("synthetic_read_failure");expect(failure.locked).toBe(false);expect(vi.getTimerCount()).toBe(0);
  await expect(boundedJson(new Response(null))).rejects.toThrow("empty_response");await expect(boundedJson(new Response(""))).rejects.toThrow("invalid_json");
});
function adminRequest(body:ReadableStream){return new Request("http://localhost/api/10x/admin/rewards/lab",{method:"POST",headers:{"content-type":"application/json"},body,duplex:"half"} as RequestInit);}
it("maps fragmented and stalled admin bodies to safe client errors without database or provider work",async()=>{
  const fragmented=new ReadableStream({pull(c){c.enqueue(new Uint8Array());}},{highWaterMark:0});await expect(adminJson(adminRequest(fragmented))).rejects.toMatchObject({message:"request_body_too_fragmented",status:413});
  vi.useFakeTimers();const stalled=new ReadableStream({pull(){return new Promise<void>(()=>{});}}),result=expect(adminJson(adminRequest(stalled))).rejects.toMatchObject({message:"request_body_timeout",status:408});await vi.advanceTimersByTimeAsync(L.timeout_ms);await result;expect(vi.getTimerCount()).toBe(0);
});
