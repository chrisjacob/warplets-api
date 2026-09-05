import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

it("limits chart concurrency and removes cancelled cards from the queue", async () => {
  const completions: ((response: Response) => void)[] = [];
  const fetcher = vi.fn(() => new Promise<Response>(resolve => completions.push(resolve)));
  vi.stubGlobal("fetch", fetcher);
  const { fetchStonkletChart } = await import("./stonkletsChartRequests");
  const controllers = Array.from({ length: 5 }, () => new AbortController());
  const requests = controllers.map((controller, index) => fetchStonkletChart(`/chart/${index}`, controller.signal).catch(error => error));
  await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(3);
  controllers[3]!.abort();
  completions[0]!(Response.json({ points: [] }));
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  expect(fetcher.mock.calls.map(call => (call as unknown[])[0])).not.toContain("/chart/3");
  for (const complete of completions.slice(1)) complete(Response.json({ points: [] }));
  const results = await Promise.all(requests);
  expect(results[3]).toMatchObject({ name: "AbortError" });
});

it("honours provider retry delays instead of treating rate limits as empty charts", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "2" } }))
    .mockResolvedValueOnce(Response.json({ points: [{ price: 1 }] }));
  vi.stubGlobal("fetch", fetcher);
  const { fetchStonkletChart } = await import("./stonkletsChartRequests");
  const request = fetchStonkletChart("/chart", new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect((await request).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
