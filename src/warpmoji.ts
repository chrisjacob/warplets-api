import type { Hono } from "hono";
import {
  buildWarpmojiUrl,
  evaluateWarpmojiCaps,
  isAllowedAttribution,
  nextRetryAt,
  stripMentionByRanges,
} from "./warpmoji-core";

export interface WarpmojiEnv {
  WARPLETS: D1Database;
  WARPLETS_APP_ORIGIN?: string;
  NEYNAR_API_KEY?: string;
  NEYNAR_WEBHOOK_SECRET?: string;
  WARPMOJI_SIGNER_UUID?: string;
  WARPMOJI_FID?: string;
}

type Context = { env: WarpmojiEnv; req: { raw: Request; header(name: string): string | undefined; query(name: string): string | undefined; json<T>(): Promise<T> } };
type MatchRow = { canonical_emoji: string; token_id: number; score: number };
type Settings = {
  mode: "disabled" | "shadow" | "live";
  organic_author_score: number;
  organic_user_24h: number;
  organic_daily: number;
  mention_user_24h: number;
  mention_daily: number;
  combined_daily: number;
  queue_batch_size: number;
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

async function resolveAlias(db: D1Database, emoji: string): Promise<string | null> {
  const row = await db.prepare("SELECT canonical_emoji FROM warpmoji_emoji_aliases WHERE alias = ? LIMIT 1")
    .bind(emoji.trim().normalize("NFC")).first<{ canonical_emoji: string }>();
  return row?.canonical_emoji ?? null;
}

async function chooseApprovedMatch(db: D1Database, canonical: string): Promise<MatchRow | null> {
  const rows = await db.prepare(
    `SELECT canonical_emoji, token_id, score FROM warpmoji_candidates
      WHERE canonical_emoji = ? AND status = 'approved'
        AND token_id NOT IN (
          SELECT token_id FROM warpmoji_recent_selections WHERE canonical_emoji = ?
          ORDER BY selected_at DESC LIMIT 3
        )
      ORDER BY score DESC LIMIT 10`,
  ).bind(canonical, canonical).all<MatchRow>();
  let pool = rows.results;
  if (!pool.length) {
    pool = (await db.prepare(
      "SELECT canonical_emoji, token_id, score FROM warpmoji_candidates WHERE canonical_emoji = ? AND status = 'approved' ORDER BY score DESC LIMIT 10",
    ).bind(canonical).all<MatchRow>()).results;
  }
  if (!pool.length) return null;
  const total = pool.reduce((sum, row) => sum + Math.max(0.05, row.score), 0);
  const random = crypto.getRandomValues(new Uint32Array(1))[0] / 0xffffffff * total;
  let cursor = 0;
  const selected = pool.find((row) => (cursor += Math.max(0.05, row.score)) >= random) ?? pool[0];
  await db.batch([
    db.prepare("INSERT INTO warpmoji_recent_selections (canonical_emoji, token_id) VALUES (?, ?)").bind(canonical, selected.token_id),
    db.prepare("DELETE FROM warpmoji_recent_selections WHERE rowid IN (SELECT rowid FROM warpmoji_recent_selections WHERE canonical_emoji = ? ORDER BY selected_at DESC LIMIT -1 OFFSET 30)").bind(canonical),
  ]);
  return selected;
}

async function publicMatch(c: Context): Promise<Response> {
  const emoji = (c.req.query("emoji") ?? "").trim().normalize("NFC");
  const channel = c.req.query("source") ?? "warpmoji_api";
  const trigger = c.req.query("trigger") ?? "api";
  if (!emoji || !isAllowedAttribution(channel, trigger)) return json({ ok: false, error: { code: "invalid_request", message: "A supported emoji and source/trigger pair are required." } }, 400);
  const canonical = await resolveAlias(c.env.WARPLETS, emoji);
  if (!canonical) return json({ ok: false, error: { code: "unsupported_emoji", message: "This emoji is not in the Unicode 17 catalog." } }, 404);
  const match = await chooseApprovedMatch(c.env.WARPLETS, canonical);
  if (!match) return json({ ok: false, error: { code: "unreviewed_emoji", message: "This emoji does not yet have a human-approved Warplet match." } }, 404);
  const url = buildWarpmojiUrl({
    origin: c.env.WARPLETS_APP_ORIGIN,
    tokenId: match.token_id,
    emoji,
    channel,
    trigger: trigger as "organic" | "mention" | "emoji" | "command" | "api",
  });
  const provider = channel === "warpmoji_api" ? "api" : channel;
  await c.env.WARPLETS.prepare(
    "INSERT INTO warpmoji_events (id, provider, external_event_id, event_class, canonical_emoji, input_emoji, token_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'matched')",
  ).bind(crypto.randomUUID(), provider, crypto.randomUUID(), trigger, canonical, emoji, match.token_id).run();
  return json({ ok: true, data: { emoji, canonicalEmoji: canonical, tokenId: match.token_id, url } });
}

async function hmacValid(body: string, provided: string, secret: string): Promise<boolean> {
  if (!provided || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (expected.length !== provided.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ provided.toLowerCase().charCodeAt(index);
  return difference === 0;
}

function castData(payload: Record<string, unknown>): Record<string, unknown> | null {
  const data = payload.data;
  return data && typeof data === "object" ? data as Record<string, unknown> : null;
}

function mentionFids(cast: Record<string, unknown>): number[] {
  const profiles = Array.isArray(cast.mentioned_profiles) ? cast.mentioned_profiles : [];
  return profiles.map((profile) => Number((profile as { fid?: unknown })?.fid)).filter(Number.isInteger);
}

function textWithoutBotMention(cast: Record<string, unknown>, botFid: number): string {
  const text = String(cast.text ?? "");
  const profiles = Array.isArray(cast.mentioned_profiles) ? cast.mentioned_profiles as Array<{ fid?: unknown }> : [];
  const ranges = Array.isArray(cast.mentioned_profiles_ranges) ? cast.mentioned_profiles_ranges as Array<{ start?: unknown; end?: unknown }> : [];
  const positions: number[] = [];
  const lengths: number[] = [];
  profiles.forEach((profile, index) => {
    if (Number(profile?.fid) !== botFid) return;
    const start = Number(ranges[index]?.start);
    const end = Number(ranges[index]?.end);
    if (Number.isInteger(start) && Number.isInteger(end) && end >= start) {
      positions.push(start); lengths.push(end - start);
    }
  });
  if (positions.length) return stripMentionByRanges(text, positions, lengths);
  return text.replace(/@warpmoji(?:\.eth)?\b/giu, "").trim();
}

async function settings(db: D1Database): Promise<Settings> {
  const row = await db.prepare("SELECT mode, organic_author_score, organic_user_24h, organic_daily, mention_user_24h, mention_daily, combined_daily, queue_batch_size FROM warpmoji_settings WHERE singleton = 1")
    .first<Settings>();
  return row ?? { mode: "shadow", organic_author_score: 0.5, organic_user_24h: 1, organic_daily: 200, mention_user_24h: 10, mention_daily: 300, combined_daily: 500, queue_batch_size: 10 };
}

async function limitReason(db: D1Database, classification: "organic" | "mention", authorId: string, config: Settings): Promise<string | null> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const user = await db.prepare("SELECT COUNT(*) AS count FROM warpmoji_events WHERE provider = 'farcaster' AND event_class = ? AND author_id = ? AND status IN ('queued','sent','shadow') AND created_at >= ?")
    .bind(classification, authorId, since).first<{ count: number }>();
  const category = await db.prepare("SELECT COUNT(*) AS count FROM warpmoji_events WHERE provider = 'farcaster' AND event_class = ? AND status IN ('queued','sent','shadow') AND created_at >= ?")
    .bind(classification, since).first<{ count: number }>();
  const combined = await db.prepare("SELECT COUNT(*) AS count FROM warpmoji_events WHERE provider = 'farcaster' AND status IN ('queued','sent','shadow') AND created_at >= ?")
    .bind(since).first<{ count: number }>();
  return evaluateWarpmojiCaps({
    classification,
    userCount: user?.count ?? 0,
    categoryCount: category?.count ?? 0,
    combinedCount: combined?.count ?? 0,
    organicUser: config.organic_user_24h,
    organicDaily: config.organic_daily,
    mentionUser: config.mention_user_24h,
    mentionDaily: config.mention_daily,
    combinedDaily: config.combined_daily,
  });
}

async function webhook(c: Context, executionCtx?: ExecutionContext): Promise<Response> {
  const raw = await c.req.raw.text();
  if (!(await hmacValid(raw, c.req.header("x-neynar-signature") ?? "", c.env.NEYNAR_WEBHOOK_SECRET?.trim() ?? ""))) return json({ ok: false }, 401);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { return json({ ok: false }, 400); }
  if (payload.type !== "cast.created") return json({ ok: true, ignored: "event_type" });
  const cast = castData(payload);
  if (!cast) return json({ ok: true, ignored: "missing_cast" });
  const hash = String(cast.hash ?? "");
  const author = cast.author && typeof cast.author === "object" ? cast.author as Record<string, unknown> : {};
  const authorFid = Number(author.fid);
  const botFid = Number(c.env.WARPMOJI_FID);
  if (!hash || !Number.isInteger(authorFid) || authorFid === botFid) return json({ ok: true, ignored: "self_or_invalid" });
  const classification: "organic" | "mention" = mentionFids(cast).includes(botFid) ? "mention" : "organic";
  const emoji = (classification === "mention" ? textWithoutBotMention(cast, botFid) : String(cast.text ?? "").trim()).normalize("NFC");
  const existing = await c.env.WARPLETS.prepare("SELECT id, event_class, status FROM warpmoji_events WHERE provider = 'farcaster' AND external_event_id = ? LIMIT 1").bind(hash).first<{ id: string; event_class: string; status: string }>();
  if (existing && (classification === "organic" || existing.event_class === "mention")) return json({ ok: true, duplicate: true });
  if (existing?.status === "sent") {
    await c.env.WARPLETS.prepare("UPDATE warpmoji_events SET event_class = 'mention', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(existing.id).run();
    return json({ ok: true, duplicate: true, upgradedToMention: true });
  }
  const id = existing?.id ?? crypto.randomUUID();
  if (existing) await c.env.WARPLETS.prepare("DELETE FROM warpmoji_jobs WHERE event_id = ?").bind(id).run();
  // SQLite length(TEXT) counts code points while JavaScript length counts UTF-16
  // units. Compare UTF-8 bytes on both sides so flags, modifiers and ZWJ emoji
  // are never incorrectly rejected by the cheap pre-lookup guard.
  const maxLength = await c.env.WARPLETS.prepare("SELECT MAX(length(CAST(alias AS BLOB))) AS max_bytes FROM warpmoji_emoji_aliases").first<{ max_bytes: number }>();
  const inputBytes = new TextEncoder().encode(emoji).byteLength;
  const canonical = inputBytes <= (maxLength?.max_bytes ?? 128) ? await resolveAlias(c.env.WARPLETS, emoji) : null;
  const config = await settings(c.env.WARPLETS);
  let rejection: string | null = null;
  if (config.mode === "disabled") rejection = "disabled";
  else if (!canonical) rejection = "not_exact_supported_emoji";
  else if (classification === "organic" && Number(author.score ?? 0) < config.organic_author_score) rejection = "author_score";
  else if (classification === "organic") {
    const optedOut = await c.env.WARPLETS.prepare("SELECT 1 AS found FROM warpmoji_opt_outs WHERE provider = 'farcaster' AND provider_user_id = ?").bind(String(authorFid)).first();
    if (optedOut) rejection = "opted_out";
  }
  if (!rejection) rejection = await limitReason(c.env.WARPLETS, classification, String(authorFid), config);
  const match = !rejection && canonical ? await chooseApprovedMatch(c.env.WARPLETS, canonical) : null;
  if (!rejection && !match) rejection = "no_approved_match";
  const status = rejection ? "rejected" : config.mode === "shadow" ? "shadow" : "queued";
  const inserted = existing ? null : await c.env.WARPLETS.prepare(
    `INSERT OR IGNORE INTO warpmoji_events (id, provider, external_event_id, event_class, author_id, canonical_emoji, input_emoji, token_id, status, rejection_reason, author_score, source_created_at)
     VALUES (?, 'farcaster', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, hash, classification, String(authorFid), canonical, emoji || null, match?.token_id ?? null, status, rejection, Number(author.score ?? 0), String(cast.timestamp ?? "") || null).run();
  if (inserted && !inserted.meta.changes) return json({ ok: true, duplicate: true });
  if (existing) {
    await c.env.WARPLETS.prepare(
      "UPDATE warpmoji_events SET event_class = 'mention', canonical_emoji = ?, input_emoji = ?, token_id = ?, status = ?, rejection_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(canonical, emoji || null, match?.token_id ?? null, status, rejection, id).run();
  }
  if (!rejection && match) {
    const jobStatus = config.mode === "shadow" ? "shadow" : "queued";
    await c.env.WARPLETS.batch([
      c.env.WARPLETS.prepare("INSERT INTO warpmoji_jobs (id, event_id, kind, idempotency_key, status) VALUES (?, ?, 'reply', ?, ?)").bind(crypto.randomUUID(), id, `warpmoji:reply:${hash}`, jobStatus),
      c.env.WARPLETS.prepare("INSERT INTO warpmoji_jobs (id, event_id, kind, idempotency_key, status) VALUES (?, ?, 'like', ?, ?)").bind(crypto.randomUUID(), id, `warpmoji:like:${hash}`, jobStatus),
    ]);
    if (config.mode === "live") executionCtx?.waitUntil(processWarpmojiJobs(c.env));
  }
  return json({ ok: true, classification, status });
}

class NeynarRequestError extends Error {
  constructor(message: string, readonly status: number, readonly latencyMs: number) { super(message); }
}

async function neynarRequest(env: WarpmojiEnv, path: string, body: Record<string, unknown>): Promise<{ payload: Record<string, unknown>; status: number; latencyMs: number }> {
  const started = Date.now();
  const response = await fetch(`https://api.neynar.com${path}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": env.NEYNAR_API_KEY?.trim() ?? "" }, body: JSON.stringify(body) });
  const latencyMs = Date.now() - started;
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new NeynarRequestError(String((payload.message ?? payload.error) || `Neynar request failed (${response.status})`), response.status, latencyMs);
  return { payload, status: response.status, latencyMs };
}

export async function processWarpmojiJobs(env: WarpmojiEnv): Promise<void> {
  if (!env.NEYNAR_API_KEY || !env.WARPMOJI_SIGNER_UUID) return;
  const config = await settings(env.WARPLETS);
  if (config.mode !== "live") return;
  const jobs = await env.WARPLETS.prepare(
    `SELECT j.id, j.event_id, j.kind, j.idempotency_key, j.attempts, e.external_event_id, e.author_id, e.input_emoji, e.token_id, e.event_class
       FROM warpmoji_jobs j JOIN warpmoji_events e ON e.id = j.event_id
      WHERE j.status IN ('queued','retry') AND j.available_at <= ? ORDER BY j.created_at LIMIT ?`,
  ).bind(new Date().toISOString(), Math.min(25, config.queue_batch_size)).all<Record<string, string | number>>();
  for (const job of jobs.results) {
    if (job.kind === "like") {
      const reply = await env.WARPLETS.prepare("SELECT status FROM warpmoji_jobs WHERE event_id = ? AND kind = 'reply'").bind(job.event_id).first<{ status: string }>();
      if (reply?.status !== "sent") continue;
    }
    await env.WARPLETS.prepare("UPDATE warpmoji_jobs SET status = 'processing', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(job.id).run();
    try {
      const body = job.kind === "reply" ? {
        signer_uuid: env.WARPMOJI_SIGNER_UUID,
        text: `${job.input_emoji}🟢`,
        parent: job.external_event_id,
        parent_author_fid: Number(job.author_id),
        embeds: [{ url: buildWarpmojiUrl({ origin: env.WARPLETS_APP_ORIGIN, tokenId: Number(job.token_id), emoji: String(job.input_emoji), channel: "farcaster", trigger: job.event_class as "organic" | "mention" }) }],
        idem: String(job.idempotency_key).slice(-16),
      } : {
        signer_uuid: env.WARPMOJI_SIGNER_UUID,
        reaction_type: "like",
        target: job.external_event_id,
        target_author_fid: Number(job.author_id),
        idem: String(job.idempotency_key).slice(-16),
      };
      const result = await neynarRequest(env, job.kind === "reply" ? "/v2/farcaster/cast/" : "/v2/farcaster/reaction/", body);
      const externalId = String((result.payload.cast as { hash?: unknown } | undefined)?.hash ?? result.payload.success ?? "sent");
      await env.WARPLETS.batch([
        env.WARPLETS.prepare("UPDATE warpmoji_jobs SET status = 'sent', external_id = ?, last_error = NULL, last_http_status = ?, last_latency_ms = ?, estimated_credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(externalId, result.status, result.latencyMs, job.kind === "reply" ? 150 : 10, job.id),
        env.WARPLETS.prepare("UPDATE warpmoji_events SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND NOT EXISTS (SELECT 1 FROM warpmoji_jobs WHERE event_id = ? AND status NOT IN ('sent','shadow'))").bind(job.event_id, job.event_id),
      ]);
    } catch (error) {
      const attempts = Number(job.attempts) + 1;
      await env.WARPLETS.prepare("UPDATE warpmoji_jobs SET status = ?, available_at = ?, last_error = ?, last_http_status = ?, last_latency_ms = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(attempts >= 6 ? "failed" : "retry", nextRetryAt(attempts), error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500), error instanceof NeynarRequestError ? error.status : null, error instanceof NeynarRequestError ? error.latencyMs : null, job.id).run();
    }
  }
}

export function registerWarpmoji(app: Hono): void {
  app.get("/v1/warpmoji/match", (raw) => publicMatch(raw as unknown as Context));
  app.post("/v1/warpmoji/webhooks/neynar", (raw) => webhook(raw as unknown as Context, raw.executionCtx));
}
