import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { STONKLETS_BY_ID } from "./shared/stonkletsCatalog";
import { parseStonkletChangeRange } from "./shared/stonkletsTime";

const ORIGIN = "https://stonklet.10x.meme";
const RETAIN_MS = 24 * 3600_000;
type Payload = Record<string, any>;
type Snapshot = { copiedAt: number; payload: Payload };
type Query = { key: string; kind: "market" | "chart"; ttl: number; pair?: string };
export function productionMarketQuery(url: URL): Query | null {
  const kind = url.pathname === "/api/stonklets/market" ? "market" : url.pathname === "/api/stonklets/chart" ? "chart" : null;
  if (!kind) return null;
  const range = parseStonkletChangeRange(url.searchParams.get("range") ?? url.searchParams.get("change") ?? "24h");
  if (!range || url.searchParams.get("flap") === "1" || url.searchParams.has("source")) throw new Error("Invalid range or unsupported local Flap preview");
  if (kind === "market") {
    const pair = url.searchParams.get("id") ?? undefined;
    if (pair && !STONKLETS_BY_ID.has(pair)) throw new Error("Unknown stock");
    // One full board cache per range, including requests for individual stocks.
    return { kind, key: `/api/stonklets/market?range=${range}`, ttl: 5 * 60_000, pair };
  }
  const pair = url.searchParams.get("pair") ?? "", asset = url.searchParams.get("asset");
  if (!STONKLETS_BY_ID.has(pair) || !["stock", "stonklet"].includes(asset ?? "")) throw new Error("Invalid chart identity");
  return { kind, key: `/api/stonklets/chart?v=2&pair=${pair}&asset=${asset}&range=${range}`, ttl: 15 * 60_000 };
}
function validPayload(value: Payload, query: Query): boolean {
  if (!value || typeof value !== "object") return false;
  if (query.kind === "market") return Array.isArray(value.entries) && value.entries.length > 0 && value.entries.every((entry: any) => STONKLETS_BY_ID.has(entry.id) && entry.stockMetrics && entry.stonkletMetrics);
  const params = new URL(query.key, ORIGIN).searchParams;
  return value.pair === params.get("pair") && value.asset === params.get("asset") && Array.isArray(value.points) && value.points.length >= 2;
}
/** Development-only public-data mirror. Never forwards cookies, credentials or writes. */
export function createLocalMarketMirror(options: { cacheDir?: string; fetcher?: typeof fetch; now?: () => number } = {}) {
  const directory = options.cacheDir ?? fileURLToPath(new URL("./node_modules/.cache/stonklets-market-production/", import.meta.url));
  const fetcher = options.fetcher ?? fetch, now = options.now ?? Date.now;
  const cache = new Map<string, Snapshot>(), pending = new Map<string, Promise<Snapshot>>(), retryAt = new Map<string, number>();
  let active = 0;
  const waiting: Array<() => void> = [];
  const path = (key: string) => join(directory, `${createHash("sha256").update(key).digest("hex")}.json`);
  async function refresh(query: Query): Promise<Snapshot> {
    const existing = pending.get(query.key);
    if (existing) return existing;
    if ((retryAt.get(query.key) ?? 0) > now() || pending.size >= 128) throw new Error("Production mirror retry pending");
    const job = (async () => {
      if (active >= 3) await new Promise<void>(resolve => waiting.push(resolve));
      else active++;
      try {
        const response = await fetcher(ORIGIN + query.key, { signal: AbortSignal.timeout(20_000), redirect: "error", headers: { accept: "application/json" } });
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error(`Production market HTTP ${response.status}`);
        if (Number(response.headers.get("content-length")) > 5_000_000) throw new Error("Oversized production response");
        const reader = response.body!.getReader(); let size = 0; const chunks: Uint8Array[] = [];
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 5_000_000) { await reader.cancel(); throw new Error("Oversized production response"); } chunks.push(value); }
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!validPayload(payload, query)) throw new Error("Invalid production market payload");
        const snapshot = { copiedAt: now(), payload }; cache.set(query.key, snapshot);
        try { await mkdir(directory, { recursive: true }); const file = path(query.key), temp = `${file}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(snapshot)); await rename(temp, file); } catch { /* Memory cache remains usable on read-only filesystems. */ }
        return snapshot;
      } finally { const next = waiting.shift(); if (next) next(); else active--; }
    })().catch(error => { retryAt.set(query.key, now() + 60_000); throw error; }).finally(() => pending.delete(query.key));
    pending.set(query.key, job); return job;
  }
  return async (query: Query): Promise<Payload & { localMirror: { origin: string; copiedAt: string; stale: boolean } }> => {
    let snapshot = cache.get(query.key);
    if (!snapshot) try { const saved = JSON.parse(await readFile(path(query.key), "utf8")); if (Number.isFinite(saved.copiedAt) && saved.copiedAt <= now() && now() - saved.copiedAt < RETAIN_MS && validPayload(saved.payload, query)) { snapshot = saved; cache.set(query.key, saved); } } catch { /* Cold start or corrupt cache. */ }
    if (!snapshot || now() - snapshot.copiedAt >= RETAIN_MS) snapshot = await refresh(query);
    else if (now() - snapshot.copiedAt >= query.ttl) void refresh(query).catch(() => undefined);
    const staleCopy = now() - snapshot.copiedAt >= query.ttl;
    const payload = structuredClone(snapshot.payload);
    if (query.kind === "market") {
      if (query.pair) payload.entries = payload.entries.filter((entry: any) => entry.id === query.pair);
      if (staleCopy) {
        payload.stale = true;
        for (const entry of payload.entries) for (const key of ["stockMetrics", "stonkletMetrics"]) if (entry[key]?.status === "live") entry[key].status = "stale";
      }
    } else if (staleCopy) payload.status = "stale";
    // Keep provider observation timestamps unchanged, including during outages.
    return { ...payload, localMirror: { origin: ORIGIN, copiedAt: new Date(snapshot.copiedAt).toISOString(), stale: staleCopy } };
  };
}
export function localStonkletsMarket(): Plugin {
  const read = createLocalMarketMirror();
  return { name: "stonklets-local-production-market", apply: "serve", configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (!["/api/stonklets/market", "/api/stonklets/chart"].includes(url.pathname)) return next();
      response.setHeader("content-type", "application/json"); response.setHeader("cache-control", "no-store");
      if (request.method !== "GET") { response.statusCode = 405; response.setHeader("allow", "GET"); response.end(JSON.stringify({ error: "Read-only local production mirror" })); return; }
      let query: Query;
      try { query = productionMarketQuery(url)!; } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: String(error) })); return; }
      void read(query).then(payload => { response.setHeader("x-stonklets-data-source", "production-mirror"); response.end(JSON.stringify(payload)); }).catch(() => {
        response.statusCode = 503; response.setHeader("retry-after", "60"); response.end(JSON.stringify({ error: "Production market snapshot temporarily unavailable" }));
      });
    });
  } };
}
