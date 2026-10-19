import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const methods = new Set(["getGenesisHash", "getSlot", "getSignaturesForAddress", "getTransaction", "getMultipleAccounts"]);
export async function startRelay({ token, rpcUrl, port = 8795, transport = fetch }) {
  const rpc = new URL(rpcUrl);
  if (rpc.protocol !== "https:" || rpc.username || rpc.password || token.length < 32) throw new Error("Invalid local relay configuration");
  const server = createServer(async (request, response) => {
    const supplied = Buffer.from(request.headers["x-tenx-local-relay"] ?? "");
    const expected = Buffer.from(token);
    response.setHeader("cache-control", "no-store");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { response.writeHead(401); response.end(); return; }
    try {
      let target, init, limit = 3_000_000;
      if (request.method === "POST" && request.url === "/rpc") {
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 32_000) { response.writeHead(413); response.end(); return; } chunks.push(chunk); }
        const body = Buffer.concat(chunks).toString("utf8"), parsed = JSON.parse(body);
        if (Array.isArray(parsed) || parsed.jsonrpc !== "2.0" || !methods.has(parsed.method) || !Array.isArray(parsed.params)) { response.writeHead(400); response.end(); return; }
        target = rpc.href; init = { method: "POST", headers: { "content-type": "application/json" }, body };
      } else if (request.method === "GET" && /^\/market\/pools\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(request.url ?? "")) {
        target = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${request.url.split("/").at(-1)}`;
        init = { headers: { accept: "application/json" } }; limit = 100_000;
      } else { response.writeHead(404); response.end(); return; }
      const upstream = await transport(target, { ...init, redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (!upstream.ok || !upstream.body) { await upstream.body?.cancel(); response.writeHead(upstream.status >= 300 ? upstream.status : 502); response.end(); return; }
      const reader = upstream.body.getReader(); const chunks = []; let size = 0;
      try {
        while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > limit) { await reader.cancel(); throw new Error("Response limit"); } chunks.push(chunk.value); }
      } finally { reader.releaseLock(); }
      response.writeHead(200, { "content-type": "application/json" }); response.end(Buffer.concat(chunks));
    } catch { if (!response.headersSent) response.writeHead(502); response.end(); }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return server;
}
