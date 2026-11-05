import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

for (const manifest of ["../package.json", "../snap/package.json"]) {
  test(
    manifest +
      " resolves the patched renderer and preserves an offline PNG render",
    async () => {
      const result = await promisify(execFile)(
        process.execPath,
        [
          fileURLToPath(new URL("./rendering-compat.mjs", import.meta.url)),
          manifest,
        ],
        { windowsHide: true, timeout: 30000 },
      );
      assert.match(result.stdout, /Offline PNG compatibility verified/);
    },
  );
}

test("Hono 2 Node adapter serves the existing fetch contract on loopback", async () => {
  const { serve } = await import("@hono/node-server");
  const server = serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new Response(new URL(request.url).pathname, {
        headers: { "content-type": "text/plain" },
      }),
  });
  try {
    if (!server.listening)
      await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/compatibility`,
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "/compatibility");
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
