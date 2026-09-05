import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchStonkletChart } from "./stonkletsChartRequests";
beforeEach(() => vi.unstubAllGlobals());
describe("chart data cache", () => {
 it("reuses data after a chart is released and recreated", async () => {
  const fetch = vi.fn(async () => new Response('{"points":[]}',{headers:{"content-type":"application/json"}})); vi.stubGlobal("fetch",fetch);
  const signal = new AbortController().signal;
  expect(await (await fetchStonkletChart("/test-cache-one",signal)).json()).toEqual({points:[]});
  expect(await (await fetchStonkletChart("/test-cache-one",signal)).json()).toEqual({points:[]});
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("does not cache failed responses", async () => {
  const fetch=vi.fn(async()=>new Response("failed",{status:500}));vi.stubGlobal("fetch",fetch);
  await fetchStonkletChart("/test-cache-error",new AbortController().signal);
  await fetchStonkletChart("/test-cache-error",new AbortController().signal);
  expect(fetch).toHaveBeenCalledTimes(2);
 });
 it("respects cancellation even with cached data", async () => {
  const controller=new AbortController();controller.abort();
  await expect(fetchStonkletChart("/test-cache-one",controller.signal)).rejects.toMatchObject({name:"AbortError"});
 });
});
