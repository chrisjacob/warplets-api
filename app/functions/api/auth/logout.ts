import { clearFarcasterFromSession, clearSessionCookies, clearWalletFromSession, deleteAppSession, type AppAuthEnv } from "../../_lib/appAuth.js";
import { requireSameOrigin } from "../../_lib/authValidation.js";
import { jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../../_lib/security.js";

interface LogoutPayload { principal?: unknown }

export const onRequestPost: PagesFunction<AppAuthEnv> = async (context) => {
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  const payload = parseObjectPayload<LogoutPayload>(parsed.value, ["principal"]);
  if (!payload.ok) return payload.response;
  const principal = payload.payload.principal ?? "all";
  if (principal === "wallet") await clearWalletFromSession(context.request, context.env);
  else if (principal === "farcaster") await clearFarcasterFromSession(context.request, context.env);
  else if (principal === "all") await deleteAppSession(context.request, context.env);
  else return jsonSecure({ error: "principal must be wallet, farcaster, or all" }, { status: 400 });

  const headers = new Headers();
  if (principal === "all") for (const cookie of clearSessionCookies()) headers.append("set-cookie", cookie);
  return jsonSecure({ ok: true }, { headers });
};
