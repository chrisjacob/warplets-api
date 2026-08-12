import { createSiweMessage } from "viem/siwe";
import { createAuthNonce, getAuthRequestUrl, hashAuthNonce, isAllowedAuthChain, normalizeAuthWallet, requireSameOrigin, AUTH_NONCE_TTL_MS } from "../../../_lib/authValidation.js";
import { jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../../../_lib/security.js";

interface Env { WARPLETS: D1Database }
interface ChallengePayload { address?: unknown; chainId?: unknown }

const PENDING_WALLET_ADDRESS = "pending";
const SIGN_IN_STATEMENT = "Sign in to 10X Warplets. This request does not trigger a blockchain transaction.";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 16 * 1024);
  if (!parsed.ok) return parsed.response;
  const payload = parseObjectPayload<ChallengePayload>(parsed.value, ["address", "chainId"]);
  if (!payload.ok) return payload.response;

  const address = normalizeAuthWallet(payload.payload.address);
  const chainId = Number(payload.payload.chainId);
  if (payload.payload.address != null && !address) {
    return jsonSecure({ error: "valid address is required" }, { status: 400 });
  }
  if (!Number.isInteger(chainId) || !isAllowedAuthChain(chainId, context.request)) {
    return jsonSecure({ error: "Base Mainnet is required" }, { status: 400 });
  }

  const url = getAuthRequestUrl(context.request);
  const domain = url.host;
  const uri = url.origin;
  const nonce = createAuthNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + AUTH_NONCE_TTL_MS);
  const nonceHash = await hashAuthNonce(nonce);
  const message = address ? createSiweMessage({
    address,
    chainId,
    domain,
    uri,
    version: "1",
    nonce,
    issuedAt,
    expirationTime: expiresAt,
    statement: SIGN_IN_STATEMENT,
  }) : null;

  await context.env.WARPLETS.prepare(
    `INSERT INTO app_auth_nonces (
       nonce_hash, wallet_address, chain_id, domain, uri, issued_at, expires_at, consumed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).bind(nonceHash, address ?? PENDING_WALLET_ADDRESS, chainId, domain, uri, issuedAt.toISOString(), expiresAt.toISOString()).run();

  return jsonSecure({
    ...(message ? { message } : {}),
    expiresAt: expiresAt.toISOString(),
    signInWithEthereum: {
      nonce,
      chainId: `0x${chainId.toString(16)}`,
      domain,
      uri,
      version: "1",
      statement: SIGN_IN_STATEMENT,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expiresAt.toISOString(),
    },
  });
};
