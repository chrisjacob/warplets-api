import { createSiweMessage } from "viem/siwe";
import { createAuthNonce, hashAuthNonce, isAllowedAuthChain, normalizeAuthWallet, requireSameOrigin, AUTH_NONCE_TTL_MS } from "../../../_lib/authValidation.js";
import { jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../../../_lib/security.js";

interface Env { WARPLETS: D1Database }
interface ChallengePayload { address?: unknown; chainId?: unknown }

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;
  const payload = parseObjectPayload<ChallengePayload>(parsed.value, ["address", "chainId"]);
  if (!payload.ok) return payload.response;

  const address = normalizeAuthWallet(payload.payload.address);
  const chainId = Number(payload.payload.chainId);
  if (!address) return jsonSecure({ error: "valid address is required" }, { status: 400 });
  if (!Number.isInteger(chainId) || !isAllowedAuthChain(chainId, context.request)) {
    return jsonSecure({ error: "Base Mainnet is required" }, { status: 400 });
  }

  const url = new URL(context.request.url);
  const domain = url.host;
  const uri = url.origin;
  const nonce = createAuthNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + AUTH_NONCE_TTL_MS);
  const nonceHash = await hashAuthNonce(nonce);
  const message = createSiweMessage({
    address,
    chainId,
    domain,
    uri,
    version: "1",
    nonce,
    issuedAt,
    expirationTime: expiresAt,
    statement: "Sign in to 10X Warplets. This request does not trigger a blockchain transaction.",
  });

  await context.env.WARPLETS.prepare(
    `INSERT INTO app_auth_nonces (
       nonce_hash, wallet_address, chain_id, domain, uri, issued_at, expires_at, consumed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).bind(nonceHash, address, chainId, domain, uri, issuedAt.toISOString(), expiresAt.toISOString()).run();

  return jsonSecure({ message, expiresAt: expiresAt.toISOString() });
};
