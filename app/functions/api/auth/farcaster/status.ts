import { requireSameOrigin } from "../../../_lib/authValidation.js";
import { createOrMergeAppSession } from "../../../_lib/appAuth.js";
import { createActionSessionToken, jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../../../_lib/security.js";
import { onRequestPost as verifyFarcasterRequest } from "./verify.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  APP_SESSION_SECRET?: string;
  ACTION_SESSION_SECRET?: string;
  NEYNAR_API_KEY?: string;
}
interface StatusPayload { channelToken?: unknown; cancel?: unknown }
interface RecoveryPayload {
  recoveryId: string;
  channelToken: string;
  nonce: string;
  uri: string;
  expiresAt: number;
  initiatedAt?: number;
}

interface CompletionReceipt {
  session: Record<string, unknown>;
  expiresAt: number;
}

const receiptKey = (recoveryId: string) => `farcaster-handoff:v1:${recoveryId}`;

function encodeRecoveryCookie(value: RecoveryPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function readRecoveryCookie(request: Request): RecoveryPayload | null {
  const match = (request.headers.get("cookie") ?? "").match(/(?:^|;\s*)__Host-warplets_farcaster_handoff=([^;]+)/);
  if (!match?.[1]) return null;
  try {
    const normalized = decodeURIComponent(match[1]).replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))) as Partial<RecoveryPayload>;
    if (!/^[a-f0-9]{32}$/.test(value.recoveryId ?? "")
      || typeof value.channelToken !== "string" || typeof value.nonce !== "string" || typeof value.uri !== "string"
      || typeof value.expiresAt !== "number" || value.expiresAt <= Date.now()) return null;
    return {
      ...(value as RecoveryPayload),
      ...(typeof value.initiatedAt === "number" && value.initiatedAt > 0 ? { initiatedAt: value.initiatedAt } : {}),
    };
  } catch { return null; }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  const recovery = readRecoveryCookie(context.request);
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 4 * 1024);
  if (!parsed.ok) return parsed.response;
  const payload = parseObjectPayload<StatusPayload>(parsed.value, ["channelToken", "cancel"]);
  if (!payload.ok) return payload.response;
  if (payload.payload.cancel === true) {
    if (recovery?.recoveryId && context.env.WARPLETS_KV) {
      await context.env.WARPLETS_KV.delete(receiptKey(recovery.recoveryId)).catch(() => undefined);
    }
    return jsonSecure({ state: "idle" }, {
      headers: {
        "set-cookie": "__Host-warplets_farcaster_handoff=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0",
      },
    });
  }
  const explicitChannelToken = typeof payload.payload.channelToken === "string"
    ? payload.payload.channelToken.trim()
    : "";
  if (!explicitChannelToken && recovery && !recovery.initiatedAt) {
    return jsonSecure({ state: "idle" });
  }
  const channelToken = explicitChannelToken || recovery?.channelToken || "";
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(channelToken)) {
    return jsonSecure({ error: "Farcaster sign-in channel is invalid" }, { status: 400 });
  }

  if (recovery?.initiatedAt && context.env.WARPLETS_KV) {
    const receipt = await context.env.WARPLETS_KV.get<CompletionReceipt>(receiptKey(recovery.recoveryId), "json").catch(() => null);
    if (receipt && receipt.expiresAt > Date.now() && Number.isInteger(Number(receipt.session.farcasterFid))) {
      const fid = Number(receipt.session.farcasterFid);
      const { session, cookie } = await createOrMergeAppSession(context.request, context.env, {
        farcasterFid: fid,
        farcasterSignerUuid: null,
      });
      const actionSessionToken = context.env.ACTION_SESSION_SECRET
        ? await createActionSessionToken(context.env.ACTION_SESSION_SECRET, fid, 3600)
        : null;
      const headers = new Headers();
      headers.append("set-cookie", cookie);
      return jsonSecure({
        state: "completed",
        session: {
          ...receipt.session,
          farcasterFid: fid,
          walletAddress: session.walletAddress,
          expiresAt: session.expiresAt,
          actionSessionToken,
        },
        recoverySource: "server-receipt",
      }, { headers });
    }
  }

  try {
    const relay = await fetch("https://relay.farcaster.xyz/v1/channel/status", {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${channelToken}`,
      },
    });
    const text = await relay.text();
    if (!text.trim()) {
      return jsonSecure({ error: "Farcaster sign-in status was empty" }, { status: 502 });
    }
    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      return jsonSecure({ error: "Farcaster sign-in status was invalid" }, { status: 502 });
    }
    // Current ConnectKit exposes the successful relay state as `complete`,
    // while the older AuthKit client used by the app types it as `completed`.
    // Keep the application-facing contract stable across both relay clients.
    const relayResult = result && typeof result === "object" ? result as Record<string, unknown> : null;
    const hasCompletedProof = relay.status === 200
      && typeof relayResult?.message === "string"
      && typeof relayResult?.signature === "string";
    const normalizedResult = relayResult
      ? {
          ...relayResult,
          ...(relayResult.state === "complete" || hasCompletedProof ? { state: "completed" } : {}),
        }
      : result;
    const activeRecovery = recovery && recovery.channelToken === channelToken
      ? { ...recovery, initiatedAt: recovery.initiatedAt ?? Date.now() }
      : recovery;
    let responsePayload: unknown = normalizedResult && typeof normalizedResult === "object" && activeRecovery?.initiatedAt
      ? { ...(normalizedResult as Record<string, unknown>), recovery: activeRecovery }
      : normalizedResult;
    let headers = new Headers(activeRecovery?.initiatedAt && (!recovery?.initiatedAt || recovery.initiatedAt !== activeRecovery.initiatedAt)
      ? {
          "set-cookie": `__Host-warplets_farcaster_handoff=${encodeRecoveryCookie(activeRecovery)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=300`,
        }
      : undefined);

    if (hasCompletedProof && relayResult) {
      const verifyHeaders = new Headers(context.request.headers);
      verifyHeaders.set("content-type", "application/json");
      const verifyRequest = new Request(context.request.url, {
        method: "POST",
        headers: verifyHeaders,
        body: JSON.stringify({
          nonce: relayResult.nonce,
          message: relayResult.message,
          signature: relayResult.signature,
          ...(Number.isInteger(Number(relayResult.fid)) && Number(relayResult.fid) > 0 ? { fid: relayResult.fid } : {}),
        }),
      });
      const verified = await verifyFarcasterRequest({
        ...context,
        request: verifyRequest as unknown as typeof context.request,
      });
      const verifiedText = await verified.text();
      let verifiedPayload: Record<string, unknown> = {};
      try { verifiedPayload = verifiedText ? JSON.parse(verifiedText) as Record<string, unknown> : {}; } catch { /* handled below */ }
      const getSetCookie = (verified.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
      const verifiedCookies = typeof getSetCookie === "function"
        ? getSetCookie.call(verified.headers)
        : [verified.headers.get("set-cookie")].filter((value): value is string => Boolean(value));
      headers = new Headers();
      for (const cookie of verifiedCookies) headers.append("set-cookie", cookie);
      if (!verified.ok) {
        if (verifiedCookies.length === 0) {
          headers.append("set-cookie", "__Host-warplets_farcaster_handoff=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0");
        }
        return jsonSecure({
          error: typeof verifiedPayload.error === "string" ? verifiedPayload.error : "Farcaster identity could not be verified",
          state: "failed",
        }, { status: verified.status, headers });
      }
      if (activeRecovery?.recoveryId && context.env.WARPLETS_KV) {
        await context.env.WARPLETS_KV.put(
          receiptKey(activeRecovery.recoveryId),
          JSON.stringify({
            session: {
              farcasterFid: verifiedPayload.farcasterFid,
              username: verifiedPayload.username,
              displayName: verifiedPayload.displayName,
              pfpUrl: verifiedPayload.pfpUrl,
            },
            expiresAt: Date.now() + 5 * 60_000,
          } satisfies CompletionReceipt),
          { expirationTtl: 300 },
        );
      }
      responsePayload = { ...relayResult, state: "completed", session: verifiedPayload };
    }
    return jsonSecure(responsePayload, { status: relay.status, headers });
  } catch {
    return jsonSecure({ error: "Farcaster sign-in status was unavailable" }, { status: 502 });
  }
};
