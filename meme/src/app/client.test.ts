import test from "node:test";
import assert from "node:assert/strict";
import { boundedResponseJson, api, ApiError } from "./client";
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
    const controller = new AbortController(),
      cancelled = api("/api/meme/state", undefined, "GET", controller.signal);
    controller.abort();
    await assert.rejects(cancelled, /aborted/);
    const stalled = api("/api/meme/state");
    context.mock.timers.tick(15001);
    await assert.rejects(stalled, /timed out/);
  } finally {
    context.mock.timers.reset();
  }
});
test("expired access preserves its status for HTML and empty JSON error responses", async (context) => {
  for (const [status, body] of [
    [401, "<form>Sign in</form>"],
    [403, "null"],
  ] as const) {
    context.mock.method(
      globalThis,
      "fetch",
      async () => new Response(body, { status }),
    );
    await assert.rejects(
      api("/api/meme/rewards"),
      (error) => error instanceof ApiError && error.status === status,
    );
  }
});
test("API JSON reads enforce an actual streamed byte limit, cancel overflow and reject malformed UTF-8", async () => {
  assert.deepEqual(await boundedResponseJson(Response.json({ ok: true })), {
    ok: true,
  });
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(30));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    boundedResponseJson(new Response(stream), 20),
    /too large/,
  );
  assert(cancelled);
  await assert.rejects(
    boundedResponseJson(new Response(new Uint8Array([0xff]))),
  );
});
