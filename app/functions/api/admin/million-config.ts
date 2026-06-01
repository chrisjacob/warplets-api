interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  ADMIN_API_KEYS_JSON?: string;
  ACTION_SESSION_SECRET?: string;
  SECURITY_LOG_SALT?: string;
}
import {
  getClientIp,
  jsonSecure,
  readJsonBodyWithLimit,
  requireAdminScope,
  sha256Hex,
} from "../../_lib/security.js";

const CONFIG_KEYS = [
  "x_quote_url",
  "recaptcha_min_score",
  "neynar_min_score",
  "cloudflare_threat_score_flag",
  "same_ip_month_clean_limit",
  "same_ip_hour_submit_limit",
] as const;

type ConfigKey = typeof CONFIG_KEYS[number];

type ConfigPayload = Partial<Record<ConfigKey, unknown>> & {
  blockCurrentIp?: unknown;
  unblockIpHash?: unknown;
  label?: unknown;
  notes?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function sanitizeValue(key: ConfigKey, value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) return null;
  if (key.endsWith("_url")) {
    if (!raw) return "";
    try {
      const url = new URL(raw);
      return url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : null;
}

async function currentIpHash(context: EventContext<Env, string, unknown>): Promise<string> {
  return sha256Hex(`million-grant-ip:v1:${context.env.SECURITY_LOG_SALT?.trim() ?? ""}:${getClientIp(context.request)}`);
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "security:manage" });
  if (!auth.ok) return auth.response;

  const configRows = await context.env.WARPLETS.prepare("SELECT key, value, updated_on FROM million_app_config ORDER BY key").all<{
    key: string;
    value: string;
    updated_on: string;
  }>();
  const ipRows = await context.env.WARPLETS.prepare(
    "SELECT ip_hash, action, label, notes, updated_on FROM million_ip_controls ORDER BY updated_on DESC LIMIT 100"
  ).all<{
    ip_hash: string;
    action: string;
    label: string | null;
    notes: string | null;
    updated_on: string;
  }>();

  return jsonSecure({
    config: Object.fromEntries((configRows.results ?? []).map((row) => [row.key, row.value])),
    ipControls: ipRows.results ?? [],
    currentIpHash: await currentIpHash(context),
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "security:manage" });
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return jsonSecure({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const payload = parsed.value as ConfigPayload;
  const now = new Date().toISOString();
  for (const key of CONFIG_KEYS) {
    if (!(key in payload)) continue;
    const value = sanitizeValue(key, payload[key]);
    if (value === null) return jsonSecure({ error: `Invalid value for ${key}` }, { status: 400 });
    await context.env.WARPLETS.prepare(
      `INSERT INTO million_app_config (key, value, updated_on)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_on = excluded.updated_on`
    )
      .bind(key, value, now)
      .run();
  }

  if (payload.blockCurrentIp === true) {
    await context.env.WARPLETS.prepare(
      `INSERT INTO million_ip_controls (ip_hash, action, label, notes, created_on, updated_on)
       VALUES (?, 'block', ?, ?, ?, ?)
       ON CONFLICT(ip_hash) DO UPDATE SET action = 'block', label = excluded.label, notes = excluded.notes, updated_on = excluded.updated_on`
    )
      .bind(await currentIpHash(context), asString(payload.label) || "admin current ip", asString(payload.notes), now, now)
      .run();
  }

  const unblockIpHash = asString(payload.unblockIpHash);
  if (unblockIpHash) {
    await context.env.WARPLETS.prepare("DELETE FROM million_ip_controls WHERE ip_hash = ?")
      .bind(unblockIpHash)
      .run();
  }

  return onRequestGet(context);
};
