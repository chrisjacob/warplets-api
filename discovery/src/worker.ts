import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Address, assess, CandidateSchema, DEFAULT_POLICY, PolicySchema, Signature, shortlist } from "./model";
import { ADAPTER_VERSION } from "./pump";
import { boundedJson } from "./rpc";
import { audit, candidates, control, dryRun, saveCandidate } from "./store";
import { fixtureCandidates } from "./fixtures";
import { runCycle } from "./ingest";
import { hashJson } from "./solana";

// Widen generated literal vars so ignored .dev.vars overrides stay type-safe.
export type LocalEnv = { [K in keyof Cloudflare.Env]: Cloudflare.Env[K] extends string ? string : Cloudflare.Env[K] };
type Env = LocalEnv;
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const origins = new Set(["https://app-local.10x.meme", "http://localhost:5183", "http://127.0.0.1:5183", "http://localhost:8794", "http://127.0.0.1:8794"]);
const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
function json(data: unknown, status = 200): Response { return Response.json(data, { status, headers }); }
function settings(env: Env) {
  const transport: typeof fetch | undefined = env.TENX_NODE_RELAY === "true" ? async (input, init) => {
    const target = new URL(String(input));
    const path = target.href === new URL(env.TENX_RPC_URL).href ? "/rpc" : target.hostname === "api.geckoterminal.com" && /^\/api\/v2\/networks\/solana\/pools\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(target.pathname) ? `/market/pools/${target.pathname.split("/").at(-1)}` : null;
    if (!path) throw new Error("relay_target_not_allowed");
    return fetch(`http://127.0.0.1:8795${path}`, { method: path === "/rpc" ? "POST" : "GET", headers: { "x-tenx-local-relay": env.TENX_ADMIN_TOKEN, "content-type": "application/json" }, ...(path === "/rpc" ? { body: init?.body } : {}), signal: init?.signal, redirect: "manual" });
  } : undefined;
  return {
    db: env.TENX_DB, rpcUrl: env.TENX_RPC_URL,
    rpcDailyLimit: z.coerce.number().int().min(1).max(10_000).parse(env.TENX_RPC_DAILY_LIMIT),
    marketDailyLimit: z.coerce.number().int().min(1).max(1000).parse(env.TENX_MARKET_DAILY_LIMIT),
    marketEnabled: env.TENX_MARKET_ENABLED === "true",
    transport,
  };
}
export function authorized(request: Request, token: string): boolean {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const expectedBytes = new TextEncoder().encode(token), suppliedBytes = new TextEncoder().encode(supplied);
  return expectedBytes.length >= 32 && suppliedBytes.length === expectedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}
async function envelope(env: Env, data: unknown, extra: Record<string, unknown> = {}) {
  const state = await control(env.TENX_DB);
  return {
    api_version: "10x-discovery-v1", trace_id: crypto.randomUUID(),
    as_of: state.last_success, served_at: new Date().toISOString(), policy_version: DEFAULT_POLICY.version,
    source_freshness: { last_harvest: state.last_harvest, last_success: state.last_success, stale: !state.last_success || Date.now() - Date.parse(state.last_success) > 180_000 },
    coverage: { scope: "bounded_pump_migration_authority_scan", exhaustive: false, history_limit: 3000, quote_support: "WSOL only", holder_classification: "unavailable", market_enabled: env.TENX_MARKET_ENABLED === "true" },
    data, ...extra,
  };
}
async function status(env: Env) {
  const state = await control(env.TENX_DB);
  const usage = await env.TENX_DB.prepare("SELECT provider,used FROM tenx_usage WHERE day=?1").bind(new Date().toISOString().slice(0, 10)).all();
  const count = await env.TENX_DB.prepare("SELECT count(*) AS count FROM tenx_pending_signatures WHERE processed_at IS NULL").first<{ count: number }>();
  return {
    local_only: true, paused: Boolean(state.paused), running: Boolean(state.lease_until && state.lease_until > new Date().toISOString()),
    last_error: state.last_error, retry_after: state.retry_after, pending_signatures: count?.count ?? 0,
    usage: usage.results, daily_limits: { rpc: Number(env.TENX_RPC_DAILY_LIMIT), market: Number(env.TENX_MARKET_DAILY_LIMIT) },
    adapter_version: ADAPTER_VERSION, policy: DEFAULT_POLICY,
    capabilities: { discovery: true, voting: false, launches: false, signing: false, rewards: false, social_publishing: false },
  };
}
export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (env.TENX_LOCAL_ONLY !== "true" || !loopback.has(url.hostname)) return json({ error: "local_runtime_required" }, 503);
  const path = url.pathname.replace(/\/+$/, "");
  const admin = path.startsWith("/api/10x/admin/");
  const method = request.method;
  if (admin && !authorized(request, env.TENX_ADMIN_TOKEN)) return json({ error: "admin_authentication_required" }, 401);
  if (method !== "GET" && method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (method === "POST" && request.headers.has("origin") && !origins.has(request.headers.get("origin")!)) return json({ error: "origin_not_allowed" }, 403);
  if (method === "POST" && !admin) return json({ error: "not_found" }, 404);
  if (method === "GET" && path === "/api/10x/health") return json({ local: true, ready: true });
  if (method === "GET" && path === "/api/10x/chains") return json(await envelope(env, [{ id: "solana", discover_enabled: true, vote_enabled: false, launch_enabled: false }]));
  if (method === "GET" && path === "/api/10x/system/status") return json(await envelope(env, await status(env)));
  if (method === "GET" && path === "/api/10x/transparency/policies") return json(await envelope(env, { policy: DEFAULT_POLICY, status: "proposed_local_policy", display_score: "liquidity descending, then creation timestamp, then address; not a voting score" }));
  if (method === "GET" && path === "/api/10x/candidates") {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      mode: z.enum(["live", "fixture"]).default("live"),
      status: z.enum(["all", "eligible", "provisional", "excluded"]).default("all"),
      cursor: z.string().max(300).optional(),
    }).strict().parse(Object.fromEntries(url.searchParams));
    const rows = shortlist(await candidates(env.TENX_DB, query.mode), DEFAULT_POLICY, new Date());
    const snapshot = await hashJson(rows);
    const filtered = query.status === "all" ? rows : rows.filter(c => c.eligibility === query.status);
    let offset = 0;
    if (query.cursor) {
      let decoded: unknown;
      try { decoded = JSON.parse(atob(query.cursor)); } catch { return json({ error: "invalid_cursor" }, 400); }
      const cursor = z.object({ snapshot: z.string(), offset: z.number().int().min(0).max(100), status: z.string(), mode: z.string() }).strict().parse(decoded);
      if (cursor.snapshot !== snapshot || cursor.status !== query.status || cursor.mode !== query.mode) return json({ error: "cursor_expired_refresh_required" }, 409);
      offset = cursor.offset;
    }
    const next = offset + query.limit;
    return json(await envelope(env, {
      candidates: filtered.slice(offset, next), mode: query.mode,
      counts: { eligible: rows.filter(c => c.eligibility === "eligible").length, provisional: rows.filter(c => c.eligibility === "provisional").length, excluded: rows.filter(c => c.eligibility === "excluded").length },
    }, { next_cursor: next < filtered.length ? btoa(JSON.stringify({ snapshot, offset: next, status: query.status, mode: query.mode })) : null }));
  }
  const detail = path.match(/^\/api\/10x\/candidates\/solana\/([^/]+)$/);
  if (method === "GET" && detail) {
    const address = Address.parse(detail[1]);
    const mode = z.enum(["live", "fixture"]).parse(url.searchParams.get("mode") ?? "live");
    const stored = await env.TENX_DB.prepare("SELECT payload FROM tenx_candidates WHERE address=?1 AND mode=?2").bind(address, mode).first<{ payload: string }>();
    if (!stored) return json({ error: "candidate_not_found" }, 404);
    const candidate = assess(CandidateSchema.parse(JSON.parse(stored.payload)), DEFAULT_POLICY, new Date());
    return json(await envelope(env, candidate));
  }
  const evidence = path.match(/^\/api\/10x\/evidence\/([^/]+)$/);
  if (method === "GET" && evidence) {
    const signature = Signature.parse(evidence[1]);
    const row = await env.TENX_DB.prepare("SELECT payload_hash,payload,fetched_at FROM tenx_evidence WHERE signature=?1").bind(signature).first<{ payload_hash: string; payload: string; fetched_at: string }>();
    return row ? json(await envelope(env, { ...row, payload: JSON.parse(row.payload) })) : json({ error: "evidence_not_found" }, 404);
  }
  const accountEvidence = path.match(/^\/api\/10x\/account-evidence\/([a-f0-9]{64})$/);
  if (method === "GET" && accountEvidence) {
    const row = await env.TENX_DB.prepare("SELECT address,slot,payload,observed_at FROM tenx_account_evidence WHERE payload_hash=?1").bind(accountEvidence[1]!).first<{ address: string; slot: number; payload: string; observed_at: string }>();
    return row ? json(await envelope(env, { ...row, payload_hash: accountEvidence[1], payload: JSON.parse(row.payload) })) : json({ error: "evidence_not_found" }, 404);
  }
  if (method === "GET" && path === "/api/10x/admin/jobs") {
    const jobs = await env.TENX_DB.prepare("SELECT * FROM tenx_jobs ORDER BY started_at DESC LIMIT 30").all();
    const runs = await env.TENX_DB.prepare("SELECT id,input_hash,created_at FROM tenx_dry_runs ORDER BY created_at DESC LIMIT 10").all();
    return json(await envelope(env, { ...await status(env), jobs: jobs.results, dry_runs: runs.results }));
  }
  if (method === "POST" && admin) {
    if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "json_required" }, 415);
    const body = await boundedJson(new Response(request.body), 32_000);
    const reason = z.object({ reason: z.string().min(3).max(300) }).passthrough().parse(body).reason;
    if (path === "/api/10x/admin/refresh") {
      await audit(env.TENX_DB, "refresh_requested", reason, {});
      return json(await runCycle(settings(env)));
    }
    if (path === "/api/10x/admin/pause") {
      const paused = z.object({ paused: z.boolean() }).passthrough().parse(body).paused;
      await audit(env.TENX_DB, paused ? "pause" : "resume", reason, { paused });
      await env.TENX_DB.prepare("UPDATE tenx_control SET paused=?1 WHERE id=1").bind(paused ? 1 : 0).run();
      return json({ paused });
    }
    if (path === "/api/10x/admin/seed-fixtures") {
      for (const candidate of await fixtureCandidates()) await saveCandidate(env.TENX_DB, candidate);
      await audit(env.TENX_DB, "seed_fixtures", reason, { mode: "fixture" });
      return json({ mode: "fixture", seeded: 4 });
    }
    if (path === "/api/10x/admin/dry-run") {
      const result = await dryRun(env.TENX_DB, new Date());
      await audit(env.TENX_DB, "election_dry_run", reason, result);
      return json(result);
    }
    if (path === "/api/10x/admin/policies/preview") {
      const policy = PolicySchema.parse(z.object({ policy: z.unknown() }).passthrough().parse(body).policy);
      const preview = shortlist(await candidates(env.TENX_DB), policy, new Date());
      return json({ activated: false, policy, candidates: preview, live_policy: DEFAULT_POLICY });
    }
  }
  return json({ error: "not_found" }, 404);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await handle(request, env); }
    catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "invalid_request_or_data" }, 400);
      console.error(JSON.stringify({ event: "tenx_request_failed", trace_id: crypto.randomUUID() }));
      return json({ error: "discovery_unavailable" }, 503);
    }
  },
} satisfies ExportedHandler<Env>;
