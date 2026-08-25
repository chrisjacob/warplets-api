/**
 * GET /n/[notificationId]?t=<encoded-target-url>&fid=<fid>
 *
 * Click-through tracking redirect. Logs the tap to D1, then 302s to the
 * original target URL. This endpoint is used as the `targetUrl` in
 * notification payloads so every tap is counted before the user lands.
 *
 * Security: `t` param is validated to be an https URL to prevent open redirect.
 */

import { normalizeAppSlug, resolveAppSlugFromUrl } from "../_lib/appSlug.js";

interface Env {
  WARPLETS: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { notificationId } = context.params as { notificationId: string };
  const url = new URL(context.request.url);
  const target = url.searchParams.get("t");
  const fidParam = url.searchParams.get("fid");
  const appSlugParam = url.searchParams.get("app");

  // Validate target is a safe https URL (prevents open redirect to arbitrary schemes)
  if (!target) {
    return new Response("Missing target", { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("Invalid target URL", { status: 400 });
  }

  if (targetUrl.protocol !== "https:") {
    return new Response("Target must be https", { status: 400 });
  }

  const fid = fidParam !== null && /^\d+$/.test(fidParam) ? parseInt(fidParam, 10) : null;
  const appSlug = normalizeAppSlug(appSlugParam, resolveAppSlugFromUrl(targetUrl));

  // Persist the click before redirecting. Pages may stop unfinished work after
  // the response is returned, so a fire-and-forget write can be lost.
  try {
    await context.env.WARPLETS.prepare(
      `INSERT INTO notification_clicks (notification_id, fid, target_url, app_slug) VALUES (?, ?, ?, ?)`
    )
      .bind(notificationId, fid, targetUrl.toString(), appSlug)
      .run();
  } catch (error) {
    console.error("Failed to record notification click", error);
  }

  return Response.redirect(targetUrl.toString(), 302);
};
