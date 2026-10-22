import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { key } from "./wallet-fixtures.test-helper";
import { shortlistDescriptor, normalizeShortlist } from "./shortlist-query-contract";
import { runShortlistQuery } from "./shortlist-query";
import { GMGN_USE_AUTHORITY } from "./gmgn-model";
import { readSourceReceipt } from "./source-collection-transport";
import worker from "./worker";

const at = new Date("2026-10-22T12:00:00.000Z"), address = key(7), other = key(8), opened: DatabaseSync[] = [];
const request = { kind: "gmgn_market_rank", interval: "24h", min_age_hours: 24, max_age_hours: 48 };
const response = { code: 0, data: { rank: [{ address, symbol: "TEST", market_cap: "200000", liquidity: "30000", volume: "90000", open_timestamp: at.getTime() / 1000 - 90000, is_wash_trading: false, top_10_holder_rate: "0.2" }] } };
afterEach(() => { opened.splice(0).forEach(d => d.close()); vi.restoreAllMocks(); });
function setup() {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  return { sqlite, db: sqliteD1(sqlite) };
}
it("pins list hosts, counts and CLI-compatible repeated filters without credentials or arbitrary URLs", () => {
  const url = new URL(shortlistDescriptor(request).url);
  expect(url.origin + url.pathname).toBe("https://openapi.gmgn.ai/v1/market/rank");
  expect(url.searchParams.getAll("filters")).toEqual(["renounced", "frozen", "is_out_market"]);
  expect(url.searchParams.get("min_created")).toBe("24h"); expect(url.searchParams.get("limit")).toBe("100");
  expect(new URL(shortlistDescriptor({ kind: "geckoterminal_trending_list", duration: "24h" }).url).hostname).toBe("api.geckoterminal.com");
  for (const bad of [{ ...request, url: "https://evil.test" }, { ...request, interval: "1s" }, { ...request, min_age_hours: 48, max_age_hours: 24 }, { kind: "dexscreener_token_crosscheck", addresses: [address, address] }, { kind: "geckoterminal_trending_list", duration: "24h", page: 3 }]) expect(() => shortlistDescriptor(bad)).toThrow();
});
it("keeps absent numeric/boolean risk data unknown and FDV separate from market cap", () => {
  const observation = normalizeShortlist(request, response, at.toISOString());
  expect(observation.rows[0]).toMatchObject({ market_cap_usd: 200000, wash_flag: false, top10_ratio: .2, rug_ratio: null, mint_disabled: null });
  expect(observation).toMatchObject({ exhaustive: false, graduation_verified: false, organic_volume_certified: false, scoring_effect: "none" });
  const missing = normalizeShortlist(request, { code: 0, data: { rank: [{ address, fdv: 1000000, top_10_holder_rate: 30, liquidity: "NaN" }] } }, at.toISOString()).rows[0]!;
  expect(missing).toMatchObject({ market_cap_usd: null, fdv_usd: 1000000, top10_ratio: null, liquidity_usd: null, wash_flag: null });
});
it("rejects oversized/application-error lists and records foreign/future rows without admitting them", () => {
  expect(() => normalizeShortlist(request, { code: 0, data: { rank: Array(101).fill({ address }) } }, at.toISOString())).toThrow();
  expect(() => normalizeShortlist(request, { code: 403, data: { rank: [] } }, at.toISOString())).toThrow();
  const rows = normalizeShortlist(request, { code: 0, data: { rank: [{ address: "bad" }, { address, open_timestamp: at.getTime() / 1000 + 1 }] } }, at.toISOString());
  expect(rows.rows).toEqual([]); expect(rows.rejected).toHaveLength(2);
  expect(normalizeShortlist({ kind: "dexscreener_token_crosscheck", addresses: [address] }, [{ chainId: "solana", baseToken: { address: other } }], at.toISOString()).rejected).toHaveLength(1);
});
it("validates both envelopes on the live market route and rejects inner business errors", () => {
  expect(normalizeShortlist(request, { code: 0, data: response }, at.toISOString()).rows).toHaveLength(1);
  expect(() => normalizeShortlist(request, { code: 0, data: { code: 403, data: response.data } }, at.toISOString())).toThrow("gmgn_application_error");
  expect(() => normalizeShortlist(request, { code: 0, data: { code: 0, data: response } }, at.toISOString())).toThrow();
});
it("binds Gecko base-token identity and preserves DEX market-cap, signed changes and missing risk fields", () => {
  const gecko = normalizeShortlist({kind:"geckoterminal_trending_list",duration:"6h"}, {data:[{attributes:{address:other,reserve_in_usd:"25000",fdv_usd:"200000",volume_usd:{h24:"100000"},price_change_percentage:{h1:"-12"}},relationships:{base_token:{data:{id:`solana_${address}`}}}}],included:[{id:`solana_${address}`,attributes:{symbol:"BASE"}}]}, at.toISOString());
  expect(gecko.rows[0]).toMatchObject({address,symbol:"BASE",pool:other,market_cap_usd:null,fdv_usd:200000,change_1h_pct:-12,wash_flag:null});
  const dex = normalizeShortlist({kind:"dexscreener_token_crosscheck",addresses:[address]}, [{chainId:"solana",baseToken:{address},pairAddress:other,marketCap:100000,liquidity:{usd:25000},priceChange:{h1:-4,h24:12}}], at.toISOString());
  expect(dex.rows[0]).toMatchObject({address,pool:other,market_cap_usd:100000,change_1h_pct:-4,change_24h_pct:12,top10_ratio:null});
});
it("charges once, retains a replayable receipt, and never writes candidates, proofs or scores", async () => {
  const { db, sqlite } = setup(), input = { request_id: crypto.randomUUID(), reason: "Explicit shortlist query", request };
  const fetcher = vi.fn(async () => Response.json(response)), settings = { db, apiKey: "synthetic-query-key", permissionReference: GMGN_USE_AUTHORITY, marketDailyLimit: 600 };
  const result = await runShortlistQuery(settings, input, fetcher, () => at);
  expect(result).toMatchObject({ state: "retained", provider_requests: 1, observation: { returned: 1 } });
  expect(fetcher).toHaveBeenCalledTimes(1); expect(await readSourceReceipt(db, input.request_id)).toMatchObject({ replay: "verified" });
  expect(await runShortlistQuery(settings, input, fetcher, () => at)).toMatchObject({ state: "held", provider_requests: 0 });
  expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='market'").get()).toEqual({ used: 1 });
  for (const table of ["tenx_candidates", "tenx_proofs", "tenx_score_cohorts"]) expect(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
});
it("charges rejected provider business responses while withholding their bodies and messages", async () => {
  const {db,sqlite}=setup(), input={request_id:crypto.randomUUID(),reason:"Inspect business failure",request};
  const result=await runShortlistQuery({db,apiKey:"synthetic-query-key",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600},input,async()=>Response.json({code:0,data:{code:403,msg:"untrusted private provider message",data:{rank:[]}}}),()=>at);
  expect(result).toMatchObject({state:"failed",provider_requests:1,observation:null,diagnostic:{failure_kind:"gmgn_application_error"}});
  const saved=await readSourceReceipt(db,input.request_id);
  expect(saved?.receipt.response).toBeNull();expect(JSON.stringify(saved)).not.toContain("untrusted private provider message");
  expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='market'").get()).toEqual({used:1});
});
it("preserves pause, pacing, daily exhaustion, provider backoff and failed-attempt charges", async () => {
  const { db, sqlite } = setup(), settings = { db, apiKey: "synthetic-query-key", permissionReference: GMGN_USE_AUTHORITY, marketDailyLimit: 1 }, fetcher = vi.fn(async () => Response.json({ reset_at: at.getTime() / 1000 + 300 }, { status: 429 }));
  const input = () => ({ request_id: crypto.randomUUID(), reason: "Explicit shortlist query", request });
  sqlite.exec("UPDATE tenx_control SET paused=1"); expect(await runShortlistQuery(settings, input(), fetcher, () => at)).toMatchObject({ provider_requests: 0 });
  sqlite.exec("UPDATE tenx_control SET paused=0"); expect(await runShortlistQuery(settings, input(), fetcher, () => at)).toMatchObject({ state: "failed", provider_requests: 1 });
  expect(await runShortlistQuery(settings, input(), fetcher, () => new Date(at.getTime() + 1000))).toMatchObject({ provider_requests: 0 });
  expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='market'").get()).toEqual({ used: 1 }); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(sqlite.prepare("SELECT backoff_until FROM tenx_source_transport_control").get()).toEqual({ backoff_until: "2026-10-22T12:05:00.000Z" });
});
it("requires existing admin authentication for live experiments", async () => {
  const { db } = setup(), fetcher = vi.spyOn(globalThis, "fetch");
  const result = await worker.fetch(new Request("http://localhost/api/10x/admin/discovery/shortlist-query", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { TENX_LOCAL_ONLY: "true", TENX_DB: db, TENX_ADMIN_TOKEN: "a".repeat(64) } as Parameters<typeof worker.fetch>[1]);
  expect(result.status).toBe(401); expect(fetcher).not.toHaveBeenCalled();
});
