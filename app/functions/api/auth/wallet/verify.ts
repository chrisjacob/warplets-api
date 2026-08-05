import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { parseSiweMessage } from "viem/siwe";
import { createOrMergeAppSession, type AppAuthEnv } from "../../../_lib/appAuth.js";
import { hashAuthNonce, isAllowedAuthChain, isUsableStoredNonce, normalizeAuthWallet, requireSameOrigin } from "../../../_lib/authValidation.js";
import { jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../../../_lib/security.js";

interface VerifyPayload { message?: unknown; signature?: unknown }
interface NonceRow {
  wallet_address: string;
  chain_id: number;
  domain: string;
  uri: string;
  expires_at: string;
  consumed_at: string | null;
}

export const onRequestPost: PagesFunction<AppAuthEnv> = async (context) => {
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const payload = parseObjectPayload<VerifyPayload>(parsed.value, ["message", "signature"]);
  if (!payload.ok) return payload.response;
  if (typeof payload.payload.message !== "string" || typeof payload.payload.signature !== "string") {
    return jsonSecure({ error: "message and signature are required" }, { status: 400 });
  }

  let siwe: ReturnType<typeof parseSiweMessage>;
  try {
    siwe = parseSiweMessage(payload.payload.message);
  } catch {
    return jsonSecure({ error: "invalid SIWE message" }, { status: 400 });
  }
  const address = normalizeAuthWallet(siwe.address);
  const chainId = Number(siwe.chainId);
  const nonce = siwe.nonce;
  if (!address || !nonce || !Number.isInteger(chainId) || !isAllowedAuthChain(chainId, context.request)) {
    return jsonSecure({ error: "invalid SIWE identity" }, { status: 400 });
  }

  const nonceHash = await hashAuthNonce(nonce);
  const row = await context.env.WARPLETS.prepare(
    `SELECT wallet_address, chain_id, domain, uri, expires_at, consumed_at
     FROM app_auth_nonces WHERE nonce_hash = ? LIMIT 1`,
  ).bind(nonceHash).first<NonceRow>();
  const requestUrl = new URL(context.request.url);
  if (
    !row || !isUsableStoredNonce(row) ||
    row.wallet_address !== address || Number(row.chain_id) !== chainId ||
    row.domain !== requestUrl.host || row.uri !== requestUrl.origin ||
    siwe.domain !== row.domain || siwe.uri !== row.uri
  ) {
    return jsonSecure({ error: "SIWE challenge is expired, consumed, or does not match" }, { status: 401 });
  }

  const client = createPublicClient({ chain: chainId === baseSepolia.id ? baseSepolia : base, transport: http() });
  let verified = false;
  try {
    verified = await client.verifySiweMessage({
      message: payload.payload.message,
      signature: payload.payload.signature as `0x${string}`,
      address,
      domain: row.domain,
      nonce,
      time: new Date(),
    });
  } catch {
    verified = false;
  }
  if (!verified) return jsonSecure({ error: "wallet signature could not be verified" }, { status: 401 });

  const consumedAt = new Date().toISOString();
  const consumed = await context.env.WARPLETS.prepare(
    "UPDATE app_auth_nonces SET consumed_at = ? WHERE nonce_hash = ? AND consumed_at IS NULL",
  ).bind(consumedAt, nonceHash).run();
  if ((consumed.meta.changes ?? 0) !== 1) {
    return jsonSecure({ error: "SIWE challenge has already been used" }, { status: 409 });
  }

  const { session, cookie } = await createOrMergeAppSession(context.request, context.env, { walletAddress: address });
  return jsonSecure(
    { farcasterFid: session.farcasterFid, walletAddress: session.walletAddress, expiresAt: session.expiresAt },
    { headers: { "set-cookie": cookie } },
  );
};
