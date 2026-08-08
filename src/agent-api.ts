import type { Hono } from "hono";

export interface AgentApiEnv {
  WARPLETS: D1Database;
  WARPLETS_APP_ORIGIN?: string;
  X402_ENABLED?: string;
  X402_NETWORK?: string;
  X402_ASSET?: string;
  X402_PAY_TO?: string;
  X402_PRICE_USDC?: string;
  X402_FACILITATOR_URL?: string;
  BOT_SERVICE_TOKEN?: string;
}

type ApiContext = {
  env: AgentApiEnv;
  req: {
    method: string;
    path: string;
    url: string;
    query(name: string): string | undefined;
    param(name: string): string;
    header(name: string): string | undefined;
    json<T>(): Promise<T>;
    raw: Request;
  };
  executionCtx?: ExecutionContext;
};

type ApiCredential = {
  id: string;
  wallet_address: string;
  scopes_json: string;
};

type ApiEnvelope<T> = {
  ok: true;
  data: T;
  meta: {
    requestId: string;
    timestamp: string;
    stale: boolean;
    nextCursor?: string;
  };
};

const TRAIT_COLUMNS = [
  "x10_level",
  "cast_level",
  "fid_level",
  "follower_level",
  "holder_level",
  "luck_level",
  "minter_level",
  "neynar_level",
  "nft_level",
  "token_level",
  "volume_level",
] as const;

const WARPLET_SELECT = `
  token_id, name, description, opensea_url, image_url, animation_url,
  x10_level, x10_rank, x10_rarity,
  cast_level, fid_level, follower_level, holder_level, luck_level,
  minter_level, neynar_level, nft_level, token_level, volume_level,
  warplet_colours, warplet_keywords, warplet_traits,
  warplet_username_farcaster, warplet_username_x, warplet_wallet,
  avif_url, jpg_url, png_url, webp_url, external_url
`;

const contextRequestIds = new WeakMap<object, string>();

function nowIso(): string {
  return new Date().toISOString();
}

function requestId(c: ApiContext): string {
  const existing = contextRequestIds.get(c as object);
  if (existing) return existing;
  const next = c.req.header("x-request-id")?.slice(0, 128) || crypto.randomUUID();
  contextRequestIds.set(c as object, next);
  return next;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function jsonWithEtag(
  c: ApiContext,
  payload: unknown,
  status = 200,
  extraHeaders: HeadersInit = {},
): Promise<Response> {
  const body = JSON.stringify(payload);
  const etag = `"${(await sha256Hex(body)).slice(0, 32)}"`;
  if (status === 200 && c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, ...extraHeaders } });
  }
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? "public, max-age=30, stale-while-revalidate=120" : "no-store",
      "x-request-id": requestId(c),
      ETag: etag,
      ...extraHeaders,
    },
  });
}

async function success<T>(
  c: ApiContext,
  data: T,
  options: { stale?: boolean; nextCursor?: string; status?: number; cache?: string } = {},
): Promise<Response> {
  const payload: ApiEnvelope<T> = {
    ok: true,
    data,
    meta: {
      requestId: requestId(c),
      timestamp: nowIso(),
      stale: options.stale ?? false,
      ...(options.nextCursor ? { nextCursor: options.nextCursor } : {}),
    },
  };
  return jsonWithEtag(c, payload, options.status ?? 200, options.cache ? { "cache-control": options.cache } : {});
}

function failure(
  c: ApiContext,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code, message, ...(details === undefined ? {} : { details }) },
      meta: { requestId: requestId(c), timestamp: nowIso() },
    }),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-request-id": requestId(c),
      },
    },
  );
}

function intParam(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function encodeCursor(tokenId: number): string {
  return btoa(String(tokenId)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(cursor: string | undefined): number | null {
  if (!cursor) return null;
  try {
    const normalized = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = Number.parseInt(atob(normalized), 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function credentialFor(c: ApiContext, requiredScope: string): Promise<ApiCredential | null> {
  const serviceIdentity = await verifiedServiceIdentity(c);
  if (serviceIdentity) {
    const link = await c.env.WARPLETS.prepare(
      `SELECT wallet_address FROM external_identity_links
        WHERE provider = ? AND provider_user_id = ? AND wallet_address IS NOT NULL
        LIMIT 1`,
    ).bind(serviceIdentity.provider, serviceIdentity.providerUserId).first<{ wallet_address: string }>();
    if (!link?.wallet_address) return null;
    return { id: `service:${serviceIdentity.provider}:${serviceIdentity.providerUserId}`, wallet_address: link.wallet_address, scopes_json: '["*"]' };
  }
  const authorization = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(10x_[A-Za-z0-9_-]{24,})$/i.exec(authorization.trim());
  if (!match) return null;
  const tokenHash = await sha256Hex(match[1]);
  const credential = await c.env.WARPLETS.prepare(
    `SELECT id, wallet_address, scopes_json
       FROM api_credentials
      WHERE token_hash = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      LIMIT 1`,
  )
    .bind(tokenHash, nowIso())
    .first<ApiCredential>();
  if (!credential) return null;
  let scopes: string[] = [];
  try {
    const parsed = JSON.parse(credential.scopes_json);
    if (Array.isArray(parsed)) scopes = parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return null;
  }
  if (!scopes.includes("*") && !scopes.includes(requiredScope)) return null;
  await c.env.WARPLETS.prepare("UPDATE api_credentials SET last_used_at = ? WHERE id = ?")
    .bind(nowIso(), credential.id)
    .run();
  return credential;
}

async function verifiedServiceIdentity(c: ApiContext): Promise<{ provider: "telegram" | "discord"; providerUserId: string } | null> {
  const configured = c.env.BOT_SERVICE_TOKEN?.trim() ?? "";
  const provided = c.req.header("x-10x-service-token")?.trim() ?? "";
  if (configured.length < 32 || provided.length !== configured.length) return null;
  const [configuredHash, providedHash] = await Promise.all([sha256Hex(configured), sha256Hex(provided)]);
  if (configuredHash !== providedHash) return null;
  const provider = c.req.header("x-10x-provider")?.trim();
  const providerUserId = c.req.header("x-10x-provider-user-id")?.trim() ?? "";
  if ((provider !== "telegram" && provider !== "discord") || !providerUserId || providerUserId.length > 128) return null;
  return { provider, providerUserId };
}

export function parseTokenIds(raw: string | null | undefined): number[] {
  try {
    const value = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((item): item is number => Number.isInteger(item) && item >= 0 && item <= 9999))].sort(
      (a, b) => a - b,
    );
  } catch {
    return [];
  }
}

async function readFavouriteIds(db: D1Database, wallet: string): Promise<number[]> {
  const row = await db.prepare("SELECT token_ids FROM warplet_favourites WHERE wallet = ? LIMIT 1")
    .bind(wallet.toLowerCase())
    .first<{ token_ids: string }>();
  return parseTokenIds(row?.token_ids);
}

async function writeFavouriteIds(db: D1Database, wallet: string, ids: number[]): Promise<void> {
  await db.prepare(
    `INSERT INTO warplet_favourites (wallet, token_ids) VALUES (?, ?)
     ON CONFLICT(wallet) DO UPDATE SET token_ids = excluded.token_ids`,
  )
    .bind(wallet.toLowerCase(), JSON.stringify(ids))
    .run();
}

function warpletsAppOrigin(env: AgentApiEnv): string {
  return (env.WARPLETS_APP_ORIGIN?.trim() || "https://warplet.10x.meme").replace(/\/$/, "");
}

async function proxyWarpletsAppApi(c: ApiContext, path: string, init?: RequestInit): Promise<Response> {
  const incoming = new URL(c.req.url);
  const target = new URL(path, `${warpletsAppOrigin(c.env)}/`);
  target.search = incoming.search;
  const upstream = await fetch(target, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await upstream.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    return failure(c, 502, "UPSTREAM_INVALID_JSON", "The Search API returned an invalid response.");
  }
  if (!upstream.ok) {
    return failure(c, upstream.status, "UPSTREAM_ERROR", "The Search API could not complete the request.", parsed);
  }
  return success(c, parsed, {
    stale: Boolean(parsed && typeof parsed === "object" && "stale" in parsed && (parsed as { stale?: unknown }).stale),
    cache: init?.method === "POST" ? "no-store" : "public, max-age=30, stale-while-revalidate=120",
  });
}

function openApiDocument(origin: string): Record<string, unknown> {
  const read = (summary: string) => ({ summary, responses: { "200": { description: "Successful response" } } });
  return {
    openapi: "3.1.0",
    info: {
      title: "10X Warplets Agent API",
      version: "1.0.0",
      description: "Read collection data and stats, manage scoped favourites and alerts, and create share snapshots.",
    },
    servers: [{ url: origin }],
    paths: {
      "/v1/warplets": { get: read("Search and filter Warplets") },
      "/v1/warplets/{tokenId}": { get: read("Get one Warplet") },
      "/v1/traits": { get: read("List trait levels and counts") },
      "/v1/stats/overview": { get: read("Get collection overview") },
      "/v1/stats/market": { get: read("Get Price, Floor Price, Volume, Listings, Offers and Sales market stats and chart series") },
      "/v1/stats/activity": { get: read("Get collection activity") },
      "/v1/stats/holders": { get: read("Get holder rankings") },
      "/v1/stats/shares": { post: read("Create a Stats share snapshot") },
      "/v1/me/favourites": { get: read("List favourites"), delete: read("Clear favourites") },
      "/v1/me/favourites/{tokenId}": { put: read("Add a favourite"), delete: read("Remove a favourite") },
      "/v1/me/alerts": { get: read("List alert preferences"), put: read("Update alert preferences") },
      "/v1/paid/stats-report": { post: { summary: "Generate the x402-protected stats report", responses: { "200": { description: "Paid report" }, "402": { description: "Payment required" } } } },
    },
    components: {
      securitySchemes: { personalToken: { type: "http", scheme: "bearer", bearerFormat: "10x personal API token" } },
    },
  };
}

export function paymentRequirements(env: AgentApiEnv): Record<string, unknown> {
  const network = env.X402_NETWORK?.trim() || "eip155:84532";
  const defaultAsset = network === "eip155:8453"
    ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    : "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  return {
    scheme: "exact",
    network,
    amount: env.X402_PRICE_USDC?.trim() || "10000",
    asset: env.X402_ASSET?.trim() || defaultAsset,
    payTo: env.X402_PAY_TO?.trim() || "",
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  };
}

async function paidStatsReport(c: ApiContext): Promise<Response> {
  if (c.env.X402_ENABLED !== "true") {
    return failure(c, 503, "X402_DISABLED", "The paid Stats report pilot is not enabled in this environment.");
  }
  const requirements = paymentRequirements(c.env);
  if (!requirements.payTo) {
    return failure(c, 503, "X402_NOT_CONFIGURED", "The x402 payment recipient is not configured.");
  }
  const payment = c.req.header("payment-signature") || c.req.header("x-payment");
  const challenge = { x402Version: 2, error: "Payment required", accepts: [requirements] };
  if (!payment) {
    return new Response(JSON.stringify(challenge), {
      status: 402,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "payment-required": btoa(JSON.stringify(challenge)),
        "cache-control": "no-store",
        "x-request-id": requestId(c),
      },
    });
  }
  const facilitator = c.env.X402_FACILITATOR_URL?.trim()?.replace(/\/$/, "");
  if (!facilitator) {
    return failure(c, 503, "X402_FACILITATOR_MISSING", "Payment verification is not configured.");
  }
  const paymentHash = await sha256Hex(payment);
  const idempotencyKey = (c.req.header("idempotency-key") || paymentHash).slice(0, 200);
  const existing = await c.env.WARPLETS.prepare(
    "SELECT settlement_json, status FROM x402_receipts WHERE idempotency_key = ? LIMIT 1",
  )
    .bind(idempotencyKey)
    .first<{ settlement_json: string | null; status: string }>();
  if (existing?.status === "settled") {
    return generateStatsReport(c, { receipt: existing.settlement_json ? JSON.parse(existing.settlement_json) : null, replayed: true });
  }

  const receiptId = crypto.randomUUID();
  const reserved = await c.env.WARPLETS.prepare(
    `INSERT OR IGNORE INTO x402_receipts (
       id, resource, idempotency_key, network, asset, amount, payment_hash,
       status, created_at
     ) VALUES (?, 'stats-report', ?, ?, ?, ?, ?, 'verifying', ?)`,
  ).bind(
    receiptId,
    idempotencyKey,
    String(requirements.network),
    String(requirements.asset),
    String(requirements.amount),
    paymentHash,
    nowIso(),
  ).run();
  if (!reserved.meta.changes) {
    return failure(c, 409, "X402_PAYMENT_IN_PROGRESS", "This idempotency key has already been reserved. Retry with the same key after the original request completes.");
  }

  const paymentPayload = (() => {
    try {
      return JSON.parse(atob(payment));
    } catch {
      return payment;
    }
  })();
  let verifyResponse: Response;
  try {
    verifyResponse = await fetch(`${facilitator}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload, paymentRequirements: requirements }),
    });
  } catch (error) {
    await c.env.WARPLETS.prepare("UPDATE x402_receipts SET status = 'verification_failed' WHERE id = ?")
      .bind(receiptId).run();
    return failure(c, 502, "X402_VERIFICATION_UNAVAILABLE", "The payment facilitator could not be reached.", error instanceof Error ? error.message : null);
  }
  const verification = await verifyResponse.json().catch(() => null) as Record<string, unknown> | null;
  if (!verifyResponse.ok || verification?.isValid === false) {
    await c.env.WARPLETS.prepare(
      "UPDATE x402_receipts SET status = 'rejected', verification_json = ? WHERE id = ?",
    ).bind(JSON.stringify(verification), receiptId).run();
    return failure(c, 402, "X402_PAYMENT_INVALID", "The payment could not be verified.", verification);
  }
  let settleResponse: Response;
  try {
    settleResponse = await fetch(`${facilitator}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload, paymentRequirements: requirements }),
    });
  } catch (error) {
    await c.env.WARPLETS.prepare(
      "UPDATE x402_receipts SET status = 'settlement_failed', verification_json = ? WHERE id = ?",
    ).bind(JSON.stringify(verification), receiptId).run();
    return failure(c, 502, "X402_SETTLEMENT_UNAVAILABLE", "The payment facilitator could not settle the payment.", error instanceof Error ? error.message : null);
  }
  const settlement = await settleResponse.json().catch(() => null) as Record<string, unknown> | null;
  if (!settleResponse.ok || settlement?.success === false) {
    await c.env.WARPLETS.prepare(
      "UPDATE x402_receipts SET status = 'settlement_failed', verification_json = ?, settlement_json = ? WHERE id = ?",
    ).bind(JSON.stringify(verification), JSON.stringify(settlement), receiptId).run();
    return failure(c, 502, "X402_SETTLEMENT_FAILED", "The payment was verified but settlement failed.", settlement);
  }
  const payer = typeof settlement?.payer === "string" ? settlement.payer.toLowerCase() : null;
  await c.env.WARPLETS.prepare(
    `UPDATE x402_receipts SET
       payer_address = ?, verification_json = ?, settlement_json = ?,
       status = 'settled', settled_at = ?
     WHERE id = ? AND status = 'verifying'`,
  )
    .bind(
      payer,
      JSON.stringify(verification),
      JSON.stringify(settlement),
      nowIso(),
      receiptId,
    )
    .run();
  return generateStatsReport(c, { receiptId, settlement, replayed: false });
}

async function generateStatsReport(c: ApiContext, payment: unknown): Promise<Response> {
  const origin = warpletsAppOrigin(c.env);
  const [overview, market, activity, holders] = await Promise.all(
    ["overview", "market", "activity", "holders"].map(async (kind) => {
      const response = await fetch(`${origin}/api/stats/${kind}`, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`Stats ${kind} failed (${response.status})`);
      return response.json();
    }),
  );
  return success(c, { report: { overview, market, activity, holders, generatedAt: nowIso() }, payment }, { cache: "private, no-store" });
}

const MCP_TOOLS = [
  ["search_warplets", "Search the 10X Warplets collection", { q: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }],
  ["get_warplet", "Get one Warplet by token ID", { tokenId: { type: "integer", minimum: 0, maximum: 9999 } }],
  ["get_collection_stats", "Get collection overview stats", {}],
  ["get_market_stats", "Get Price, Floor Price, Volume, Listings, Offers and Sales market stats and chart series", { range: { type: "string", enum: ["7d", "30d", "90d", "1y", "all"] } }],
  ["get_activity", "Get activity stats", { range: { type: "string" }, eventType: { type: "string" } }],
  ["get_top_holders", "Get holder rankings", { limit: { type: "integer", minimum: 1, maximum: 100 } }],
  ["list_favourites", "List favourites for the authenticated API credential", {}],
  ["add_favourite", "Add a favourite", { tokenId: { type: "integer", minimum: 0, maximum: 9999 } }],
  ["remove_favourite", "Remove a favourite", { tokenId: { type: "integer", minimum: 0, maximum: 9999 } }],
  ["create_stats_share", "Create an immutable Stats share snapshot", { request: { type: "object" } }],
  ["generate_stats_report", "Generate the x402-protected Stats report", {}],
] as const;

function mcpToolList(): unknown[] {
  return MCP_TOOLS.map(([name, description, properties]) => ({
    name,
    description,
    inputSchema: { type: "object", properties, additionalProperties: false },
  }));
}

function toolRoute(name: string, args: Record<string, unknown>): { path: string; method?: string; body?: unknown } | null {
  const query = new URLSearchParams();
  if (typeof args.q === "string") query.set("q", args.q);
  if (typeof args.limit === "number") query.set("limit", String(args.limit));
  if (typeof args.range === "string") query.set("range", args.range);
  if (typeof args.eventType === "string") query.set("eventType", args.eventType);
  const suffix = query.size ? `?${query}` : "";
  switch (name) {
    case "search_warplets": return { path: `/v1/warplets${suffix}` };
    case "get_warplet": return { path: `/v1/warplets/${args.tokenId}` };
    case "get_collection_stats": return { path: "/v1/stats/overview" };
    case "get_market_stats": return { path: `/v1/stats/market${suffix}` };
    case "get_activity": return { path: `/v1/stats/activity${suffix}` };
    case "get_top_holders": return { path: `/v1/stats/holders${suffix}` };
    case "list_favourites": return { path: "/v1/me/favourites" };
    case "add_favourite": return { path: `/v1/me/favourites/${args.tokenId}`, method: "PUT" };
    case "remove_favourite": return { path: `/v1/me/favourites/${args.tokenId}`, method: "DELETE" };
    case "create_stats_share": return { path: "/v1/stats/shares", method: "POST", body: args.request };
    case "generate_stats_report": return { path: "/v1/paid/stats-report", method: "POST" };
    default: return null;
  }
}

export function registerAgentApi(app: Hono): void {
  app.use("/v1/*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "authorization, content-type, idempotency-key, payment-signature, x-payment, x-request-id");
    c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    c.header("Access-Control-Expose-Headers", "etag, payment-required, x-request-id");
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    try {
      await next();
    } catch (error) {
      console.error("[agent-api] request failed", error);
      return failure(c as unknown as ApiContext, 500, "INTERNAL_ERROR", "The request could not be completed.");
    }
  });

  app.get("/v1/warplets", async (rawContext) => {
    const c = rawContext as unknown as ApiContext;
    const limit = intParam(c.req.query("limit"), 20, 1, 100);
    const cursorRaw = c.req.query("cursor");
    const cursor = decodeCursor(cursorRaw);
    if (cursorRaw && cursor === null) return failure(c, 400, "INVALID_CURSOR", "The cursor is invalid.");
    const q = (c.req.query("q") ?? "").trim().slice(0, 100);
    const sort = c.req.query("sort") === "rank" ? "rank" : c.req.query("sort") === "name" ? "name" : "token";
    const order = c.req.query("order") === "desc" ? "DESC" : "ASC";
    const filters: string[] = [];
    const binds: unknown[] = [];
    if (cursor !== null) {
      filters.push(`token_id ${order === "ASC" ? ">" : "<"} ?`);
      binds.push(cursor);
    }
    if (q) {
      filters.push("(name LIKE ? OR CAST(token_id AS TEXT) = ? OR warplet_keywords LIKE ? OR warplet_traits LIKE ?)");
      binds.push(`%${q}%`, q.replace(/^#/, ""), `%${q}%`, `%${q}%`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const orderBy = sort === "rank" ? `x10_rank IS NULL, x10_rank ${order}, token_id ASC` : sort === "name" ? `name ${order}, token_id ASC` : `token_id ${order}`;
    const result = await c.env.WARPLETS.prepare(
      `SELECT ${WARPLET_SELECT} FROM warplets_metadata ${where} ORDER BY ${orderBy} LIMIT ?`,
    )
      .bind(...binds, limit + 1)
      .all<Record<string, unknown>>();
    const rows = result.results ?? [];
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const last = data.length ? data[data.length - 1] : undefined;
    const nextCursor = hasMore && typeof last?.token_id === "number" ? encodeCursor(last.token_id) : undefined;
    return success(c, data, { nextCursor });
  });

  app.get("/v1/warplets/:tokenId", async (rawContext) => {
    const c = rawContext as unknown as ApiContext;
    const tokenId = Number.parseInt(c.req.param("tokenId"), 10);
    if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId > 9999) {
      return failure(c, 400, "INVALID_TOKEN_ID", "tokenId must be an integer from 0 to 9999.");
    }
    const row = await c.env.WARPLETS.prepare(`SELECT ${WARPLET_SELECT} FROM warplets_metadata WHERE token_id = ? LIMIT 1`)
      .bind(tokenId)
      .first<Record<string, unknown>>();
    return row ? success(c, row) : failure(c, 404, "NOT_FOUND", "Warplet not found.");
  });

  app.get("/v1/traits", async (rawContext) => {
    const c = rawContext as unknown as ApiContext;
    const traits = await Promise.all(
      TRAIT_COLUMNS.map(async (column) => {
        const result = await c.env.WARPLETS.prepare(
          `SELECT ${column} AS value, COUNT(*) AS count FROM warplets_metadata WHERE ${column} IS NOT NULL GROUP BY ${column} ORDER BY count DESC`,
        ).all<{ value: string; count: number }>();
        return { trait: column.replace(/_level$/, ""), values: result.results ?? [] };
      }),
    );
    return success(c, traits);
  });

  for (const kind of ["overview", "market", "activity", "holders"] as const) {
    app.get(`/v1/stats/${kind}`, (c) => proxyWarpletsAppApi(c as unknown as ApiContext, `/api/stats/${kind}`));
  }

  app.post("/v1/stats/shares", async (rawContext) => {
    const c = rawContext as unknown as ApiContext;
    const body = await c.req.raw.text();
    if (body.length > 32_000) return failure(c, 413, "BODY_TOO_LARGE", "Snapshot requests are limited to 32 KB.");
    return proxyWarpletsAppApi(c, "/api/stats/shares", { method: "POST", headers: { "content-type": "application/json" }, body });
  });

  app.get("/v1/me/favourites", async (rawContext) => {
    const c = rawContext as unknown as ApiContext;
    const credential = await credentialFor(c, "favourites:read");
    if (!credential) return failure(c, 401, "UNAUTHORIZED", "A personal API token with favourites:read is required.");
    return success(c, { tokenIds: await readFavouriteIds(c.env.WARPLETS, credential.wallet_address) }, { cache: "private, no-store" });
  });

  app.put("/v1/me/favourites/:tokenId", async (rawContext) => {
    const c = rawContext as unknown as ApiContext;
    const credential = await credentialFor(c, "favourites:write");
    if (!credential) return failure(c, 401, "UNAUTHORIZED", "A personal API token with favourites:write is required.");
    const tokenId = Number.parseInt(c.req.param("tokenId"), 10);
    if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId > 9999) return failure(c, 400, "INVALID_TOKEN_ID", "Invalid token ID.");
    const ids = await readFavouriteIds(c.env.WARPLETS, credential.wallet_address);
    if (!ids.includes(tokenId)) ids.push(tokenId);
    ids.sort((a, b) => a - b);
    await writeFavouriteIds(c.env.WARPLETS, credential.wallet_address, ids);
    return success(c, { tokenIds: ids }, { cache: "private, no-store" });
  });

  app.delete("/v1/me/favourites/:tokenId", async (rawContext) => {
    const c = rawContext as unknown as ApiContext;
    const credential = await credentialFor(c, "favourites:write");
    if (!credential) return failure(c, 401, "UNAUTHORIZED", "A personal API token with favourites:write is required.");
    const tokenId = Number.parseInt(c.req.param("tokenId"), 10);
    const ids = (await readFavouriteIds(c.env.WARPLETS, credential.wallet_address)).filter((id) => id !== tokenId);
    await writeFavouriteIds(c.env.WARPLETS, credential.wallet_address, ids);
    return success(c, { tokenIds: ids }, { cache: "private, no-store" });
  });

  app.delete("/v1/me/favourites", async (rawContext) => {
    const c = rawContext as unknown as ApiContext;
    const credential = await credentialFor(c, "favourites:write");
    if (!credential) return failure(c, 401, "UNAUTHORIZED", "A personal API token with favourites:write is required.");
    await writeFavouriteIds(c.env.WARPLETS, credential.wallet_address, []);
    return success(c, { tokenIds: [] }, { cache: "private, no-store" });
  });

  app.get("/v1/me/alerts", async (rawContext) => {
    const c = rawContext as unknown as ApiContext;
    const credential = await credentialFor(c, "alerts:read");
    if (!credential) return failure(c, 401, "UNAUTHORIZED", "A personal API token with alerts:read is required.");
    const identityKey = `wallet:${credential.wallet_address.toLowerCase()}`;
    const rows = await c.env.WARPLETS.prepare(
      "SELECT channel, topic, enabled, updated_at FROM notification_preferences WHERE identity_key = ? ORDER BY channel, topic",
    )
      .bind(identityKey)
      .all<Record<string, unknown>>();
    return success(c, rows.results ?? [], { cache: "private, no-store" });
  });

  app.put("/v1/me/alerts", async (rawContext) => {
    const c = rawContext as unknown as ApiContext;
    const credential = await credentialFor(c, "alerts:write");
    if (!credential) return failure(c, 401, "UNAUTHORIZED", "A personal API token with alerts:write is required.");
    const body = await c.req.json<{ channel?: string; topic?: string; enabled?: boolean }>().catch(
      (): { channel?: string; topic?: string; enabled?: boolean } => ({}),
    );
    const channels = new Set(["farcaster", "base", "web-push", "telegram", "discord"]);
    if (!body.channel || !channels.has(body.channel) || !body.topic || body.topic.length > 80 || typeof body.enabled !== "boolean") {
      return failure(c, 400, "INVALID_ALERT", "channel, topic and enabled are required.");
    }
    const identityKey = `wallet:${credential.wallet_address.toLowerCase()}`;
    await c.env.WARPLETS.prepare(
      `INSERT INTO notification_preferences (identity_key, channel, topic, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(identity_key, channel, topic) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
    )
      .bind(identityKey, body.channel, body.topic, body.enabled ? 1 : 0, nowIso())
      .run();
    return success(c, { channel: body.channel, topic: body.topic, enabled: body.enabled }, { cache: "private, no-store" });
  });

  app.post("/v1/bot/link-challenges", async (rawContext) => {
    const c = rawContext as unknown as ApiContext;
    const identity = await verifiedServiceIdentity(c);
    if (!identity) return failure(c, 401, "UNAUTHORIZED", "A verified first-party bot service is required.");
    const challengeBytes = crypto.getRandomValues(new Uint8Array(24));
    let binary = "";
    for (const byte of challengeBytes) binary += String.fromCharCode(byte);
    const challenge = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const timestamp = new Date();
    await c.env.WARPLETS.prepare(
      `INSERT INTO bot_link_challenges (
         challenge_hash, provider, provider_user_id, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        await sha256Hex(challenge),
        identity.provider,
        identity.providerUserId,
        timestamp.toISOString(),
        new Date(timestamp.getTime() + 10 * 60 * 1000).toISOString(),
      )
      .run();
    const link = new URL("/link-bot", warpletsAppOrigin(c.env));
    link.searchParams.set("provider", identity.provider);
    link.searchParams.set("challenge", challenge);
    return success(c, { link: link.toString(), expiresAt: new Date(timestamp.getTime() + 10 * 60 * 1000).toISOString() }, { cache: "private, no-store" });
  });

  app.post("/v1/bot/registrations", async (rawContext) => {
    const c = rawContext as unknown as ApiContext;
    const identity = await verifiedServiceIdentity(c);
    if (!identity) return failure(c, 401, "UNAUTHORIZED", "A verified first-party bot service is required.");
    const body = await c.req.json<{ displayName?: string; metadata?: Record<string, unknown> }>().catch(
      (): { displayName?: string; metadata?: Record<string, unknown> } => ({}),
    );
    const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 160) : null;
    const metadataJson = JSON.stringify(body.metadata && typeof body.metadata === "object" ? body.metadata : {}).slice(0, 4_000);
    const timestamp = new Date().toISOString();
    await c.env.WARPLETS.prepare(
      `INSERT INTO external_identity_links (
         provider, provider_user_id, display_name, verified_at,
         verification_method, metadata_json
       ) VALUES (?, ?, ?, ?, 'verified-bot-webhook', ?)
       ON CONFLICT(provider, provider_user_id) DO UPDATE SET
         display_name = excluded.display_name, verified_at = excluded.verified_at,
         metadata_json = excluded.metadata_json`,
    ).bind(identity.provider, identity.providerUserId, displayName, timestamp, metadataJson).run();
    return success(c, { registered: true }, { cache: "private, no-store" });
  });

  app.get("/v1/openapi.json", (rawContext) => {
    const c = rawContext as unknown as ApiContext;
    return jsonWithEtag(c, openApiDocument(new URL(c.req.url).origin));
  });

  app.post("/v1/paid/stats-report", (c) => paidStatsReport(c as unknown as ApiContext));

  app.options("/mcp", (c) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "authorization, content-type, payment-signature, x-payment");
    c.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    return c.body(null, 204);
  });

  app.post("/mcp", async (rawContext) => {
    const c = rawContext as unknown as ApiContext;
    const body = await c.req.json<{ jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }>().catch(
      (): { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> } => ({}),
    );
    const respond = (result?: unknown, error?: { code: number; message: string }) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? null, ...(error ? { error } : { result }) }), {
        status: error ? 400 : 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    if (body.method === "initialize") {
      return respond({ protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "10x-warplets", version: "1.0.0" } });
    }
    if (body.method === "ping") return respond({});
    if (body.method === "tools/list") return respond({ tools: mcpToolList() });
    if (body.method !== "tools/call") return respond(undefined, { code: -32601, message: "Method not found" });
    const params = body.params ?? {};
    const name = typeof params.name === "string" ? params.name : "";
    const args = params.arguments && typeof params.arguments === "object" ? params.arguments as Record<string, unknown> : {};
    const route = toolRoute(name, args);
    if (!route) return respond(undefined, { code: -32602, message: "Unknown tool" });
    const target = new URL(route.path, new URL(c.req.url).origin);
    const headers = new Headers({ accept: "application/json" });
    for (const header of ["authorization", "payment-signature", "x-payment", "idempotency-key"] as const) {
      const value = c.req.header(header);
      if (value) headers.set(header, value);
    }
    if (route.body !== undefined) headers.set("content-type", "application/json");
    const internalRequest = new Request(target, {
      method: route.method ?? "GET",
      headers,
      body: route.body === undefined ? undefined : JSON.stringify(route.body),
    });
    const internal = await (app.fetch as unknown as (
      request: Request,
      env: AgentApiEnv,
      executionCtx?: ExecutionContext,
    ) => Promise<Response>)(internalRequest, c.env, c.executionCtx);
    const text = await internal.text();
    const content = [{ type: "text", text }];
    return respond({ content, isError: !internal.ok });
  });
}
