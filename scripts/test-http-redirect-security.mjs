import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import test from "node:test";

// Exercise the actual Base account -> CDP -> axios dependency path, rather
// than adding a separate test-only copy of follow-redirects.
const appRequire = createRequire(new URL("../app/package.json", import.meta.url));
const baseRequire = createRequire(appRequire.resolve("@base-org/account"));
const cdpRequire = createRequire(baseRequire.resolve("@coinbase/cdp-sdk"));
const axiosRequire = createRequire(cdpRequire.resolve("axios"));
const redirects = axiosRequire("follow-redirects");

async function redirectHeaders(t, headers, { sameOrigin = false, sensitiveHeaders = [] } = {}) {
  const target = createServer((request, response) => response.end(JSON.stringify(request.headers)));
  const source = createServer((request, response) => {
    if (request.url === "/final") return response.end(JSON.stringify(request.headers));
    response.writeHead(302, { location: sameOrigin ? "/final" : `http://127.0.0.1:${target.address().port}/final` });
    response.end();
  });
  for (const server of [target, source]) {
    t.after(() => { server.closeAllConnections(); server.close(); });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  }
  return new Promise((resolve, reject) => {
    const request = redirects.http.get({ hostname: "127.0.0.1", port: source.address().port,
      path: "/start", headers, sensitiveHeaders, maxRedirects: 2 }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("error", reject);
      response.on("end", () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    request.on("error", reject);
    request.setTimeout(2_000, () => request.destroy(new Error("Loopback redirect test timed out")));
  });
}

const credentials = { Authorization: "synthetic-bearer", Cookie: "synthetic-cookie", "Proxy-Authorization": "synthetic-proxy", "X-Public": "public" };
for (const form of ["object", "array"]) {
  test(`cross-origin redirect strips ${form}-form credential headers`, { timeout: 5_000 }, async t => {
    const headers = await redirectHeaders(t, form === "array" ? Object.entries(credentials).flat() : { ...credentials });
    for (const name of ["authorization", "cookie", "proxy-authorization"]) assert.equal(headers[name], undefined);
    assert.equal(headers["x-public"], "public");
  });
}

test("custom sensitive header names containing regex syntax are stripped literally", { timeout: 5_000 }, async t => {
  const headers = await redirectHeaders(t, { "X-Session$": "synthetic-session", "X-Public": "public" }, { sensitiveHeaders: ["X-Session$"] });
  assert.equal(headers["x-session$"], undefined);
  assert.equal(headers["x-public"], "public");
});

test("same-origin redirects retain required authentication headers", { timeout: 5_000 }, async t => {
  const headers = await redirectHeaders(t, Object.entries(credentials).flat(), { sameOrigin: true });
  for (const [name, value] of Object.entries(credentials)) assert.equal(headers[name.toLowerCase()], value);
});
