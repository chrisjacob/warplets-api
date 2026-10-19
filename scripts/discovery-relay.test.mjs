import { test } from "node:test";
import assert from "node:assert/strict";
import { startRelay } from "./discovery-relay.mjs";

test("loopback relay authenticates and forwards only whitelisted read methods", async () => {
  const calls = [], token = "test-local-operator-".repeat(4);
  const server = await startRelay({ token, rpcUrl: "https://api.mainnet-beta.solana.com", port: 0, transport: async (url, init) => { calls.push({ url, init }); return Response.json({ result: "read-only" }); } });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${url}/rpc`, { method: "POST", body: "{}" })).status, 401);
    const options = { method: "POST", headers: { "x-tenx-local-relay": token }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: [] }) };
    assert.equal((await fetch(`${url}/rpc`, options)).status, 200);
    assert.equal(calls[0].url, "https://api.mainnet-beta.solana.com/"); assert.equal(calls[0].init.redirect, "manual");
    for (const method of ["sendTransaction", "requestAirdrop", "simulateTransaction"]) {
      assert.equal((await fetch(`${url}/rpc`, { ...options, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params: [] }) })).status, 400);
    }
    assert.equal((await fetch(`${url}/https://evil.example`, { headers: { "x-tenx-local-relay": token } })).status, 404);
    assert.equal(calls.length, 1);
    assert.equal((await fetch(`${url}/market/pools/So11111111111111111111111111111111111111112`, { headers: { "x-tenx-local-relay": token } })).status, 200);
    assert.equal(calls[1].url, "https://api.geckoterminal.com/api/v2/networks/solana/pools/So11111111111111111111111111111111111111112");
    assert.equal((await fetch(`${url}/rpc`, { ...options, body: "x".repeat(33_000) })).status, 413);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
