import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { gmgnIpv4Fetch, gmgnRelayTarget } from "./discovery-gmgn-relay.mjs";
import { startRelay } from "./discovery-relay.mjs";
const address = "So11111111111111111111111111111111111111112";
const query = now => `chain=sol&address=${address}&timestamp=${Math.floor(now / 1000)}&client_id=00000000-0000-4000-8000-000000000001`;

test("GMGN bridge accepts only fixed exact-mint Solana reads and bounded closed minute windows", () => {
  const now = Date.parse("2026-10-21T01:00:22.000Z"), base = `/gmgn/v1/token/info?${query(now)}`;
  assert.equal(new URL(gmgnRelayTarget(base, now)).hostname, "openapi.gmgn.ai");
  for (const bad of [base + "&url=https://evil.test", base + "&chain=sol", base.replace("chain=sol", "chain=eth"), base.replace("/token/info", "/trade/swap"), base.replace(address, "../../../private"), base.replace(/timestamp=\d+/, "timestamp=123"), "//evil.test"]) assert.equal(gmgnRelayTarget(bad, now), null);
  const end = Math.floor(now / 60_000) * 60_000;
  const candles = `/gmgn/v1/market/token_kline?${query(now)}&resolution=1m&from=${end - 21_600_000}&to=${end - 1}`;
  assert.ok(gmgnRelayTarget(candles, now));
  for (const bad of [candles.replace("resolution=1m", "resolution=1s"), candles.replace(`to=${end - 1}`, `to=${end}`), candles.replace(String(end - 21_600_000), String(end - 86_400_000))]) assert.equal(gmgnRelayTarget(bad, now), null);
});
test("HTTPS adapter pins IPv4, forwards cancellation and never disables TLS validation or follows redirects", async () => {
  const signal = AbortSignal.timeout(1000); let options;
  const result = await gmgnIpv4Fetch(`https://openapi.gmgn.ai/v1/token/info?${query(Date.now())}`, { method: "GET", headers: { "X-APIKEY": "test-query-key" }, signal }, (url, init, callback) => {
    options = init;
    const incoming = Readable.from([Buffer.from('{"code":0,"data":{}}')]); incoming.statusCode = 200; incoming.headers = { "content-type": "application/json", "set-cookie": "do-not-forward" };
    const outgoing = new EventEmitter(); outgoing.end = () => callback(incoming); return outgoing;
  });
  assert.equal(options.family, 4); assert.equal(options.method, "GET"); assert.equal(options.signal, signal); assert.equal(options.rejectUnauthorized, undefined);
  assert.equal(result.headers.has("set-cookie"), false); assert.deepEqual(await result.json(), { code: 0, data: {} });
  assert.throws(() => gmgnIpv4Fetch("https://evil.test/v1/token/info", {}));
  assert.throws(() => gmgnIpv4Fetch("https://openapi.gmgn.ai/v1/trade/swap", {}));
});

test("trader bridge pins one unfiltered top-100 buy-ranked query and rejects broader parameters",()=>{
  const now=Date.parse("2026-10-21T01:00:22.000Z"),target=`/gmgn/v1/market/token_top_traders?${query(now)}&limit=100&order_by=buy_volume_cur&direction=desc`;
  assert.ok(gmgnRelayTarget(target,now));
  for(const bad of [target.replace("limit=100","limit=101"),target.replace("direction=desc","direction=asc"),target.replace("order_by=buy_volume_cur","order_by=profit"),target+"&tag=smart_degen",target+"&limit=100",target+"&cursor=next"])assert.equal(gmgnRelayTarget(bad,now),null);
});
test("activity bridge requires both a wallet and exact token with one 20-row page",()=>{
  const now=Date.parse("2026-10-21T01:00:22.000Z"),target=`/gmgn/v1/user/wallet_activity?${query(now).replace(`address=${address}`,`wallet_address=${address}&token_address=${address}`)}&limit=20`;
  assert.ok(gmgnRelayTarget(target,now));
  for(const bad of [target.replace("limit=20","limit=21"),target.replace(`&token_address=${address}`,""),target+"&cursor=next",target+"&type=buy",target+"&limit=20"])assert.equal(gmgnRelayTarget(bad,now),null);
});
test("authenticated loopback bridge preserves rate-limit status/reset without forwarding local credentials", async () => {
  const token = "local-test-operator-".repeat(4), calls = [];
  const server = await startRelay({ token, rpcUrl: "https://api.mainnet-beta.solana.com", port: 0,
    gmgnTransport: async (url, init) => { calls.push({ url, init }); return Response.json({ code: 429, reset_at: 9999999999 }, { status: 429, headers: { "x-ratelimit-reset": "9999999999", "x-ratelimit-remaining": "0", "retry-after": "60" } }); },
    transport: async () => { throw new Error("wrong transport"); } });
  const base = `http://127.0.0.1:${server.address().port}`, target = `/gmgn/v1/token/info?${query(Date.now())}`;
  try {
    assert.equal((await fetch(base + target)).status, 401);
    const headers = { "x-tenx-local-relay": token, "x-tenx-gmgn-key": "test-gmgn-query-key" };
    const response = await fetch(base + target, { headers });
    assert.equal(response.status, 429); assert.equal(response.headers.get("x-ratelimit-reset"), "9999999999"); assert.equal((await response.json()).code, 429);
    assert.deepEqual(calls[0].init.headers, { accept: "application/json", "X-APIKEY": "test-gmgn-query-key" });
    assert.equal(calls[0].init.redirect, "manual");
    for (const path of [target + "&secret=bad", target.replace("token/info", "trade/swap")]) assert.equal((await fetch(base + path, { headers })).status, 400);
    assert.equal((await fetch(base + target, { headers, method: "POST" })).status, 404); assert.equal(calls.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
