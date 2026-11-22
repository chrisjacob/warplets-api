import test from "node:test";
import assert from "node:assert/strict";
import { api } from "./client";
test("API requests stop on account cancellation or timeout without newer AbortSignal helpers", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  context.mock.method(
    globalThis,
    "fetch",
    (_url: unknown, options?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = options?.signal;
        const abort = () => reject(Error("aborted"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      }),
  );
  try {
    const controller = new AbortController();
    const cancelled = api(
      "/api/meme/state",
      undefined,
      "GET",
      controller.signal,
    );
    controller.abort();
    await assert.rejects(cancelled, /aborted/);
    const stalled = api("/api/meme/state");
    context.mock.timers.tick(15001);
    await assert.rejects(stalled, /timed out/);
  } finally {
    context.mock.timers.reset();
  }
});
