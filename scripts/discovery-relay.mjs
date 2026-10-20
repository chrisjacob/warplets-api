import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const methods = new Set(["getGenesisHash", "getSlot", "getBlockTime", "getSignaturesForAddress", "getTransaction", "getMultipleAccounts", "getProgramAccounts"]);
export async function startRelay({ token, rpcUrl, port = 8795, transport = fetch }) {
  const rpc = new URL(rpcUrl);
  if (rpc.protocol !== "https:" || rpc.username || rpc.password || token.length < 32) throw new Error("Invalid local relay configuration");
  let nextRpcAt = 0, rpcCooldownUntil = 0;
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
        if(parsed.method==="getBlockTime"&&(parsed.params.length!==1||!Number.isSafeInteger(parsed.params[0])||parsed.params[0]<0)){response.writeHead(400);response.end();return;}
        if (parsed.method === "getProgramAccounts") {
          const [program, config] = parsed.params;
          if (!["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"].includes(program) || config?.commitment !== "finalized" || config?.withContext !== true || config?.encoding !== "base64" || config?.dataSlice?.offset !== 0 || config?.dataSlice?.length !== 166 || config?.filters?.length !== 1 || config?.filters[0]?.memcmp?.offset !== 0 || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(config?.filters[0]?.memcmp?.bytes ?? "")) { response.writeHead(400); response.end(); return; }
        }
        target = rpc.href; init = { method: "POST", headers: { "content-type": "application/json" }, body };
      } else if (request.method === "GET" && /^\/market\/pools\/(?:multi\/)?[1-9A-HJ-NP-Za-km-z,]{32,1350}$/.test(request.url ?? "")) {
        const addresses = request.url.split("/").at(-1).split(",");
        if (addresses.length > 30 || addresses.some(a => !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) || (!request.url.includes("/multi/") && addresses.length > 1)) { response.writeHead(400); response.end(); return; }
        target = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${request.url.includes("/multi/") ? "multi/" : ""}${addresses.join(",")}?include=base_token`;
        init = { headers: { accept: "application/json" } }; limit = 500_000;
      } else if (request.method === "GET" && /^\/dex\/tokens\/[1-9A-HJ-NP-Za-km-z,]{32,1350}$/.test(request.url ?? "")) {
        const addresses = request.url.split("/").at(-1).split(",");
        if (addresses.length > 30 || addresses.some(a => !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a))) { response.writeHead(400); response.end(); return; }
        target = `https://api.dexscreener.com/tokens/v1/solana/${addresses.join(",")}`;
        init = { headers: { accept: "application/json" } }; limit = 1_000_000;
      } else if (request.method === "GET" && /^\/metadata\/ipfs\/[a-zA-Z0-9]{32,128}(?:\/[a-zA-Z0-9._~/-]*)?$/.test(request.url ?? "") && !request.url.includes("..")) {
        target = `https://gateway.pinata.cloud${request.url.slice("/metadata".length)}`;
        init = { headers: { accept: "application/json" } }; limit = 64_000;
      } else { response.writeHead(404); response.end(); return; }
      if (target === rpc.href) {
        if (rpcCooldownUntil > Date.now()) { response.writeHead(429, { "retry-after": String(Math.ceil((rpcCooldownUntil - Date.now()) / 1000)) }); response.end(); return; }
        const start = Math.max(Date.now(), nextRpcAt), delay = start - Date.now();
        if (delay > 3000) { response.writeHead(429, { "retry-after": "300" }); response.end(); return; }
        nextRpcAt = start + 1000;
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        if (rpcCooldownUntil > Date.now()) { response.writeHead(429, { "retry-after": String(Math.ceil((rpcCooldownUntil - Date.now()) / 1000)) }); response.end(); return; }
      }
      const upstream = await transport(target, { ...init, redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (upstream.status === 429 && target === rpc.href) { const raw = upstream.headers.get("retry-after"), seconds = raw && /^\d+$/.test(raw) ? Number(raw) : raw ? Math.ceil((Date.parse(raw) - Date.now()) / 1000) : 300; rpcCooldownUntil = Date.now() + Math.max(300, Number.isFinite(seconds) ? Math.min(31536000, seconds) : 300) * 1000; }
      if (!upstream.ok || !upstream.body) { await upstream.body?.cancel(); response.writeHead(upstream.status >= 300 ? upstream.status : 502, upstream.headers.has("retry-after") ? { "retry-after": upstream.headers.get("retry-after") } : {}); response.end(); return; }
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
