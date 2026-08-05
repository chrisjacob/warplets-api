import { createClient } from "@farcaster/quick-auth";
import { createOrMergeAppSession, type AppAuthEnv } from "../../../_lib/appAuth.js";
import { requireSameOrigin } from "../../../_lib/authValidation.js";
import { createActionSessionToken, jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../../../_lib/security.js";

interface Env extends AppAuthEnv {
  NEYNAR_API_KEY?: string;
  ACTION_SESSION_SECRET?: string;
}
interface SiwnPayload { signerUuid?: unknown; fid?: unknown }

async function verifyNeynarSigner(env: Env, signerUuid: string, expectedFid: number): Promise<boolean> {
  if (!env.NEYNAR_API_KEY?.trim()) return false;
  const response = await fetch(
    `https://api.neynar.com/v2/farcaster/signer/?signer_uuid=${encodeURIComponent(signerUuid)}`,
    { headers: { accept: "application/json", "x-api-key": env.NEYNAR_API_KEY } },
  );
  if (!response.ok) return false;
  const signer = await response.json() as { fid?: unknown; status?: unknown };
  return Number(signer.fid) === expectedFid && signer.status === "approved";
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  const authorization = context.request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  let fid: number | null = null;
  let signerUuid: string | null = null;

  if (bearer) {
    try {
      const payload = await createClient().verifyJwt({ token: bearer, domain: new URL(context.request.url).host });
      fid = Number(payload.sub);
    } catch {
      return jsonSecure({ error: "Farcaster Quick Auth token is invalid" }, { status: 401 });
    }
  } else {
    const parsed = await readJsonBodyWithLimit<unknown>(context.request, 16 * 1024);
    if (!parsed.ok) return parsed.response;
    const payload = parseObjectPayload<SiwnPayload>(parsed.value, ["signerUuid", "fid"]);
    if (!payload.ok) return payload.response;
    signerUuid = typeof payload.payload.signerUuid === "string" ? payload.payload.signerUuid.trim() : "";
    fid = Number(payload.payload.fid);
    if (!signerUuid || !Number.isInteger(fid) || fid <= 0 || !(await verifyNeynarSigner(context.env, signerUuid, fid))) {
      return jsonSecure({ error: "SIWN identity could not be verified" }, { status: 401 });
    }
  }

  if (!Number.isInteger(fid) || Number(fid) <= 0) {
    return jsonSecure({ error: "Farcaster identity is invalid" }, { status: 401 });
  }
  const { session, cookie } = await createOrMergeAppSession(context.request, context.env, {
    farcasterFid: Number(fid),
    farcasterSignerUuid: signerUuid,
  });
  const actionSessionToken = context.env.ACTION_SESSION_SECRET
    ? await createActionSessionToken(context.env.ACTION_SESSION_SECRET, Number(fid), 3600)
    : null;
  return jsonSecure(
    {
      farcasterFid: session.farcasterFid,
      walletAddress: session.walletAddress,
      expiresAt: session.expiresAt,
      actionSessionToken,
    },
    { headers: { "set-cookie": cookie } },
  );
};
