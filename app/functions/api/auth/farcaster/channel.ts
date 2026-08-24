import { hashAuthNonce, isUsableStoredNonce, requireSameOrigin } from "../../../_lib/authValidation.js";
import { jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../../../_lib/security.js";

interface Env { WARPLETS: D1Database }
interface ChannelPayload { nonce?: unknown; uri?: unknown }
interface NonceRow { domain: string; uri: string; expires_at: string; consumed_at: string | null }

function encodeRecoveryCookie(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomRecoveryId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  const payload = parseObjectPayload<ChannelPayload>(parsed.value, ["nonce", "uri"]);
  if (!payload.ok) return payload.response;
  const nonce = typeof payload.payload.nonce === "string" ? payload.payload.nonce.trim() : "";
  const uri = typeof payload.payload.uri === "string" ? payload.payload.uri.trim() : "";
  if (!nonce || !uri) return jsonSecure({ error: "Farcaster sign-in challenge is incomplete" }, { status: 400 });

  const row = await context.env.WARPLETS.prepare(
    "SELECT domain, uri, expires_at, consumed_at FROM farcaster_auth_nonces WHERE nonce_hash = ? LIMIT 1",
  ).bind(await hashAuthNonce(nonce)).first<NonceRow>();
  const requestUrl = new URL(context.request.url);
  if (!row || !isUsableStoredNonce(row) || row.domain !== requestUrl.host || new URL(row.uri).href !== new URL(uri).href) {
    return jsonSecure({ error: "Farcaster sign-in challenge is expired or does not match" }, { status: 401 });
  }

  try {
    const relay = await fetch("https://relay.farcaster.xyz/v1/channel", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ nonce, siweUri: row.uri, domain: row.domain }),
    });
    const text = await relay.text();
    if (!text.trim()) return jsonSecure({ error: "Farcaster sign-in channel was empty" }, { status: 502 });
    let result: unknown;
    try { result = JSON.parse(text); } catch {
      return jsonSecure({ error: "Farcaster sign-in channel was invalid" }, { status: 502 });
    }
    if (!relay.ok || !result || typeof result !== "object") return jsonSecure(result, { status: relay.status });
    const channel = result as { channelToken?: unknown; nonce?: unknown };
    if (typeof channel.channelToken !== "string" || typeof channel.nonce !== "string") {
      return jsonSecure({ error: "Farcaster sign-in channel was incomplete" }, { status: 502 });
    }
    const expiresAt = Date.now() + 5 * 60_000;
    const recovery = encodeRecoveryCookie({
      recoveryId: randomRecoveryId(),
      channelToken: channel.channelToken,
      nonce: channel.nonce,
      uri: row.uri,
      expiresAt,
      // Channel creation is preparation only. The status endpoint marks the
      // handoff initiated when the user's tap starts polling this token.
      initiatedAt: null,
    });
    return jsonSecure(result, {
      status: relay.status,
      headers: {
        "set-cookie": `__Host-warplets_farcaster_handoff=${recovery}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=300`,
      },
    });
  } catch {
    return jsonSecure({ error: "Farcaster sign-in channel was unavailable" }, { status: 502 });
  }
};
