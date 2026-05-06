import { AppSlug, normalizeAppSlug } from "../_lib/appSlug.js";
import { Env, handleWebhookRequest } from "../webhook.js";

const VALID_APP_SLUGS = new Set<AppSlug>(["app", "drop", "find", "million"]);

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const rawAppSlug = context.params?.appSlug;
  if (typeof rawAppSlug !== "string") {
    return Response.json({ success: false, error: "Missing app slug" }, { status: 400 });
  }

  const appSlug = normalizeAppSlug(rawAppSlug);
  if (!VALID_APP_SLUGS.has(appSlug) || rawAppSlug.trim().toLowerCase() !== appSlug) {
    return Response.json({ success: false, error: "Invalid app slug" }, { status: 404 });
  }

  return handleWebhookRequest(context, appSlug);
};
