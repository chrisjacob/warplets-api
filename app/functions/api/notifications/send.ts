/**
 * POST /api/notifications/send
 *
 * Admin endpoint to dispatch notifications to one or more FIDs.
 * Requires x-admin-token header matching ADMIN_NOTIFY_TEST_TOKEN secret.
 *
 * Request body:
 *   fids?:           number[]  — specific FIDs to target (omit for all enabled)
 *   title:           string    — max 32 chars
 *   body:            string    — max 128 chars
 *   targetUrl?:      string    — defaults to https://app.10x.meme
 *   notificationId?: string    — max 128 chars, auto-generated if omitted
 *
 * Response body:
 *   { total, results: { fid, state }[] }
 */

import { getNotificationToken } from "../../_lib/kv.js";
import { dispatchNotification } from "../../_lib/dispatch.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV: KVNamespace;
  ADMIN_NOTIFY_TEST_TOKEN?: string;
}

interface RequestBody {
  fids?: number[];
  title: string;
  body: string;
  targetUrl?: string;
  notificationId?: string;
}

interface TokenRow {
  fid: number;
  notification_url: string;
  notification_token: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const configuredToken = context.env.ADMIN_NOTIFY_TEST_TOKEN;
  const suppliedToken = context.request.headers.get("x-admin-token");

  if (!configuredToken || suppliedToken !== configuredToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: RequestBody;
  try {
    json = (await context.request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!json.title || !json.body) {
    return Response.json({ error: "title and body are required" }, { status: 400 });
  }

  const title = json.title.slice(0, 32);
  const body = json.body.slice(0, 128);
  const notificationId = (json.notificationId ?? `campaign-${Date.now()}`).slice(0, 128);
  const targetUrl = json.targetUrl ?? `https://app.10x.meme/?notificationId=${notificationId}`;

  if (!targetUrl.startsWith("https://")) {
    return Response.json({ error: "targetUrl must be https" }, { status: 400 });
  }

  // Hard cap: max 100 FIDs per request (Farcaster tokens-per-request limit)
  if (Array.isArray(json.fids) && json.fids.length > 100) {
    return Response.json({ error: "fids array exceeds max of 100" }, { status: 400 });
  }

  // Resolve target tokens from D1
  let rows: TokenRow[];
  if (Array.isArray(json.fids) && json.fids.length > 0) {
    const placeholders = json.fids.map(() => "?").join(", ");
    const result = await context.env.WARPLETS.prepare(
      `SELECT fid, notification_url, notification_token
       FROM miniapp_notification_tokens
       WHERE enabled = 1 AND fid IN (${placeholders})
       ORDER BY updated_at DESC`
    )
      .bind(...json.fids)
      .all<TokenRow>();
    rows = result.results;
  } else {
    const result = await context.env.WARPLETS.prepare(
      `SELECT fid, notification_url, notification_token
       FROM miniapp_notification_tokens
       WHERE enabled = 1
       ORDER BY updated_at DESC`
    ).all<TokenRow>();
    rows = result.results;
  }

  if (rows.length === 0) {
    return Response.json({ total: 0, results: [], message: "No enabled tokens found" });
  }

  // Dispatch to each FID sequentially (could be batched for scale, fine for now)
  const results: { fid: number; state: string }[] = [];

  for (const row of rows) {
    // Prefer KV token if available (may have fresher token than D1 for recent subscribers)
    const kv = await getNotificationToken(context.env.WARPLETS_KV, row.fid);
    const notificationUrl = kv?.url ?? row.notification_url;
    const notificationToken = kv?.token ?? row.notification_token;

    const result = await dispatchNotification(context.env.WARPLETS, {
      fid: row.fid,
      notificationUrl,
      notificationToken,
      notificationId,
      title,
      body,
      targetUrl,
    }, context.env.WARPLETS_KV);

    results.push({ fid: row.fid, state: result.state });
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.state] = (acc[r.state] ?? 0) + 1;
    return acc;
  }, {});

  return Response.json({
    total: rows.length,
    notificationId,
    summary,
    results,
  });
};
