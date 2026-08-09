import { AUTH_NONCE_TTL_MS, createAuthNonce, hashAuthNonce, requireSameOrigin } from "../../../_lib/authValidation.js";
import { jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../../../_lib/security.js";

interface Env { WARPLETS: D1Database }
interface ChallengePayload { uri?: unknown }

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  const payload = parseObjectPayload<ChallengePayload>(parsed.value, ["uri"]);
  if (!payload.ok) return payload.response;
  if (typeof payload.payload.uri !== "string") {
    return jsonSecure({ error: "Farcaster sign-in URL is required" }, { status: 400 });
  }
  let signInUri: URL;
  try {
    signInUri = new URL(payload.payload.uri);
  } catch {
    return jsonSecure({ error: "Farcaster sign-in URL is invalid" }, { status: 400 });
  }
  const requestUrl = new URL(context.request.url);
  if (signInUri.host !== requestUrl.host || !/^https?:$/.test(signInUri.protocol)) {
    return jsonSecure({ error: "Farcaster sign-in URL must belong to this application" }, { status: 400 });
  }
  signInUri.hash = "";
  const nonce = createAuthNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + AUTH_NONCE_TTL_MS);
  await context.env.WARPLETS.prepare(
    `INSERT INTO farcaster_auth_nonces (nonce_hash, domain, uri, issued_at, expires_at, consumed_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).bind(
    await hashAuthNonce(nonce),
    requestUrl.host,
    signInUri.href,
    issuedAt.toISOString(),
    expiresAt.toISOString(),
  ).run();
  return jsonSecure({ nonce, expiresAt: expiresAt.toISOString() });
};
