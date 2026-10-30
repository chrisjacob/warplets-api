import test from "node:test";
import assert from "node:assert/strict";
import {
  operatorRequest,
  statusExitCode,
  controlRequestBody,
} from "./operator-client.mjs";
const origin = "http://127.0.0.1:8797",
  path = "/api/meme/operator/operations/health";
test("operator transport refuses remote, normalized or non-operator routes before exposing its token", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({});
  };
  for (const [base, route] of [
    ["https://evil.test", path],
    [origin + "/wrong", path],
    [origin, "/api/auth/session"],
    [origin, "/api/meme/operator/../auth/session"],
    [origin, "/api/meme/operator/%2e%2e/auth/session"],
    [origin, path + "?token=secret"],
  ])
    await assert.rejects(
      operatorRequest(
        base,
        "disposable-token",
        route,
        undefined,
        "GET",
        fetcher,
      ),
      /loopback/,
    );
  assert.equal(calls, 0);
});
test("status reads use headers, no body or redirect following; raw server errors stay private", async () => {
  let options;
  const result = await operatorRequest(
    origin,
    "disposable-token",
    path,
    undefined,
    "GET",
    async (_url, opts) => {
      options = opts;
      return Response.json({ status: "idle" });
    },
  );
  assert.equal(result.status, "idle");
  assert.equal(options.redirect, "manual");
  assert.equal(options.body, undefined);
  assert.equal(options.headers.authorization, "Bearer disposable-token");
  await assert.rejects(
    operatorRequest(
      origin,
      "disposable-token",
      path,
      undefined,
      "GET",
      async () =>
        new Response("SENTINEL_SECRET_ERROR", {
          status: 302,
          headers: { location: "https://evil.test" },
        }),
    ),
    (error) =>
      error.message.includes("302") && !error.message.includes("SENTINEL"),
  );
});
test("oversized operator responses are cancelled rather than buffered", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(524289));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(
    operatorRequest(
      origin,
      "disposable-token",
      path,
      undefined,
      "GET",
      async () => response,
    ),
    /exceeds its limit/,
  );
  assert.equal(cancelled, true);
});
test("monitoring exit codes describe local attention and reject financial readiness claims", () => {
  const report = {
    version: 1,
    scope: "local-preview",
    productionReady: false,
    financialActions: { launching: false, funding: false, claims: false },
  };
  for (const status of ["ok", "idle", "paused"])
    assert.equal(statusExitCode({ ...report, status }), 0);
  assert.equal(statusExitCode({ ...report, status: "attention" }), 2);
  assert.equal(
    statusExitCode({ ...report, status: "ok", productionReady: true }),
    1,
  );
  assert.equal(
    statusExitCode({
      ...report,
      status: "ok",
      financialActions: { launching: true, funding: false, claims: false },
    }),
    1,
  );
  assert.equal(statusExitCode({ status: "ok" }), 1);
});
test("saved retries are bound to the chosen local profile and worktree", () => {
  const saved = {
    version: 1,
    target: "preview",
    origin,
    workspace: "/isolated-preview",
    request: { key: "saved-request-key" },
  };
  assert.deepEqual(
    controlRequestBody(saved, "preview", origin, "/isolated-preview"),
    saved.request,
  );
  for (const args of [
    ["restricted-qa", origin, "/isolated-preview"],
    ["preview", "http://127.0.0.1:8799", "/isolated-preview"],
    ["preview", origin, "/other-worktree"],
  ])
    assert.throws(
      () => controlRequestBody(saved, ...args),
      /another local target or worktree/,
    );
});
