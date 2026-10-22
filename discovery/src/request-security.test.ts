import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { API_HEADERS, adminJson, authorized, requireAdminBrowser, requireLocalReadBrowser } from "./request-security";
import worker, { type LocalEnv } from "./worker";

const token = "a".repeat(64);
const instances: DatabaseSync[] = [];
afterEach(() => { instances.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
const req = (headers: HeadersInit = {}, body?: BodyInit) => new Request("http://127.0.0.1:8794/api/10x/admin/rewards/lab", { method: body ? "POST" : "GET", headers, ...(body ? { body } : {}) });
it("requires the Bearer scheme and rejects combined, altered or weak credentials", () => {
  for (const header of [token, `Basic ${token}`, `Bearer ${token}, Bearer ${token}`, `Bearer ${token} extra`, `Bearer ${"b".repeat(64)}`, "Bearer ", ""]) expect(authorized(req({ authorization: header }), token)).toBe(false);
  for (const scheme of ["Bearer", "bearer", "BEARER"]) expect(authorized(req({ authorization: `${scheme} ${token}` }), token)).toBe(true);
  expect(authorized(req({ authorization: "Bearer short" }), "short")).toBe(false);
});
it("blocks foreign and null origins and cross-site metadata for private reads and writes", () => {
  for (const origin of ["https://evil.example", "https://app-local.10x.meme.evil.example", "null"]) expect(() => requireAdminBrowser(req({ origin }))).toThrow("origin_not_allowed");
  for (const site of ["cross-site", "same-site", "invalid"]) expect(() => requireAdminBrowser(req({ "sec-fetch-site": site }))).toThrow("admin_cross_site_request");
  const allowed: HeadersInit[] = [{}, { origin: "https://app-local.10x.meme", "sec-fetch-site": "same-origin" }, { "sec-fetch-site": "none" }];
  for (const headers of allowed) expect(() => requireAdminBrowser(req(headers))).not.toThrow();
});
it("rejects foreign-browser public reads, including embeds without Origin, before database work",async()=>{
  const db={prepare:vi.fn(()=>{throw Error("No database work allowed");})}as Pick<D1Database,"prepare">;
  const env={TENX_DB:db,TENX_LOCAL_ONLY:"true"}as LocalEnv;
  const path="http://localhost:8794/api/10x/gmgn/event-sample/10000000-0000-4000-8000-000000000001";
  const blocked:HeadersInit[]=[{origin:"https://evil.example"},{origin:"null"},{origin:"https://app-local.10x.meme.evil.example"},{"sec-fetch-site":"cross-site"},{"sec-fetch-site":"same-site"},{"sec-fetch-site":"invalid"}];
  for(const headers of blocked){
    const response=await worker.fetch(new Request(path,{headers}),env);expect(response.status).toBe(403);expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(db.prepare).not.toHaveBeenCalled();
  const allowed:HeadersInit[]=[{}, {"sec-fetch-site":"same-origin"},{"sec-fetch-site":"none"},{origin:"https://app-local.10x.meme","sec-fetch-site":"cross-site"},{origin:"http://localhost:5183","sec-fetch-site":"same-site"}];
  for(const headers of allowed)expect(()=>requireLocalReadBrowser(new Request(path,{headers}))).not.toThrow();
});
it("bounds streamed and advertised JSON bodies and rejects invalid JSON media types", async () => {
  await expect(adminJson(req({ "content-type": "application/json; charset=utf-8" }, '{"reason":"valid"}'))).resolves.toEqual({ reason: "valid" });
  for (const type of ["text/plain", "application/jsonx", "application/json-patch+json"]) await expect(adminJson(req({ "content-type": type }, "{}"))).rejects.toMatchObject({ status: 415 });
  await expect(adminJson(req({ "content-type": "application/json" }, "{"))).rejects.toMatchObject({ status: 400 });
  await expect(adminJson(req({ "content-type": "application/json", "content-length": "32001" }, "{}"))).rejects.toMatchObject({ status: 413 });
  const cancel = vi.fn(); let sent = false;
  const body = new ReadableStream({ pull(c) { if (!sent) { sent = true; c.enqueue(new Uint8Array(32001)); } }, cancel });
  const request = new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
  await expect(adminJson(request)).rejects.toMatchObject({ status: 413 }); expect(cancel).toHaveBeenCalledOnce();
});
it("returns protected errors before touching the database and sets security headers", async () => {
  const sql = new DatabaseSync(":memory:"); instances.push(sql);
  const db = sqliteD1(sql), prepare = vi.spyOn(db, "prepare").mockImplementation(() => { throw Error("No database access expected"); });
  const env: LocalEnv = { TENX_DB: db, TENX_LOCAL_ONLY: "true", TENX_NODE_RELAY: "false", TENX_ADMIN_TOKEN: token, TENX_RPC_URL: "https://api.mainnet-beta.solana.com", TENX_RPC_DAILY_LIMIT: "5000", TENX_MARKET_DAILY_LIMIT: "600", TENX_MARKET_PROVIDER: "dexscreener", TENX_QUALITY_ENABLED: "true", TENX_QUALITY_RPC_DAILY_LIMIT: "1800", TENX_MARKET_ENABLED: "false", TENX_WALLET_ANALYSIS_ENABLED: "true", TENX_WALLET_RPC_DAILY_LIMIT: "800" };
  const cases: [Request, number][] = [
    [req({ authorization: token }), 401],
    [req({ authorization: `Bearer ${token}`, origin: "https://evil.example" }), 403],
    [req({ authorization: `Bearer ${token}`, "sec-fetch-site": "cross-site" }), 403],
    [req({ authorization: `Bearer ${token}`, "content-type": "application/jsonx" }, "{}"), 415],
    [req({ authorization: `Bearer ${token}`, "content-type": "application/json" }, "{"), 400],
    [req({ authorization: `Bearer ${token}`, "content-type": "application/json" }, "x".repeat(32001)), 413],
  ];
  for (const [request, status] of cases) { const r = await worker.fetch(request, env); expect(r.status).toBe(status); for (const [key, value] of Object.entries(API_HEADERS)) expect(r.headers.get(key)).toBe(value); }
  const fragmented=new Request("http://localhost:8794/api/10x/admin/rewards/lab",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:new ReadableStream({pull(c){c.enqueue(new Uint8Array());}},{highWaterMark:0}),duplex:"half"} as RequestInit);
  const held=await worker.fetch(fragmented,env);expect(held.status).toBe(413);expect(await held.json()).toEqual({error:"request_body_too_fragmented"});
  vi.useFakeTimers();const stalled=new Request("http://localhost:8794/api/10x/admin/rewards/lab",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:new ReadableStream({pull(){return new Promise<void>(()=>{});}}),duplex:"half"} as RequestInit),pending=worker.fetch(stalled,env);
  await vi.advanceTimersByTimeAsync(12000);const expired=await pending;expect(expired.status).toBe(408);expect(await expired.json()).toEqual({error:"request_body_timeout"});for(const [key,value]of Object.entries(API_HEADERS))expect(expired.headers.get(key)).toBe(value);vi.useRealTimers();
  expect(prepare).not.toHaveBeenCalled();
});
