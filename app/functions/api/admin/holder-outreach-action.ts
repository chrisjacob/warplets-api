import {
  buildFarcasterReplyComposeUrl,
  buildHolderOutreachDeepLink,
  buildHolderOutreachMessage,
} from "../../_lib/holderOutreach.js";
import {
  jsonSecure,
  readJsonBodyWithLimit,
  requireAdminScope,
  type SecurityEnv,
} from "../../_lib/security.js";

interface Env extends SecurityEnv {
  WARPLETS: D1Database;
  BASE_APP_URL?: string;
}

type RequestBody = {
  fid?: unknown;
  castHash?: unknown;
  channel?: unknown;
  templateId?: unknown;
};

type CastRow = {
  fid: number;
  cast_hash: string;
  token_id: number;
  x_username: string | null;
};

function positiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function safeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function randomTrackingCode(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getWarpletsOrigin(env: Env): string {
  try {
    const url = new URL(env.BASE_APP_URL?.trim() || "https://warplet.10x.meme");
    if (url.protocol === "https:" && /(^|\.)warplet(?:-local|-dev)?\.10x\.meme$/i.test(url.hostname)) {
      return url.origin;
    }
  } catch {
    // Fall through to the production URL.
  }
  return "https://warplet.10x.meme";
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:send" });
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBodyWithLimit<RequestBody>(context.request, 4 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  const fid = positiveInteger(body.fid);
  const castHash = safeString(body.castHash, 100);
  const channel = body.channel === "farcaster" || body.channel === "x" ? body.channel : null;
  const templateId = safeString(body.templateId, 80) ?? "airdrop-seen";
  if (!fid || !castHash || !channel) {
    return jsonSecure({ error: "fid, castHash and a supported channel are required" }, { status: 400 });
  }

  const cast = await context.env.WARPLETS.prepare(
    `SELECT c.fid, c.cast_hash, c.token_id, c.x_username
     FROM holder_outreach_casts c
     WHERE c.fid = ? AND c.cast_hash = ?
       AND NOT EXISTS (
         SELECT 1 FROM warplets_outreach_opt_outs o
         WHERE o.fid = c.fid AND o.opted_back_in_on IS NULL
       )
     LIMIT 1`,
  ).bind(fid, castHash).first<CastRow>();
  if (!cast) return jsonSecure({ error: "The holder is unavailable or has opted out of outreach" }, { status: 409 });
  if (channel === "x" && !cast.x_username) {
    return jsonSecure({ error: "This holder has no verified X username" }, { status: 409 });
  }

  const trackingCode = randomTrackingCode();
  const deepLink = buildHolderOutreachDeepLink(getWarpletsOrigin(context.env), Number(cast.token_id), trackingCode);
  const message = buildHolderOutreachMessage(templateId, Number(cast.token_id), deepLink);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await context.env.WARPLETS.prepare(
    `INSERT INTO holder_outreach_events (
       id, tracking_code, fid, token_id, cast_hash, channel,
       template_id, message_text, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    trackingCode,
    fid,
    cast.token_id,
    castHash,
    channel,
    message.templateId,
    message.text,
    now,
  ).run();

  return jsonSecure({
    ok: true,
    eventId: id,
    message: message.text,
    deepLink,
    composeUrl: channel === "farcaster"
      ? buildFarcasterReplyComposeUrl(message.text, deepLink, castHash)
      : null,
    xProfileUrl: cast.x_username ? `https://x.com/${encodeURIComponent(cast.x_username.replace(/^@/, ""))}` : null,
  });
};
