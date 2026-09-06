import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchStonkletChart } from "./stonkletsChartRequests";
beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.useRealTimers());
describe("chart data cache", () => {
 it("reuses data after a chart is released and recreated", async () => {
  const fetch = vi.fn(async () => new Response('{"points":[{},{}]}',{headers:{"content-type":"application/json"}})); vi.stubGlobal("fetch",fetch);
  const signal = new AbortController().signal;
  expect(await (await fetchStonkletChart("/test-cache-one",signal)).json()).toEqual({points:[{},{}]});
  expect(await (await fetchStonkletChart("/test-cache-one",signal)).json()).toEqual({points:[{},{}]});
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("does not cache failed responses", async () => {
  const fetch=vi.fn(async()=>new Response("failed",{status:404}));vi.stubGlobal("fetch",fetch);
  await fetchStonkletChart("/test-cache-error",new AbortController().signal);
  await fetchStonkletChart("/test-cache-error",new AbortController().signal);
  expect(fetch).toHaveBeenCalledTimes(2);
 });
 it("respects cancellation even with cached data", async () => {
  const controller=new AbortController();controller.abort();
  await expect(fetchStonkletChart("/test-cache-one",controller.signal)).rejects.toMatchObject({name:"AbortError"});
 });
});

describe("temporary chart failures", () => {
 it.each([200, 503, 429])("retries a temporary %s response and recovers", async (status) => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(new Response(status === 200 ? '{"points":[]}' : null, { status, headers: { 'retry-after': '1' } })).mockImplementation(async () => new Response('{"points":[{},{}]}'));
  vi.stubGlobal('fetch', fetch);
  const request = fetchStonkletChart(`/retry-${status}`, new AbortController().signal);
  await vi.runAllTimersAsync();
  expect((await request).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(2);
 });
 it("bounds retries and never caches empty chart responses", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => new Response('{"points":[]}'));
  vi.stubGlobal('fetch', fetch);
  for (let i = 0; i < 2; i++) {
   const request = fetchStonkletChart('/empty-retry-limit', new AbortController().signal);
   await vi.runAllTimersAsync();
   await request;
  }
  expect(fetch).toHaveBeenCalledTimes(8);
 });
});
